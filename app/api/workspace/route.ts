import { readAuthSession } from '@/lib/auth';
import { readWorkspace, validWorkspaceSnapshot, writeWorkspace } from '@/lib/workspace-store';
import { publicTimerStates, syncTimerConfigs, timerConfigsFromSnapshot } from '@/lib/schedule-store';

const JSON_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'Inicia sesión para abrir tu workspace.' }, { status: 401, headers: JSON_HEADERS });

  try {
    const workspace = await readWorkspace(session.sub);
    return Response.json({
      workspace: workspace?.snapshot ?? null,
      updatedAt: workspace?.updatedAt ?? null,
    }, { headers: JSON_HEADERS });
  } catch {
    return Response.json({ error: 'No se pudo abrir tu workspace.' }, { status: 500, headers: JSON_HEADERS });
  }
}

export async function PUT(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401, headers: JSON_HEADERS });

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 750_000) {
    return Response.json({ error: 'El workspace es demasiado grande.' }, { status: 413, headers: JSON_HEADERS });
  }

  try {
    const snapshot = await request.json() as unknown;
    if (!validWorkspaceSnapshot(snapshot)) {
      return Response.json({ error: 'El formato del workspace no es válido.' }, { status: 400, headers: JSON_HEADERS });
    }
    const stored = await writeWorkspace(session.sub, snapshot);
    const schedule = await syncTimerConfigs(session.sub, timerConfigsFromSnapshot(snapshot));
    return Response.json({ saved: true, updatedAt: stored.updatedAt, timers: publicTimerStates(schedule) }, { headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('tamaño máximo')
      ? error.message
      : 'No se pudo guardar tu workspace.';
    return Response.json({ error: message }, { status: 500, headers: JSON_HEADERS });
  }
}
