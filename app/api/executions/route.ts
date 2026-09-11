import { readAuthSession } from '@/lib/auth';
import { latestLiveExecution } from '@/lib/execution-store';

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401 });
  return Response.json(
    { execution: latestLiveExecution(session.sub) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
