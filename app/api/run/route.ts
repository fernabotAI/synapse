import { readAuthSession } from '@/lib/auth';
import { readCredentials } from '@/lib/credential-store';
import { readGmailMessages } from '@/lib/gmail-actions';
import { executePython } from '@/lib/python-executor';
import {
  runAgentFlow,
  type AgentInput,
  type AgentRunEvent,
  type AgentToolInput,
  type ConnectionInput,
  type Provider,
} from '@/lib/model-runner';

type RunRequest = {
  prompt: string;
  agents: AgentInput[];
  connections: ConnectionInput[];
  tools?: AgentToolInput[];
  gmailApproved?: boolean;
};
const encoder = new TextEncoder();

export async function POST(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401 });

  let body: RunRequest;
  try {
    body = await request.json() as RunRequest;
  } catch {
    return Response.json({ error: 'La solicitud no contiene JSON válido.' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const agents = Array.isArray(body.agents) ? body.agents.slice(0, 12) : [];
  const connections = Array.isArray(body.connections) ? body.connections : [];
  const agentIds = new Set(agents.map((agent) => agent.id));
  const tools = Array.isArray(body.tools)
    ? body.tools.slice(0, 12).flatMap((tool): AgentToolInput[] => {
      if (!tool || !agentIds.has(tool.agentId)) return [];
      if (tool.kind === 'python') return [{
        id: String(tool.id).slice(0, 100),
        agentId: String(tool.agentId).slice(0, 100),
        kind: 'python',
        name: String(tool.name || 'Python').slice(0, 100),
        description: String(tool.description || 'Ejecuta una función Python aislada.').slice(0, 500),
        code: String(tool.code || '').slice(0, 12_000),
        inputDescription: String(tool.inputDescription || 'Objeto JSON de entrada.').slice(0, 500),
        timeoutMs: Math.min(15_000, Math.max(2_000, Number(tool.timeoutMs) || 8_000)),
      }];
      if (tool.kind !== 'gmail_read') return [];
      return [{
        id: String(tool.id).slice(0, 100),
        agentId: String(tool.agentId).slice(0, 100),
        kind: 'gmail_read',
        name: String(tool.name || 'Gmail').slice(0, 100),
        description: String(tool.description || 'Consulta correos de Gmail cuando sea necesario.').slice(0, 500),
        defaultQuery: String(tool.defaultQuery || 'in:inbox newer_than:7d').slice(0, 500),
        maxResults: Math.min(10, Math.max(1, Number(tool.maxResults) || 5)),
      }];
    })
    : [];
  let credentials;
  try {
    credentials = await readCredentials(session.sub);
  } catch {
    return Response.json({ error: 'No se pudo abrir tu bóveda de credenciales.' }, { status: 500 });
  }

  if (!prompt || prompt.length > 20_000) return Response.json({ error: 'El prompt debe contener entre 1 y 20.000 caracteres.' }, { status: 400 });
  if (!agents.length) return Response.json({ error: 'El canvas no contiene agentes.' }, { status: 400 });
  if (tools.some((tool) => tool.kind === 'gmail_read') && !body.gmailApproved) return Response.json({ error: 'Autoriza el uso de Gmail para esta ejecución.' }, { status: 400 });

  const missingProviders = [...new Set(agents.map((agent) => agent.provider))]
    .filter((provider): provider is Provider => !credentials[provider]?.trim());
  if (missingProviders.length) {
    return Response.json({ error: `Falta una credencial para: ${missingProviders.join(', ')}.`, missingProviders }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runAgentFlow({
          prompt,
          agents,
          connections,
          credentials,
          tools,
          executeTool: async (tool, arguments_) => {
            if (tool.kind === 'python') return executePython(tool.code, arguments_.input ?? {}, tool.timeoutMs);
            const requestedQuery = typeof arguments_.query === 'string' ? arguments_.query.trim() : '';
            const requestedMaximum = typeof arguments_.maxResults === 'number' ? arguments_.maxResults : tool.maxResults;
            const result = await readGmailMessages(session.sub, requestedQuery || tool.defaultQuery, Math.min(tool.maxResults, requestedMaximum));
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
          onEvent: (event: AgentRunEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'La ejecución falló por un error desconocido.';
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
