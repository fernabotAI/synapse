import { clearAuthSessionCookie } from '@/lib/auth';
import { publicRequestUrl, redirectResponse } from '@/lib/app-path';
import { clearSessionCookie } from '@/lib/gmail';

export async function GET(request: Request) {
  const response = redirectResponse(publicRequestUrl(request, '/synapse/'));
  response.headers.append('Set-Cookie', clearAuthSessionCookie(request));
  response.headers.append('Set-Cookie', clearSessionCookie(request));
  return response;
}
