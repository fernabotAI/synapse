import { readAuthSession } from '@/lib/auth';
import { deleteCredential, readWhatsAppCredentials, storeWhatsAppCredentials } from '@/lib/credential-store';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció.' }, { status: 401, headers: HEADERS });
  try {
    return Response.json({ connected: Boolean(await readWhatsAppCredentials(session.sub)) }, { headers: HEADERS });
  } catch {
    return Response.json({ error: 'No se pudo abrir la credencial de WhatsApp.' }, { status: 500, headers: HEADERS });
  }
}

export async function PUT(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció.' }, { status: 401, headers: HEADERS });
  if (Number(request.headers.get('content-length') ?? 0) > 5_000) {
    return Response.json({ error: 'Las credenciales son demasiado grandes.' }, { status: 413, headers: HEADERS });
  }
  try {
    const body = await request.json() as { accessToken?: unknown; appSecret?: unknown };
    if (typeof body.accessToken !== 'string') {
      return Response.json({ error: 'Completa el Access Token.' }, { status: 400, headers: HEADERS });
    }
    const existing = await readWhatsAppCredentials(session.sub);
    const appSecret = typeof body.appSecret === 'string' && body.appSecret.trim()
      ? body.appSecret
      : existing?.appSecret;
    if (!appSecret) {
      return Response.json({ error: 'Completa el App Secret del webhook.' }, { status: 400, headers: HEADERS });
    }
    await storeWhatsAppCredentials(session.sub, { accessToken: body.accessToken, appSecret });
    return Response.json({ saved: true, connected: true }, { headers: HEADERS });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('formato válido') ? error.message : 'No se pudieron guardar las credenciales de WhatsApp.';
    return Response.json({ error: message }, { status: message.includes('formato válido') ? 400 : 500, headers: HEADERS });
  }
}

export async function DELETE(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció.' }, { status: 401, headers: HEADERS });
  try {
    await deleteCredential(session.sub, 'WhatsApp');
    return Response.json({ removed: true, connected: false }, { headers: HEADERS });
  } catch {
    return Response.json({ error: 'No se pudo eliminar la credencial de WhatsApp.' }, { status: 500, headers: HEADERS });
  }
}
