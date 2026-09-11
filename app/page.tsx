'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/prefer-tag-over-role */

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  CirclePlay,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  History,
  Inbox,
  KeyRound,
  LayoutGrid,
  Link2,
  LogOut,
  MessageSquareText,
  Maximize2,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { MarkdownOutput } from '@/components/markdown-output';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { appPath } from '@/lib/app-path';
import type { AgentToolInput } from '@/lib/model-runner';

type Provider = 'OpenAI' | 'Anthropic' | 'Google';
type AgentMode = 'standard' | 'orchestrator' | 'specialist';

type Agent = {
  id: string;
  kind: 'agent' | 'input' | 'gmail' | 'timer' | 'webhook' | 'python' | 'whatsapp';
  name: string;
  provider: Provider;
  model: string;
  role: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  color: string;
  x: number;
  y: number;
  inputMode?: 'text' | 'audio';
  inputValue?: string;
  gmailOperation?: 'read' | 'draft';
  gmailQuery?: string;
  gmailMaxResults?: number;
  gmailRecipient?: string;
  gmailSubject?: string;
  timerEnabled?: boolean;
  timerIntervalMinutes?: number;
  webhookId?: string;
  webhookSecret?: string;
  pythonCode?: string;
  pythonInputDescription?: string;
  pythonTimeoutMs?: number;
  whatsappWebhookId?: string;
  whatsappVerifyToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  whatsappOutboundRecipient?: string;
  whatsappMemoryEnabled?: boolean;
  whatsappMemoryMaxMessages?: number;
  whatsappMemoryRetentionHours?: number;
  webSearchEnabled?: boolean;
  agentMode?: AgentMode;
};

type TimerStatus = {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'success' | 'no_changes' | 'error';
  lastMessage: string;
  lastTrace: TimerTraceStep[];
  lastOutput: TimerOutput | null;
};

type TimerOutput = { entityId: string; entityName: string; text: string };

type ScheduledResult = {
  sourceId: string;
  sourceName: string;
  sourceKind: 'timer' | 'webhook' | 'whatsapp';
  runAt: string;
  output: TimerOutput;
};

type LiveExecution = {
  runId: string;
  sourceId: string;
  sourceName: string;
  sourceKind: 'webhook' | 'whatsapp';
  status: 'running' | 'success' | 'error';
  startedAt: string;
  completedAt: string | null;
  trace: TimerTraceStep[];
  output: TimerOutput | null;
  error: string | null;
  revision: number;
};

type TimerTraceStep =
  | { type: 'node'; nodeId: string }
  | { type: 'edge'; source: string; target: string };

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  redirectUri?: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type Connection = { id: string; source: string; target: string };
type ChatMessage = { id: number; agentId: string; text: string; latency: string };
type AuthUser = { email: string; name: string; picture: string | null };
type CanvasSnapshot = {
  version: 2;
  agents: Agent[];
  connections: Connection[];
  selectedId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  prompt: string;
  libraryCollapsed: boolean;
  inspectorCollapsed: boolean;
  gmailRunApproved: boolean;
};
type RunStreamEvent =
  | { type: 'status'; agentId: string }
  | { type: 'tool_start'; agentId: string; toolId: string; toolName: string }
  | { type: 'tool_result'; agentId: string; toolId: string; toolName: string; summary: string }
  | { type: 'message'; agentId: string; text: string; latency: string }
  | { type: 'error'; message: string }
  | { type: 'done'; count: number };

const NODE_WIDTH = 206;
const NODE_PORT_Y = 76;
const NODE_HEIGHT = 150;
const TIMER_NODE_WIDTH = 112;
const TIMER_NODE_HEIGHT = 142;
const TIMER_NODE_PORT_Y = 68;
const GMAIL_NODE_WIDTH = 126;
const GMAIL_NODE_HEIGHT = 112;
const GMAIL_NODE_PORT_Y = 45;
const PYTHON_NODE_WIDTH = 126;
const PYTHON_NODE_HEIGHT = 112;
const PYTHON_NODE_PORT_Y = 45;
const WHATSAPP_NODE_WIDTH = 126;
const WHATSAPP_NODE_HEIGHT = 112;
const WHATSAPP_NODE_PORT_Y = 45;
const WEBHOOK_NODE_WIDTH = 126;
const WEBHOOK_NODE_HEIGHT = 112;
const WEBHOOK_NODE_PORT_Y = 45;
const EDGE_MIN_CLEARANCE = 32;
const EDGE_MIN_STUB = 38;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const CANVAS_STORAGE_KEY = 'synapse.canvas.v2';
const LEGACY_CANVAS_STORAGE_KEY = 'synapse.canvas.v1';
const LEGACY_DEMO_PROMPT = 'Diseña un plan de lanzamiento para una app de finanzas personales enfocada en profesionales independientes.';

function webhookSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

const providers: Provider[] = ['OpenAI', 'Anthropic', 'Google'];
const providerModels: Record<Provider, string[]> = {
  OpenAI: ['gpt-5.2'],
  Anthropic: ['claude-sonnet-5', 'claude-sonnet-4-6'],
  Google: ['gemini-3.7-flash', 'gemini-3.5-flash'],
};
const presets: Array<{ provider: Provider; model: string; name: string; color: string; mark: string }> = [
  { provider: 'OpenAI', model: 'gpt-5.2', name: 'Estratega', color: '#ffb45c', mark: 'O' },
  { provider: 'Anthropic', model: 'claude-sonnet-5', name: 'Crítico', color: '#f1795c', mark: 'A' },
  { provider: 'Google', model: 'gemini-3.7-flash', name: 'Sintetizador', color: '#47c5b6', mark: 'G' },
];

function GmailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 20" fill="none">
      <path d="M2 5.1V17.3C2 18.2 2.7 19 3.7 19H6V8.15L2 5.1Z" fill="#4285F4" />
      <path d="M18 8.15V19H20.3C21.3 19 22 18.2 22 17.3V5.1L18 8.15Z" fill="#34A853" />
      <path d="M18 8.15L22 5.1V3.7C22 1.65 19.65.5 18.05 1.7L12 6.25L5.95 1.7C4.35.5 2 1.65 2 3.7V5.1L6 8.15L12 12.65L18 8.15Z" fill="#EA4335" />
      <path d="M6 8.15L2 5.1V17.3C2 18.2 2.7 19 3.7 19H6V8.15Z" fill="#C5221F" opacity=".58" />
      <path d="M18 8.15L22 5.1V9.35L18 12.35V8.15Z" fill="#FBBC04" />
    </svg>
  );
}

function PythonIcon({ size = 38 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M31.7 6.5c-13.1 0-12.3 5.7-12.3 5.7v6h12.5V20H14.4S6 19 6 32.1s7.3 12.7 7.3 12.7h4.4v-6.2s-.2-7.3 7.2-7.3h12.4s7 .1 7-6.8V13.1s1.1-6.6-12.6-6.6Z" fill="#4B8BBE" />
      <circle cx="25" cy="13.8" r="2.2" fill="#EAF4FA" />
      <path d="M32.3 57.5c13.1 0 12.3-5.7 12.3-5.7v-6H32.1V44h17.5S58 45 58 31.9s-7.3-12.7-7.3-12.7h-4.4v6.2s.2 7.3-7.2 7.3H26.7s-7-.1-7 6.8v11.4s-1.1 6.6 12.6 6.6Z" fill="#FFD43B" />
      <circle cx="39" cy="50.2" r="2.2" fill="#715B12" />
    </svg>
  );
}

function WhatsAppIcon({ size = 38 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M54.7 31.6a22.5 22.5 0 0 1-33.3 19.8L10 54.6l3.1-11A22.5 22.5 0 1 1 54.7 31.6Z" fill="#25D366" />
      <path d="M22.1 18.5c.6-1.4 1.3-1.4 2-1.4h1.6c.5 0 1.2.2 1.5 1.1l2.3 5.5c.3.8.2 1.4-.2 2l-1.7 2.2c-.5.6-.4 1.2 0 1.9 1.7 3 4.2 5.4 7.2 7 .7.4 1.3.4 1.8-.2l2.5-3c.6-.7 1.2-.8 2-.5l5.2 2.5c.9.4 1.2 1 1.1 1.8-.3 3.2-1.7 5.3-4 6.3-2.1.9-5.2.7-9.7-1.2-5.7-2.4-10.5-6.5-13.7-11.8-2.7-4.4-3.2-7.9-1.9-10.8Z" fill="white" />
    </svg>
  );
}

function WebhookNodeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M39.6 3.5C34 .6 28.8.7 24.8 4c-6.4 5.2-7.1 13.4-2.5 24.1l-9.4 17.7c-.9 1.6-.1 3.2 1.3 3.6 1.6.4 2.7-.4 3.4-1.7L28.5 28c-3-4.7-4.8-8.2-4.8-10.3-1.1-5.7 1.6-10.2 6.8-11.1 2.7-.5 5.7.6 8.1 2.7l2.3-4.2-1.3-1.6Z" fill="currentColor" />
      <path d="M30.5 13.6c-1.5.8-1.3 2.7-.9 3.3l11.1 20.4 10.3 1.2c3.8.5 5.7 3.9 5.5 8.2-.1 3.7-2.4 6.9-5.6 9.6l2.3 4.5c4.8-2.7 8.5-6.8 9.1-11.4.9-5.8-1.8-9.8-5.5-13.6-3.3-3.3-8.1-3.5-13-3.9L34 14c-.7-1.3-2.2-1.2-3.5-.4Z" fill="currentColor" />
      <path d="M1.5 46.3c.7 4.9 1.7 7.5 2.9 9.7 2.8 4 6.4 5.8 10.1 5.8 3.5 0 6-1 7.7-2L29.7 50h19.5c1.3 0 2.1-1 2.1-2.6 0-1.6-.6-2.9-1.8-3.2H27l-6 9.4c-1.5 2.3-4 3-6 2.4-3.6-.7-5.8-2.9-6.4-3.5l-2-8.2-4.6-.1-.5 2.1Z" fill="currentColor" />
      <circle cx="55.1" cy="52.8" r="1.15" fill="#ffc0a6" />
    </svg>
  );
}

function entityWidth(agent: Agent) {
  return agent.kind === 'timer' ? TIMER_NODE_WIDTH : agent.kind === 'gmail' ? GMAIL_NODE_WIDTH : agent.kind === 'python' ? PYTHON_NODE_WIDTH : agent.kind === 'whatsapp' ? WHATSAPP_NODE_WIDTH : agent.kind === 'webhook' ? WEBHOOK_NODE_WIDTH : NODE_WIDTH;
}

function entityHeight(agent: Agent) {
  return agent.kind === 'timer' ? TIMER_NODE_HEIGHT : agent.kind === 'gmail' ? GMAIL_NODE_HEIGHT : agent.kind === 'python' ? PYTHON_NODE_HEIGHT : agent.kind === 'whatsapp' ? WHATSAPP_NODE_HEIGHT : agent.kind === 'webhook' ? WEBHOOK_NODE_HEIGHT : NODE_HEIGHT;
}

function entityPortY(agent: Agent) {
  return agent.kind === 'timer' ? TIMER_NODE_PORT_Y : agent.kind === 'gmail' ? GMAIL_NODE_PORT_Y : agent.kind === 'python' ? PYTHON_NODE_PORT_Y : agent.kind === 'whatsapp' ? WHATSAPP_NODE_PORT_Y : agent.kind === 'webhook' ? WEBHOOK_NODE_PORT_Y : NODE_PORT_Y;
}

function timerDisplay(intervalMinutes = 5) {
  const bounded = Math.min(10_080, Math.max(1, Math.round(intervalMinutes)));
  if (bounded % 1_440 === 0) return { value: bounded / 1_440, unit: 'days' as const };
  if (bounded % 60 === 0) return { value: bounded / 60, unit: 'hours' as const };
  return { value: bounded, unit: 'minutes' as const };
}

function timerIntervalLabel(intervalMinutes = 5) {
  const display = timerDisplay(intervalMinutes);
  const labels = { minutes: display.value === 1 ? 'minuto' : 'minutos', hours: display.value === 1 ? 'hora' : 'horas', days: display.value === 1 ? 'día' : 'días' };
  return `${display.value} ${labels[display.unit]}`;
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function countdownLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3_600)}h`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h ${String(Math.floor((seconds % 3_600) / 60)).padStart(2, '0')}m`;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function TimerDial({ enabled, intervalMinutes = 5, status }: { enabled: boolean; intervalMinutes?: number; status?: TimerStatus }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [enabled]);

  const intervalMilliseconds = Math.max(60_000, intervalMinutes * 60_000);
  const nextRun = status?.nextRunAt ? Date.parse(status.nextRunAt) : Number.NaN;
  const remaining = enabled && Number.isFinite(nextRun) ? Math.max(0, nextRun - now) : intervalMilliseconds;
  const progress = enabled && Number.isFinite(nextRun) ? Math.min(1, remaining / intervalMilliseconds) : 0;
  const running = status?.lastStatus === 'running';

  return (
    <div className={`stopwatch ${enabled ? 'enabled' : 'paused'} ${running ? 'running' : ''}`} aria-label={enabled ? `Próxima ejecución en ${countdownLabel(remaining)}` : 'Temporizador pausado'}>
      <i className="stopwatch-crown" />
      <i className="stopwatch-button left" />
      <i className="stopwatch-button right" />
      <div className="stopwatch-face">
        <div className="stopwatch-dial" style={{ '--elapsed-angle': `${(1 - progress) * 360}deg` } as CSSProperties}>
          <i className="stopwatch-hand" />
          <strong>{running ? 'AHORA' : enabled && Number.isFinite(nextRun) ? countdownLabel(remaining) : 'PAUSA'}</strong>
          <small>{running ? 'EJECUTANDO' : 'RESTANTE'}</small>
        </div>
      </div>
    </div>
  );
}

function timerKickoffTrace(timerId: string, entities: Agent[], edges: Connection[]) {
  const trace: TimerTraceStep[] = [{ type: 'node', nodeId: timerId }];
  const queue = [timerId];
  const visited = new Set<string>([timerId]);
  while (queue.length) {
    const source = queue.shift()!;
    for (const edge of edges.filter((candidate) => candidate.source === source)) {
      trace.push({ type: 'edge', source: edge.source, target: edge.target });
      trace.push({ type: 'node', nodeId: edge.target });
      const target = entities.find((entity) => entity.id === edge.target);
      if (target && target.kind !== 'agent' && target.kind !== 'timer' && !visited.has(target.id)) {
        visited.add(target.id);
        queue.push(target.id);
      }
    }
  }
  return trace;
}

function sameTraceStep(left: TimerTraceStep, right: TimerTraceStep) {
  return left.type === right.type && (left.type === 'node'
    ? left.nodeId === (right.type === 'node' ? right.nodeId : '')
    : left.source === (right.type === 'edge' ? right.source : '') && left.target === (right.type === 'edge' ? right.target : ''));
}

const initialAgents: Agent[] = [
  {
    id: 'input-01',
    kind: 'input',
    name: 'Instrucción inicial',
    provider: 'OpenAI',
    model: 'input',
    role: 'Punto de partida del flujo',
    systemPrompt: '',
    temperature: 0,
    maxTokens: 0,
    color: '#b9f34e',
    x: 28,
    y: 220,
    inputMode: 'text',
    inputValue: '',
  },
  {
    id: 'agent-01',
    kind: 'agent',
    name: 'Estratega',
    provider: 'OpenAI',
    model: 'gpt-5.2',
    role: 'Define el enfoque',
    systemPrompt: 'Analiza el objetivo, identifica oportunidades y propone una estrategia concreta. Entrega contexto claro al siguiente agente.',
    temperature: 0.7,
    maxTokens: 1200,
    color: '#ffb45c',
    x: 286,
    y: 72,
  },
  {
    id: 'agent-02',
    kind: 'agent',
    name: 'Crítico',
    provider: 'Anthropic',
    model: 'claude-sonnet-5',
    role: 'Desafía los supuestos',
    systemPrompt: 'Actúa como revisor adversarial. Busca riesgos, contradicciones y supuestos sin validar. Sé directo y constructivo.',
    temperature: 0.45,
    maxTokens: 900,
    color: '#f1795c',
    x: 286,
    y: 335,
  },
  {
    id: 'agent-03',
    kind: 'agent',
    name: 'Sintetizador',
    provider: 'Google',
    model: 'gemini-3.7-flash',
    role: 'Produce la respuesta final',
    systemPrompt: 'Integra la propuesta y la crítica. Produce una recomendación final breve, accionable y fiel a la conversación.',
    temperature: 0.3,
    maxTokens: 1400,
    color: '#47c5b6',
    x: 566,
    y: 205,
  },
];

const initialConnections: Connection[] = [
  { id: 'edge-input', source: 'input-01', target: 'agent-01' },
  { id: 'edge-1', source: 'agent-01', target: 'agent-02' },
  { id: 'edge-2', source: 'agent-02', target: 'agent-03' },
];

function isStoredAgent(value: unknown): value is Agent {
  if (!value || typeof value !== 'object') return false;
  const agent = value as Partial<Agent>;
  return typeof agent.id === 'string'
    && (agent.kind === 'agent' || agent.kind === 'input' || agent.kind === 'gmail' || agent.kind === 'timer' || agent.kind === 'webhook' || agent.kind === 'python' || agent.kind === 'whatsapp')
    && typeof agent.name === 'string'
    && (agent.provider === 'OpenAI' || agent.provider === 'Anthropic' || agent.provider === 'Google')
    && typeof agent.model === 'string'
    && typeof agent.role === 'string'
    && typeof agent.systemPrompt === 'string'
    && typeof agent.temperature === 'number'
    && typeof agent.maxTokens === 'number'
    && typeof agent.color === 'string'
    && typeof agent.x === 'number' && Number.isFinite(agent.x)
    && typeof agent.y === 'number' && Number.isFinite(agent.y);
}

function isStoredConnection(value: unknown): value is Connection {
  if (!value || typeof value !== 'object') return false;
  const connection = value as Partial<Connection>;
  return typeof connection.id === 'string'
    && typeof connection.source === 'string'
    && typeof connection.target === 'string';
}

function parseCanvasSnapshot(value: unknown): CanvasSnapshot | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if ((candidate.version !== 1 && candidate.version !== 2)
      || !Array.isArray(candidate.agents)
      || !Array.isArray(candidate.connections)) return null;

    let agents = candidate.agents.filter(isStoredAgent).map((agent) => (
      agent.inputValue?.trim() === LEGACY_DEMO_PROMPT ? { ...agent, inputValue: '' } : agent
    ));
    const agentIds = new Set(agents.map((agent) => agent.id));
    const connections = candidate.connections
      .filter(isStoredConnection)
      .filter((connection) => agentIds.has(connection.source) && agentIds.has(connection.target));
    if (!agents.some((agent) => agent.kind === 'agent' && agent.agentMode === 'orchestrator')) {
      const inferredOrchestrator = agents.find((agent) => agent.kind === 'agent' && !agent.webSearchEnabled
        && connections.some((edge) => edge.source === agent.id && agents.some((target) => target.id === edge.target && (target.kind === 'gmail' || target.kind === 'python')))
        && connections.some((edge) => edge.source === agent.id && agents.some((target) => target.id === edge.target && target.kind === 'agent' && target.webSearchEnabled)));
      if (inferredOrchestrator) agents = agents.map((agent) => agent.id === inferredOrchestrator.id
        ? { ...agent, agentMode: 'orchestrator' }
        : agent.kind === 'agent' && agent.webSearchEnabled ? { ...agent, agentMode: 'specialist' } : agent);
    }
    const storedPan = candidate.pan && typeof candidate.pan === 'object'
      ? candidate.pan as { x?: unknown; y?: unknown }
      : null;
    const pan = {
      x: typeof storedPan?.x === 'number' && Number.isFinite(storedPan.x) ? storedPan.x : 0,
      y: typeof storedPan?.y === 'number' && Number.isFinite(storedPan.y) ? storedPan.y : 0,
    };
    const zoom = typeof candidate.zoom === 'number' && Number.isFinite(candidate.zoom)
      ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, candidate.zoom))
      : 1;
    const selectedId = typeof candidate.selectedId === 'string' && agentIds.has(candidate.selectedId)
      ? candidate.selectedId
      : null;

    return {
      version: 2,
      agents,
      connections,
      selectedId,
      zoom,
      pan,
      prompt: typeof candidate.prompt === 'string' && candidate.prompt.trim() !== LEGACY_DEMO_PROMPT ? candidate.prompt : '',
      libraryCollapsed: candidate.version === 1 ? true : candidate.libraryCollapsed !== false,
      inspectorCollapsed: candidate.version === 1 ? true : candidate.inspectorCollapsed !== false,
      gmailRunApproved: candidate.gmailRunApproved === true,
    };
  } catch {
    return null;
  }
}

function readCanvasSnapshot(): CanvasSnapshot | null {
  try {
    const current = window.localStorage.getItem(CANVAS_STORAGE_KEY);
    if (current) return parseCanvasSnapshot(JSON.parse(current));
    const legacy = window.localStorage.getItem(LEGACY_CANVAS_STORAGE_KEY);
    return legacy ? parseCanvasSnapshot(JSON.parse(legacy)) : null;
  } catch {
    return null;
  }
}

function writeCanvasSnapshot(snapshot: CanvasSnapshot) {
  try {
    window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(snapshot));
    window.localStorage.removeItem(LEGACY_CANVAS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

function connectionPortOffset(edge: Connection, allConnections: Connection[], side: 'source' | 'target') {
  const key = side === 'source' ? 'source' : 'target';
  const siblings = allConnections.filter((candidate) => candidate[key] === edge[key]);
  const index = siblings.findIndex((candidate) => candidate.id === edge.id);
  return Math.max(-24, Math.min(24, (index - (siblings.length - 1) / 2) * 8));
}

function connectionPath(source: Agent, target: Agent, sourceOffset = 0, targetOffset = 0) {
  const sx = source.x + entityWidth(source);
  const sy = source.y + entityPortY(source) + sourceOffset;
  const tx = target.x;
  const ty = target.y + entityPortY(target) + targetOffset;

  // Forward connections use a centered vertical rail. Every segment remains
  // horizontal or vertical while the rail adapts to the distance between nodes.
  if (tx >= sx) {
    if (Math.abs(ty - sy) < 0.5) return `M ${sx} ${sy} H ${tx}`;
    const railX = sx + (tx - sx) / 2;
    return `M ${sx} ${sy} H ${railX} V ${ty} H ${tx}`;
  }

  // A connection that travels backwards needs an external corridor so it
  // does not cross either card. Prefer the free vertical gap when one exists;
  // otherwise route above or below according to the target's direction.
  const sourceTop = source.y;
  const sourceBottom = source.y + entityHeight(source);
  const targetTop = target.y;
  const targetBottom = target.y + entityHeight(target);
  const verticalDistance = Math.abs(ty - sy);
  const clearance = Math.min(72, Math.max(EDGE_MIN_CLEARANCE, verticalDistance * 0.18));
  const stub = Math.min(68, Math.max(EDGE_MIN_STUB, (sx - tx) * 0.14));

  let corridorY: number;
  if (sourceBottom + EDGE_MIN_CLEARANCE <= targetTop) {
    corridorY = sourceBottom + (targetTop - sourceBottom) / 2;
  } else if (targetBottom + EDGE_MIN_CLEARANCE <= sourceTop) {
    corridorY = targetBottom + (sourceTop - targetBottom) / 2;
  } else if (ty >= sy) {
    corridorY = Math.max(sourceBottom, targetBottom) + clearance;
  } else {
    corridorY = Math.min(sourceTop, targetTop) - clearance;
  }

  return `M ${sx} ${sy} H ${sx + stub} V ${corridorY} H ${tx - stub} V ${ty} H ${tx}`;
}

export default function Home() {
  const [agents, setAgents] = useState(initialAgents);
  const [connections, setConnections] = useState(initialConnections);
  const [selectedId, setSelectedId] = useState<string | null>('agent-03');
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [query, setQuery] = useState('');
  const [libraryCollapsed, setLibraryCollapsed] = useState(true);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [runOpen, setRunOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<Partial<Record<Provider, boolean>>>({});
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [credentialProvider, setCredentialProvider] = useState<Provider>('OpenAI');
  const [credentialDraft, setCredentialDraft] = useState('');
  const [credentialFormError, setCredentialFormError] = useState('');
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [recordingNodeId, setRecordingNodeId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [blinkingAgentIds, setBlinkingAgentIds] = useState<Set<string>>(() => new Set());
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ configured: false, connected: false, email: null });
  const [gmailChecking, setGmailChecking] = useState(true);
  const [gmailActionBusy, setGmailActionBusy] = useState(false);
  const [whatsappConnected, setWhatsAppConnected] = useState(false);
  const [whatsappAccessToken, setWhatsAppAccessToken] = useState('');
  const [whatsappAppSecret, setWhatsAppAppSecret] = useState('');
  const [whatsappCredentialBusy, setWhatsAppCredentialBusy] = useState(false);
  const [whatsappCredentialError, setWhatsAppCredentialError] = useState<string | null>(null);
  const [runNotices, setRunNotices] = useState<string[]>([]);
  const [gmailRunApproved, setGmailRunApproved] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [workspaceSaveState, setWorkspaceSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [timerStatuses, setTimerStatuses] = useState<Record<string, TimerStatus>>({});
  const [timerMutation, setTimerMutation] = useState<{ timerId: string; enabled: boolean } | null>(null);
  const [timerMutationError, setTimerMutationError] = useState<{ timerId: string; message: string } | null>(null);
  const [tracePlayback, setTracePlayback] = useState<{ runAt: string; sourceKind: 'timer' | 'webhook' | 'whatsapp'; steps: TimerTraceStep[]; index: number } | null>(null);
  const [pendingScheduledResult, setPendingScheduledResult] = useState<ScheduledResult | null>(null);
  const [scheduledResult, setScheduledResult] = useState<(ScheduledResult & { closing: boolean }) | null>(null);
  const [copiedWebhookField, setCopiedWebhookField] = useState<'url' | 'secret' | 'whatsapp-url' | 'whatsapp-token' | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef({ zoom: 1, x: 0, y: 0 });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const seenTimerRunsRef = useRef<Record<string, string | null>>({});
  const seenTimerStatusesRef = useRef<Record<string, TimerStatus['lastStatus']>>({});
  const kickoffTracesRef = useRef<Record<string, TimerTraceStep[]>>({});
  const liveExecutionReadyRef = useRef(false);
  const seenLiveExecutionRef = useRef<{ runId: string; traceLength: number; completed: boolean } | null>(null);
  const agentsRef = useRef(agents);
  const connectionsRef = useRef(connections);

  useEffect(() => {
    agentsRef.current = agents;
    connectionsRef.current = connections;
  }, [agents, connections]);

  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const selectedTimerStatus = selected?.kind === 'timer' ? timerStatuses[selected.id] : null;
  const modelAgents = agents.filter((agent) => agent.kind === 'agent');
  const modelAgentIdsKey = modelAgents.map((agent) => agent.id).join('|');
  const isSourceEntity = (agent: Agent) => agent.kind === 'input' || (agent.kind === 'gmail' && agent.gmailOperation === 'read');
  const connectedSource = agents.find((agent) => isSourceEntity(agent) && connections.some((edge) => edge.source === agent.id));
  const selectedSource = selected && isSourceEntity(selected) && connections.some((edge) => edge.source === selected.id) ? selected : null;
  const primarySource = selectedSource ?? connectedSource ?? null;
  const primarySourceId = primarySource?.id;
  const effectivePrompt = primarySource?.inputValue?.trim() || (primarySource?.kind === 'gmail' ? 'Analiza los correos encontrados y responde según tu función.' : prompt.trim());
  const reachableAgentIds = (() => {
    if (!primarySourceId) return new Set(agents.filter((agent) => agent.kind === 'agent').map((agent) => agent.id));
    const reachable = new Set<string>();
    const queue = connections.filter((edge) => edge.source === primarySourceId).map((edge) => edge.target);
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      const entity = agents.find((agent) => agent.id === id);
      if (!entity || entity.kind !== 'agent') continue;
      reachable.add(id);
      connections.filter((edge) => edge.source === id).forEach((edge) => queue.push(edge.target));
    }
    return reachable;
  })();
  const flowAgents = modelAgents.filter((agent) => reachableAgentIds.has(agent.id));
  const flowAgentIds = new Set(flowAgents.map((agent) => agent.id));
  const flowConnections = connections.filter((edge) => flowAgentIds.has(edge.source) && flowAgentIds.has(edge.target));
  const agentTools = connections.flatMap((edge): AgentToolInput[] => {
    const source = agents.find((agent) => agent.id === edge.source);
    const target = agents.find((agent) => agent.id === edge.target);
    if (!source || source.kind !== 'agent' || !flowAgentIds.has(source.id) || !target) return [];
    if (target.kind === 'python') return [{
      id: target.id,
      agentId: source.id,
      kind: 'python' as const,
      name: target.name,
      description: target.role || `Ejecuta el código configurado en ${target.name} cuando sea necesario.`,
      code: target.pythonCode || '',
      inputDescription: target.pythonInputDescription || 'Objeto JSON de entrada para la función Python.',
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
  const draftTargets = agents.filter((agent) => agent.kind === 'gmail' && agent.gmailOperation === 'draft' && connections.some((edge) => flowAgentIds.has(edge.source) && edge.target === agent.id));
  const flowUsesGmail = primarySource?.kind === 'gmail' || draftTargets.length > 0 || agentTools.some((tool) => tool.kind === 'gmail_read');
  const filteredPresets = presets.filter((preset) =>
    `${preset.name} ${preset.provider} ${preset.model}`.toLowerCase().includes(query.toLowerCase()),
  );

  const canvasSnapshot = useMemo<CanvasSnapshot>(() => ({
    version: 2,
    agents,
    connections,
    selectedId,
    zoom,
    pan,
    prompt,
    libraryCollapsed,
    inspectorCollapsed,
    gmailRunApproved,
  }), [agents, connections, gmailRunApproved, inspectorCollapsed, libraryCollapsed, pan, prompt, selectedId, zoom]);

  const edgeData = useMemo(
    () => connections.map((edge) => ({
      ...edge,
      sourceAgent: agents.find((agent) => agent.id === edge.source),
      targetAgent: agents.find((agent) => agent.id === edge.target),
    })).filter((edge) => edge.sourceAgent && edge.targetAgent),
    [agents, connections],
  );
  const currentTraceStep = tracePlayback?.steps[tracePlayback.index] ?? null;

  const receiveTimerStatuses = useCallback((timers: TimerStatus[], animate: boolean) => {
    let newestRun: (ScheduledResult & { trace: TimerTraceStep[] }) | null = null;
    for (const timer of timers) {
      const previousRun = seenTimerRunsRef.current[timer.id];
      const previousStatus = seenTimerStatusesRef.current[timer.id];
      seenTimerStatusesRef.current[timer.id] = timer.lastStatus;
      if (animate && previousStatus !== undefined && previousStatus !== 'running' && timer.lastStatus === 'running') {
        const kickoff = timerKickoffTrace(timer.id, agentsRef.current, connectionsRef.current);
        kickoffTracesRef.current[timer.id] = kickoff;
        if (kickoff.length) setTracePlayback({ runAt: timer.nextRunAt || `running-${timer.id}`, sourceKind: 'timer', steps: kickoff, index: 0 });
      }
      if (!(timer.id in seenTimerRunsRef.current)) {
        seenTimerRunsRef.current[timer.id] = timer.lastRunAt;
      } else if (timer.lastRunAt && timer.lastRunAt !== previousRun) {
        seenTimerRunsRef.current[timer.id] = timer.lastRunAt;
        if (animate && timer.lastOutput?.text.trim() && (!newestRun || timer.lastRunAt > newestRun.runAt)) {
          const kickoff = kickoffTracesRef.current[timer.id] ?? [];
          const completeTrace = timer.lastTrace ?? [];
          const prefixMatches = kickoff.length <= completeTrace.length && kickoff.every((step, index) => sameTraceStep(step, completeTrace[index]));
          newestRun = {
            sourceId: timer.id,
            sourceName: agentsRef.current.find((agent) => agent.id === timer.id)?.name || 'Temporizador',
            sourceKind: 'timer',
            runAt: timer.lastRunAt,
            output: timer.lastOutput,
            trace: prefixMatches ? completeTrace.slice(kickoff.length) : completeTrace,
          };
        }
        delete kickoffTracesRef.current[timer.id];
      }
    }
    setTimerStatuses(Object.fromEntries(timers.map((timer) => [timer.id, timer])));
    if (newestRun) {
      const { trace, ...result } = newestRun;
      setPendingScheduledResult(result);
      if (trace.length) setTracePlayback({ runAt: result.runAt, sourceKind: 'timer', steps: trace, index: 0 });
    }
  }, []);

  const receiveLiveExecution = useCallback((execution: LiveExecution | null) => {
    if (!liveExecutionReadyRef.current) {
      liveExecutionReadyRef.current = true;
      if (!execution) return;
      seenLiveExecutionRef.current = { runId: execution.runId, traceLength: execution.trace.length, completed: execution.status !== 'running' };
      if (execution.status === 'running' && execution.trace.length) {
        setTracePlayback({ runAt: execution.runId, sourceKind: execution.sourceKind, steps: execution.trace, index: 0 });
      }
      return;
    }
    if (!execution) return;
    const seen = seenLiveExecutionRef.current;
    if (!seen) {
      seenLiveExecutionRef.current = { runId: execution.runId, traceLength: execution.trace.length, completed: execution.status !== 'running' };
      if (execution.trace.length) setTracePlayback({ runAt: execution.runId, sourceKind: execution.sourceKind, steps: execution.trace, index: 0 });
      if (execution.status === 'success' && execution.output?.text.trim()) {
        setPendingScheduledResult({ sourceId: execution.sourceId, sourceName: execution.sourceName, sourceKind: execution.sourceKind, runAt: execution.completedAt || execution.startedAt, output: execution.output });
      }
      return;
    }

    const isNewRun = seen.runId !== execution.runId;
    const consumedLength = isNewRun ? 0 : seen.traceLength;
    const additionalSteps = execution.trace.slice(consumedLength);
    const justCompleted = execution.status === 'success' && (isNewRun || !seen.completed);
    seenLiveExecutionRef.current = {
      runId: execution.runId,
      traceLength: execution.trace.length,
      completed: execution.status !== 'running',
    };

    if (additionalSteps.length) {
      setTracePlayback((current) => {
        if (!current || current.runAt !== execution.runId) {
          return { runAt: execution.runId, sourceKind: execution.sourceKind, steps: additionalSteps, index: 0 };
        }
        return { ...current, steps: [...current.steps, ...additionalSteps] };
      });
    }
    if (justCompleted && execution.output?.text.trim()) {
      setPendingScheduledResult({
        sourceId: execution.sourceId,
        sourceName: execution.sourceName,
        sourceKind: execution.sourceKind,
        runAt: execution.completedAt || execution.startedAt,
        output: execution.output,
      });
    }
  }, []);

  function updateSelected(patch: Partial<Agent>) {
    if (!selectedId) return;
    setAgents((current) => current.map((agent) => agent.id === selectedId ? { ...agent, ...patch } : agent));
  }

  function updateNode(id: string, patch: Partial<Agent>) {
    setAgents((current) => current.map((agent) => agent.id === id ? { ...agent, ...patch } : agent));
  }

  async function setTimerEnabled(timer: Agent, enabled: boolean) {
    if (timerMutation) return;
    setTimerMutation({ timerId: timer.id, enabled });
    setTimerMutationError(null);
    setWorkspaceSaveState('saving');
    try {
      const response = await fetch(appPath('/api/schedules'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timerId: timer.id, enabled }),
      });
      const payload = await response.json() as { timers?: TimerStatus[]; error?: string };
      if (response.status === 401) {
        window.location.replace('/synapse/');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'No se pudo actualizar la programación.');
      const confirmed = (payload.timers ?? []).find((item) => item.id === timer.id);
      if (!confirmed || confirmed.enabled !== enabled || (enabled && !confirmed.nextRunAt)) {
        throw new Error('El servidor no confirmó la próxima ejecución.');
      }
      updateNode(timer.id, { timerEnabled: enabled });
      setTimerStatuses(Object.fromEntries((payload.timers ?? []).map((item) => [item.id, item])));
      setWorkspaceSaveState('saved');
    } catch (error) {
      setWorkspaceSaveState('error');
      setTimerMutationError({
        timerId: timer.id,
        message: error instanceof Error ? error.message : 'No se pudo actualizar la programación.',
      });
    } finally {
      setTimerMutation(null);
    }
  }

  function changeProvider(provider: Provider) {
    updateSelected({ provider, model: providerModels[provider][0] });
  }

  function changeGmailOperation(operation: 'read' | 'draft') {
    if (!selectedId) return;
    setConnections((current) => current.filter((edge) => operation === 'read' ? edge.target !== selectedId : edge.source !== selectedId));
    setAgents((current) => current.map((agent) => {
      if (agent.id !== selectedId) return agent;
      const usesDefaultName = agent.name === 'Bandeja de Gmail' || agent.name === 'Borrador de Gmail';
      return {
        ...agent,
        gmailOperation: operation,
        role: operation === 'read' ? 'Entrega correos al flujo' : 'Crea un borrador para revisión',
        name: usesDefaultName ? operation === 'read' ? 'Bandeja de Gmail' : 'Borrador de Gmail' : agent.name,
      };
    }));
    setConnectingFrom(null);
  }

  async function disconnectGmail() {
    setGmailActionBusy(true);
    setRunError(null);
    try {
      const response = await fetch(appPath('/api/gmail/status'), { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo desconectar la cuenta de Gmail.');
      setGmailStatus((current) => ({ ...current, connected: false, email: null }));
      setGmailRunApproved(false);
      setRunNotices([]);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'No se pudo desconectar la cuenta de Gmail.');
    } finally {
      setGmailActionBusy(false);
    }
  }

  function openCredential(provider: Provider) {
    setCredentialProvider(provider);
    setCredentialDraft('');
    setCredentialFormError('');
    setShowCredential(false);
    setCredentialOpen(true);
  }

  function chooseCredentialProvider(provider: Provider) {
    setCredentialProvider(provider);
    setCredentialDraft('');
    setCredentialFormError('');
    setShowCredential(false);
  }

  async function saveCredential() {
    const value = credentialDraft.trim();
    if (!value && credentialStatus[credentialProvider]) {
      setCredentialOpen(false);
      return;
    }
    if (value.length < 12) {
      setCredentialFormError('La clave parece demasiado corta. Comprueba que esté completa.');
      return;
    }
    setCredentialBusy(true);
    setCredentialFormError('');
    try {
      const response = await fetch(appPath('/api/credentials'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: credentialProvider, key: value }),
      });
      const payload = await response.json() as { error?: string; providers?: Provider[] };
      if (response.status === 401) {
        window.location.replace('/synapse/');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar la credencial.');
      setCredentialStatus(Object.fromEntries((payload.providers ?? []).map((provider) => [provider, true])));
      setCredentialDraft('');
      setCredentialOpen(false);
    } catch (error) {
      setCredentialFormError(error instanceof Error ? error.message : 'No se pudo guardar la credencial.');
    } finally {
      setCredentialBusy(false);
    }
  }

  async function removeCredential() {
    setCredentialBusy(true);
    setCredentialFormError('');
    try {
      const response = await fetch(appPath(`/api/credentials?provider=${encodeURIComponent(credentialProvider)}`), { method: 'DELETE' });
      const payload = await response.json() as { error?: string; providers?: Provider[] };
      if (response.status === 401) {
        window.location.replace('/synapse/');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'No se pudo eliminar la credencial.');
      setCredentialStatus(Object.fromEntries((payload.providers ?? []).map((provider) => [provider, true])));
      setCredentialDraft('');
      setCredentialOpen(false);
    } catch (error) {
      setCredentialFormError(error instanceof Error ? error.message : 'No se pudo eliminar la credencial.');
    } finally {
      setCredentialBusy(false);
    }
  }

  function addAgent(preset = presets[modelAgents.length % presets.length]) {
    const sequence = modelAgents.length + 1;
    const id = `agent-${Date.now()}`;
    const agent: Agent = {
      id,
      kind: 'agent',
      name: sequence > 4 ? `${preset.name} ${sequence}` : preset.name,
      provider: preset.provider,
      model: preset.model,
      role: 'Nueva función en el diálogo',
      systemPrompt: 'Define aquí la personalidad, objetivos, límites y formato de salida de esta entidad.',
      temperature: 0.6,
      maxTokens: 1000,
      color: preset.color,
      x: 65 + ((sequence * 113) % 465),
      y: 88 + ((sequence * 91) % 310),
    };
    setAgents((current) => [...current, agent]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function addInput() {
    const sequence = agents.filter((agent) => agent.kind === 'input').length + 1;
    const id = `input-${Date.now()}`;
    const input: Agent = {
      id,
      kind: 'input',
      name: sequence === 1 ? 'Instrucción inicial' : `Entrada ${sequence}`,
      provider: 'OpenAI',
      model: 'input',
      role: 'Punto de partida del flujo',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#b9f34e',
      x: 42 + ((sequence * 41) % 150),
      y: 105 + ((sequence * 119) % 340),
      inputMode: 'text',
      inputValue: '',
    };
    setAgents((current) => [...current, input]);
    setSelectedId(id);
    setInputError(null);
    setInspectorCollapsed(false);
  }

  function addGmail(operation: 'read' | 'draft' = 'read') {
    const sequence = agents.filter((agent) => agent.kind === 'gmail').length + 1;
    const id = `gmail-${Date.now()}`;
    const gmail: Agent = {
      id,
      kind: 'gmail',
      name: operation === 'read' ? 'Bandeja de Gmail' : 'Borrador de Gmail',
      provider: 'Google',
      model: 'gmail-api',
      role: operation === 'read' ? 'Entrega correos al flujo' : 'Crea un borrador para revisión',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#ea4335',
      x: 45 + ((sequence * 127) % 520),
      y: 95 + ((sequence * 83) % 330),
      inputValue: 'Analiza los correos encontrados y responde según tu función en el flujo.',
      gmailOperation: operation,
      gmailQuery: 'in:inbox is:unread',
      gmailMaxResults: 5,
      gmailRecipient: '',
      gmailSubject: 'Borrador generado por Synapse',
    };
    setAgents((current) => [...current, gmail]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function addPython() {
    const sequence = agents.filter((agent) => agent.kind === 'python').length + 1;
    const id = `python-${Date.now()}`;
    const python: Agent = {
      id,
      kind: 'python',
      name: sequence === 1 ? 'Python' : `Python ${sequence}`,
      provider: 'OpenAI',
      model: 'pyodide-wasm',
      role: 'Ejecuta una función aislada con parámetros JSON',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#4b8bbe',
      x: 58 + ((sequence * 139) % 500),
      y: 105 + ((sequence * 91) % 330),
      pythonCode: 'def main(input):\n    value = input.get("value", 0)\n    return {"result": value * 2}',
      pythonInputDescription: 'Objeto JSON con los valores que necesita la función. Por ejemplo: {"value": 21}.',
      pythonTimeoutMs: 8_000,
    };
    setAgents((current) => [...current, python]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function addTimer() {
    const sequence = agents.filter((agent) => agent.kind === 'timer').length + 1;
    const id = `timer-${Date.now()}`;
    const timer: Agent = {
      id,
      kind: 'timer',
      name: sequence === 1 ? 'Temporizador' : `Temporizador ${sequence}`,
      provider: 'OpenAI',
      model: 'scheduler',
      role: 'Dispara una entidad de forma periódica',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#e7bd55',
      x: 38 + ((sequence * 73) % 360),
      y: 92 + ((sequence * 67) % 330),
      inputValue: '',
      timerEnabled: false,
      timerIntervalMinutes: 5,
    };
    setAgents((current) => [...current, timer]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function addWebhook() {
    const sequence = agents.filter((agent) => agent.kind === 'webhook').length + 1;
    const id = `webhook-${Date.now()}`;
    const webhook: Agent = {
      id,
      kind: 'webhook',
      name: sequence === 1 ? 'Webhook' : `Webhook ${sequence}`,
      provider: 'OpenAI',
      model: 'http-webhook',
      role: 'Recibe una petición HTTP y devuelve la respuesta final',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#ff5a1f',
      x: 48 + ((sequence * 89) % 390),
      y: 102 + ((sequence * 103) % 330),
      inputValue: 'Procesa la petición recibida y responde de acuerdo con la función del agente.',
      webhookId: crypto.randomUUID(),
      webhookSecret: webhookSecret(),
    };
    setAgents((current) => [...current, webhook]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function addWhatsApp() {
    const sequence = agents.filter((agent) => agent.kind === 'whatsapp').length + 1;
    const id = `whatsapp-${Date.now()}`;
    const whatsapp: Agent = {
      id,
      kind: 'whatsapp',
      name: sequence === 1 ? 'WhatsApp' : `WhatsApp ${sequence}`,
      provider: 'OpenAI',
      model: 'whatsapp-cloud-api',
      role: 'Recibe texto o audio y devuelve la respuesta final al mismo chat',
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      color: '#25d366',
      x: 52 + ((sequence * 101) % 420),
      y: 112 + ((sequence * 97) % 330),
      inputValue: 'Responde al mensaje recibido por WhatsApp de acuerdo con la función del agente.',
      whatsappWebhookId: crypto.randomUUID(),
      whatsappVerifyToken: webhookSecret(),
      whatsappPhoneNumberId: '',
      whatsappBusinessAccountId: '',
      whatsappOutboundRecipient: '',
      whatsappMemoryEnabled: true,
      whatsappMemoryMaxMessages: 20,
      whatsappMemoryRetentionHours: 168,
    };
    setAgents((current) => [...current, whatsapp]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  async function copyWebhookField(field: 'url' | 'secret', webhook: Agent) {
    const value = field === 'url'
      ? new URL(appPath(`/api/webhook?id=${encodeURIComponent(webhook.webhookId ?? '')}`), window.location.origin).toString()
      : webhook.webhookSecret ?? '';
    await navigator.clipboard.writeText(value);
    setCopiedWebhookField(field);
    window.setTimeout(() => setCopiedWebhookField((current) => current === field ? null : current), 1_800);
  }

  async function copyWhatsAppField(field: 'whatsapp-url' | 'whatsapp-token', whatsapp: Agent) {
    const value = field === 'whatsapp-url'
      ? new URL(appPath(`/api/whatsapp/webhook?id=${encodeURIComponent(whatsapp.whatsappWebhookId ?? '')}`), window.location.origin).toString()
      : whatsapp.whatsappVerifyToken ?? '';
    await navigator.clipboard.writeText(value);
    setCopiedWebhookField(field);
    window.setTimeout(() => setCopiedWebhookField((current) => current === field ? null : current), 1_800);
  }

  async function saveWhatsAppCredentials() {
    if (whatsappAccessToken.trim().length < 20 || (!whatsappConnected && whatsappAppSecret.trim().length < 16)) {
      setWhatsAppCredentialError(whatsappConnected ? 'Completa el nuevo Access Token.' : 'Completa el Access Token y el App Secret del webhook.');
      return;
    }
    setWhatsAppCredentialBusy(true);
    setWhatsAppCredentialError(null);
    try {
      const response = await fetch(appPath('/api/whatsapp/credentials'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: whatsappAccessToken, ...(whatsappAppSecret.trim() ? { appSecret: whatsappAppSecret } : {}) }),
      });
      const payload = await response.json() as { connected?: boolean; error?: string };
      if (response.status === 401) { window.location.replace('/synapse/'); return; }
      if (!response.ok) throw new Error(payload.error || 'No se pudieron guardar las credenciales.');
      setWhatsAppConnected(payload.connected === true);
      setWhatsAppAccessToken('');
      setWhatsAppAppSecret('');
    } catch (error) {
      setWhatsAppCredentialError(error instanceof Error ? error.message : 'No se pudieron guardar las credenciales.');
    } finally {
      setWhatsAppCredentialBusy(false);
    }
  }

  function duplicateSelected() {
    if (!selected) return;
    const id = `${selected.kind}-${Date.now()}`;
    const copy: Agent = {
      ...selected,
      id,
      name: `${selected.name} copia`,
      x: selected.x + 34,
      y: selected.y + 34,
      timerEnabled: selected.kind === 'timer' ? false : selected.timerEnabled,
      webhookId: selected.kind === 'webhook' ? crypto.randomUUID() : selected.webhookId,
      webhookSecret: selected.kind === 'webhook' ? webhookSecret() : selected.webhookSecret,
      whatsappWebhookId: selected.kind === 'whatsapp' ? crypto.randomUUID() : selected.whatsappWebhookId,
      whatsappVerifyToken: selected.kind === 'whatsapp' ? webhookSecret() : selected.whatsappVerifyToken,
    };
    setAgents((current) => [...current, copy]);
    setSelectedId(id);
    setInspectorCollapsed(false);
  }

  function toggleRecording(input: Agent) {
    if (recordingNodeId === input.id) {
      recognitionRef.current?.stop();
      return;
    }

    recognitionRef.current?.abort();
    const browserWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setInputError('Este navegador no admite dictado por voz. Prueba Chrome o escribe la instrucción como texto.');
      return;
    }

    const recognition = new Recognition();
    const original = input.inputValue?.trim() ?? '';
    let committed = original ? `${original} ` : '';
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const fragment = event.results[index][0].transcript.trim();
        if (!fragment) continue;
        if (event.results[index].isFinal) committed += `${fragment} `;
        else interim += `${fragment} `;
      }
      updateNode(input.id, { inputValue: `${committed}${interim}`.trim() });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setRecordingNodeId(null);
    };
    recognition.onerror = () => {
      setInputError('No pude acceder al micrófono. Revisa el permiso del navegador e inténtalo otra vez.');
      recognitionRef.current = null;
      setRecordingNodeId(null);
    };

    try {
      recognitionRef.current = recognition;
      setInputError(null);
      setRecordingNodeId(input.id);
      recognition.start();
    } catch {
      setInputError('El micrófono ya está ocupado. Detén la grabación actual e inténtalo otra vez.');
      recognitionRef.current = null;
      setRecordingNodeId(null);
    }
  }

  function deleteSelected() {
    if (!selectedId) return;
    if (recordingNodeId === selectedId) recognitionRef.current?.abort();
    setAgents((current) => current.filter((agent) => agent.id !== selectedId));
    setConnections((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, agent: Agent) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: agent.id, startX: event.clientX, startY: event.clientY, originX: agent.x, originY: agent.y };
    setSelectedId(agent.id);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.max(12, drag.originX + (event.clientX - drag.startX) / zoom);
    const y = Math.max(48, drag.originY + (event.clientY - drag.startY) / zoom);
    setAgents((current) => current.map((agent) => agent.id === drag.id ? { ...agent, x, y } : agent));
  }

  function finishDrag() {
    dragRef.current = null;
  }

  function startConnection(event: ReactPointerEvent<HTMLButtonElement>, agentId: string) {
    event.stopPropagation();
    // Re-clicking an already armed source must keep it armed. Users naturally
    // return to the agent output before adding a second tool; cancellation is
    // handled explicitly by clicking the canvas background or pressing Escape.
    setConnectingFrom(agentId);
  }

  function finishConnection(event: ReactPointerEvent<HTMLButtonElement>, targetId: string) {
    event.stopPropagation();
    if (!connectingFrom || connectingFrom === targetId) return;
    const sourceId = connectingFrom;
    setConnections((current) => current.some((edge) => edge.source === sourceId && edge.target === targetId)
      ? current
      : [...current, { id: `edge-${crypto.randomUUID()}`, source: sourceId, target: targetId }]);
  }

  function removeConnection(id: string) {
    setConnections((current) => current.filter((edge) => edge.id !== id));
  }

  async function connectGmail() {
    setGmailActionBusy(true);
    const disconnectedSnapshot = { ...canvasSnapshot, gmailRunApproved: false };
    setGmailRunApproved(false);
    if (canvasReady) writeCanvasSnapshot(disconnectedSnapshot);
    try {
      await fetch(appPath('/api/workspace'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(disconnectedSnapshot),
        keepalive: true,
      });
    } catch {
      // The local copy still protects the canvas during the OAuth round-trip.
    }
    window.location.assign(appPath('/api/gmail/auth'));
  }

  function applyViewport(nextZoom: number, focusClientX?: number, focusClientY?: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const current = viewportRef.current;
    const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const focusX = focusClientX === undefined ? rect.width / 2 : focusClientX - rect.left;
    const focusY = focusClientY === undefined ? rect.height / 2 : focusClientY - rect.top;
    const ratio = boundedZoom / current.zoom;
    const nextX = focusX - (focusX - current.x) * ratio;
    const nextY = focusY - (focusY - current.y) * ratio;
    viewportRef.current = { zoom: boundedZoom, x: nextX, y: nextY };
    setZoom(boundedZoom);
    setPan({ x: nextX, y: nextY });
  }

  useEffect(() => {
    let cancelled = false;
    const localSnapshot = readCanvasSnapshot();

    const restore = (snapshot: CanvasSnapshot | null) => {
      if (!snapshot) return;
      setAgents(snapshot.agents);
      setConnections(snapshot.connections);
      setSelectedId(snapshot.selectedId);
      setZoom(snapshot.zoom);
      setPan(snapshot.pan);
      setPrompt(snapshot.prompt);
      setLibraryCollapsed(snapshot.libraryCollapsed);
      setInspectorCollapsed(snapshot.inspectorCollapsed);
      setGmailRunApproved(snapshot.gmailRunApproved);
      viewportRef.current = { zoom: snapshot.zoom, x: snapshot.pan.x, y: snapshot.pan.y };
    };

    void (async () => {
      try {
        const authResponse = await fetch(appPath('/api/auth/status'), { cache: 'no-store' });
        const auth = await authResponse.json() as { authenticated?: boolean; user?: AuthUser | null };
        if (!authResponse.ok || !auth.authenticated || !auth.user) {
          window.location.replace('/synapse/');
          return;
        }

        const [workspaceResponse, credentialResponse, scheduleResponse, whatsappResponse] = await Promise.all([
          fetch(appPath('/api/workspace'), { cache: 'no-store' }),
          fetch(appPath('/api/credentials'), { cache: 'no-store' }),
          fetch(appPath('/api/schedules'), { cache: 'no-store' }),
          fetch(appPath('/api/whatsapp/credentials'), { cache: 'no-store' }),
        ]);
        const workspacePayload = workspaceResponse.ok
          ? await workspaceResponse.json() as { workspace?: unknown }
          : { workspace: null };
        const credentialPayload = credentialResponse.ok
          ? await credentialResponse.json() as { providers?: Provider[] }
          : { providers: [] };
        const schedulePayload = scheduleResponse.ok
          ? await scheduleResponse.json() as { timers?: TimerStatus[] }
          : { timers: [] };
        const whatsappPayload = whatsappResponse.ok
          ? await whatsappResponse.json() as { connected?: boolean }
          : { connected: false };
        const serverSnapshot = parseCanvasSnapshot(workspacePayload.workspace);
        if (cancelled) return;
        setAuthUser(auth.user);
        setCredentialStatus(Object.fromEntries((credentialPayload.providers ?? []).map((provider) => [provider, true])));
        setWhatsAppConnected(whatsappPayload.connected === true);
        receiveTimerStatuses(schedulePayload.timers ?? [], false);
        restore(serverSnapshot ?? localSnapshot);
        setCanvasReady(true);
      } catch {
        if (cancelled) return;
        restore(localSnapshot);
        setCanvasReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [receiveTimerStatuses]);

  useEffect(() => {
    if (!canvasReady || timerMutation) return;
    writeCanvasSnapshot(canvasSnapshot);
    const timer = window.setTimeout(() => {
      setWorkspaceSaveState('saving');
      void fetch(appPath('/api/workspace'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canvasSnapshot),
      }).then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/synapse/');
          return;
        }
        if (response.ok) {
          const payload = await response.json() as { timers?: TimerStatus[] };
          setTimerStatuses(Object.fromEntries((payload.timers ?? []).map((item) => [item.id, item])));
        }
        setWorkspaceSaveState(response.ok ? 'saved' : 'error');
      }).catch(() => setWorkspaceSaveState('error'));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [canvasReady, canvasSnapshot, timerMutation]);

  useEffect(() => {
    if (!tracePlayback) return;
    const timer = window.setTimeout(() => {
      setTracePlayback((current) => {
        if (!current) return null;
        return current.index + 1 < current.steps.length ? { ...current, index: current.index + 1 } : null;
      });
    }, currentTraceStep?.type === 'node' ? 820 : 680);
    return () => window.clearTimeout(timer);
  }, [currentTraceStep, tracePlayback]);

  useEffect(() => {
    if (tracePlayback || !pendingScheduledResult) return;
    const result = pendingScheduledResult;
    const revealTimer = window.setTimeout(() => {
      setScheduledResult({ ...result, closing: false });
      setPendingScheduledResult((current) => current?.runAt === result.runAt ? null : current);
    }, 0);
    return () => window.clearTimeout(revealTimer);
  }, [pendingScheduledResult, tracePlayback]);

  const scheduledResultRunAt = scheduledResult?.runAt;
  useEffect(() => {
    if (!scheduledResultRunAt) return;
    const runAt = scheduledResultRunAt;
    const fadeTimer = window.setTimeout(() => {
      setScheduledResult((current) => current?.runAt === runAt ? { ...current, closing: true } : current);
    }, 14_000);
    const closeTimer = window.setTimeout(() => {
      setScheduledResult((current) => current?.runAt === runAt ? null : current);
    }, 15_000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(closeTimer);
    };
  }, [scheduledResultRunAt]);

  useEffect(() => {
    if (!canvasReady || !agents.some((agent) => agent.kind === 'timer')) return;
    let cancelled = false;
    const refresh = () => {
      void fetch(appPath('/api/schedules'), { cache: 'no-store' })
        .then(async (response) => response.ok ? response.json() as Promise<{ timers?: TimerStatus[] }> : { timers: [] })
        .then((payload) => {
          if (!cancelled) receiveTimerStatuses(payload.timers ?? [], true);
        });
    };
    const timer = window.setInterval(refresh, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [agents, canvasReady, receiveTimerStatuses]);

  useEffect(() => {
    if (!canvasReady || !agents.some((agent) => agent.kind === 'webhook' || agent.kind === 'whatsapp')) return;
    let cancelled = false;
    const refresh = () => {
      void fetch(appPath('/api/executions'), { cache: 'no-store' })
        .then(async (response) => response.ok ? response.json() as Promise<{ execution?: LiveExecution | null }> : { execution: null })
        .then((payload) => {
          if (!cancelled) receiveLiveExecution(payload.execution ?? null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 600);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [agents, canvasReady, receiveLiveExecution]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const captureWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const intensity = event.ctrlKey ? 0.006 : 0.0017;
      const nextZoom = viewportRef.current.zoom * Math.exp(-event.deltaY * intensity);
      applyViewport(nextZoom, event.clientX, event.clientY);
    };

    canvas.addEventListener('wheel', captureWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', captureWheel);
  }, [canvasReady]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    void fetch(appPath('/api/gmail/status'), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('No se pudo consultar Gmail.');
        return response.json() as Promise<GmailStatus>;
      })
      .then((status) => { if (!cancelled) setGmailStatus(status); })
      .catch(() => { if (!cancelled) setGmailStatus({ configured: false, connected: false, email: null }); })
      .finally(() => { if (!cancelled) setGmailChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers = new Set<number>();
    let cancelled = false;

    const scheduleBlink = (id: string) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (cancelled) return;
        setBlinkingAgentIds((current) => new Set(current).add(id));
        const reopenTimer = window.setTimeout(() => {
          timers.delete(reopenTimer);
          if (cancelled) return;
          setBlinkingAgentIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          scheduleBlink(id);
        }, 145 + Math.random() * 90);
        timers.add(reopenTimer);
      }, 1800 + Math.random() * 5600);
      timers.add(timer);
    };

    modelAgentIdsKey.split('|').filter(Boolean).forEach(scheduleBlink);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [modelAgentIdsKey]);

  function startCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as Element;
    const isInteractive = target.closest('article, button, input, textarea, select, .edge-hit');
    if (isInteractive || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = viewportRef.current;
    panRef.current = { startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y };
    setIsPanning(true);
    setConnectingFrom(null);
  }

  function moveCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const activePan = panRef.current;
    if (!activePan) return;
    event.preventDefault();
    const nextX = activePan.originX + event.clientX - activePan.startX;
    const nextY = activePan.originY + event.clientY - activePan.startY;
    viewportRef.current = { ...viewportRef.current, x: nextX, y: nextY };
    setPan({ x: nextX, y: nextY });
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    if (!panRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
    setIsPanning(false);
  }

  function fitAllAgents() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!agents.length) {
      viewportRef.current = { zoom: 1, x: 0, y: 0 };
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(...agents.map((agent) => agent.x));
    const minY = Math.min(...agents.map((agent) => agent.y));
    const maxX = Math.max(...agents.map((agent) => agent.x + entityWidth(agent)));
    const maxY = Math.max(...agents.map((agent) => agent.y + entityHeight(agent)));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const fittedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((rect.width - 100) / contentWidth, (rect.height - 100) / contentHeight, 1.15)));
    const nextX = (rect.width - contentWidth * fittedZoom) / 2 - minX * fittedZoom;
    const nextY = (rect.height - contentHeight * fittedZoom) / 2 - minY * fittedZoom;
    viewportRef.current = { zoom: fittedZoom, x: nextX, y: nextY };
    setZoom(fittedZoom);
    setPan({ x: nextX, y: nextY });
  }

  async function startConversation(options: { gmailApproved?: boolean } = {}) {
    const hasGmailApproval = options.gmailApproved ?? gmailRunApproved;
    setRunOpen(true);
    setRunError(null);
    if (!effectivePrompt) {
      setRunError('Escribe o dicta una instrucción en la entidad de entrada antes de ejecutar el flujo.');
      return;
    }
    if (!flowAgents.length) {
      setRunError(primarySource ? 'Conecta la salida de la entidad inicial al agente que debe iniciar el flujo.' : 'Añade al menos un agente al canvas.');
      return;
    }
    if (flowUsesGmail && !gmailStatus.configured) {
      setRunError('Falta configurar OAuth de Gmail en el servidor.');
      return;
    }
    if (flowUsesGmail && !gmailStatus.connected) {
      setRunError('Conecta tu cuenta de Gmail antes de ejecutar este flujo.');
      return;
    }
    if (flowUsesGmail && !hasGmailApproval) {
      setRunError('Confirma en la consola que autorizas esta ejecución con datos de Gmail.');
      return;
    }
    const incompleteDraft = draftTargets.find((target) => !target.gmailRecipient?.trim() || !target.gmailSubject?.trim());
    if (incompleteDraft) {
      setRunError(`Completa el destinatario y el asunto de ${incompleteDraft.name}.`);
      return;
    }

    const requiredProviders = [...new Set(flowAgents.map((agent) => agent.provider))];
    const missingProviders = requiredProviders.filter((provider) => !credentialStatus[provider]);
    if (missingProviders.length) {
      setRunError(`Falta conectar ${missingProviders.join(', ')} para ejecutar este flujo.`);
      openCredential(missingProviders[0]);
      return;
    }

    setMessages([]);
    setRunNotices([]);
    setRunning(true);
    setActiveAgentId(null);

    try {
      let runPrompt = effectivePrompt;
      if (primarySource?.kind === 'gmail') {
        const mailResponse = await fetch(appPath(`/api/gmail/messages?q=${encodeURIComponent(primarySource.gmailQuery || 'in:inbox newer_than:7d')}&max=${primarySource.gmailMaxResults ?? 5}`), { cache: 'no-store' });
        const mailPayload = await mailResponse.json() as {
          error?: string;
          count?: number;
          messages?: Array<{ from: string; to: string; subject: string; date: string; snippet: string; body: string }>;
        };
        if (!mailResponse.ok) throw new Error(mailPayload.error || 'No se pudieron leer los correos de Gmail.');
        if (!mailPayload.messages?.length) throw new Error('La búsqueda de Gmail no encontró correos para entregar al flujo.');
        const emailContext = mailPayload.messages.map((message, index) => [
          `CORREO ${index + 1}`,
          `De: ${message.from}`,
          `Para: ${message.to}`,
          `Fecha: ${message.date}`,
          `Asunto: ${message.subject}`,
          `Contenido:\n${(message.body || message.snippet).slice(0, 2500)}`,
        ].join('\n')).join('\n\n---\n\n');
        const instruction = effectivePrompt.slice(0, 3_000);
        const availableContext = Math.max(1_000, 19_000 - instruction.length);
        runPrompt = `${instruction}\n\nCORREOS OBTENIDOS DE GMAIL\n${emailContext.slice(0, availableContext)}`;
        setRunNotices([`${mailPayload.count ?? mailPayload.messages.length} correos entregados al primer agente.`]);
      }

      const response = await fetch(appPath('/api/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: runPrompt,
          agents: flowAgents.map(({ id, name, provider, model, systemPrompt, temperature, maxTokens, webSearchEnabled, agentMode }) => ({ id, name, provider, model, systemPrompt, temperature, maxTokens, webSearchEnabled, agentMode })),
          connections: flowConnections.map(({ source, target }) => ({ source, target })),
          tools: agentTools,
          gmailApproved: hasGmailApproval,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; missingProviders?: Provider[] };
        if (payload.missingProviders?.length) {
          setCredentialStatus((current) => {
            const next = { ...current };
            payload.missingProviders?.forEach((provider) => { delete next[provider]; });
            return next;
          });
          openCredential(payload.missingProviders[0]);
        }
        throw new Error(payload.error ?? `La ejecución respondió con error ${response.status}.`);
      }
      if (!response.body) throw new Error('El servidor no inició el flujo de respuestas.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let messageIndex = 0;
      const completedMessages: ChatMessage[] = [];

      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as RunStreamEvent;
        if (event.type === 'status') setActiveAgentId(event.agentId);
        if (event.type === 'tool_start') {
          setActiveAgentId(event.agentId);
          setRunNotices((current) => [...current, `${flowAgents.find((agent) => agent.id === event.agentId)?.name || 'El agente'} está usando ${event.toolName}…`]);
        }
        if (event.type === 'tool_result') {
          setRunNotices((current) => [...current.filter((notice) => !notice.endsWith(`está usando ${event.toolName}…`)), `${event.toolName}: ${event.summary}.`]);
        }
        if (event.type === 'message') {
          messageIndex += 1;
          const message = {
            id: Date.now() + messageIndex,
            agentId: event.agentId,
            text: event.text,
            latency: event.latency,
          };
          completedMessages.push(message);
          setMessages((current) => [...current, message]);
        }
        if (event.type === 'error') throw new Error(event.message);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(consumeLine);
      }
      if (buffer.trim()) consumeLine(buffer);

      for (const draftTarget of draftTargets) {
        const incoming = connections.find((edge) => edge.target === draftTarget.id && flowAgentIds.has(edge.source));
        const sourceMessage = incoming
          ? completedMessages.find((message) => message.agentId === incoming.source)
          : completedMessages[completedMessages.length - 1];
        if (!sourceMessage) continue;
        const draftResponse = await fetch(appPath('/api/gmail/draft'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: draftTarget.gmailRecipient,
            subject: draftTarget.gmailSubject,
            body: sourceMessage.text,
          }),
        });
        const draftPayload = await draftResponse.json() as { error?: string };
        if (!draftResponse.ok) throw new Error(draftPayload.error || `No se pudo crear ${draftTarget.name}.`);
        setRunNotices((current) => [...current, `Borrador creado en Gmail para ${draftTarget.gmailRecipient}. Revísalo antes de enviarlo.`]);
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'La ejecución falló por un error desconocido.');
    } finally {
      setRunning(false);
      setActiveAgentId(null);
    }
  }

  const userInitials = authUser
    ? authUser.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'SY';

  if (!canvasReady) {
    return (
      <main className="workspace-loader" aria-live="polite">
        <div className="loader-mark"><BrainCircuit size={25} /></div>
        <span>ABRIENDO TU WORKSPACE</span>
        <i />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <button className="brand" aria-label="Inicio" onClick={() => window.location.assign('/synapse/')}><BrainCircuit size={21} /></button>
        <nav className="rail-nav" aria-label="Navegación principal">
          <button className="rail-button active" aria-label="Canvas"><LayoutGrid size={19} /></button>
          <button className="rail-button" aria-label="Conversaciones" onClick={() => setRunOpen(true)}><MessageSquareText size={19} /></button>
          <button className="rail-button" aria-label="Historial"><History size={19} /></button>
        </nav>
        <div className="rail-bottom">
          <button className="rail-button" aria-label="Ayuda"><CircleHelp size={19} /></button>
          <button className="avatar" aria-label={`Cerrar sesión de ${authUser?.email ?? 'Synapse'}`} title={`${authUser?.name ?? 'Cuenta'} · Cerrar sesión`} onClick={() => window.location.assign(appPath('/api/auth/logout'))}>{userInitials}</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-block">
            <button className="back-button" aria-label="Volver al inicio" onClick={() => window.location.assign('/synapse/')}><ChevronLeft size={17} /></button>
            <div>
              <div className="eyebrow">WORKSPACE / / / EXPERIMENTO 04</div>
              <h1>Consejo de producto</h1>
            </div>
            <span className={`saved-status ${workspaceSaveState}`}><i /> {workspaceSaveState === 'saving' ? 'Guardando…' : workspaceSaveState === 'error' ? 'Guardado local · sin sincronizar' : 'Sincronizado con tu cuenta'}</span>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Buscar"><Search size={17} /></button>
            <button className={`credentials-button ${providers.some((provider) => credentialStatus[provider]) ? 'has-keys' : ''}`} onClick={() => openCredential('OpenAI')}>
              <KeyRound size={15} /> {providers.filter((provider) => credentialStatus[provider]).length}/{providers.length} claves
            </button>
            <button className="secondary-button" onClick={() => setRunOpen(true)}><Sparkles size={16} /> Probar prompt</button>
            <button className={`run-button ${running ? 'is-running' : ''}`} onClick={() => { setRunOpen(true); if (!running) void startConversation(); }}>
              {running ? <Zap size={15} /> : <Play size={15} fill="currentColor" />} {running ? 'Ejecutando…' : 'Ejecutar flujo'}
            </button>
          </div>
        </header>

        <div className={`stage-grid ${selected ? 'with-inspector' : ''} ${libraryCollapsed ? 'library-collapsed' : ''} ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
          <button
            className="panel-edge-tab library-edge-tab"
            aria-label={libraryCollapsed ? 'Mostrar entidades' : 'Ocultar entidades'}
            title={libraryCollapsed ? 'Mostrar entidades' : 'Ocultar entidades'}
            onClick={() => setLibraryCollapsed((value) => !value)}
          >
            {libraryCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <aside className={`library-panel ${libraryCollapsed ? 'collapsed' : ''}`}>
            <div className="panel-heading">
              <div><span>ENTIDADES</span><strong>Modelos</strong></div>
              <div className="panel-heading-actions">
                <button className="add-model-button" aria-label="Añadir entidad" onClick={() => addAgent()}><Plus size={16} /></button>
              </div>
            </div>
            <p className="panel-intro">Añade una entrada, conecta agentes y define el recorrido del diálogo.</p>
            <div className="input-library">
              <span>INICIO DEL FLUJO</span>
              <div className="model-row input-model-row">
                <div className="model-mark"><CirclePlay size={16} /></div>
                <div><strong>Entrada</strong><span>Texto o micrófono</span></div>
                <button aria-label="Añadir entrada" onClick={addInput}><Plus size={15} /></button>
              </div>
            </div>
            <div className="input-library automation-library">
              <span>AUTOMATIZACIÓN</span>
              <div className="model-row timer-model-row">
                <div className="model-mark timer-mark"><Clock3 size={15} /></div>
                <div><strong>Temporizador</strong><span>Ejecutar por intervalo</span></div>
                <button aria-label="Añadir temporizador" onClick={addTimer}><Plus size={15} /></button>
              </div>
            </div>
            <div className="input-library connector-library">
              <span>CONECTORES</span>
              <div className="model-row gmail-model-row">
                <div className="model-mark gmail-mark"><GmailIcon size={20} /></div>
                <div><strong>Gmail</strong><span>Leer o crear borrador</span></div>
                <button aria-label="Añadir Gmail" onClick={() => addGmail()}><Plus size={15} /></button>
              </div>
              <div className="model-row whatsapp-model-row">
                <div className="model-mark whatsapp-mark"><WhatsAppIcon size={22} /></div>
                <div><strong>WhatsApp</strong><span>Recibir y responder mensajes</span></div>
                <button aria-label="Añadir WhatsApp" onClick={addWhatsApp}><Plus size={15} /></button>
              </div>
              <div className="model-row python-model-row">
                <div className="model-mark python-mark"><PythonIcon size={22} /></div>
                <div><strong>Python</strong><span>Ejecutar función aislada</span></div>
                <button aria-label="Añadir Python" onClick={addPython}><Plus size={15} /></button>
              </div>
              <div className="model-row webhook-model-row">
                <div className="model-mark webhook-mark"><WebhookNodeIcon size={19} /></div>
                <div><strong>Webhook</strong><span>Recibir y responder HTTP</span></div>
                <button aria-label="Añadir Webhook" onClick={addWebhook}><Plus size={15} /></button>
              </div>
            </div>
            <label className="search-box">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelos" />
              <kbd>⌘ K</kbd>
            </label>
            <div className="model-list">
              {filteredPresets.map((preset) => (
                <div className="model-row" key={preset.model}>
                  <div className="model-mark" style={{ '--agent': preset.color } as CSSProperties}>{preset.mark}</div>
                  <div><strong>{preset.name}</strong><span>{preset.model}</span></div>
                  <button aria-label={`Añadir ${preset.name}`} onClick={() => addAgent(preset)}><Plus size={15} /></button>
                </div>
              ))}
            </div>
            <button className="new-agent" onClick={() => addAgent()}><Plus size={16} /> Nueva entidad</button>

            <div className="library-tip">
              <Link2 size={14} />
              <p><b>Cómo conectar</b><span>Pulsa el puerto derecho de un nodo y luego el izquierdo de otro.</span></p>
            </div>
          </aside>

          <section
            ref={canvasRef}
            className={`canvas ${connectingFrom ? 'is-connecting' : ''} ${isPanning ? 'is-panning' : ''}`}
            aria-label="Canvas de agentes. Arrastra el fondo para mover la vista y usa la rueda del mouse para acercar o alejar."
            role="application"
            tabIndex={0}
            onClick={() => setConnectingFrom(null)}
            onKeyDown={(event) => { if (event.key === 'Escape') setConnectingFrom(null); }}
            onPointerDown={startCanvasPan}
            onPointerMove={moveCanvasPan}
            onPointerUp={finishCanvasPan}
            onPointerCancel={finishCanvasPan}
          >
            <div className="canvas-dots" style={{ backgroundSize: `${22 * zoom}px ${22 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }} />
            <div className="canvas-label"><i /> CANVAS EN VIVO <span>{agents.length} entidades · {connections.length} conexiones · arrastra para mover · rueda para zoom</span></div>
            {tracePlayback && <div className="trace-live"><span><i /></span> {tracePlayback.sourceKind === 'whatsapp' ? 'MENSAJE DE WHATSAPP EN CURSO' : tracePlayback.sourceKind === 'webhook' ? 'PETICIÓN WEBHOOK EN CURSO' : 'EJECUCIÓN AUTOMÁTICA'}</div>}
            {connectingFrom && <div className="connect-hint"><Link2 size={13} /> Elige uno o varios destinos · clic en el fondo para terminar</div>}

            <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <svg className="connections" aria-hidden="true">
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {edgeData.map((edge, index) => {
                  const sourceOffset = connectionPortOffset(edge, connections, 'source');
                  const targetOffset = connectionPortOffset(edge, connections, 'target');
                  const path = connectionPath(edge.sourceAgent!, edge.targetAgent!, sourceOffset, targetOffset);
                  const isToolEdge = edge.sourceAgent!.kind === 'agent' && (edge.targetAgent!.kind === 'python' || edge.targetAgent!.kind === 'gmail' && edge.targetAgent!.gmailOperation !== 'draft');
                  const isTraceEdge = currentTraceStep?.type === 'edge' && currentTraceStep.source === edge.source && currentTraceStep.target === edge.target;
                  return (
                    <g key={edge.id} className={`${running ? 'edge-running' : ''} ${isToolEdge ? 'tool-edge' : ''} ${isTraceEdge ? 'trace-edge-active' : ''}`}>
                      <path className={`edge-path ${index === 2 ? 'feedback' : ''}`} d={path} markerEnd="url(#arrow)" />
                      {isToolEdge && <g className="tool-edge-label" transform={`translate(${(edge.sourceAgent!.x + entityWidth(edge.sourceAgent!) + edge.targetAgent!.x) / 2} ${(edge.sourceAgent!.y + entityPortY(edge.sourceAgent!) + sourceOffset + edge.targetAgent!.y + entityPortY(edge.targetAgent!) + targetOffset) / 2})`}><circle r="10" /><path d="M-4-1.5a4 4 0 0 0 5 5L5 7l2-2-3.5-3.5a4 4 0 0 0-5-5L1-1-1 1Z" /></g>}
                      {(running || isTraceEdge) && <circle className="flow-packet" r={isTraceEdge ? 4.5 : 3.5}><animateMotion dur={isTraceEdge ? '.68s' : `${1.5 + index * 0.28}s`} repeatCount={isTraceEdge ? '1' : 'indefinite'} path={path} /></circle>}
                      <path className="edge-hit" d={path} onClick={(event) => { event.stopPropagation(); removeConnection(edge.id); }} />
                    </g>
                  );
                })}
              </svg>

              {agents.map((agent, index) => (
                <article
                  className={`agent-node ${agent.kind === 'input' ? 'input-node' : ''} ${agent.kind === 'gmail' ? 'gmail-node' : ''} ${agent.kind === 'python' ? 'python-node' : ''} ${agent.kind === 'whatsapp' ? 'whatsapp-node' : ''} ${agent.kind === 'timer' ? 'timer-node' : ''} ${agent.kind === 'webhook' ? 'webhook-node' : ''} ${selectedId === agent.id ? 'selected' : ''} ${activeAgentId === agent.id ? 'active-run' : ''} ${currentTraceStep?.type === 'node' && currentTraceStep.nodeId === agent.id ? 'trace-active' : ''}`}
                  key={agent.id}
                  style={{ left: agent.x, top: agent.y, '--agent': agent.color, animationDelay: `${index * 70}ms` } as CSSProperties}
                  onPointerDown={(event) => startDrag(event, agent)}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(agent.id); setInspectorCollapsed(false); }}
                  role="group"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(agent.id); setInspectorCollapsed(false); } }}
                >
                  {agent.kind === 'timer' ? (
                    <>
                      <TimerDial enabled={agent.timerEnabled === true} intervalMinutes={agent.timerIntervalMinutes} status={timerStatuses[agent.id]} />
                      <div className="timer-node-label">
                        <b>{agent.name}</b>
                        <span><i /> {agent.timerEnabled ? `Cada ${timerIntervalLabel(agent.timerIntervalMinutes)}` : 'Pausado'}</span>
                      </div>
                      <button className={`port output-port ${connections.filter((edge) => edge.source === agent.id).length > 1 ? 'multi-port' : ''} ${connectingFrom === agent.id ? 'armed' : ''}`} aria-label={`Conectar desde ${agent.name}. Admite múltiples destinos.`} onPointerDown={(event) => startConnection(event, agent.id)}>{connections.filter((edge) => edge.source === agent.id).length > 0 && <span>{connections.filter((edge) => edge.source === agent.id).length}</span>}</button>
                    </>
                  ) : agent.kind === 'gmail' ? (
                    <>
                      <div className="gmail-tool drag-handle">
                        <div className="gmail-tool-icon">
                          <GmailIcon size={78} />
                        </div>
                        <div className="gmail-tool-label">
                          <b>{agent.name}</b>
                          <span><i className={gmailStatus.connected ? 'connected' : ''} /> {agent.gmailOperation === 'draft' ? 'Crear borrador' : 'Leer correos'}</span>
                        </div>
                      </div>
                      <div className="gmail-tool-badge" aria-hidden="true"><Wrench size={9} /> HERRAMIENTA</div>
                      <button className={`port input-port ${connections.filter((edge) => edge.target === agent.id).length > 1 ? 'multi-port' : ''}`} aria-label={`Conectar a ${agent.name}. Admite múltiples orígenes.`} onPointerDown={(event) => finishConnection(event, agent.id)}>{connections.filter((edge) => edge.target === agent.id).length > 0 && <span>{connections.filter((edge) => edge.target === agent.id).length}</span>}</button>
                      {agent.gmailOperation !== 'draft' && <button className={`port output-port ${connections.filter((edge) => edge.source === agent.id).length > 1 ? 'multi-port' : ''} ${connectingFrom === agent.id ? 'armed' : ''}`} aria-label={`Conectar desde ${agent.name}. Admite múltiples destinos.`} onPointerDown={(event) => startConnection(event, agent.id)}>{connections.filter((edge) => edge.source === agent.id).length > 0 && <span>{connections.filter((edge) => edge.source === agent.id).length}</span>}</button>}
                    </>
                  ) : agent.kind === 'whatsapp' ? (
                    <>
                      <div className="whatsapp-channel drag-handle">
                        <div className="whatsapp-channel-icon"><WhatsAppIcon size={66} /><i /></div>
                        <div className="whatsapp-channel-label"><b>{agent.name}</b><span><i className={whatsappConnected ? 'connected' : ''} /> {whatsappConnected ? 'CANAL CONECTADO' : 'POR CONFIGURAR'}</span></div>
                      </div>
                      <div className="whatsapp-channel-badge" aria-hidden="true"><PhoneCall size={9} /> ENTRADA · SALIDA</div>
                      <button className={`port input-port ${connections.filter((edge) => edge.target === agent.id).length > 1 ? 'multi-port' : ''}`} aria-label={`Conectar una salida automática a ${agent.name}.`} onPointerDown={(event) => finishConnection(event, agent.id)}>{connections.filter((edge) => edge.target === agent.id).length > 0 && <span>{connections.filter((edge) => edge.target === agent.id).length}</span>}</button>
                      <button className={`port output-port ${connections.filter((edge) => edge.source === agent.id).length > 1 ? 'multi-port' : ''} ${connectingFrom === agent.id ? 'armed' : ''}`} aria-label={`Conectar ${agent.name} al agente que responderá.`} onPointerDown={(event) => startConnection(event, agent.id)}>{connections.filter((edge) => edge.source === agent.id).length > 0 && <span>{connections.filter((edge) => edge.source === agent.id).length}</span>}</button>
                    </>
                  ) : agent.kind === 'webhook' ? (
                    <>
                      <div className="webhook-trigger drag-handle">
                        <div className="webhook-trigger-icon"><WebhookNodeIcon size={82} /></div>
                        <div className="webhook-trigger-label"><b>{agent.name}</b><span><i /> WEBHOOK · POST</span></div>
                      </div>
                      <div className="webhook-trigger-badge" aria-hidden="true"><WebhookNodeIcon size={10} /> HTTP IN</div>
                      <button className={`port output-port ${connections.filter((edge) => edge.source === agent.id).length > 1 ? 'multi-port' : ''} ${connectingFrom === agent.id ? 'armed' : ''}`} aria-label={`Conectar desde ${agent.name}. Admite múltiples destinos.`} onPointerDown={(event) => startConnection(event, agent.id)}>{connections.filter((edge) => edge.source === agent.id).length > 0 && <span>{connections.filter((edge) => edge.source === agent.id).length}</span>}</button>
                    </>
                  ) : agent.kind === 'python' ? (
                    <>
                      <div className="python-tool drag-handle">
                        <div className="python-tool-icon"><PythonIcon size={64} /><code>&gt;_</code></div>
                        <div className="python-tool-label"><b>{agent.name}</b><span><i /> FUNCIÓN AISLADA</span></div>
                      </div>
                      <div className="python-tool-badge" aria-hidden="true"><Code2 size={9} /> PYTHON</div>
                      <button className={`port input-port ${connections.filter((edge) => edge.target === agent.id).length > 1 ? 'multi-port' : ''}`} aria-label={`Conectar a ${agent.name}. Admite múltiples agentes.`} onPointerDown={(event) => finishConnection(event, agent.id)}>{connections.filter((edge) => edge.target === agent.id).length > 0 && <span>{connections.filter((edge) => edge.target === agent.id).length}</span>}</button>
                    </>
                  ) : (
                    <>
                      {agent.kind === 'agent' && (
                        <div className={`agent-eyes ${blinkingAgentIds.has(agent.id) ? 'blink' : ''}`} aria-hidden="true">
                          <span><i /></span><span><i /></span>
                        </div>
                      )}
                      {agent.kind === 'input' && <div className="start-flag" aria-hidden="true"><CirclePlay size={11} /> INICIO</div>}
                      <button className={`port input-port ${connections.filter((edge) => edge.target === agent.id).length > 1 ? 'multi-port' : ''}`} aria-label={`Conectar a ${agent.name}. Admite múltiples orígenes.`} onPointerDown={(event) => finishConnection(event, agent.id)}>{connections.filter((edge) => edge.target === agent.id).length > 0 && <span>{connections.filter((edge) => edge.target === agent.id).length}</span>}</button>
                      <header className="drag-handle">
                        <div className="node-icon">{agent.kind === 'input' ? <CirclePlay size={19} /> : <Bot size={17} />}</div>
                        <div><b>{agent.name}</b><small>{agent.kind === 'input' ? `INICIO · ${agent.inputMode === 'audio' ? 'MICRÓFONO' : 'TEXTO'}` : `AGENTE · ${agent.provider.toUpperCase()} · ${String(index + 1).padStart(2, '0')}`}</small></div>
                        <button className="node-more" aria-label="Más opciones"><MoreHorizontal size={14} /></button>
                      </header>
                      <p>{agent.kind === 'input' ? agent.inputValue?.trim() || 'Escribe o dicta la instrucción inicial.' : agent.role}</p>
                      <footer>
                        <span><i /> {agent.kind === 'input' ? recordingNodeId === agent.id ? 'escuchando…' : agent.inputMode === 'audio' ? 'entrada por voz' : 'entrada de texto' : agent.model}</span>
                        {agent.kind === 'input' ? <ArrowRight size={14} /> : <Settings2 size={14} />}
                      </footer>
                      <button className={`port output-port ${connections.filter((edge) => edge.source === agent.id).length > 1 ? 'multi-port' : ''} ${connectingFrom === agent.id ? 'armed' : ''}`} aria-label={`Conectar desde ${agent.name}. Admite múltiples destinos.`} onPointerDown={(event) => startConnection(event, agent.id)}>{connections.filter((edge) => edge.source === agent.id).length > 0 && <span>{connections.filter((edge) => edge.source === agent.id).length}</span>}</button>
                    </>
                  )}
                </article>
              ))}
            </div>

            {!agents.length && (
              <div className="empty-canvas"><BrainCircuit size={30} /><b>Tu consejo está vacío</b><span>Añade una entidad para empezar a diseñar el diálogo.</span><button onClick={() => addAgent()}><Plus size={16} /> Crear primera entidad</button></div>
            )}

            <div className="canvas-add-group">
              <button className="canvas-add timer-add" onClick={(event) => { event.stopPropagation(); addTimer(); }}><Clock3 size={14} /> Temporizador</button>
              <button className="canvas-add webhook-add" onClick={(event) => { event.stopPropagation(); addWebhook(); }}><WebhookNodeIcon size={15} /> Webhook</button>
              <button className="canvas-add input-add" onClick={(event) => { event.stopPropagation(); addInput(); }}><MessageSquareText size={16} /> Entrada</button>
              <button className="canvas-add gmail-add" onClick={(event) => { event.stopPropagation(); addGmail(); }}><GmailIcon size={15} /> Gmail</button>
              <button className="canvas-add whatsapp-add" onClick={(event) => { event.stopPropagation(); addWhatsApp(); }}><WhatsAppIcon size={16} /> WhatsApp</button>
              <button className="canvas-add python-add" onClick={(event) => { event.stopPropagation(); addPython(); }}><PythonIcon size={17} /> Python</button>
              <button className="canvas-add" onClick={(event) => { event.stopPropagation(); addAgent(); }}><Plus size={18} /> Agente</button>
            </div>
            <div className="zoom-control">
              <button aria-label="Alejar" title="Alejar" onClick={(event) => { event.stopPropagation(); applyViewport(viewportRef.current.zoom - .1); }}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button aria-label="Acercar" title="Acercar" onClick={(event) => { event.stopPropagation(); applyViewport(viewportRef.current.zoom + .1); }}>+</button>
              <button className="fit-button" aria-label="Encajar todos los agentes" title="Encajar todos los agentes" onClick={(event) => { event.stopPropagation(); fitAllAgents(); }}><Maximize2 size={13} /></button>
            </div>
          </section>

          {selected && (
            <>
              <button
                className="panel-edge-tab inspector-edge-tab"
                aria-label={inspectorCollapsed ? 'Mostrar configuración' : 'Ocultar configuración'}
                title={inspectorCollapsed ? 'Mostrar configuración' : 'Ocultar configuración'}
                onClick={() => setInspectorCollapsed((value) => !value)}
              >
                {inspectorCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
              </button>
              <aside className={`inspector ${inspectorCollapsed ? 'collapsed' : ''}`}>
              <div className="inspector-top">
                <div><span>CONFIGURACIÓN</span><strong>{selected.name}</strong></div>
              </div>

              <div className="entity-summary">
                <div className={`summary-icon ${selected.kind === 'gmail' ? 'gmail-summary-icon' : ''} ${selected.kind === 'python' ? 'python-summary-icon' : ''} ${selected.kind === 'whatsapp' ? 'whatsapp-summary-icon' : ''} ${selected.kind === 'timer' ? 'timer-summary-icon' : ''} ${selected.kind === 'webhook' ? 'webhook-summary-icon' : ''}`} style={{ '--agent': selected.color } as CSSProperties}>{selected.kind === 'input' ? <CirclePlay size={20} /> : selected.kind === 'gmail' ? <GmailIcon size={23} /> : selected.kind === 'python' ? <PythonIcon size={25} /> : selected.kind === 'whatsapp' ? <WhatsAppIcon size={25} /> : selected.kind === 'timer' ? <Clock3 size={17} /> : selected.kind === 'webhook' ? <WebhookNodeIcon size={20} /> : <Bot size={19} />}</div>
                <div><b>{selected.name}</b><span>{selected.kind === 'input' ? 'INICIO DEL FLUJO' : selected.kind === 'gmail' ? `GMAIL · ${selected.gmailOperation === 'draft' ? 'BORRADOR' : 'LECTURA'}` : selected.kind === 'python' ? 'HERRAMIENTA · PYTHON WASM' : selected.kind === 'whatsapp' ? 'CANAL · WHATSAPP CLOUD' : selected.kind === 'timer' ? 'CONTROL · TEMPORIZADOR' : selected.kind === 'webhook' ? 'CONECTOR · WEBHOOK HTTP' : `AGENTE · ID ${selected.id.replace('agent-', '')}`}</span></div>
                <span className={`entity-online ${selected.kind === 'gmail' && !gmailStatus.connected || selected.kind === 'whatsapp' && !whatsappConnected || selected.kind === 'timer' && !selected.timerEnabled ? 'offline' : ''}`}><i /> {selected.kind === 'input' ? 'activa' : selected.kind === 'gmail' ? gmailChecking ? 'revisando' : gmailStatus.connected ? 'conectado' : 'sin conectar' : selected.kind === 'python' ? 'aislada' : selected.kind === 'whatsapp' ? whatsappConnected ? 'protegido' : 'sin credencial' : selected.kind === 'timer' ? selected.timerEnabled ? 'programado' : 'pausado' : 'lista'}</span>
              </div>

              {selected.kind === 'timer' ? (
                <div className="form-stack timer-form">
                  <label><span>Nombre del control</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <div className="timer-interval-field">
                    <span>Ejecutar cada</span>
                    <div>
                      <input
                        type="number"
                        min="1"
                        max="10080"
                        value={timerDisplay(selected.timerIntervalMinutes).value}
                        onChange={(event) => {
                          const unit = timerDisplay(selected.timerIntervalMinutes).unit;
                          const multiplier = unit === 'days' ? 1_440 : unit === 'hours' ? 60 : 1;
                          updateSelected({ timerIntervalMinutes: Math.min(10_080, Math.max(1, Math.round(Number(event.target.value) * multiplier))) });
                        }}
                      />
                      <label aria-label="Unidad del intervalo">
                        <select
                          value={timerDisplay(selected.timerIntervalMinutes).unit}
                          onChange={(event) => {
                            const multiplier = event.target.value === 'days' ? 1_440 : event.target.value === 'hours' ? 60 : 1;
                            updateSelected({ timerIntervalMinutes: Math.min(10_080, Math.max(1, timerDisplay(selected.timerIntervalMinutes).value * multiplier)) });
                          }}
                        >
                          <option value="minutes">Minutos</option>
                          <option value="hours">Horas</option>
                          <option value="days">Días</option>
                        </select>
                        <ChevronDown size={13} />
                      </label>
                    </div>
                  </div>
                  <div className="timer-presets" aria-label="Intervalos rápidos">
                    {[1, 5, 15, 60].map((minutes) => <button className={selected.timerIntervalMinutes === minutes ? 'active' : ''} key={minutes} onClick={() => updateSelected({ timerIntervalMinutes: minutes })}>{minutes < 60 ? `${minutes}m` : '1h'}</button>)}
                  </div>
                  <label className={`timer-enable ${selected.timerEnabled ? 'active' : ''} ${timerMutation?.timerId === selected.id ? 'saving' : ''}`}>
                    <span className="sr-only">Activar o pausar temporizador</span>
                    <input type="checkbox" disabled={timerMutation !== null} checked={selected.timerEnabled === true} onChange={(event) => void setTimerEnabled(selected, event.target.checked)} />
                    <span className="timer-switch"><i /></span>
                    <span><b>{timerMutation?.timerId === selected.id ? timerMutation.enabled ? 'Activando programación…' : 'Pausando programación…' : selected.timerEnabled ? 'Programación activa' : 'Programación pausada'}</b><small>{timerMutation?.timerId === selected.id ? 'Esperando confirmación del servidor.' : selected.timerEnabled ? 'El servidor ejecutará este flujo automáticamente.' : 'Actívala cuando el flujo esté conectado y listo.'}</small></span>
                  </label>
                  {timerMutationError?.timerId === selected.id && <div className="timer-enable-error">{timerMutationError.message}</div>}
                  <div className="timer-neutral-note"><Zap size={14} /><p><b>Este control solo indica cuándo</b><span>La tarea pertenece al agente y se configura en su prompt de sistema. El temporizador no añade instrucciones.</span></p></div>
                  <div className={`timer-run-state ${selectedTimerStatus?.lastStatus ?? 'idle'}`}>
                    <Clock3 size={15} />
                    <p><b>Próxima ejecución: {selected.timerEnabled ? dateTimeLabel(selectedTimerStatus?.nextRunAt) : 'pausada'}</b><span>{selectedTimerStatus?.lastMessage || 'Todavía no hay ejecuciones registradas.'}</span><small>Última: {dateTimeLabel(selectedTimerStatus?.lastRunAt)}</small></p>
                  </div>
                  {!connections.some((edge) => edge.source === selected.id) && <div className="timer-route-warning"><Link2 size={14} /><p><b>Falta conectar el disparador</b><span>Une el puerto derecho con Gmail, una entrada o un agente.</span></p></div>}
                  <div className="timer-server-note"><ShieldCheck size={14} /><p><b>Funciona con la página cerrada</b><span>La programación queda guardada en tu cuenta y se ejecuta desde el servidor.</span></p></div>
                </div>
              ) : selected.kind === 'webhook' ? (
                <div className="form-stack webhook-form">
                  <label><span>Nombre de entidad</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <label className="input-prompt-field"><span>Instrucción previa al payload</span><textarea value={selected.inputValue ?? ''} onChange={(event) => updateSelected({ inputValue: event.target.value })} rows={5} placeholder="Indica cómo debe interpretar el agente la petición…" /><small>{selected.inputValue?.length ?? 0} caracteres</small></label>
                  <div className="webhook-endpoint-card">
                    <div><WebhookNodeIcon size={17} /><p><b>Endpoint de producción</b><span>POST · responde al finalizar el flujo</span></p></div>
                    <code>{appPath(`/api/webhook?id=${selected.webhookId ?? ''}`)}</code>
                    <button onClick={() => void copyWebhookField('url', selected)}><Copy size={13} /> {copiedWebhookField === 'url' ? 'URL copiada' : 'Copiar URL completa'}</button>
                  </div>
                  <div className="webhook-secret-field">
                    <span>CLAVE DE AUTORIZACIÓN</span>
                    <code>{selected.webhookSecret ? `${selected.webhookSecret.slice(0, 7)}••••••••••••${selected.webhookSecret.slice(-5)}` : 'sin clave'}</code>
                    <div>
                      <button onClick={() => void copyWebhookField('secret', selected)}><Copy size={13} /> {copiedWebhookField === 'secret' ? 'Copiada' : 'Copiar clave'}</button>
                      <button className="rotate-secret" onClick={() => updateSelected({ webhookSecret: webhookSecret() })}><RefreshCw size={13} /> Regenerar</button>
                    </div>
                  </div>
                  <div className="webhook-auth-note"><ShieldCheck size={15} /><p><b>Autorización Bearer</b><span>El sistema que llame este endpoint debe enviar <code>Authorization: Bearer TU_CLAVE</code>. Nunca incluyas la clave en la URL.</span></p></div>
                  <div className="webhook-flow-note"><ArrowRight size={15} /><p><b>Respuesta automática</b><span>Conecta la salida del webhook al primer agente. La salida del último agente volverá como JSON en la misma petición HTTP.</span></p></div>
                  {!connections.some((edge) => edge.source === selected.id && agents.some((entity) => entity.id === edge.target && entity.kind === 'agent')) && <div className="timer-route-warning"><Link2 size={14} /><p><b>Falta el agente inicial</b><span>Conecta este webhook directamente al agente que recibirá el payload.</span></p></div>}
                </div>
              ) : selected.kind === 'whatsapp' ? (
                <div className="form-stack whatsapp-form">
                  <label><span>Nombre del canal</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <label><span>Phone Number ID</span><input inputMode="numeric" value={selected.whatsappPhoneNumberId ?? ''} onChange={(event) => updateSelected({ whatsappPhoneNumberId: event.target.value.replace(/\D/g, '').slice(0, 40) })} placeholder="Identificador del número de Meta" /></label>
                  <label><span>WhatsApp Business Account ID</span><input inputMode="numeric" value={selected.whatsappBusinessAccountId ?? ''} onChange={(event) => updateSelected({ whatsappBusinessAccountId: event.target.value.replace(/\D/g, '').slice(0, 40) })} placeholder="WABA ID" /></label>
                  <label><span>Destinatario para envíos automáticos</span><input inputMode="tel" value={selected.whatsappOutboundRecipient ?? ''} onChange={(event) => updateSelected({ whatsappOutboundRecipient: event.target.value.replace(/\D/g, '').slice(0, 15) })} placeholder="56912345678" /><small>Código de país + número, sin espacios ni signo +.</small></label>
                  <label className="input-prompt-field"><span>Instrucción previa al mensaje</span><textarea value={selected.inputValue ?? ''} onChange={(event) => updateSelected({ inputValue: event.target.value })} rows={4} /><small>{selected.inputValue?.length ?? 0} caracteres</small></label>

                  <div className={`whatsapp-memory-card ${selected.whatsappMemoryEnabled !== false ? 'active' : ''}`}>
                    <button className="whatsapp-memory-toggle" onClick={() => updateSelected({ whatsappMemoryEnabled: selected.whatsappMemoryEnabled === false })}>
                      <BrainCircuit size={17} />
                      <p><b>Recordar conversación</b><span>Memoria cifrada y separada para cada contacto.</span></p>
                      <i><span /></i>
                    </button>
                    {selected.whatsappMemoryEnabled !== false && <div className="whatsapp-memory-options">
                      <label><span>Mensajes conservados</span><input type="number" min={2} max={50} value={selected.whatsappMemoryMaxMessages ?? 20} onChange={(event) => updateSelected({ whatsappMemoryMaxMessages: Math.min(50, Math.max(2, Number(event.target.value) || 20)) })} /></label>
                      <label><span>Duración</span><select value={selected.whatsappMemoryRetentionHours ?? 168} onChange={(event) => updateSelected({ whatsappMemoryRetentionHours: Number(event.target.value) })}><option value={24}>24 horas</option><option value={168}>7 días</option><option value={720}>30 días</option><option value={2160}>90 días</option></select></label>
                      <small>El contacto puede escribir “olvida esta conversación” para borrar únicamente su historial.</small>
                    </div>}
                  </div>

                  <div className="whatsapp-callback-card">
                    <div><WhatsAppIcon size={20} /><p><b>Callback de Meta</b><span>GET de verificación · POST de mensajes</span></p></div>
                    <code>{appPath(`/api/whatsapp/webhook?id=${selected.whatsappWebhookId ?? ''}`)}</code>
                    <button onClick={() => void copyWhatsAppField('whatsapp-url', selected)}><Copy size={13} /> {copiedWebhookField === 'whatsapp-url' ? 'URL copiada' : 'Copiar URL completa'}</button>
                  </div>
                  <div className="whatsapp-verify-card">
                    <span>VERIFY TOKEN</span>
                    <code>{selected.whatsappVerifyToken ? `${selected.whatsappVerifyToken.slice(0, 7)}••••••••••••${selected.whatsappVerifyToken.slice(-5)}` : 'sin token'}</code>
                    <div><button onClick={() => void copyWhatsAppField('whatsapp-token', selected)}><Copy size={13} /> {copiedWebhookField === 'whatsapp-token' ? 'Copiado' : 'Copiar Verify Token'}</button><button className="rotate-secret" onClick={() => updateSelected({ whatsappVerifyToken: webhookSecret() })}><RefreshCw size={13} /> Regenerar</button></div>
                  </div>

                  <div className={`whatsapp-vault ${whatsappConnected ? 'connected' : ''}`}>
                    <div><ShieldCheck size={16} /><p><b>{whatsappConnected ? 'Credenciales protegidas' : 'Conectar WhatsApp Cloud API'}</b><span>{whatsappConnected ? 'Access Token y App Secret guardados cifrados.' : 'Estos valores nunca se guardan en el canvas.'}</span></p></div>
                    <label><span>{whatsappConnected ? 'Nuevo Access Token permanente' : 'Access Token'}</span><input type="password" autoComplete="off" value={whatsappAccessToken} onChange={(event) => { setWhatsAppAccessToken(event.target.value); setWhatsAppCredentialError(null); }} /></label>
                    {!whatsappConnected && <label><span>App Secret del webhook</span><input type="password" autoComplete="off" value={whatsappAppSecret} onChange={(event) => { setWhatsAppAppSecret(event.target.value); setWhatsAppCredentialError(null); }} /></label>}
                    {whatsappCredentialError && <small className="whatsapp-credential-error">{whatsappCredentialError}</small>}
                    <button className="whatsapp-save-credentials" disabled={whatsappCredentialBusy || !whatsappAccessToken || (!whatsappConnected && !whatsappAppSecret)} onClick={() => void saveWhatsAppCredentials()}>{whatsappCredentialBusy ? 'Guardando…' : whatsappConnected ? 'Reemplazar Access Token' : 'Guardar en la bóveda'}</button>
                  </div>
                  <div className="whatsapp-flow-note"><ArrowRight size={15} /><p><b>Entrada y salida</b><span>WhatsApp → Agente responde al mismo chat. Agente → WhatsApp envía el resultado programado al destinatario configurado.</span></p></div>
                  {connections.some((edge) => edge.target === selected.id) && !/^\d{8,15}$/.test(selected.whatsappOutboundRecipient ?? '') && <div className="timer-route-warning"><Link2 size={14} /><p><b>Falta el destinatario automático</b><span>Escribe el número con código de país para completar esta salida.</span></p></div>}
                  {!connections.some((edge) => edge.source === selected.id && agents.some((entity) => entity.id === edge.target && entity.kind === 'agent')) && <div className="timer-route-warning"><Link2 size={14} /><p><b>Falta el agente inicial</b><span>Conecta WhatsApp directamente al agente que responderá.</span></p></div>}
                </div>
              ) : selected.kind === 'input' ? (
                <div className="form-stack input-form">
                  <label><span>Nombre de entidad</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <div className="input-mode-field">
                    <span>Tipo de entrada</span>
                    <div className="input-mode-switch">
                      <button className={selected.inputMode !== 'audio' ? 'active' : ''} onClick={() => { if (recordingNodeId === selected.id) recognitionRef.current?.stop(); updateSelected({ inputMode: 'text' }); setInputError(null); }}><MessageSquareText size={14} /> Texto</button>
                      <button className={selected.inputMode === 'audio' ? 'active' : ''} onClick={() => { updateSelected({ inputMode: 'audio' }); setInputError(null); }}><Mic size={14} /> Micrófono</button>
                    </div>
                  </div>
                  <label className="input-prompt-field"><span>{selected.inputMode === 'audio' ? 'Transcripción de voz' : 'Instrucción inicial'}</span><textarea value={selected.inputValue ?? ''} onChange={(event) => updateSelected({ inputValue: event.target.value })} rows={8} placeholder="Escribe qué deben resolver los agentes…" /><small>{selected.inputValue?.length ?? 0} caracteres</small></label>
                  {selected.inputMode === 'audio' && (
                    <div className="voice-control">
                      <button className={recordingNodeId === selected.id ? 'recording' : ''} onClick={() => toggleRecording(selected)}>
                        {recordingNodeId === selected.id ? <Square size={14} fill="currentColor" /> : <Mic size={15} />}
                        {recordingNodeId === selected.id ? 'Detener dictado' : 'Iniciar dictado'}
                      </button>
                      <p>{recordingNodeId === selected.id ? 'Escuchando y transcribiendo en vivo…' : 'El navegador convertirá tu voz en texto; podrás corregirla antes de ejecutar.'}</p>
                    </div>
                  )}
                  {inputError && <div className="input-error">{inputError}</div>}
                  <div className="input-route-note"><ArrowRight size={15} /><p><b>Define el primer turno</b><span>Conecta el puerto derecho al agente que debe recibir esta instrucción.</span></p></div>
                </div>
              ) : selected.kind === 'gmail' ? (
                <div className="form-stack gmail-form">
                  <label><span>Nombre de entidad</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <div className="input-mode-field">
                    <span>Operación de Gmail</span>
                    <div className="input-mode-switch gmail-operation-switch">
                      <button className={selected.gmailOperation !== 'draft' ? 'active' : ''} onClick={() => changeGmailOperation('read')}><Inbox size={14} /> Leer</button>
                      <button className={selected.gmailOperation === 'draft' ? 'active' : ''} onClick={() => changeGmailOperation('draft')}><FileText size={14} /> Borrador</button>
                    </div>
                  </div>

                  {selected.gmailOperation !== 'draft' ? (
                    <>
                      <label><span>Búsqueda de Gmail</span><input value={selected.gmailQuery ?? ''} onChange={(event) => updateSelected({ gmailQuery: event.target.value })} placeholder="in:inbox is:unread" /></label>
                      <label><span>Máximo de correos</span><input type="number" min="1" max="10" value={selected.gmailMaxResults ?? 5} onChange={(event) => updateSelected({ gmailMaxResults: Math.min(10, Math.max(1, Number(event.target.value))) })} /></label>
                      <label className="input-prompt-field"><span>Instrucción para el agente</span><textarea value={selected.inputValue ?? ''} onChange={(event) => updateSelected({ inputValue: event.target.value })} rows={6} placeholder="Indica qué debe hacer el agente con los correos…" /><small>{selected.inputValue?.length ?? 0} caracteres</small></label>
                      <div className="gmail-route-note"><Wrench size={15} /><p><b>Dos formas de usar Gmail</b><span><b>Gmail → Agente:</b> entrega correos al iniciar. <b>Agente → Gmail:</b> el agente decide cuándo consultar esta bandeja.</span></p></div>
                    </>
                  ) : (
                    <>
                      <label><span>Destinatario</span><input type="email" value={selected.gmailRecipient ?? ''} onChange={(event) => updateSelected({ gmailRecipient: event.target.value })} placeholder="persona@empresa.com" /></label>
                      <label><span>Asunto</span><input value={selected.gmailSubject ?? ''} onChange={(event) => updateSelected({ gmailSubject: event.target.value })} placeholder="Asunto del correo" /></label>
                      <div className="gmail-route-note draft-note"><FileText size={15} /><p><b>Solo crea un borrador</b><span>Conecta un agente a la entrada. Su respuesta se guardará en Gmail para que tú la revises y envíes.</span></p></div>
                    </>
                  )}

                  <div className={`gmail-account ${gmailStatus.connected ? 'connected' : ''}`}>
                    <div className="gmail-account-mark"><GmailIcon size={22} /></div>
                    <p><b>{gmailChecking ? 'Comprobando Gmail…' : gmailStatus.connected ? gmailStatus.email : gmailStatus.configured ? 'Conecta tu cuenta de Gmail' : 'Servicio Gmail pendiente'}</b><span>{gmailStatus.connected ? 'Cuenta privada de este usuario' : gmailStatus.configured ? 'Cada usuario autoriza su propia cuenta' : 'El propietario debe activar OAuth una sola vez'}</span></p>
                    <div className="gmail-account-actions">
                      <button disabled={gmailChecking || gmailActionBusy || !gmailStatus.configured} onClick={() => void connectGmail()}>{gmailStatus.connected ? <RefreshCw size={13} /> : <GmailIcon size={14} />}{gmailStatus.connected ? 'Cambiar' : 'Conectar mi cuenta'}</button>
                      {gmailStatus.connected && <button className="gmail-disconnect" disabled={gmailActionBusy} onClick={disconnectGmail} aria-label="Desconectar cuenta de Gmail"><LogOut size={13} /> Desconectar</button>}
                    </div>
                  </div>
                  {gmailStatus.configured
                    ? <div className="gmail-user-note"><ShieldCheck size={15} /><p><b>Conexión individual</b><span>Las cuentas no se comparten: cada persona acepta los permisos de Google en su propio navegador.</span></p></div>
                    : gmailStatus.redirectUri && <div className="gmail-setup-hint"><b>Configuración única del propietario</b><span>Registra esta URI en el cliente OAuth de la aplicación. Después cualquier usuario podrá pulsar “Conectar mi cuenta”.</span><code>{gmailStatus.redirectUri}</code></div>}
                </div>
              ) : selected.kind === 'python' ? (
                <div className="form-stack python-form">
                  <label><span>Nombre de herramienta</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <label><span>Cuándo debe usarla el agente</span><textarea value={selected.role} onChange={(event) => updateSelected({ role: event.target.value })} rows={3} placeholder="Describe para qué sirve esta función…" /><small>{selected.role.length} caracteres</small></label>
                  <label><span>Descripción del objeto de entrada</span><textarea value={selected.pythonInputDescription ?? ''} onChange={(event) => updateSelected({ pythonInputDescription: event.target.value })} rows={3} placeholder='Ejemplo: {"amount": 100, "tax": 0.19}' /><small>{selected.pythonInputDescription?.length ?? 0} caracteres</small></label>
                  <label className="python-code-field"><span>Código Python</span><textarea spellCheck={false} value={selected.pythonCode ?? ''} onChange={(event) => updateSelected({ pythonCode: event.target.value.slice(0, 12_000) })} rows={13} /><small>{selected.pythonCode?.length ?? 0} / 12.000 caracteres</small></label>
                  <div className="python-contract"><Code2 size={15} /><p><b>Contrato de la función</b><span>Define <code>def main(input):</code>. Recibe un objeto JSON y debe devolver un valor serializable como JSON.</span></p></div>
                  <div className="python-sandbox-note"><ShieldCheck size={15} /><p><b>Sandbox WebAssembly</b><span>Sin acceso a la red ni al disco del servidor. Máximo 8 segundos, 20 KB de entrada y 24 KB de salida.</span></p></div>
                  {!connections.some((edge) => edge.target === selected.id && agents.some((entity) => entity.id === edge.source && entity.kind === 'agent')) && <div className="timer-route-warning"><Link2 size={14} /><p><b>Falta conectar un agente</b><span>Une la salida del agente con el puerto izquierdo de Python.</span></p></div>}
                </div>
              ) : (
                <div className="form-stack">
                  <label><span>Nombre de entidad</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                  <label><span>Función en el diálogo</span><input value={selected.role} onChange={(event) => updateSelected({ role: event.target.value })} /></label>
                  <label><span>Tipo de agente</span><select value={selected.agentMode ?? 'standard'} onChange={(event) => updateSelected({ agentMode: event.target.value as AgentMode })}><option value="standard">Agente secuencial</option><option value="orchestrator">Orquestador (solo decide)</option><option value="specialist">Especialista</option></select><ChevronDown size={13} /></label>
                  <div className="agent-routing-panel">
                    <div><span>ENTRADAS</span><b>{connections.filter((edge) => edge.target === selected.id).length}</b><small>disparadores o agentes</small></div>
                    <i />
                    <div><span>SALIDAS</span><b>{connections.filter((edge) => edge.source === selected.id).length}</b><small>agentes o herramientas</small></div>
                  </div>
                  <div className="split-fields">
                    <label><span>Proveedor</span><select value={selected.provider} onChange={(event) => changeProvider(event.target.value as Provider)}>{providers.map((provider) => <option key={provider}>{provider}</option>)}</select><ChevronDown size={13} /></label>
                    <label><span>Modelo</span><select value={selected.model} onChange={(event) => updateSelected({ model: event.target.value })}>{providerModels[selected.provider].map((model) => <option key={model}>{model}</option>)}</select><ChevronDown size={13} /></label>
                  </div>
                  <label><span>Prompt de sistema</span><textarea value={selected.systemPrompt} onChange={(event) => updateSelected({ systemPrompt: event.target.value })} rows={6} /><small>{selected.systemPrompt.length} caracteres</small></label>
                  <button
                    type="button"
                    className={`web-search-enable ${selected.webSearchEnabled ? 'active' : ''}`}
                    onClick={() => updateSelected(selected.webSearchEnabled
                      ? { webSearchEnabled: false }
                      : { webSearchEnabled: true, agentMode: 'specialist', provider: 'Google', model: providerModels.Google[0] })}
                  >
                    <Search size={15} />
                    <span><b>Búsqueda real en internet</b><small>{selected.webSearchEnabled ? 'Activa solo ante consultas actuales o solicitudes de búsqueda.' : 'Convierte este agente en un buscador condicional con Google Search.'}</small></span>
                  </button>
                  {connections.some((edge) => edge.source === selected.id && agents.some((entity) => entity.id === edge.target && (entity.kind === 'python' || entity.kind === 'gmail' && entity.gmailOperation !== 'draft'))) && (
                    <div className="agent-tools-panel">
                      <Wrench size={14} />
                      <p><b>Herramientas disponibles</b><span>{connections.flatMap((edge) => edge.source === selected.id ? agents.filter((entity) => entity.id === edge.target && (entity.kind === 'python' || entity.kind === 'gmail' && entity.gmailOperation !== 'draft')).map((entity) => entity.name) : []).join(', ')}</span><small>El agente decidirá si necesita utilizarlas.</small></p>
                    </div>
                  )}
                  <div className="range-field"><div className="range-label"><label htmlFor="agent-temperature">Temperatura</label><output>{selected.temperature.toFixed(1)}</output></div><input id="agent-temperature" type="range" min="0" max="1" step="0.1" value={selected.temperature} onChange={(event) => updateSelected({ temperature: Number(event.target.value) })} /><div className="range-scale"><span>Preciso</span><span>Creativo</span></div></div>
                  <label><span>Máximo de tokens</span><input type="number" value={selected.maxTokens} onChange={(event) => updateSelected({ maxTokens: Number(event.target.value) })} /></label>
                  <div className="credential-group"><span>Credencial</span><button className={`credential ${credentialStatus[selected.provider] ? 'connected' : ''}`} onClick={() => openCredential(selected.provider)}><KeyRound size={14} /><span>{credentialStatus[selected.provider] ? `${selected.provider} protegida` : `Agregar clave de ${selected.provider}`}</span>{credentialStatus[selected.provider] ? <Check size={13} /> : <Plus size={13} />}</button></div>
                </div>
              )}

              <div className="inspector-footer">
                <button className="duplicate" onClick={duplicateSelected}><Copy size={14} /> Duplicar</button>
                <button className="delete" onClick={deleteSelected}><Trash2 size={14} /> Eliminar</button>
              </div>
              </aside>
            </>
          )}
        </div>
      </section>

      {runOpen && (
        <aside className="run-drawer" aria-label="Ejecución del diálogo">
          <header>
            <div><span>EJECUCIÓN</span><h2>Consola de diálogo</h2></div>
            <button aria-label="Cerrar consola" onClick={() => setRunOpen(false)}><X size={18} /></button>
          </header>

          <div className="run-meta">
            <span className={running ? 'pulse' : ''}><i /> {running ? 'Flujo en curso' : messages.length ? 'Ejecución completada' : 'Listo para ejecutar'}</span>
            <small>{flowAgents.length} agentes alcanzables · ejecución real</small>
          </div>

          <div className="prompt-card">
            <label htmlFor="initial-prompt">{primarySource ? `${primarySource.kind === 'gmail' ? 'GMAIL' : 'ENTRADA'} · ${primarySource.name.toUpperCase()}` : 'INSTRUCCIÓN DE ESTA EJECUCIÓN'}</label>
            <textarea id="initial-prompt" value={primarySource?.inputValue ?? prompt} onChange={(event) => primarySource ? updateNode(primarySource.id, { inputValue: event.target.value }) : setPrompt(event.target.value)} rows={4} placeholder={primarySource?.kind === 'gmail' ? 'Indica qué hacer con los correos encontrados…' : 'Escribe qué debe hacer el agente en esta ejecución manual…'} />
            <div><span>{primarySource?.kind === 'gmail' ? 'Los correos encontrados se añadirán como contexto' : primarySource ? 'La ruta comienza en el nodo conectado' : 'Los agentes reciben el historial completo'}</span><button onClick={() => void startConversation()} disabled={running || !flowAgents.length}><Play size={13} fill="currentColor" /> {messages.length ? 'Ejecutar de nuevo' : 'Iniciar conversación'}</button></div>
          </div>

          {flowUsesGmail && (
            <label className="gmail-run-consent">
              <input type="checkbox" checked={gmailRunApproved} onChange={(event) => { setGmailRunApproved(event.target.checked); setRunError(null); }} />
              <span><b>Permitir Gmail en este flujo</b>Esta preferencia queda guardada. Desmárcala para volver a exigir autorización antes de compartir correos con los proveedores de IA.</span>
            </label>
          )}

          <div className="run-progress"><i style={{ width: `${messages.length ? running ? Math.min(92, (messages.length / Math.max(1, flowAgents.length)) * 100) : 100 : 0}%` }} /></div>

          <div className="transcript">
            {runError && (
              <div className="run-error">
                <span>{runError}</span>
                {flowUsesGmail && !gmailRunApproved ? (
                  <button
                    className="authorize-action"
                    onClick={() => {
                      setGmailRunApproved(true);
                      void startConversation({ gmailApproved: true });
                    }}
                  >
                    <ShieldCheck size={12} /> Autorizar y ejecutar
                  </button>
                ) : flowUsesGmail && gmailStatus.configured && !gmailStatus.connected ? (
                  <button onClick={() => void connectGmail()}><GmailIcon size={12} /> Conectar Gmail</button>
                ) : flowAgents.some((agent) => !credentialStatus[agent.provider]) && (
                  <button onClick={() => openCredential(flowAgents.find((agent) => !credentialStatus[agent.provider])?.provider ?? 'OpenAI')}><KeyRound size={12} /> Revisar claves</button>
                )}
              </div>
            )}
            {runNotices.map((notice, index) => <div className="run-notice" key={`${index}-${notice}`}><GmailIcon size={15} /><span>{notice}</span></div>)}
            {!messages.length && !running && <div className="transcript-empty"><MessageSquareText size={23} /><span>La conversación aparecerá aquí, turno por turno.</span></div>}
            {messages.map((message, index) => {
              const agent = agents.find((item) => item.id === message.agentId);
              if (!agent) return null;
              return (
                <article className="message" key={message.id} style={{ '--agent': agent.color } as CSSProperties}>
                  <div className="message-rail"><span>{index + 1}</span><i /></div>
                  <div className="message-body">
                    <header><div className="message-agent"><Bot size={14} /><b>{agent.name}</b><span>{agent.model}</span></div><small>{message.latency}</small></header>
                    <p>{message.text}</p>
                  </div>
                </article>
              );
            })}
            {running && (
              <div className="thinking"><i /><i /><i /><span>{activeAgentId ? `${agents.find((agent) => agent.id === activeAgentId)?.name ?? 'Agente'} está generando…` : 'Iniciando agentes…'}</span></div>
            )}
          </div>

          {messages.length > 0 && !running && (
            <footer className="run-result"><div><Check size={14} /><span><b>Resultado listo</b> · {messages.length} turnos completados</span></div><button><Send size={13} /> Exportar resultado</button></footer>
          )}
        </aside>
      )}
      {runOpen && <button className="drawer-scrim" aria-label="Cerrar consola de diálogo" onClick={() => setRunOpen(false)} />}

      {scheduledResult && (
        <div className={`scheduled-result-layer ${scheduledResult.closing ? 'closing' : ''}`} role="presentation">
          <section className="scheduled-result-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-result-title" aria-describedby="scheduled-result-description">
            <header>
              <div className="scheduled-result-sigil"><Sparkles size={19} /></div>
              <div>
                <span><i /> RESULTADO AUTOMÁTICO</span>
                <h2 id="scheduled-result-title">Tarea finalizada</h2>
              </div>
              <button aria-label="Cerrar resultado" onClick={() => setScheduledResult(null)}><X size={17} /></button>
            </header>
            <div className="scheduled-result-origin">
              <div><Bot size={15} /><p><b>{scheduledResult.output.entityName}</b><span>Entidad terminal</span></p></div>
              <div>{scheduledResult.sourceKind === 'webhook' ? <WebhookNodeIcon size={15} /> : scheduledResult.sourceKind === 'whatsapp' ? <WhatsAppIcon size={14} /> : <Clock3 size={14} />}<p><b>{scheduledResult.sourceName}</b><span>{dateTimeLabel(scheduledResult.runAt)}</span></p></div>
            </div>
            <div className="scheduled-result-copy" id="scheduled-result-description">
              <span>SALIDA DE LA TAREA</span>
              <MarkdownOutput>{scheduledResult.output.text}</MarkdownOutput>
            </div>
            <footer>
              <div><Check size={14} /><span>Flujo completado correctamente</span></div>
              <small>Se cerrará en 15 segundos</small>
            </footer>
            <div className="scheduled-result-timer"><i /></div>
          </section>
        </div>
      )}

      <Dialog open={credentialOpen} onOpenChange={(open) => setCredentialOpen(open)}>
        <DialogContent className="credential-dialog" showCloseButton={false}>
          <form onSubmit={(event) => { event.preventDefault(); void saveCredential(); }}>
            <DialogHeader className="credential-dialog-header">
              <div className="credential-dialog-icon"><KeyRound size={18} /></div>
              <div>
                <DialogTitle>Conectar proveedor</DialogTitle>
                <DialogDescription>La clave se usa para ejecutar los agentes de este canvas.</DialogDescription>
              </div>
              <button type="button" className="credential-dialog-close" aria-label="Cerrar" disabled={credentialBusy} onClick={() => setCredentialOpen(false)}><X size={16} /></button>
            </DialogHeader>

            <div className="provider-tabs" role="tablist" aria-label="Proveedores de modelos">
              {providers.map((provider) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={credentialProvider === provider}
                  className={credentialProvider === provider ? 'active' : ''}
                  disabled={credentialBusy}
                  key={provider}
                  onClick={() => chooseCredentialProvider(provider)}
                >
                  <span>{provider.slice(0, 1)}</span>{provider}{credentialStatus[provider] && <i />}
                </button>
              ))}
            </div>

            <div className="credential-field">
              <label htmlFor="provider-key">API key de {credentialProvider}</label>
              <div>
                <KeyRound size={14} />
                <input
                  id="provider-key"
                  type={showCredential ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={credentialDraft}
                  onChange={(event) => { setCredentialDraft(event.target.value); setCredentialFormError(''); }}
                  placeholder={credentialStatus[credentialProvider] ? 'Pega una nueva clave para reemplazarla' : 'Pega aquí tu clave privada'}
                  disabled={credentialBusy}
                />
                <button type="button" aria-label={showCredential ? 'Ocultar clave' : 'Mostrar clave'} disabled={credentialBusy} onClick={() => setShowCredential((value) => !value)}>{showCredential ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              {credentialFormError && <small>{credentialFormError}</small>}
            </div>

            <div className="credential-security"><ShieldCheck size={16} /><p><b>Bóveda privada cifrada</b><span>Se guarda para tu cuenta en el servidor. Synapse nunca vuelve a mostrar ni enviar la clave al navegador.</span></p></div>

            <DialogFooter className="credential-dialog-footer">
              {credentialStatus[credentialProvider] && <button type="button" className="remove-key" disabled={credentialBusy} onClick={() => void removeCredential()}>Eliminar del servidor</button>}
              <button type="button" className="cancel-key" disabled={credentialBusy} onClick={() => setCredentialOpen(false)}>Cancelar</button>
              <button type="submit" className="save-key" disabled={credentialBusy}>{credentialBusy ? 'Guardando…' : credentialStatus[credentialProvider] ? 'Reemplazar clave' : 'Guardar clave'}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
