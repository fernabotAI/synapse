import { readCredentials, readWhatsAppCredentials } from '@/lib/credential-store';
import { createGmailDraft, readGmailMessages, type GmailMessage } from '@/lib/gmail-actions';
import { runAgentFlow, type AgentInput, type AgentToolInput, type ConnectionInput } from '@/lib/model-runner';
import { executePython } from '@/lib/python-executor';
import { listScheduleRecords, updateTimerState, type TimerOutput, type TimerState, type TimerTraceStep } from '@/lib/schedule-store';
import { normalizeWhatsAppRecipient, sendWhatsAppMessage } from '@/lib/whatsapp-actions';
import { readWorkspace } from '@/lib/workspace-store';

type Entity = {
  id: string;
  kind: 'agent' | 'input' | 'gmail' | 'timer' | 'webhook' | 'python' | 'whatsapp';
  name: string;
  role?: string;
  provider: 'OpenAI' | 'Anthropic' | 'Google';
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  inputValue?: string;
  gmailOperation?: 'read' | 'draft';
  gmailQuery?: string;
  gmailMaxResults?: number;
  gmailRecipient?: string;
  gmailSubject?: string;
  pythonCode?: string;
  pythonInputDescription?: string;
  pythonTimeoutMs?: number;
  whatsappPhoneNumberId?: string;
  whatsappOutboundRecipient?: string;
  webSearchEnabled?: boolean;
  agentMode?: 'standard' | 'orchestrator' | 'specialist';
};

type Connection = { source: string; target: string };
type WorkspaceSnapshot = { agents: Entity[]; connections: Connection[]; gmailRunApproved?: boolean };

async function createScheduledDraft(subject: string, target: Entity, body: string) {
  const to = target.gmailRecipient?.trim() ?? '';
  const mailSubject = target.gmailSubject?.trim() ?? '';
  if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error(`El destinatario de ${target.name} no es válido.`);
  if (!mailSubject) throw new Error(`Define el asunto de ${target.name}.`);
  await createGmailDraft(subject, to, mailSubject, body);
}

function flowFromTarget(snapshot: WorkspaceSnapshot, targetId: string) {
  const byId = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const agentIds = new Set<string>();
  const draftTargets = new Set<string>();
  const whatsappTargets = new Set<string>();
  const queue = [targetId];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const entity = byId.get(id);
    if (!entity || entity.kind === 'timer') continue;
    if (entity.kind === 'agent') agentIds.add(id);
    if (entity.kind === 'gmail' && entity.gmailOperation === 'draft') {
      draftTargets.add(id);
      continue;
    }
    if (entity.kind === 'whatsapp') {
      whatsappTargets.add(id);
      continue;
    }
    snapshot.connections.filter((edge) => edge.source === id).forEach((edge) => queue.push(edge.target));
  }
  const agents = snapshot.agents.filter((entity): entity is Entity & AgentInput => entity.kind === 'agent' && agentIds.has(entity.id));
  const connections: ConnectionInput[] = snapshot.connections.filter((edge) => agentIds.has(edge.source) && agentIds.has(edge.target));
  const tools: AgentToolInput[] = snapshot.connections.flatMap((edge): AgentToolInput[] => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || source.kind !== 'agent' || !agentIds.has(source.id) || !target) return [];
    if (target.kind === 'python') return [{
      id: target.id,
      agentId: source.id,
      kind: 'python' as const,
      name: target.name,
      description: target.role || `Ejecuta ${target.name} cuando sea necesario.`,
      code: target.pythonCode || '',
      inputDescription: target.pythonInputDescription || 'Objeto JSON de entrada.',
      timeoutMs: target.pythonTimeoutMs ?? 8_000,
    }];
    if (target.kind !== 'gmail' || target.gmailOperation === 'draft') return [];
    return [{
      id: target.id,
      agentId: source.id,
      kind: 'gmail_read' as const,
      name: target.name,
      description: `Consulta ${target.name} para obtener correos reales cuando sean necesarios para resolver la tarea.`,
      defaultQuery: target.gmailQuery || 'in:inbox newer_than:7d',
      maxResults: target.gmailMaxResults ?? 5,
    }];
  });
  return {
    agents,
    connections,
    tools,
    draftTargets: snapshot.agents.filter((entity) => draftTargets.has(entity.id)),
    whatsappTargets: snapshot.agents.filter((entity) => whatsappTargets.has(entity.id)),
  };
}

function emailPrompt(source: Entity, messages: GmailMessage[]) {
  const context = messages.map((message, index) => [
    `CORREO ${index + 1}`,
    `De: ${message.from}`,
    `Para: ${message.to}`,
    `Fecha: ${message.date}`,
    `Asunto: ${message.subject}`,
    `Contenido:\n${(message.body || message.snippet).slice(0, 2500)}`,
  ].join('\n')).join('\n\n---\n\n');
  const instruction = (source.inputValue?.trim() || 'Analiza los correos encontrados y responde según tu función.').slice(0, 3_000);
  return `${instruction}\n\nCORREOS NUEVOS OBTENIDOS DE GMAIL\n${context.slice(0, Math.max(1_000, 19_000 - instruction.length))}`;
}

async function runBranch(
  subject: string,
  snapshot: WorkspaceSnapshot,
  timer: Entity,
  target: Entity,
  seenIds: Set<string>,
  trace: TimerTraceStep[],
) {
  const flow = flowFromTarget(snapshot, target.id);
  if (target.kind === 'gmail' && target.gmailOperation === 'draft') {
    throw new Error('Conecta el temporizador a un agente y luego el agente al borrador de Gmail. El temporizador no contiene instrucciones.');
  }
  if (!flow.agents.length) throw new Error(`Conecta ${target.name} a por lo menos un agente.`);

  let prompt = `Ejecución programada por ${timer.name}. Realiza ahora la función definida en tu configuración y utiliza las herramientas conectadas cuando sean necesarias.`;
  const processedIds: string[] = [];
  if (target.kind === 'input') {
    prompt = target.inputValue?.trim() || prompt;
  } else if (target.kind === 'gmail' && target.gmailOperation !== 'draft') {
    if (!snapshot.gmailRunApproved) throw new Error('Autoriza Gmail en la consola antes de activar este temporizador.');
    const messages = (await readGmailMessages(subject, target.gmailQuery || 'in:inbox is:unread', target.gmailMaxResults ?? 5)).messages;
    const unseenMessages = messages.filter((message) => !seenIds.has(message.id));
    if (!unseenMessages.length) return { status: 'no_changes' as const, message: 'Sin correos nuevos; el flujo no se ejecutó.', processedIds: [], output: null };
    prompt = emailPrompt(target, unseenMessages);
    processedIds.push(...unseenMessages.map((message) => message.id));
  }
  const runtimeCapabilities = [
    ...(target.kind === 'gmail' && target.gmailOperation !== 'draft' ? ['Gmail (lectura): los correos reales ya fueron incorporados a esta ejecución.'] : []),
    ...flow.tools.map((tool) => tool.kind === 'gmail_read'
      ? `${tool.name} (lectura de Gmail): puedes consultarla durante esta ejecución.`
      : `${tool.name} (función Python): puedes ejecutarla durante esta ejecución.`),
    ...flow.draftTargets.map((draft) => `${draft.name} (salida Gmail): Synapse creará el borrador con tu respuesta final.`),
    ...flow.whatsappTargets.map((whatsapp) => `${whatsapp.name} (salida WhatsApp): Synapse enviará automáticamente tu respuesta final al destinatario configurado.`),
  ];
  if (runtimeCapabilities.length) {
    prompt += `\n\nCAPACIDADES REALES DE ESTA EJECUCIÓN\n${runtimeCapabilities.map((capability) => `- ${capability}`).join('\n')}\nEstas capacidades pertenecen al flujo anfitrión y debes considerarlas disponibles. No las niegues ni digas que careces de ellas. Si te solicitan una acción que no aparece en esta lista, indícalo con precisión y sin inventar que fue realizada.`;
  }

  const credentials = await readCredentials(subject);
  if (flow.tools.some((tool) => tool.kind === 'gmail_read') && !snapshot.gmailRunApproved) throw new Error('Autoriza Gmail en la consola antes de usarlo como herramienta.');
  const usedTools: string[] = [];
  let previousNodeId = target.id;
  const transcript = await runAgentFlow({
    prompt,
    agents: flow.agents,
    connections: flow.connections,
    credentials,
    tools: flow.tools,
    executeTool: async (tool, arguments_) => {
      if (tool.kind === 'python') return executePython(tool.code, arguments_.input ?? {}, tool.timeoutMs);
      const query = typeof arguments_.query === 'string' && arguments_.query.trim() ? arguments_.query.trim() : tool.defaultQuery;
      const requestedMaximum = typeof arguments_.maxResults === 'number' ? arguments_.maxResults : tool.maxResults;
      const result = await readGmailMessages(subject, query, Math.min(tool.maxResults, requestedMaximum));
      return {
        query: result.query,
        count: result.messages.length,
        messages: result.messages.map((message) => ({
          from: message.from,
          to: message.to,
          date: message.date,
          subject: message.subject,
          content: message.body || message.snippet,
        })),
      };
    },
    onEvent: (event) => {
      if (event.type === 'status') {
        const incoming = snapshot.connections.find((edge) => edge.target === event.agentId && edge.source === previousNodeId)
          ?? snapshot.connections.find((edge) => edge.target === event.agentId && flow.agents.some((agent) => agent.id === edge.source));
        if (incoming) trace.push({ type: 'edge', source: incoming.source, target: incoming.target });
        const lastStep = trace[trace.length - 1];
        if (lastStep?.type !== 'node' || lastStep.nodeId !== event.agentId) trace.push({ type: 'node', nodeId: event.agentId });
        previousNodeId = event.agentId;
      }
      if (event.type === 'tool_start') {
        trace.push({ type: 'edge', source: event.agentId, target: event.toolId });
        trace.push({ type: 'node', nodeId: event.toolId });
      }
      if (event.type === 'tool_result') {
        usedTools.push(`${event.toolName}: ${event.summary}`);
        trace.push({ type: 'node', nodeId: event.agentId });
        previousNodeId = event.agentId;
      }
    },
  });
  for (const draft of flow.draftTargets) {
    if (!snapshot.gmailRunApproved) throw new Error('Autoriza Gmail en la consola antes de crear borradores automáticamente.');
    const incoming = snapshot.connections.find((edge) => edge.target === draft.id && flow.agents.some((agent) => agent.id === edge.source));
    const sourceMessage = incoming
      ? transcript.find((message) => message.agentId === incoming.source)
      : transcript[transcript.length - 1];
    if (sourceMessage) {
      trace.push({ type: 'edge', source: sourceMessage.agentId, target: draft.id });
      trace.push({ type: 'node', nodeId: draft.id });
      await createScheduledDraft(subject, draft, sourceMessage.text);
    }
  }
  if (flow.whatsappTargets.length) {
    const credentials = await readWhatsAppCredentials(subject);
    if (!credentials) throw new Error('Configura las credenciales de WhatsApp antes de usarlo como salida programada.');
    for (const whatsapp of flow.whatsappTargets) {
      const phoneNumberId = whatsapp.whatsappPhoneNumberId?.trim() ?? '';
      const recipient = normalizeWhatsAppRecipient(whatsapp.whatsappOutboundRecipient ?? '');
      if (!phoneNumberId) throw new Error(`Define el Phone Number ID de ${whatsapp.name}.`);
      if (!recipient) throw new Error(`Define un destinatario válido en ${whatsapp.name}, con código de país y solo números.`);
      const incoming = snapshot.connections.find((edge) => edge.target === whatsapp.id && flow.agents.some((agent) => agent.id === edge.source));
      const sourceMessage = incoming
        ? [...transcript].reverse().find((message) => message.agentId === incoming.source) ?? transcript[transcript.length - 1]
        : transcript[transcript.length - 1];
      if (!sourceMessage) throw new Error(`${whatsapp.name} no recibió contenido para enviar.`);
      trace.push({ type: 'edge', source: sourceMessage.agentId, target: whatsapp.id });
      trace.push({ type: 'node', nodeId: whatsapp.id });
      await sendWhatsAppMessage(phoneNumberId, recipient, sourceMessage.text, credentials.accessToken);
    }
  }
  const terminalAgentIds = new Set(flow.agents.filter((agent) => !snapshot.connections.some((edge) => {
    if (edge.source !== agent.id) return false;
    const targetEntity = snapshot.agents.find((entity) => entity.id === edge.target);
    return targetEntity?.kind === 'agent' || targetEntity?.gmailOperation === 'draft' || targetEntity?.kind === 'whatsapp';
  })).map((agent) => agent.id));
  const terminalMessage = [...transcript].reverse().find((message) => terminalAgentIds.has(message.agentId)) ?? transcript[transcript.length - 1];
  const terminalEntity = terminalMessage ? snapshot.agents.find((entity) => entity.id === terminalMessage.agentId) : null;
  return {
    status: 'success' as const,
    message: `${transcript.length} agente${transcript.length === 1 ? '' : 's'} ejecutado${transcript.length === 1 ? '' : 's'} correctamente.${usedTools.length ? ` Herramientas: ${usedTools.join(', ')}.` : ''}${flow.whatsappTargets.length ? ` WhatsApp enviado a ${flow.whatsappTargets.length} destino${flow.whatsappTargets.length === 1 ? '' : 's'}.` : ''}`,
    processedIds,
    output: terminalMessage ? {
      entityId: terminalMessage.agentId,
      entityName: terminalEntity?.name || terminalMessage.name,
      text: terminalMessage.text,
    } satisfies TimerOutput : null,
  };
}

async function executeTimer(subject: string, timerState: TimerState, snapshot: WorkspaceSnapshot) {
  const timer = snapshot.agents.find((entity) => entity.id === timerState.id && entity.kind === 'timer');
  if (!timer) throw new Error('El temporizador ya no existe en el canvas.');
  const targetIds = snapshot.connections.filter((edge) => edge.source === timer.id).map((edge) => edge.target);
  if (!targetIds.length) throw new Error('Conecta el temporizador a la entidad que debe iniciar el flujo.');
  const seenIds = new Set(timerState.seenGmailMessageIds);
  let finalStatus: 'success' | 'no_changes' = 'no_changes';
  const messages: string[] = [];
  const processedIds: string[] = [];
  const trace: TimerTraceStep[] = [{ type: 'node', nodeId: timer.id }];
  let output: TimerOutput | null = null;
  for (const targetId of targetIds) {
    const target = snapshot.agents.find((entity) => entity.id === targetId);
    if (!target) continue;
    trace.push({ type: 'edge', source: timer.id, target: target.id });
    trace.push({ type: 'node', nodeId: target.id });
    const result = await runBranch(subject, snapshot, timer, target, seenIds, trace);
    if (result.status === 'success') finalStatus = 'success';
    messages.push(result.message);
    processedIds.push(...result.processedIds);
    if (result.output) output = result.output;
  }
  return {
    status: finalStatus,
    message: messages.join(' ').slice(0, 240) || 'No se encontraron entidades conectadas.',
    seenIds: [...seenIds, ...processedIds].slice(-300),
    trace: trace.slice(0, 80),
    output,
  };
}

export async function runDueSchedules(now = new Date()) {
  const records = await listScheduleRecords();
  const due = records.flatMap((record) => record.timers
    .filter((timer) => timer.enabled && timer.nextRunAt && Date.parse(timer.nextRunAt) <= now.getTime())
    .map((timer) => ({ subject: record.subject, timer }))).slice(0, 20);
  const results: Array<{ timerId: string; status: string }> = [];

  for (const item of due) {
    const nextRunAt = new Date(now.getTime() + item.timer.intervalMinutes * 60_000).toISOString();
    await updateTimerState(item.subject, item.timer.id, { lastStatus: 'running', nextRunAt, lastMessage: 'Ejecutando…', lastTrace: [], lastOutput: null });
    try {
      const workspace = await readWorkspace(item.subject);
      if (!workspace?.snapshot || typeof workspace.snapshot !== 'object') throw new Error('No se encontró el flujo guardado.');
      const snapshot = workspace.snapshot as WorkspaceSnapshot;
      if (!Array.isArray(snapshot.agents) || !Array.isArray(snapshot.connections)) throw new Error('El flujo guardado no es válido.');
      const result = await executeTimer(item.subject, item.timer, snapshot);
      await updateTimerState(item.subject, item.timer.id, {
        lastRunAt: now.toISOString(),
        lastStatus: result.status,
        lastMessage: result.message,
        nextRunAt,
        seenGmailMessageIds: result.seenIds,
        lastTrace: result.trace,
        lastOutput: result.output,
      });
      results.push({ timerId: item.timer.id, status: result.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La ejecución programada falló.';
      await updateTimerState(item.subject, item.timer.id, {
        lastRunAt: now.toISOString(),
        lastStatus: 'error',
        lastMessage: message.slice(0, 240),
        nextRunAt,
        lastOutput: null,
      });
      results.push({ timerId: item.timer.id, status: 'error' });
    }
  }
  return { checked: records.length, due: due.length, results };
}
