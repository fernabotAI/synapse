import { authConfig, readAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  const config = authConfig(request);
  const session = await readAuthSession(request);
  return Response.json({
    configured: config.configured,
    authenticated: Boolean(session),
    user: session ? {
      email: session.email,
      name: session.name,
      picture: session.picture ?? null,
    } : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
