import { publicRequestOrigin } from '@/lib/app-path';
import {
  clearCookieHeader,
  cookieHeader,
  readCookie,
  seal,
  unseal,
} from '@/lib/gmail';

const AUTH_SESSION_COOKIE = 'synapse_auth_session';
const AUTH_STATE_COOKIE = 'synapse_auth_state';

export type AuthSession = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: number;
};

export type AuthState = {
  state: string;
  createdAt: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function runtimeValue(name: string) {
  const processValue = typeof process !== 'undefined' ? process.env[name] : undefined;
  return processValue?.trim() ?? '';
}

export function authConfig(request: Request) {
  const clientId = runtimeValue('GOOGLE_GMAIL_CLIENT_ID');
  const clientSecret = runtimeValue('GOOGLE_GMAIL_CLIENT_SECRET');
  const sessionSecret = runtimeValue('SYNAPSE_SESSION_SECRET') || runtimeValue('GMAIL_TOKEN_SECRET');
  const redirectUri = runtimeValue('GOOGLE_GMAIL_REDIRECT_URI');
  return {
    clientId,
    clientSecret,
    sessionSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && sessionSecret && redirectUri && publicRequestOrigin(request)),
  };
}

export async function readAuthSession(request: Request) {
  const config = authConfig(request);
  if (!config.configured) return null;
  const cookie = readCookie(request, AUTH_SESSION_COOKIE);
  if (!cookie) return null;
  const session = await unseal<AuthSession>(cookie, config.sessionSecret);
  if (!session
    || typeof session.sub !== 'string'
    || typeof session.email !== 'string'
    || typeof session.name !== 'string'
    || typeof session.createdAt !== 'number'
    || Date.now() - session.createdAt > 14 * 24 * 60 * 60 * 1_000) return null;
  return session;
}

export async function authSessionCookie(session: AuthSession, request: Request) {
  const config = authConfig(request);
  const value = await seal(session, config.sessionSecret);
  return cookieHeader(AUTH_SESSION_COOKIE, value, request, 60 * 60 * 24 * 14);
}

export async function authStateCookie(state: AuthState, request: Request) {
  const config = authConfig(request);
  const value = await seal(state, config.sessionSecret);
  return cookieHeader(AUTH_STATE_COOKIE, value, request, 60 * 10);
}

export async function readAuthState(request: Request) {
  const config = authConfig(request);
  const cookie = readCookie(request, AUTH_STATE_COOKIE);
  if (!config.configured || !cookie) return null;
  const state = await unseal<AuthState>(cookie, config.sessionSecret);
  if (!state || typeof state.state !== 'string' || typeof state.createdAt !== 'number') return null;
  return state;
}

export function clearAuthSessionCookie(request: Request) {
  return clearCookieHeader(AUTH_SESSION_COOKIE, request);
}

export function clearAuthStateCookie(request: Request) {
  return clearCookieHeader(AUTH_STATE_COOKIE, request);
}

export async function completeGoogleLogin(code: string, request: Request): Promise<AuthSession> {
  const config = authConfig(request);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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
  const tokens = await tokenResponse.json() as GoogleTokenResponse;
  if (!tokenResponse.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || tokens.error || 'Google no pudo completar el inicio de sesión.');
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileResponse.json() as GoogleUserInfo;
  if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
    throw new Error('Google no pudo verificar la identidad de esta cuenta.');
  }

  return {
    sub: profile.sub,
    email: profile.email,
    name: profile.name?.trim() || profile.email.split('@')[0],
    picture: profile.picture,
    createdAt: Date.now(),
  };
}

export const authCookies = {
  session: AUTH_SESSION_COOKIE,
  state: AUTH_STATE_COOKIE,
};
