import { readAuthSession } from '@/lib/auth';
import { publicTimerStates, readSchedule, syncTimerConfigs, timerConfigsFromSnapshot } from '@/lib/schedule-store';
import { readWorkspace, validWorkspaceSnapshot, writeWorkspace } from '@/lib/workspace-store';

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401 });
  try {
    return Response.json({ timers: publicTimerStates(await readSchedule(session.sub)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'No se pudo consultar la programación.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  try {
    const body = await request.json() as { timerId?: unknown; enabled?: unknown };
    const timerId = typeof body.timerId === 'string' ? body.timerId.trim() : '';
    if (!/^[a-z0-9_-]{1,100}$/i.test(timerId) || typeof body.enabled !== 'boolean') {
      return Response.json({ error: 'La activación solicitada no es válida.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const workspace = await readWorkspace(session.sub);
    if (!workspace?.snapshot || typeof workspace.snapshot !== 'object') {
      return Response.json({ error: 'No se encontró el flujo guardado.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const snapshot = workspace.snapshot as Record<string, unknown>;
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    let found = false;
    const nextAgents = agents.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const entity = item as Record<string, unknown>;
      if (entity.id !== timerId || entity.kind !== 'timer') return item;
      found = true;
      return { ...entity, timerEnabled: body.enabled };
    });
    if (!found) return Response.json({ error: 'El temporizador ya no existe en el flujo.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

    const nextSnapshot = { ...snapshot, agents: nextAgents };
    if (!validWorkspaceSnapshot(nextSnapshot)) {
      return Response.json({ error: 'El flujo guardado no es válido.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    await writeWorkspace(session.sub, nextSnapshot);
    const schedule = await syncTimerConfigs(session.sub, timerConfigsFromSnapshot(nextSnapshot));
    return Response.json({ saved: true, timers: publicTimerStates(schedule) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'No se pudo actualizar la programación.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
