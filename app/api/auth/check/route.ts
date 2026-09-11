import { readAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  return new Response(null, {
    status: session ? 204 : 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}
