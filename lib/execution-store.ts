import { randomUUID } from 'node:crypto';
import type { TimerOutput, TimerTraceStep } from '@/lib/schedule-store';

export type LiveExecution = {
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

const STORE_KEY = Symbol.for('synapse.live-executions');
type GlobalWithExecutions = typeof globalThis & { [STORE_KEY]?: Map<string, LiveExecution> };

function store() {
  const scope = globalThis as GlobalWithExecutions;
  scope[STORE_KEY] ??= new Map<string, LiveExecution>();
  return scope[STORE_KEY];
}

export function startWebhookExecution(subject: string, sourceId: string, sourceName: string, sourceKind: LiveExecution['sourceKind'] = 'webhook') {
  const execution: LiveExecution = {
    runId: randomUUID(),
    sourceId,
    sourceName: sourceName.slice(0, 100) || 'Webhook',
    sourceKind,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    trace: [{ type: 'node', nodeId: sourceId }],
    output: null,
    error: null,
    revision: 1,
  };
  store().set(subject, execution);
  return execution;
}

export function updateLiveExecution(subject: string, runId: string, patch: Partial<Omit<LiveExecution, 'runId' | 'revision'>>) {
  const current = store().get(subject);
  if (!current || current.runId !== runId) return null;
  const next: LiveExecution = {
    ...current,
    ...patch,
    trace: (patch.trace ?? current.trace).slice(0, 80),
    revision: current.revision + 1,
  };
  store().set(subject, next);
  return next;
}

export function latestLiveExecution(subject: string) {
  const execution = store().get(subject) ?? null;
  if (!execution) return null;
  if (Date.now() - Date.parse(execution.startedAt) > 10 * 60_000) {
    store().delete(subject);
    return null;
  }
  return execution;
}
