import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GmailSession } from '@/lib/gmail';

type GmailRecord = { version: 1; updatedAt: string; sealed: string };

function storageDirectory() {
  return process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data';
}

function userStorageKey(subject: string) {
  return createHash('sha256').update(subject).digest('hex');
}

function recordPath(subject: string) {
  return path.join(storageDirectory(), 'gmail', `${userStorageKey(subject)}.json`);
}

function encryptionKey() {
  const secret = process.env.SYNAPSE_CREDENTIAL_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('El almacenamiento seguro de Gmail no está configurado.');
  return createHash('sha256').update(`synapse:gmail:${secret}`).digest();
}

function seal(session: GmailSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function unseal(value: string): GmailSession {
  const [version, encodedIv, encodedTag, encodedPayload] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedPayload) throw new Error('La conexión guardada de Gmail está dañada.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encodedPayload, 'base64url')), decipher.final()]);
  const session = JSON.parse(decrypted.toString('utf8')) as Partial<GmailSession>;
  if (typeof session.accessToken !== 'string'
    || typeof session.refreshToken !== 'string'
    || typeof session.expiresAt !== 'number'
    || typeof session.email !== 'string'
    || typeof session.scope !== 'string') throw new Error('La conexión guardada de Gmail está dañada.');
  return session as GmailSession;
}

export async function readStoredGmailSession(subject: string): Promise<GmailSession | null> {
  try {
    const record = JSON.parse(await readFile(recordPath(subject), 'utf8')) as GmailRecord;
    if (record.version !== 1 || typeof record.sealed !== 'string') throw new Error('La conexión guardada de Gmail está dañada.');
    return unseal(record.sealed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeStoredGmailSession(subject: string, session: GmailSession) {
  const destination = recordPath(subject);
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const record: GmailRecord = { version: 1, updatedAt: new Date().toISOString(), sealed: seal(session) };
  const temporary = path.join(directory, `.${userStorageKey(subject)}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

export async function deleteStoredGmailSession(subject: string) {
  try {
    await unlink(recordPath(subject));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
