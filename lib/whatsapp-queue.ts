import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type WhatsAppJobInput = {
  subject: string;
  webhookId: string;
  messageId: string;
  from: string;
  text: string;
  messageType?: 'text' | 'audio';
  mediaId?: string;
  phoneNumberId: string;
};

export type WhatsAppJob = {
  version: 1;
  id: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  attempts: number;
  lastError: string;
  input: WhatsAppJobInput;
};

type SealedJob = { version: 1; sealed: string };
const STALE_PROCESSING_MS = 5 * 60_000;
const RETENTION_MS = 24 * 60 * 60_000;

function storageDirectory() {
  return path.join(process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data', 'whatsapp-jobs');
}

function encryptionKey() {
  const secret = process.env.SYNAPSE_CREDENTIAL_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('La cola segura de WhatsApp no está configurada.');
  return createHash('sha256').update(secret).digest();
}

function jobId(messageId: string) {
  return createHash('sha256').update(messageId).digest('hex');
}

function jobPath(id: string) {
  return path.join(storageDirectory(), `${id}.json`);
}

function seal(job: WhatsAppJob) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(job), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function unseal(value: string): WhatsAppJob {
  const [version, encodedIv, encodedTag, encodedPayload] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedPayload) throw new Error('Trabajo de WhatsApp inválido.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encodedPayload, 'base64url')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as WhatsAppJob;
}

async function readJob(file: string) {
  const record = JSON.parse(await readFile(file, 'utf8')) as SealedJob;
  if (record.version !== 1 || typeof record.sealed !== 'string') throw new Error('Trabajo de WhatsApp inválido.');
  return unseal(record.sealed);
}

async function writeJob(job: WhatsAppJob) {
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = jobPath(job.id);
  const temporary = path.join(directory, `.${job.id}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ version: 1, sealed: seal(job) } satisfies SealedJob), { mode: 0o600 });
  await rename(temporary, destination);
}

export async function enqueueWhatsAppJob(input: WhatsAppJobInput) {
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = jobId(input.messageId);
  const now = new Date().toISOString();
  const job: WhatsAppJob = {
    version: 1,
    id,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    attempts: 0,
    lastError: '',
    input,
  };
  try {
    const handle = await open(jobPath(id), 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, sealed: seal(job) } satisfies SealedJob));
    } finally {
      await handle.close();
    }
    return { queued: true, id };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { queued: false, id };
    throw error;
  }
}

export async function listReadyWhatsAppJobs(now = new Date(), limit = 10) {
  const directory = storageDirectory();
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ready: WhatsAppJob[] = [];
  for (const name of files.filter((item) => item.endsWith('.json')).slice(0, 1_000)) {
    try {
      const file = path.join(directory, name);
      const job = await readJob(file);
      const updated = Date.parse(job.updatedAt);
      if ((job.status === 'success' || job.status === 'failed') && now.getTime() - updated > RETENTION_MS) {
        await unlink(file);
        continue;
      }
      const processingIsStale = job.status === 'processing' && now.getTime() - updated > STALE_PROCESSING_MS;
      if ((job.status === 'pending' && Date.parse(job.nextAttemptAt) <= now.getTime()) || processingIsStale) ready.push(job);
    } catch (error) {
      console.error('No se pudo leer un trabajo de WhatsApp:', error instanceof Error ? error.message : 'error desconocido');
    }
  }
  return ready.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(0, limit);
}

export async function claimWhatsAppJob(id: string) {
  const job = await readJob(jobPath(id));
  const now = new Date().toISOString();
  job.status = 'processing';
  job.updatedAt = now;
  job.attempts += 1;
  await writeJob(job);
  return job;
}

export async function completeWhatsAppJob(job: WhatsAppJob) {
  job.status = 'success';
  job.updatedAt = new Date().toISOString();
  job.lastError = '';
  await writeJob(job);
}

export async function failWhatsAppJob(job: WhatsAppJob, error: string) {
  const delayMs = [10_000, 30_000, 2 * 60_000, 10 * 60_000][Math.min(job.attempts - 1, 3)];
  job.status = job.attempts >= 5 ? 'failed' : 'pending';
  job.updatedAt = new Date().toISOString();
  job.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  job.lastError = error.slice(0, 500);
  await writeJob(job);
}
