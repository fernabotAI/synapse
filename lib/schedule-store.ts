import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type TimerConfig = { id: string; enabled: boolean; intervalMinutes: number };
export type TimerRunStatus = 'idle' | 'running' | 'success' | 'no_changes' | 'error';
export type TimerTraceStep =
  | { type: 'node'; nodeId: string }
  | { type: 'edge'; source: string; target: string };
export type TimerOutput = { entityId: string; entityName: string; text: string };

export type TimerState = TimerConfig & {
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TimerRunStatus;
  lastMessage: string;
  seenGmailMessageIds: string[];
  lastTrace: TimerTraceStep[];
  lastOutput: TimerOutput | null;
};

type ScheduleRecord = {
  version: 1;
  subject: string;
  updatedAt: string;
  timers: TimerState[];
};

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 10_080;

function storageDirectory() {
  return process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data';
}

function schedulesDirectory() {
  return path.join(storageDirectory(), 'schedules');
}

function userStorageKey(subject: string) {
  return createHash('sha256').update(subject).digest('hex');
}

function schedulePath(subject: string) {
  return path.join(schedulesDirectory(), `${userStorageKey(subject)}.json`);
}

function boundedInterval(value: number) {
  if (!Number.isFinite(value)) return MIN_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(value)));
}

function validTimer(value: unknown): value is TimerState {
  if (!value || typeof value !== 'object') return false;
  const timer = value as Partial<TimerState>;
  return typeof timer.id === 'string'
    && typeof timer.enabled === 'boolean'
    && typeof timer.intervalMinutes === 'number'
    && (timer.nextRunAt === null || typeof timer.nextRunAt === 'string')
    && (timer.lastRunAt === null || typeof timer.lastRunAt === 'string')
    && (timer.lastStatus === 'idle' || timer.lastStatus === 'running' || timer.lastStatus === 'success' || timer.lastStatus === 'no_changes' || timer.lastStatus === 'error')
    && typeof timer.lastMessage === 'string'
    && Array.isArray(timer.seenGmailMessageIds)
    && (timer.lastTrace === undefined || Array.isArray(timer.lastTrace))
    && (timer.lastOutput === undefined || timer.lastOutput === null || typeof timer.lastOutput === 'object');
}

function validTraceStep(value: unknown): value is TimerTraceStep {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<TimerTraceStep> & { source?: unknown; target?: unknown; nodeId?: unknown };
  return step.type === 'node'
    ? typeof step.nodeId === 'string'
    : step.type === 'edge' && typeof step.source === 'string' && typeof step.target === 'string';
}

function validOutput(value: unknown): value is TimerOutput {
  if (!value || typeof value !== 'object') return false;
  const output = value as Partial<TimerOutput>;
  return typeof output.entityId === 'string'
    && typeof output.entityName === 'string'
    && typeof output.text === 'string';
}

function parseRecord(value: unknown): ScheduleRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ScheduleRecord>;
  if (record.version !== 1 || typeof record.subject !== 'string' || typeof record.updatedAt !== 'string' || !Array.isArray(record.timers)) return null;
  const timers = record.timers.filter(validTimer).map((timer) => ({
    ...timer,
    lastTrace: (timer.lastTrace ?? []).filter(validTraceStep).slice(0, 80),
    lastOutput: validOutput(timer.lastOutput) ? {
      entityId: timer.lastOutput.entityId.slice(0, 100),
      entityName: timer.lastOutput.entityName.slice(0, 100),
      text: timer.lastOutput.text.slice(0, 24_000),
    } : null,
  }));
  return { ...record, timers } as ScheduleRecord;
}

async function writeRecord(record: ScheduleRecord) {
  const directory = schedulesDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = schedulePath(record.subject);
  const temporary = path.join(directory, `.${userStorageKey(record.subject)}.${randomUUID()}.tmp`);
  const nextRecord = { ...record, updatedAt: new Date().toISOString() };
  await writeFile(temporary, JSON.stringify(nextRecord), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
  return nextRecord;
}

export async function readSchedule(subject: string): Promise<ScheduleRecord | null> {
  try {
    return parseRecord(JSON.parse(await readFile(schedulePath(subject), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function syncTimerConfigs(subject: string, configs: TimerConfig[]) {
  const current = await readSchedule(subject);
  const now = Date.now();
  const unique = new Map(configs.slice(0, 50).filter((timer) => typeof timer.id === 'string' && timer.id.length <= 100).map((timer) => [timer.id, timer]));
  const timers = [...unique.values()].map((config) => {
    const intervalMinutes = boundedInterval(config.intervalMinutes);
    const previous = current?.timers.find((timer) => timer.id === config.id);
    const needsNewDeadline = config.enabled && (!previous?.enabled || previous.intervalMinutes !== intervalMinutes || !previous.nextRunAt);
    return {
      id: config.id,
      enabled: config.enabled,
      intervalMinutes,
      nextRunAt: config.enabled ? needsNewDeadline ? new Date(now + intervalMinutes * 60_000).toISOString() : previous!.nextRunAt : null,
      lastRunAt: previous?.lastRunAt ?? null,
      lastStatus: previous?.lastStatus ?? 'idle',
      lastMessage: previous?.lastMessage ?? '',
      seenGmailMessageIds: (previous?.seenGmailMessageIds ?? []).filter((id) => typeof id === 'string').slice(-300),
      lastTrace: (previous?.lastTrace ?? []).filter(validTraceStep).slice(0, 80),
      lastOutput: validOutput(previous?.lastOutput) ? previous.lastOutput : null,
    } satisfies TimerState;
  });
  return writeRecord({ version: 1, subject, updatedAt: new Date().toISOString(), timers });
}

export async function updateTimerState(subject: string, timerId: string, patch: Partial<Omit<TimerState, 'id'>>) {
  const record = await readSchedule(subject);
  if (!record) return null;
  const timers = record.timers.map((timer) => timer.id === timerId ? {
    ...timer,
    ...patch,
    intervalMinutes: boundedInterval(patch.intervalMinutes ?? timer.intervalMinutes),
    seenGmailMessageIds: (patch.seenGmailMessageIds ?? timer.seenGmailMessageIds).slice(-300),
    lastTrace: (patch.lastTrace ?? timer.lastTrace).filter(validTraceStep).slice(0, 80),
    lastOutput: patch.lastOutput === null
      ? null
      : validOutput(patch.lastOutput ?? timer.lastOutput)
        ? {
          ...(patch.lastOutput ?? timer.lastOutput)!,
          entityId: (patch.lastOutput ?? timer.lastOutput)!.entityId.slice(0, 100),
          entityName: (patch.lastOutput ?? timer.lastOutput)!.entityName.slice(0, 100),
          text: (patch.lastOutput ?? timer.lastOutput)!.text.slice(0, 24_000),
        }
        : null,
  } : timer);
  return writeRecord({ ...record, timers });
}

export async function listScheduleRecords() {
  let files: string[];
  try {
    files = await readdir(schedulesDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(files.filter((file) => file.endsWith('.json')).slice(0, 1_000).map(async (file) => {
    try {
      return parseRecord(JSON.parse(await readFile(path.join(schedulesDirectory(), file), 'utf8')));
    } catch {
      return null;
    }
  }));
  return records.filter((record): record is ScheduleRecord => Boolean(record));
}

export function publicTimerStates(record: ScheduleRecord | null) {
  return (record?.timers ?? []).map(({ seenGmailMessageIds: _seen, ...timer }) => timer);
}

export function timerConfigsFromSnapshot(value: unknown): TimerConfig[] {
  if (!value || typeof value !== 'object') return [];
  const agents = (value as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return [];
  return agents.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const agent = item as Record<string, unknown>;
    if (agent.kind !== 'timer' || typeof agent.id !== 'string') return [];
    return [{
      id: agent.id,
      enabled: agent.timerEnabled === true,
      intervalMinutes: boundedInterval(typeof agent.timerIntervalMinutes === 'number' ? agent.timerIntervalMinutes : 5),
    }];
  });
}

export const scheduleLimits = { minimumMinutes: MIN_INTERVAL_MINUTES, maximumMinutes: MAX_INTERVAL_MINUTES };
