import { readCredentials, readWhatsAppCredentials } from '@/lib/credential-store';
import { startWebhookExecution, updateLiveExecution } from '@/lib/execution-store';
import { runWebhookFlow } from '@/lib/webhook-runner';
import { sendWhatsAppMessage } from '@/lib/whatsapp-actions';
import { claimWhatsAppJob, completeWhatsAppJob, failWhatsAppJob, listReadyWhatsAppJobs } from '@/lib/whatsapp-queue';
import { findWorkspaceByWhatsApp } from '@/lib/workspace-store';
import { appendConversationMemory, clearConversationMemory, isConversationResetRequest, readConversationMemory } from '@/lib/conversation-memory';
import { transcribeWhatsAppAudio } from '@/lib/whatsapp-audio';

type WhatsAppEntity = {
  id?: string;
  name?: string;
  whatsappPhoneNumberId?: string;
  whatsappMemoryEnabled?: boolean;
  whatsappMemoryMaxMessages?: number;
  whatsappMemoryRetentionHours?: number;
};

export async function runPendingWhatsAppJobs() {
  const pending = await listReadyWhatsAppJobs();
  const results: Array<{ jobId: string; status: string }> = [];
  for (const item of pending) {
    const job = await claimWhatsAppJob(item.id);
    let execution: ReturnType<typeof startWebhookExecution> | null = null;
    try {
      const workspace = await findWorkspaceByWhatsApp(job.input.webhookId);
      if (!workspace || workspace.subject !== job.input.subject) throw new Error('Ya no existe el flujo asociado al canal de WhatsApp.');
      const entity = workspace.whatsapp as WhatsAppEntity;
      const configuredPhoneId = entity.whatsappPhoneNumberId?.trim() ?? '';
      if (configuredPhoneId && configuredPhoneId !== job.input.phoneNumberId) throw new Error('El mensaje pertenece a otro número de WhatsApp.');
      const credentials = await readWhatsAppCredentials(workspace.subject);
      if (!credentials) throw new Error('Las credenciales de WhatsApp no están disponibles.');

      const sourceId = entity.id ?? job.input.webhookId;
      const sourceName = typeof entity.name === 'string' ? entity.name : 'WhatsApp';
      execution = startWebhookExecution(workspace.subject, sourceId, sourceName, 'whatsapp');
      let userText = job.input.text;
      if (job.input.messageType === 'audio' || job.input.mediaId) {
        try {
          if (!job.input.mediaId) throw new Error('El mensaje de voz no contiene un identificador de audio.');
          const providerCredentials = await readCredentials(workspace.subject);
          userText = await transcribeWhatsAppAudio(job.input.mediaId, credentials.accessToken, providerCredentials);
        } catch (audioError) {
          const detail = audioError instanceof Error ? audioError.message : 'No se pudo transcribir el mensaje de voz.';
          const response = `No pude procesar ese audio. ${detail}`;
          await sendWhatsAppMessage(configuredPhoneId || job.input.phoneNumberId, job.input.from, response, credentials.accessToken);
          updateLiveExecution(workspace.subject, execution.runId, {
            status: 'error', completedAt: new Date().toISOString(), error: detail.slice(0, 500),
            output: { entityId: sourceId, entityName: sourceName, text: response },
          });
          await completeWhatsAppJob(job);
          results.push({ jobId: job.id.slice(0, 12), status: 'audio_error' });
          continue;
        }
      }
      const memoryEnabled = entity.whatsappMemoryEnabled !== false;
      const memoryIdentity = { subject: workspace.subject, channelId: sourceId, participantId: job.input.from };
      const memoryMaxMessages = Math.min(50, Math.max(2, entity.whatsappMemoryMaxMessages ?? 20));
      const memoryRetentionHours = Math.min(24 * 90, Math.max(1, entity.whatsappMemoryRetentionHours ?? 24 * 7));
      if (memoryEnabled && isConversationResetRequest(userText)) {
        await clearConversationMemory(memoryIdentity);
        const resetResponse = 'Listo. Olvidé el historial de esta conversación y comenzaremos desde cero.';
        await sendWhatsAppMessage(configuredPhoneId || job.input.phoneNumberId, job.input.from, resetResponse, credentials.accessToken);
        updateLiveExecution(workspace.subject, execution.runId, {
          status: 'success',
          completedAt: new Date().toISOString(),
          trace: [{ type: 'node', nodeId: sourceId }],
          output: { entityId: sourceId, entityName: sourceName, text: resetResponse },
        });
        await completeWhatsAppJob(job);
        results.push({ jobId: job.id.slice(0, 12), status: 'success' });
        continue;
      }
      const conversationHistory = memoryEnabled
        ? await readConversationMemory(memoryIdentity, memoryMaxMessages, memoryRetentionHours)
        : [];
      const output = await runWebhookFlow(
        workspace.subject,
        workspace.snapshot,
        workspace.whatsapp,
        `${job.input.messageType === 'audio' ? 'MENSAJE DE VOZ TRANSCRITO' : 'MENSAJE DE WHATSAPP'}\nRemitente: ${job.input.from}\nTexto: ${userText}`,
        (trace) => updateLiveExecution(workspace.subject, execution!.runId, { trace }),
        conversationHistory,
      );
      await sendWhatsAppMessage(configuredPhoneId || job.input.phoneNumberId, job.input.from, output.text, credentials.accessToken);
      if (memoryEnabled) {
        try {
          await appendConversationMemory(memoryIdentity, { user: userText, assistant: output.text }, memoryMaxMessages, memoryRetentionHours);
        } catch (memoryError) {
          console.error(`No se pudo guardar la memoria de WhatsApp ${job.id.slice(0, 12)}:`, memoryError instanceof Error ? memoryError.message : 'error desconocido');
        }
      }
      updateLiveExecution(workspace.subject, execution.runId, {
        status: 'success',
        completedAt: new Date().toISOString(),
        trace: output.trace,
        output: { entityId: output.agentId, entityName: output.agentName, text: output.text },
      });
      await completeWhatsAppJob(job);
      results.push({ jobId: job.id.slice(0, 12), status: 'success' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'El flujo de WhatsApp falló.';
      if (execution) updateLiveExecution(job.input.subject, execution.runId, {
        status: 'error', completedAt: new Date().toISOString(), error: detail.slice(0, 500),
      });
      await failWhatsAppJob(job, detail);
      console.error(`Trabajo de WhatsApp ${job.id.slice(0, 12)} falló (intento ${job.attempts}): ${detail}`);
      results.push({ jobId: job.id.slice(0, 12), status: job.status });
    }
  }
  return { pending: pending.length, results };
}
