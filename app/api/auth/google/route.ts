import { authConfig, authStateCookie } from '@/lib/auth';
import { publicRequestUrl, redirectResponse } from '@/lib/app-path';
import { randomState } from '@/lib/gmail';

export async function GET(request: Request) {
  const config = authConfig(request);
  if (!config.configured) {
    return redirectResponse(publicRequestUrl(request, '/synapse/?auth=unconfigured'));
  }

  const state = randomState();
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    prompt: 'select_account',
    state,
    scope: ['openid', 'email', 'profile'].join(' '),
  }).toString();

  const response = redirectResponse(authorization);
  response.headers.append('Set-Cookie', await authStateCookie({ state, createdAt: Date.now() }, request));
  return response;
}
