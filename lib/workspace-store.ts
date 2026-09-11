import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_WORKSPACE_BYTES = 750_000;

type WorkspaceRecord = {
  subject?: string;
  updatedAt: string;
  snapshot: unknown;
};

function storageDirectory() {
  return process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data';
}

function userStorageKey(subject: string) {
  return createHash('sha256').update(subject).digest('hex');
}

function workspacePath(subject: string) {
  return path.join(storageDirectory(), 'workspaces', `${userStorageKey(subject)}.json`);
}

export async function readWorkspace(subject: string): Promise<WorkspaceRecord | null> {
  try {
    const stored = JSON.parse(await readFile(workspacePath(subject), 'utf8')) as WorkspaceRecord;
    if (!stored || typeof stored !== 'object' || typeof stored.updatedAt !== 'string' || !('snapshot' in stored)) return null;
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeWorkspace(subject: string, snapshot: unknown) {
  const record: WorkspaceRecord = {
    subject,
    updatedAt: new Date().toISOString(),
    snapshot,
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKSPACE_BYTES) {
    throw new Error('El workspace supera el tamaño máximo permitido.');
  }

  const directory = path.dirname(workspacePath(subject));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${userStorageKey(subject)}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, workspacePath(subject));
  return record;
}

export async function findWorkspaceByWebhook(webhookId: string) {
  const directory = path.join(storageDirectory(), 'workspaces');
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  for (const file of files.filter((name) => name.endsWith('.json')).slice(0, 1_000)) {
    try {
      const record = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as WorkspaceRecord;
      if (!record?.subject || !record.snapshot || typeof record.snapshot !== 'object') continue;
      const agents = (record.snapshot as { agents?: unknown }).agents;
      if (!Array.isArray(agents)) continue;
      const webhook = agents.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).kind === 'webhook' && (item as Record<string, unknown>).webhookId === webhookId);
      if (webhook) return { subject: record.subject, snapshot: record.snapshot, webhook };
    } catch {
      // Ignore incomplete or legacy records while locating a public webhook.
    }
  }
  return null;
}

export async function findWorkspaceByWhatsApp(webhookId: string) {
  const directory = path.join(storageDirectory(), 'workspaces');
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  for (const file of files.filter((name) => name.endsWith('.json')).slice(0, 1_000)) {
    try {
      const record = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as WorkspaceRecord;
      if (!record?.subject || !record.snapshot || typeof record.snapshot !== 'object') continue;
      const agents = (record.snapshot as { agents?: unknown }).agents;
      if (!Array.isArray(agents)) continue;
      const whatsapp = agents.find((item) => item && typeof item === 'object'
        && (item as Record<string, unknown>).kind === 'whatsapp'
        && (item as Record<string, unknown>).whatsappWebhookId === webhookId);
      if (whatsapp) return { subject: record.subject, snapshot: record.snapshot, whatsapp };
    } catch {
      // Ignore incomplete or legacy records while locating a WhatsApp channel.
    }
  }
  return null;
}

export function validWorkspaceSnapshot(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  if ((snapshot.version !== 1 && snapshot.version !== 2)
    || !Array.isArray(snapshot.agents)
    || !Array.isArray(snapshot.connections)
    || snapshot.agents.length > 200
    || snapshot.connections.length > 1_000) return false;
  return JSON.stringify(snapshot).length <= MAX_WORKSPACE_BYTES;
}
