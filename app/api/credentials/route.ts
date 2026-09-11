import { readAuthSession } from '@/lib/auth';
import {
  credentialStatus,
  deleteCredential,
  isCredentialProvider,
  storeCredential,
} from '@/lib/credential-store';

const JSON_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'Inicia sesión para abrir tus credenciales.' }, { status: 401, headers: JSON_HEADERS });

  try {
    return Response.json({ providers: await credentialStatus(session.sub) }, { headers: JSON_HEADERS });
  } catch {
    return Response.json({ error: 'No se pudo abrir la bóveda de credenciales.' }, { status: 500, headers: JSON_HEADERS });
  }
}

export async function PUT(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401, headers: JSON_HEADERS });
  if (Number(request.headers.get('content-length') ?? 0) > 5_000) {
    return Response.json({ error: 'La credencial es demasiado grande.' }, { status: 413, headers: JSON_HEADERS });
  }

  try {
    const body = await request.json() as { provider?: unknown; key?: unknown };
    if (!isCredentialProvider(body.provider) || typeof body.key !== 'string') {
      return Response.json({ error: 'El proveedor o la clave no son válidos.' }, { status: 400, headers: JSON_HEADERS });
    }
    const providers = await storeCredential(session.sub, body.provider, body.key);
    return Response.json({ saved: true, providers }, { headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('formato válido')
      ? error.message
      : 'No se pudo guardar la credencial.';
    return Response.json({ error: message }, { status: message.includes('formato válido') ? 400 : 500, headers: JSON_HEADERS });
  }
}

export async function DELETE(request: Request) {
  const session = await readAuthSession(request);
  if (!session) return Response.json({ error: 'La sesión venció. Vuelve a iniciar sesión.' }, { status: 401, headers: JSON_HEADERS });
  const provider = new URL(request.url).searchParams.get('provider');
  if (!isCredentialProvider(provider)) {
    return Response.json({ error: 'El proveedor no es válido.' }, { status: 400, headers: JSON_HEADERS });
  }

  try {
    return Response.json({ removed: true, providers: await deleteCredential(session.sub, provider) }, { headers: JSON_HEADERS });
  } catch {
    return Response.json({ error: 'No se pudo eliminar la credencial.' }, { status: 500, headers: JSON_HEADERS });
  }
}
