import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ConversationMemoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type ConversationMemoryRecord = {
  version: 1;
  updatedAt: string;
  messages: ConversationMemoryMessage[];
};

type SealedMemory = { version: 1; sealed: string };
type MemoryIdentity = {
  subject: string;
  channelId: string;
  participantId: string;
};

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 4_000;
const locks = new Map<string, Promise<void>>();

function storageDirectory() {
  return path.join(
    process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data',
    'conversation-memory',
  );
}

function encryptionKey() {
  const secret = process.env.SYNAPSE_CREDENTIAL_SECRET?.trim() ?? '';
  if (secret.length < 32)
    throw new Error('La memoria segura de conversaciones no está configurada.');
  return createHash('sha256').update(secret).digest();
}

function memoryKey(identity: MemoryIdentity) {
  return createHash('sha256')
    .update(
      `${identity.subject}\0${identity.channelId}\0${identity.participantId}`,
    )
    .digest('hex');
}

function memoryPath(key: string) {
  return path.join(storageDirectory(), `${key}.json`);
}

function seal(record: ConversationMemoryRecord, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(key));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(record), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function unseal(value: string, key: string) {
  const [version, encodedIv, encodedTag, encodedPayload] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedPayload)
    throw new Error('La memoria de conversación no es válida.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(key));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encodedPayload, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as ConversationMemoryRecord;
}

function boundedMaxMessages(value: number) {
  return Math.min(
    MAX_MESSAGES,
    Math.max(2, Number.isFinite(value) ? Math.round(value) : 20),
  );
}

function boundedRetentionHours(value: number) {
  return Math.min(
    24 * 90,
    Math.max(1, Number.isFinite(value) ? Math.round(value) : 24 * 7),
  );
}

async function readRecord(key: string) {
  try {
    const stored = JSON.parse(
      await readFile(memoryPath(key), 'utf8'),
    ) as SealedMemory;
    if (stored.version !== 1 || typeof stored.sealed !== 'string') return null;
    const record = unseal(stored.sealed, key);
    return record.version === 1 && Array.isArray(record.messages)
      ? record
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeRecord(key: string, record: ConversationMemoryRecord) {
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${key}.${randomUUID()}.tmp`);
  await writeFile(
    temporary,
    JSON.stringify({
      version: 1,
      sealed: seal(record, key),
    } satisfies SealedMemory),
    { mode: 0o600 },
  );
  await rename(temporary, memoryPath(key));
}

async function withMemoryLock<T>(key: string, operation: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

export async function readConversationMemory(
  identity: MemoryIdentity,
  maxMessages = 20,
  retentionHours = 24 * 7,
) {
  const key = memoryKey(identity);
  return withMemoryLock(key, async () => {
    const record = await readRecord(key);
    if (!record) return [];
    const cutoff =
      Date.now() - boundedRetentionHours(retentionHours) * 60 * 60_000;
    const messages = record.messages
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          Date.parse(message.createdAt) >= cutoff,
      )
      .slice(-boundedMaxMessages(maxMessages));
    if (!messages.length) await unlink(memoryPath(key)).catch(() => undefined);
    return messages;
  });
}

export async function appendConversationMemory(
  identity: MemoryIdentity,
  exchange: { user: string; assistant: string },
  maxMessages = 20,
  retentionHours = 24 * 7,
) {
  const key = memoryKey(identity);
  await withMemoryLock(key, async () => {
    const record = await readRecord(key);
    const cutoff =
      Date.now() - boundedRetentionHours(retentionHours) * 60 * 60_000;
    const now = new Date().toISOString();
    const messages = (record?.messages ?? [])
      .filter((message) => Date.parse(message.createdAt) >= cutoff)
      .concat(
        {
          role: 'user',
          content: exchange.user.slice(0, MAX_MESSAGE_CHARS),
          createdAt: now,
        },
        {
          role: 'assistant',
          content: exchange.assistant.slice(0, MAX_MESSAGE_CHARS),
          createdAt: now,
        },
      )
      .slice(-boundedMaxMessages(maxMessages));
    await writeRecord(key, { version: 1, updatedAt: now, messages });
  });
}

export async function clearConversationMemory(identity: MemoryIdentity) {
  const key = memoryKey(identity);
  await withMemoryLock(key, async () => {
    await unlink(memoryPath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  });
}

export function isConversationResetRequest(text: string) {
  const normalized = text
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /^(olvida|borra|elimina|reinicia|limpia)\b.*\b(conversacion|contexto|memoria|historial|anterior)\b/.test(
      normalized,
    ) || /^(empecemos|comencemos) de (cero|nuevo)$/.test(normalized)
  );
}
