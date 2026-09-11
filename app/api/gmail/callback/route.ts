import {
  clearStateCookie,
  exchangeAuthorizationCode,
  getStateCookie,
  gmailConfig,
  sessionCookie,
  unseal,
  type GmailSession,
} from '@/lib/gmail';
import { publicRequestUrl, redirectResponse, requestBasePath } from '@/lib/app-path';
import {
  authSessionCookie,
  clearAuthStateCookie,
  completeGoogleLogin,
  readAuthSession,
  readAuthState,
} from '@/lib/auth';
import { writeStoredGmailSession } from '@/lib/gmail-store';

type OAuthState = { state: string; createdAt: number };

function redirectWithStatus(request: Request, status: string) {
  const basePath = requestBasePath(request);
  return redirectResponse(publicRequestUrl(request, `${basePath ? `${basePath}/` : '/'}?gmail=${status}`));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const authState = await readAuthState(request);
  const isLoginCallback = Boolean(returnedState && authState?.state === returnedState);

  if (isLoginCallback) {
    const authFailed = Boolean(oauthError || !code || !authState || Date.now() - authState.createdAt > 600_000);
    if (authFailed) {
      const response = redirectResponse(publicRequestUrl(request, `/synapse/?auth=${oauthError === 'access_denied' ? 'cancelled' : 'error'}`));
      response.headers.append('Set-Cookie', clearAuthStateCookie(request));
      return response;
    }

    try {
      const session = await completeGoogleLogin(code!, request);
      const response = redirectResponse(publicRequestUrl(request, '/synapse/app/'));
      response.headers.append('Set-Cookie', await authSessionCookie(session, request));
      response.headers.append('Set-Cookie', clearAuthStateCookie(request));
      return response;
    } catch {
      const response = redirectResponse(publicRequestUrl(request, '/synapse/?auth=error'));
      response.headers.append('Set-Cookie', clearAuthStateCookie(request));
      return response;
    }
  }

  const config = gmailConfig(request);
  const stateValue = getStateCookie(request);
  const storedState = stateValue && config.configured
    ? await unseal<OAuthState>(stateValue, config.tokenSecret)
    : null;

  if (oauthError || !code || !returnedState || !storedState || storedState.state !== returnedState || Date.now() - storedState.createdAt > 600_000) {
    const response = redirectWithStatus(request, oauthError === 'access_denied' ? 'cancelled' : 'error');
    response.headers.append('Set-Cookie', clearStateCookie(request));
    return response;
  }

  try {
    const authSession = await readAuthSession(request);
    if (!authSession) throw new Error('La sesión de Synapse venció.');
    const tokens = await exchangeAuthorizationCode(code, request);
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json() as { emailAddress?: string };
    if (!profileResponse.ok || !profile.emailAddress) throw new Error('No se pudo identificar la cuenta de Gmail.');

    const session: GmailSession = {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      email: profile.emailAddress,
      scope: tokens.scope ?? '',
    };
    await writeStoredGmailSession(authSession.sub, session);
    const response = redirectWithStatus(request, 'connected');
    response.headers.append('Set-Cookie', await sessionCookie(session, request));
    response.headers.append('Set-Cookie', clearStateCookie(request));
    return response;
  } catch {
    const response = redirectWithStatus(request, 'error');
    response.headers.append('Set-Cookie', clearStateCookie(request));
    return response;
  }
}
