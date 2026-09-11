import { findWorkspaceByWebhook } from '@/lib/workspace-store';
import { runWebhookFlow, validWebhookSecret } from '@/lib/webhook-runner';
import { startWebhookExecution, updateLiveExecution } from '@/lib/execution-store';

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const activeWebhooks = new Set<string>();

function withinRateLimit(webhookId: string) {
  const now = Date.now();
  const current = requestWindows.get(webhookId);
  if (!current || now - current.startedAt >= 60_000) {
    requestWindows.set(webhookId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: RESPONSE_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...RESPONSE_HEADERS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Synapse-Secret',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 100_000) return json({ ok: false, error: 'La petición supera el máximo de 100 KB.' }, 413);
  const webhookId = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!/^[a-f0-9-]{16,80}$/i.test(webhookId)) return json({ ok: false, error: 'Webhook no encontrado.' }, 404);

  const workspace = await findWorkspaceByWebhook(webhookId);
  if (!workspace) return json({ ok: false, error: 'Webhook no encontrado.' }, 404);
  const entity = workspace.webhook as { webhookSecret?: unknown; name?: unknown };
  const authorization = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const suppliedSecret = request.headers.get('x-synapse-secret')?.trim() || authorization;
  const expectedSecret = typeof entity.webhookSecret === 'string' ? entity.webhookSecret : '';
  if (!validWebhookSecret(expectedSecret, suppliedSecret)) return json({ ok: false, error: 'Clave de webhook inválida.' }, 401);
  if (!withinRateLimit(webhookId)) return json({ ok: false, error: 'Demasiadas peticiones. Inténtalo nuevamente en un minuto.' }, 429);
  if (activeWebhooks.has(webhookId)) return json({ ok: false, error: 'Este webhook ya tiene una ejecución en curso.' }, 409);
  activeWebhooks.add(webhookId);

  let body: string;
  try {
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      body = JSON.stringify(await request.json(), null, 2);
    } else {
      body = await request.text();
    }
  } catch {
    activeWebhooks.delete(webhookId);
    return json({ ok: false, error: 'El cuerpo de la petición no es válido.' }, 400);
  }
  if (body.length > 100_000) {
    activeWebhooks.delete(webhookId);
    return json({ ok: false, error: 'La petición supera el máximo de 100 KB.' }, 413);
  }

  const execution = startWebhookExecution(
    workspace.subject,
    (workspace.webhook as { id?: string }).id ?? webhookId,
    typeof entity.name === 'string' ? entity.name : 'Webhook',
  );
  try {
    const output = await runWebhookFlow(
      workspace.subject,
      workspace.snapshot,
      workspace.webhook,
      body || '(petición sin cuerpo)',
      (trace) => updateLiveExecution(workspace.subject, execution.runId, { trace }),
    );
    updateLiveExecution(workspace.subject, execution.runId, {
      status: 'success',
      completedAt: new Date().toISOString(),
      trace: output.trace,
      output: { entityId: output.agentId, entityName: output.agentName, text: output.text },
    });
    return json({ ok: true, webhook: typeof entity.name === 'string' ? entity.name : 'Webhook', output: output.text, agent: { id: output.agentId, name: output.agentName }, steps: output.steps });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'El flujo webhook no pudo ejecutarse.';
    updateLiveExecution(workspace.subject, execution.runId, { status: 'error', completedAt: new Date().toISOString(), error: message.slice(0, 500) });
    return json({ ok: false, error: message.slice(0, 500) }, 422);
  } finally {
    activeWebhooks.delete(webhookId);
  }
}
