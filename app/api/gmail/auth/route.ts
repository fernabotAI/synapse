import { gmailConfig, randomState, seal, stateCookie } from '@/lib/gmail';
import { publicRequestUrl, redirectResponse, requestBasePath } from '@/lib/app-path';

export async function GET(request: Request) {
  const config = gmailConfig(request);
  if (!config.configured) {
    const basePath = requestBasePath(request);
    return redirectResponse(publicRequestUrl(request, `${basePath ? `${basePath}/` : '/'}?gmail=unconfigured`));
  }

  const state = randomState();
  const sealedState = await seal({ state, createdAt: Date.now() }, config.tokenSecret);
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ].join(' '),
  }).toString();

  const response = redirectResponse(authorization);
  response.headers.append('Set-Cookie', stateCookie(sealedState, request));
  return response;
}
