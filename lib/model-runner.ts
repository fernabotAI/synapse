import type { StoredCredentials } from '@/lib/credential-store';

export type Provider = 'OpenAI' | 'Anthropic' | 'Google';
export type AgentMode = 'standard' | 'orchestrator' | 'specialist';

export type AgentInput = {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  webSearchEnabled?: boolean;
  agentMode?: AgentMode;
};

export type ConnectionInput = { source: string; target: string };

type AgentToolBase = {
  id: string;
  agentId: string;
  name: string;
  description: string;
};

export type AgentToolInput = AgentToolBase & ({
  kind: 'gmail_read';
  defaultQuery: string;
  maxResults: number;
} | {
  kind: 'python';
  code: string;
  inputDescription: string;
  timeoutMs: number;
});

type ToolCall = { callId: string; name: string; arguments: Record<string, unknown> };
type ToolExecutor = (tool: AgentToolInput, arguments_: Record<string, unknown>) => Promise<unknown>;

export type AgentRunEvent =
  | { type: 'status'; agentId: string }
  | { type: 'tool_start'; agentId: string; toolId: string; toolName: string }
  | { type: 'tool_result'; agentId: string; toolId: string; toolName: string; summary: string }
  | { type: 'message'; agentId: string; text: string; latency: string }
  | { type: 'done'; count: number };

export type AgentRunMessage = { agentId: string; name: string; text: string; latency: string };

export const supportedProviders: Provider[] = ['OpenAI', 'Anthropic', 'Google'];

function boundedNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function orderAgents(agents: AgentInput[], connections: ConnectionInput[]) {
  const ids = new Set(agents.map((agent) => agent.id));
  const incoming = new Map(agents.map((agent) => [agent.id, 0]));
  const outgoing = new Map(agents.map((agent) => [agent.id, [] as string[]]));
  for (const connection of connections) {
    if (!ids.has(connection.source) || !ids.has(connection.target)) continue;
    incoming.set(connection.target, (incoming.get(connection.target) ?? 0) + 1);
    outgoing.get(connection.source)?.push(connection.target);
  }

  const queue = agents.filter((agent) => incoming.get(agent.id) === 0).map((agent) => agent.id);
  const orderedIds: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (orderedIds.includes(id)) continue;
    orderedIds.push(id);
    for (const target of outgoing.get(id) ?? []) {
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const agent of agents) {
    if (!orderedIds.includes(agent.id)) orderedIds.push(agent.id);
  }
  return orderedIds.map((id) => agents.find((agent) => agent.id === id)!).filter(Boolean);
}

function upstreamAgents(agentId: string, agentIds: Set<string>, connections: ConnectionInput[]) {
  const upstream = new Set<string>();
  const queue = connections.filter((connection) => connection.target === agentId && agentIds.has(connection.source)).map((connection) => connection.source);
  while (queue.length) {
    const id = queue.shift()!;
    if (upstream.has(id)) continue;
    upstream.add(id);
    connections.filter((connection) => connection.target === id && agentIds.has(connection.source)).forEach((connection) => queue.push(connection.source));
  }
  return upstream;
}

async function providerError(response: Response, provider: Provider, apiKey: string) {
  let detail = '';
  try {
    const payload = await response.json() as { error?: { message?: string } | string; message?: string };
    detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? '';
  } catch {
    detail = '';
  }
  const safeDetail = detail
    .replaceAll(apiKey, '[credencial]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[credencial]')
    .slice(0, 240);
  return `${provider} respondió con error ${response.status}${safeDetail ? `: ${safeDetail}` : ''}`;
}

function toolForCall(tools: AgentToolInput[], name: string) {
  return tools.find((tool) => toolFunctionName(tool) === name);
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toolSummary(result: unknown) {
  if (result && typeof result === 'object' && 'messages' in result && Array.isArray((result as { messages?: unknown[] }).messages)) {
    const count = (result as { messages: unknown[] }).messages.length;
    return `${count} correo${count === 1 ? '' : 's'} recibido${count === 1 ? '' : 's'}`;
  }
  if (result && typeof result === 'object' && 'result' in result) return 'Python devolvió un resultado';
  return 'Herramienta completada';
}

function sourceLink(title: string, uri: string) {
  const label = title.replaceAll('[', '').replaceAll(']', '').replace(/[\r\n]/g, '').trim() || 'Fuente';
  return `[${label}](${uri})`;
}

function normalizedWords(value: string) {
  const stopWords = new Set(['agente', 'cuando', 'debe', 'desde', 'ejecuta', 'funcion', 'herramienta', 'necesario', 'objeto', 'para', 'respuesta', 'segun', 'solicitud', 'utiliza']);
  return new Set(value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((word) => !stopWords.has(word)) ?? []);
}

export function needsWebSearch(request: string) {
  const value = request.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(internet|web|google|online|en linea|busca(?:r|me)?|investiga(?:r)?|fuentes?|enlaces?|links?)\b/.test(value)
    || /\b(hoy|actual(?:es|mente)?|actualizad[oa]s?|reciente(?:s)?|ultim[oa]s?|ahora mismo|en vivo|noticias?|precio(?:s)?|cotizacion(?:es)?|clima|pronostico)\b/.test(value)
    || /\b(cuant[oa]s?|cuales?)\b[^?\n]{0,120}\b(hay|existen|operan|funcionan|estan)\b/.test(value);
}

export function requiresExternalKnowledge(request: string) {
  if (needsWebSearch(request)) return true;
  const value = request.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const asksForEntities = /\b(nombra(?:me)?|lista(?:me)?|enumera(?:me)?|menciona(?:me)?|dime|indica(?:me)?|cuales?)\b/.test(value);
  const realWorldScope = /\b(que hay|que existen|provincia|region|comuna|ciudad|localidad|pais|ubicad[oa]s?|operativ[oa]s?|direcciones?|telefonos?)\b/.test(value);
  return asksForEntities && realWorldScope;
}

function isContextualFollowup(request: string) {
  const value = request.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(eso|esa|ese|esas|esos|ellos|ellas|lo|los|la|las|sus|anterior(?:es)?|nombres?|listalos?|nombralos?|continua|amplia|detalla)\b/.test(value);
}

export function routeAgentTools(request: string, tools: AgentToolInput[]) {
  if (!tools.length) return [];
  const normalized = request.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(gmail|e-?mail|correo(?:s)?|bandeja de entrada|inbox|mensajes? recibidos?)\b/.test(normalized)) {
    const gmail = tools.find((tool) => tool.kind === 'gmail_read');
    return gmail ? [gmail] : [];
  }
  const pythonTools = tools.filter((tool) => tool.kind === 'python');
  if (!pythonTools.length) return [];
  const requestWords = normalizedWords(request);
  const ranked = pythonTools.map((tool) => {
    const toolWords = normalizedWords(`${tool.name} ${tool.description} ${tool.inputDescription}`);
    const overlap = [...requestWords].filter((word) => toolWords.has(word)).length;
    return { tool, overlap };
  }).sort((left, right) => right.overlap - left.overlap);
  const explicitlyPython = /\b(python|script|codigo|calcula(?:r)?|calculo)\b/.test(normalized);
  const dateOrTime = /\b(fecha|hora|dia de hoy|que dia)\b/.test(normalized);
  const dateTool = pythonTools.find((tool) => /\b(fecha|hora|reloj|timezone|zona horaria)\b/.test(
    `${tool.name} ${tool.description} ${tool.inputDescription}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  ));
  if (dateOrTime && dateTool) return [dateTool];
  if (explicitlyPython || (ranked[0]?.overlap ?? 0) >= 2) return ranked[0] ? [ranked[0].tool] : [];
  return [];
}

function toolFunctionName(tool: AgentToolInput) {
  const prefix = tool.kind === 'python' ? 'python' : 'gmail';
  return `${prefix}_${tool.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 60);
}

function openAIToolParameters(tool: AgentToolInput) {
  if (tool.kind === 'python') return {
    type: 'object',
    properties: { input: { type: 'object', description: tool.inputDescription, additionalProperties: true } },
    required: ['input'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: {
      query: { type: 'string', description: `Búsqueda de Gmail. Si se omite usa: ${tool.defaultQuery}` },
      maxResults: { type: 'integer', minimum: 1, maximum: tool.maxResults },
    },
    additionalProperties: false,
  };
}

function googleToolParameters(tool: AgentToolInput) {
  if (tool.kind === 'python') return {
    type: 'OBJECT',
    properties: { input: { type: 'OBJECT', description: tool.inputDescription } },
    required: ['input'],
  };
  return {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: `Búsqueda de Gmail. Si se omite usa: ${tool.defaultQuery}` },
      maxResults: { type: 'INTEGER', description: `Cantidad de correos, máximo ${tool.maxResults}` },
    },
  };
}

async function executeCalls(agent: AgentInput, tools: AgentToolInput[], calls: ToolCall[], executeTool: ToolExecutor, onEvent?: (event: AgentRunEvent) => void) {
  const results: Array<{ call: ToolCall; output: unknown }> = [];
  for (const call of calls.slice(0, 4)) {
    const tool = toolForCall(tools, call.name);
    if (!tool) throw new Error(`El agente intentó usar una herramienta que no está conectada: ${call.name}.`);
    onEvent?.({ type: 'tool_start', agentId: agent.id, toolId: tool.id, toolName: tool.name });
    const output = await executeTool(tool, call.arguments);
    onEvent?.({ type: 'tool_result', agentId: agent.id, toolId: tool.id, toolName: tool.name, summary: toolSummary(output) });
    results.push({ call, output });
  }
  return results;
}

async function callOpenAI(agent: AgentInput, input: string, apiKey: string, tools: AgentToolInput[], executeTool?: ToolExecutor, onEvent?: (event: AgentRunEvent) => void) {
  const conversation: unknown[] = [{ role: 'user', content: input }];
  const requiredTool = tools.length === 1 ? toolFunctionName(tools[0]) : null;
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agent.model,
        instructions: agent.systemPrompt,
        input: conversation,
        max_output_tokens: boundedNumber(agent.maxTokens, 32, 4096),
        temperature: boundedNumber(agent.temperature, 0, 1),
        store: false,
        include: ['reasoning.encrypted_content'],
        tool_choice: requiredTool && round === 0 ? { type: 'function', name: requiredTool } : 'auto',
        tools: tools.length ? tools.map((tool) => ({
          type: 'function',
          name: toolFunctionName(tool),
          description: tool.description,
          parameters: openAIToolParameters(tool),
        })) : undefined,
      }),
    });
    if (!response.ok) throw new Error(await providerError(response, 'OpenAI', apiKey));
    const data = await response.json() as {
      output_text?: string;
      output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const calls = (data.output ?? []).filter((item) => item.type === 'function_call' && item.call_id && item.name).map((item) => ({
      callId: item.call_id!, name: item.name!, arguments: parseArguments(item.arguments),
    }));
    if (!calls.length) {
      const text = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text ?? '').join('\n');
      if (!text?.trim()) throw new Error('OpenAI no devolvió contenido de texto.');
      return text.trim();
    }
    if (!executeTool) throw new Error('Las herramientas del agente no están disponibles en esta ejecución.');
    conversation.push(...(data.output ?? []));
    const results = await executeCalls(agent, tools, calls, executeTool, onEvent);
    conversation.push(...results.map(({ call, output }) => ({ type: 'function_call_output', call_id: call.callId, output: JSON.stringify(output) })));
  }
  throw new Error('El agente superó el límite de consultas a herramientas.');
}

async function callAnthropic(agent: AgentInput, input: string, apiKey: string, tools: AgentToolInput[], executeTool?: ToolExecutor, onEvent?: (event: AgentRunEvent) => void) {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [{ role: 'user', content: input }];
  const requiredTool = tools.length === 1 ? toolFunctionName(tools[0]) : null;
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model,
      system: agent.systemPrompt,
      messages,
      max_tokens: boundedNumber(agent.maxTokens, 32, 4096),
      tool_choice: requiredTool && round === 0 ? { type: 'tool', name: requiredTool } : { type: 'auto' },
      tools: tools.length ? tools.map((tool) => ({
        name: toolFunctionName(tool),
        description: tool.description,
        input_schema: openAIToolParameters(tool),
      })) : undefined,
    }),
    });
    if (!response.ok) throw new Error(await providerError(response, 'Anthropic', apiKey));
    const data = await response.json() as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }> };
    const calls = (data.content ?? []).filter((item) => item.type === 'tool_use' && item.id && item.name).map((item) => ({
      callId: item.id!, name: item.name!, arguments: parseArguments(item.input),
    }));
    if (!calls.length) {
      const text = data.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n');
      if (!text?.trim()) throw new Error('Anthropic no devolvió contenido de texto.');
      return text.trim();
    }
    if (!executeTool) throw new Error('Las herramientas del agente no están disponibles en esta ejecución.');
    messages.push({ role: 'assistant', content: data.content ?? [] });
    const results = await executeCalls(agent, tools, calls, executeTool, onEvent);
    messages.push({ role: 'user', content: results.map(({ call, output }) => ({ type: 'tool_result', tool_use_id: call.callId, content: JSON.stringify(output) })) });
  }
  throw new Error('El agente superó el límite de consultas a herramientas.');
}

async function callGoogle(agent: AgentInput, input: string, apiKey: string, tools: AgentToolInput[], useWebSearch: boolean, executeTool?: ToolExecutor, onEvent?: (event: AgentRunEvent) => void) {
  const model = encodeURIComponent(agent.model);
  const contents: Array<{ role: string; parts: unknown[] }> = [{ role: 'user', parts: [{ text: input }] }];
  const requiredTool = tools.length === 1 ? toolFunctionName(tools[0]) : null;
  const googleTools = [
    ...(tools.length ? [{ functionDeclarations: tools.map((tool) => ({
      name: toolFunctionName(tool),
      description: tool.description,
      parameters: googleToolParameters(tool),
    })) }] : []),
    ...(useWebSearch ? [{ googleSearch: {} }] : []),
  ];
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: agent.systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: boundedNumber(agent.maxTokens, 32, 4096) },
      tools: googleTools.length ? googleTools : undefined,
      toolConfig: tools.length ? {
        functionCallingConfig: {
          mode: requiredTool && round === 0 ? 'ANY' : 'AUTO',
          ...(requiredTool && round === 0 ? { allowedFunctionNames: [requiredTool] } : {}),
        },
      } : undefined,
    }),
    });
    if (!response.ok) throw new Error(await providerError(response, 'Google', apiKey));
    const data = await response.json() as { candidates?: Array<{ content?: { role?: string; parts?: Array<{ text?: string; functionCall?: { id?: string; name?: string; args?: unknown } }> }; groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }> };
    const candidate = data.candidates?.[0];
    const content = candidate?.content;
    const calls = (content?.parts ?? []).filter((part) => part.functionCall?.name).map((part, index) => ({
      callId: part.functionCall!.id || `google-${round}-${index}`, name: part.functionCall!.name!, arguments: parseArguments(part.functionCall!.args),
    }));
    if (!calls.length) {
      const text = content?.parts?.map((part) => part.text ?? '').join('\n');
      if (!text?.trim()) throw new Error('Gemini no devolvió contenido de texto.');
      const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
        .flatMap((chunk) => chunk.web?.uri ? [{ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri }] : [])
        .filter((source, index, all) => all.findIndex((item) => item.uri === source.uri) === index)
        .slice(0, 5);
      return `${text.trim()}${sources.length ? `\n\nFuentes:\n${sources.map((source) => `- ${sourceLink(source.title, source.uri)}`).join('\n')}` : ''}`;
    }
    if (!executeTool) throw new Error('Las herramientas del agente no están disponibles en esta ejecución.');
    contents.push({ role: content?.role || 'model', parts: content?.parts ?? [] });
    const results = await executeCalls(agent, tools, calls, executeTool, onEvent);
    contents.push({
      role: 'user',
      parts: results.map(({ call, output }) => ({ functionResponse: { id: call.callId, name: call.name, response: { result: output } } })),
    });
  }
  throw new Error('El agente superó el límite de consultas a herramientas.');
}

async function callProvider(agent: AgentInput, input: string, apiKey: string, tools: AgentToolInput[], useWebSearch: boolean, executeTool?: ToolExecutor, onEvent?: (event: AgentRunEvent) => void) {
  if (agent.provider === 'OpenAI') return callOpenAI(agent, input, apiKey, tools, executeTool, onEvent);
  if (agent.provider === 'Anthropic') return callAnthropic(agent, input, apiKey, tools, executeTool, onEvent);
  if (agent.provider === 'Google') return callGoogle(agent, input, apiKey, tools, useWebSearch, executeTool, onEvent);
  throw new Error('El proveedor seleccionado todavía no está conectado.');
}

function parseOrchestratorRoute(value: string, allowedRoutes: Set<string>) {
  const candidate = value.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as { route?: unknown };
    return typeof parsed.route === 'string' && allowedRoutes.has(parsed.route) ? parsed.route : null;
  } catch {
    return null;
  }
}

function agentMessage(agent: AgentInput, text: string, startedAt: number): AgentRunMessage {
  return {
    agentId: agent.id,
    name: agent.name,
    text,
    latency: `${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
  };
}

async function runOrchestratedFlow(options: {
  prompt: string;
  routingPrompt: string;
  routingContext?: string;
  orchestrator: AgentInput;
  agents: AgentInput[];
  connections: ConnectionInput[];
  credentials: StoredCredentials;
  tools: AgentToolInput[];
  executeTool?: ToolExecutor;
  onEvent?: (event: AgentRunEvent) => void;
}) {
  const { orchestrator } = options;
  const connectedAgentIds = new Set(options.connections.filter((edge) => edge.source === orchestrator.id).map((edge) => edge.target));
  const specialists = options.agents.filter((agent) => connectedAgentIds.has(agent.id) && agent.id !== orchestrator.id);
  const connectedTools = options.tools.filter((tool) => tool.agentId === orchestrator.id);
  const capabilities = [
    ...specialists.map((agent) => ({
      route: `agent:${agent.id}`,
      description: agent.webSearchEnabled
        ? `${agent.name}: búsqueda real en internet para información pública, lugares, listados, cantidades, noticias y datos verificables.`
        : `${agent.name}: ${agent.systemPrompt || agent.name}`.slice(0, 500),
    })),
    ...connectedTools.map((tool) => ({ route: `tool:${tool.id}`, description: `${tool.name}: ${tool.description}`.slice(0, 500) })),
    { route: 'general', description: 'Respuesta general que no requiere información externa ni herramientas.' },
  ];
  const allowedRoutes = new Set(capabilities.map((capability) => capability.route));
  const deterministicTool = routeAgentTools(options.routingPrompt, connectedTools)[0];
  const webSpecialist = specialists.find((agent) => agent.webSearchEnabled);
  const contextApplies = Boolean(options.routingContext && isContextualFollowup(options.routingPrompt));
  const externalKnowledgeRequest = requiresExternalKnowledge(options.routingPrompt)
    || Boolean(contextApplies && requiresExternalKnowledge(options.routingContext!));
  let selectedRoute = deterministicTool ? `tool:${deterministicTool.id}` : externalKnowledgeRequest && webSpecialist ? `agent:${webSpecialist.id}` : null;

  options.onEvent?.({ type: 'status', agentId: orchestrator.id });
  if (!selectedRoute) {
    const routingAgent: AgentInput = {
      ...orchestrator,
      name: 'Orquestador',
      systemPrompt: [
        'Eres un orquestador estricto. No respondas la pregunta del usuario ni intentes resolverla.',
        'Tu única función es escoger exactamente una capacidad disponible.',
        'Usa Gmail solo si el usuario pide explícitamente leer, revisar o resumir su correo o bandeja.',
        'Usa búsqueda web para hechos del mundo real: lugares, instituciones, personas, listados, cantidades, noticias o información que deba verificarse, aunque el usuario no diga “internet”.',
        'Usa una función Python solo cuando su descripción coincida directamente con la tarea.',
        'Usa general para conversación, redacción, explicación o razonamiento que no necesite datos externos.',
        'Devuelve únicamente JSON válido con esta forma: {"route":"identificador"}.',
      ].join('\n'),
      temperature: 0,
      maxTokens: 200,
      webSearchEnabled: false,
    };
    const routingContext = contextApplies ? `\n\nCONTEXTO DE LA CONVERSACIÓN\n${options.routingContext!.slice(-5_000)}` : '';
    const routingInput = `PETICIÓN ACTUAL DEL USUARIO\n${options.routingPrompt}${routingContext}\n\nCAPACIDADES DISPONIBLES\n${capabilities.map((item) => `- ${item.route}: ${item.description}`).join('\n')}`;
    try {
      const decision = await callProvider(routingAgent, routingInput, options.credentials[routingAgent.provider]!.trim(), [], false);
      selectedRoute = parseOrchestratorRoute(decision, allowedRoutes);
    } catch {
      selectedRoute = null;
    }
  }
  selectedRoute ??= webSpecialist && externalKnowledgeRequest ? `agent:${webSpecialist.id}` : 'general';

  const selectedSpecialist = selectedRoute.startsWith('agent:')
    ? specialists.find((agent) => `agent:${agent.id}` === selectedRoute)
    : null;
  const selectedTool = selectedRoute.startsWith('tool:')
    ? connectedTools.find((tool) => `tool:${tool.id}` === selectedRoute)
    : null;

  if (selectedSpecialist) {
    options.onEvent?.({ type: 'status', agentId: selectedSpecialist.id });
    const startedAt = performance.now();
    const useWebSearch = selectedSpecialist.webSearchEnabled === true;
    const specialistTools = routeAgentTools(options.routingPrompt, options.tools.filter((tool) => tool.agentId === selectedSpecialist.id));
    const input = `PETICIÓN DEL USUARIO\n${options.prompt}\n\nHas sido seleccionado por el Orquestador. Resuelve únicamente esta tarea dentro de tu especialidad.${useWebSearch ? '\nDebes consultar Google Search y verificar la información. No escribas una sección de fuentes: Synapse la agregará automáticamente.' : ''}`;
    try {
      const text = await callProvider(selectedSpecialist, input, options.credentials[selectedSpecialist.provider]!.trim(), specialistTools, useWebSearch, options.executeTool, options.onEvent);
      const message = agentMessage(selectedSpecialist, text, startedAt);
      options.onEvent?.({ type: 'message', agentId: message.agentId, text: message.text, latency: message.latency });
      options.onEvent?.({ type: 'done', count: 1 });
      return [message];
    } catch {
      const message = agentMessage(selectedSpecialist, 'No pude consultar la fuente especializada en este momento. Inténtalo nuevamente en unos minutos.', startedAt);
      options.onEvent?.({ type: 'message', agentId: message.agentId, text: message.text, latency: message.latency });
      options.onEvent?.({ type: 'done', count: 1 });
      return [message];
    }
  }

  const responder: AgentInput = {
    ...orchestrator,
    name: selectedTool ? `Especialista · ${selectedTool.name}` : 'Generalista',
    systemPrompt: selectedTool
      ? `Eres el especialista exclusivo de ${selectedTool.name}. Usa esa herramienta una sola vez y responde en español basándote únicamente en su resultado.`
      : 'Eres un asistente general. Responde en español de forma clara. No afirmes haber consultado herramientas ni información actual si no las tienes disponibles.',
    webSearchEnabled: false,
  };
  const startedAt = performance.now();
  try {
    const text = await callProvider(responder, options.prompt, options.credentials[responder.provider]!.trim(), selectedTool ? [selectedTool] : [], false, options.executeTool, options.onEvent);
    const message = agentMessage(responder, text, startedAt);
    options.onEvent?.({ type: 'message', agentId: message.agentId, text: message.text, latency: message.latency });
    options.onEvent?.({ type: 'done', count: 1 });
    return [message];
  } catch {
    const message = agentMessage(responder, 'No pude completar esta solicitud en este momento. Inténtalo nuevamente.', startedAt);
    options.onEvent?.({ type: 'message', agentId: message.agentId, text: message.text, latency: message.latency });
    options.onEvent?.({ type: 'done', count: 1 });
    return [message];
  }
}

export function validateAgentRun(prompt: string, agents: AgentInput[], credentials: StoredCredentials) {
  if (!prompt || prompt.length > 20_000) throw new Error('El prompt debe contener entre 1 y 20.000 caracteres.');
  if (!agents.length) throw new Error('El canvas no contiene agentes.');
  if (agents.some((agent) => !supportedProviders.includes(agent.provider))) throw new Error('El flujo contiene un proveedor que todavía no está conectado.');
  const missingProviders = [...new Set(agents.map((agent) => agent.provider))].filter((provider) => !credentials[provider]?.trim());
  if (missingProviders.length) {
    const error = new Error(`Falta una credencial para: ${missingProviders.join(', ')}.`) as Error & { missingProviders?: Provider[] };
    error.missingProviders = missingProviders;
    throw error;
  }
}

export async function runAgentFlow(options: {
  prompt: string;
  routingPrompt?: string;
  routingContext?: string;
  agents: AgentInput[];
  connections: ConnectionInput[];
  credentials: StoredCredentials;
  tools?: AgentToolInput[];
  executeTool?: ToolExecutor;
  onEvent?: (event: AgentRunEvent) => void;
}) {
  validateAgentRun(options.prompt, options.agents, options.credentials);
  const orderedAgents = orderAgents(options.agents, options.connections);
  const agentIds = new Set(options.agents.map((agent) => agent.id));
  const transcript: AgentRunMessage[] = [];
  const routingPrompt = options.routingPrompt?.trim() || options.prompt;
  const orchestrator = orderedAgents.find((agent) => agent.agentMode === 'orchestrator')
    ?? orderedAgents.find((agent) => {
      if (agent.agentMode === 'specialist' || agent.webSearchEnabled) return false;
      const hasConnectedTool = (options.tools ?? []).some((tool) => tool.agentId === agent.id);
      const hasWebSpecialist = options.connections.some((edge) => edge.source === agent.id
        && options.agents.some((candidate) => candidate.id === edge.target && candidate.webSearchEnabled));
      return hasConnectedTool && hasWebSpecialist;
    });
  if (orchestrator) return runOrchestratedFlow({
    prompt: options.prompt,
    routingPrompt,
    routingContext: options.routingContext,
    orchestrator,
    agents: options.agents,
    connections: options.connections,
    credentials: options.credentials,
    tools: options.tools ?? [],
    executeTool: options.executeTool,
    onEvent: options.onEvent,
  });

  for (const agent of orderedAgents) {
    const useWebSearch = agent.webSearchEnabled === true && (needsWebSearch(routingPrompt)
      || Boolean(options.routingContext && isContextualFollowup(routingPrompt) && requiresExternalKnowledge(options.routingContext)));
    if (agent.webSearchEnabled === true && !useWebSearch) continue;
    options.onEvent?.({ type: 'status', agentId: agent.id });
    const startedAt = performance.now();
    const upstream = upstreamAgents(agent.id, agentIds, options.connections);
    const relevantTurns = transcript.filter((turn) => upstream.has(turn.agentId));
    const priorTurns = relevantTurns.length
      ? relevantTurns.map((turn) => `${turn.name}:\n${turn.text}`).join('\n\n')
      : 'Todavía no hay intervenciones anteriores.';
    const connectedTools = (options.tools ?? []).filter((tool) => tool.agentId === agent.id);
    const agentTools = routeAgentTools(routingPrompt, connectedTools);
    const toolInstruction = agentTools.length
      ? '\n\nTienes herramientas conectadas. Úsalas solamente si aportan información necesaria; no inventes sus resultados. Después de recibirlos, continúa tu razonamiento y entrega una respuesta final.'
      : '';
    const webInstruction = useWebSearch
      ? '\n\nDebes consultar Google Search antes de responder. Usa resultados actuales y responde en español. No escribas una sección de fuentes: Synapse la agregará automáticamente.'
      : '';
    const input = `OBJETIVO ORIGINAL\n${options.prompt}\n\nTRANSCRIPCIÓN DEL CONSEJO\n${priorTurns}\n\nEs tu turno como ${agent.name}. Responde a partir del objetivo y del diálogo anterior. No simules a los otros agentes.${toolInstruction}${webInstruction}`;
    let text: string;
    try {
      text = await callProvider(agent, input, options.credentials[agent.provider]!.trim(), agentTools, useWebSearch, options.executeTool, options.onEvent);
    } catch (error) {
      if (useWebSearch && transcript.length) continue;
      throw error;
    }
    const message = {
      agentId: agent.id,
      name: agent.name,
      text,
      latency: `${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
    };
    transcript.push(message);
    options.onEvent?.({ type: 'message', agentId: agent.id, text, latency: message.latency });
  }
  options.onEvent?.({ type: 'done', count: transcript.length });
  return transcript;
}
