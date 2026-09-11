import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const credentialProviders = ['OpenAI', 'Anthropic', 'Google', 'WhatsApp'] as const;
export type CredentialProvider = typeof credentialProviders[number];
export type StoredCredentials = Partial<Record<CredentialProvider, string>>;
export type WhatsAppCredentials = { accessToken: string; appSecret: string };

type CredentialRecord = {
  version: 1;
  updatedAt: string;
  sealed: string;
};

const MAX_KEY_LENGTH = 4_096;

function storageDirectory() {
  return process.env.SYNAPSE_DATA_DIR?.trim() || '/home/deploy/synapse/shared/data';
}

function encryptionSecret() {
  const secret = process.env.SYNAPSE_CREDENTIAL_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('La bóveda de credenciales no está configurada.');
  return createHash('sha256').update(secret).digest();
}

function userStorageKey(subject: string) {
  return createHash('sha256').update(subject).digest('hex');
}

function credentialPath(subject: string) {
  return path.join(storageDirectory(), 'credentials', `${userStorageKey(subject)}.json`);
}

function seal(credentials: StoredCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionSecret(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ version: 1, credentials }), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function unseal(value: string): StoredCredentials {
  const [version, encodedIv, encodedTag, encodedPayload] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedPayload) throw new Error('La bóveda está dañada.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionSecret(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encodedPayload, 'base64url')),
    decipher.final(),
  ]);
  const payload = JSON.parse(decrypted.toString('utf8')) as { version?: unknown; credentials?: unknown };
  if (payload.version !== 1 || !payload.credentials || typeof payload.credentials !== 'object') throw new Error('La bóveda está dañada.');

  const credentials: StoredCredentials = {};
  for (const provider of credentialProviders) {
    const key = (payload.credentials as Record<string, unknown>)[provider];
    if (typeof key === 'string' && key.length >= 12 && key.length <= MAX_KEY_LENGTH) credentials[provider] = key;
  }
  return credentials;
}

async function writeCredentials(subject: string, credentials: StoredCredentials) {
  const destination = credentialPath(subject);
  const directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const record: CredentialRecord = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sealed: seal(credentials),
  };
  const temporaryPath = path.join(directory, `.${userStorageKey(subject)}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, destination);
  return record.updatedAt;
}

export function isCredentialProvider(value: unknown): value is CredentialProvider {
  return typeof value === 'string' && credentialProviders.includes(value as CredentialProvider);
}

export async function readCredentials(subject: string): Promise<StoredCredentials> {
  try {
    const record = JSON.parse(await readFile(credentialPath(subject), 'utf8')) as CredentialRecord;
    if (record.version !== 1 || typeof record.sealed !== 'string') throw new Error('La bóveda está dañada.');
    return unseal(record.sealed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function storeCredential(subject: string, provider: CredentialProvider, key: string) {
  const normalizedKey = key.trim();
  if (normalizedKey.length < 12 || normalizedKey.length > MAX_KEY_LENGTH || normalizedKey.includes('\0')) {
    throw new Error('La clave no tiene un formato válido.');
  }
  const credentials = await readCredentials(subject);
  credentials[provider] = normalizedKey;
  await writeCredentials(subject, credentials);
  return credentialProviders.filter((item) => Boolean(credentials[item]));
}

export async function deleteCredential(subject: string, provider: CredentialProvider) {
  const credentials = await readCredentials(subject);
  delete credentials[provider];
  await writeCredentials(subject, credentials);
  return credentialProviders.filter((item) => Boolean(credentials[item]));
}

export async function credentialStatus(subject: string) {
  const credentials = await readCredentials(subject);
  return credentialProviders.filter((provider) => Boolean(credentials[provider]));
}

export async function readWhatsAppCredentials(subject: string): Promise<WhatsAppCredentials | null> {
  const sealed = (await readCredentials(subject)).WhatsApp;
  if (!sealed) return null;
  try {
    const parsed = JSON.parse(sealed) as Partial<WhatsAppCredentials>;
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length < 20
      || typeof parsed.appSecret !== 'string' || parsed.appSecret.length < 16) return null;
    return { accessToken: parsed.accessToken, appSecret: parsed.appSecret };
  } catch {
    return null;
  }
}

export async function storeWhatsAppCredentials(subject: string, credentials: WhatsAppCredentials) {
  const accessToken = credentials.accessToken.trim();
  const appSecret = credentials.appSecret.trim();
  if (accessToken.length < 20 || accessToken.length > 3_500 || appSecret.length < 16 || appSecret.length > 500) {
    throw new Error('Las credenciales de WhatsApp no tienen un formato válido.');
  }
  return storeCredential(subject, 'WhatsApp', JSON.stringify({ accessToken, appSecret }));
}
