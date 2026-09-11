import { publicRequestOrigin, requestBasePath } from '@/lib/app-path';

const GMAIL_SESSION_COOKIE = 'synapse_gmail_session';
const GMAIL_STATE_COOKIE = 'synapse_gmail_state';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type GmailSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  scope: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function runtimeValue(name: string) {
  const processValue = typeof process !== 'undefined' ? process.env[name] : undefined;
  return processValue?.trim() ?? '';
}

export function gmailConfig(request?: Request) {
  const clientId = runtimeValue('GOOGLE_GMAIL_CLIENT_ID');
  const clientSecret = runtimeValue('GOOGLE_GMAIL_CLIENT_SECRET');
  const tokenSecret = runtimeValue('GMAIL_TOKEN_SECRET');
  const requestOrigin = request ? publicRequestOrigin(request) : '';
  const requestPath = request ? requestBasePath(request) : '';
  const redirectUri = runtimeValue('GOOGLE_GMAIL_REDIRECT_URI') || `${requestOrigin}${requestPath}/api/gmail/callback`;
  return {
    clientId,
    clientSecret,
    tokenSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && tokenSecret && requestOrigin),
  };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(value: unknown, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function unseal<T>(value: string, secret: string): Promise<T | null> {
  try {
    const [encodedIv, encodedPayload] = value.split('.');
    if (!encodedIv || !encodedPayload) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(encodedIv) },
      await encryptionKey(secret),
      fromBase64Url(encodedPayload),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string) {
  const cookie = request.headers.get('cookie') ?? '';
  for (const item of cookie.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

export function cookieHeader(name: string, value: string, request: Request, maxAge: number) {
  const secure = new URL(publicRequestOrigin(request)).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookieHeader(name: string, request: Request) {
  return cookieHeader(name, '', request, 0);
}

export function randomState() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function readGmailSession(request: Request) {
  const config = gmailConfig(request);
  if (!config.configured) return null;
  const cookie = readCookie(request, GMAIL_SESSION_COOKIE);
  if (!cookie) return null;
  return unseal<GmailSession>(cookie, config.tokenSecret);
}

export async function sessionCookie(session: GmailSession, request: Request) {
  const config = gmailConfig(request);
  const value = await seal(session, config.tokenSecret);
  return cookieHeader(GMAIL_SESSION_COOKIE, value, request, 60 * 60 * 24 * 30);
}

export function stateCookie(value: string, request: Request) {
  return cookieHeader(GMAIL_STATE_COOKIE, value, request, 60 * 10);
}

export function clearStateCookie(request: Request) {
  return clearCookieHeader(GMAIL_STATE_COOKIE, request);
}

export function clearSessionCookie(request: Request) {
  return clearCookieHeader(GMAIL_SESSION_COOKIE, request);
}

export function getStateCookie(request: Request) {
  return readCookie(request, GMAIL_STATE_COOKIE);
}

export async function exchangeAuthorizationCode(code: string, request: Request) {
  const config = gmailConfig(request);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.error_description || payload.error || 'Google no entregó las credenciales OAuth esperadas.');
  }
  return payload;
}

export async function freshGmailSession(session: GmailSession, request: Request) {
  const refreshed = await refreshGmailSession(session);
  return {
    session: refreshed.session,
    cookie: refreshed.refreshed ? await sessionCookie(refreshed.session, request) : null as string | null,
  };
}

export async function refreshGmailSession(session: GmailSession) {
  if (session.expiresAt > Date.now() + 60_000) return { session, refreshed: false };
  const config = gmailConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error('La sesión de Gmail venció o fue revocada. Vuelve a conectar la cuenta.');
  }
  const nextSession: GmailSession = {
    ...session,
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope ?? session.scope,
  };
  return { session: nextSession, refreshed: true };
}

export async function gmailFetchWithSession(session: GmailSession, path: string, init?: RequestInit) {
  const refreshed = await refreshGmailSession(session);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${refreshed.session.accessToken}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message || `Gmail respondió con error ${response.status}.`);
  }
  return { response, session: refreshed.session, refreshed: refreshed.refreshed };
}

export async function gmailFetch(request: Request, path: string, init?: RequestInit) {
  const stored = await readGmailSession(request);
  if (!stored) throw new Error('Conecta una cuenta de Gmail antes de ejecutar este nodo.');
  const result = await gmailFetchWithSession(stored, path, init);
  return { response: result.response, cookie: result.refreshed ? await sessionCookie(result.session, request) : null };
}

export const gmailCookies = {
  session: GMAIL_SESSION_COOKIE,
  state: GMAIL_STATE_COOKIE,
};
