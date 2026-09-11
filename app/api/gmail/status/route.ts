import { readAuthSession } from '@/lib/auth';
import { clearSessionCookie, gmailConfig, readGmailSession } from '@/lib/gmail';
import { deleteStoredGmailSession, readStoredGmailSession, writeStoredGmailSession } from '@/lib/gmail-store';

export async function GET(request: Request) {
  const config = gmailConfig(request);
  const auth = await readAuthSession(request);
  let session = auth ? await readStoredGmailSession(auth.sub) : null;
  if (!session) {
    session = await readGmailSession(request);
    if (session && auth) await writeStoredGmailSession(auth.sub, session);
  }
  return Response.json({
    configured: config.configured,
    connected: Boolean(session),
    email: session?.email ?? null,
    redirectUri: config.redirectUri,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: Request) {
  const auth = await readAuthSession(request);
  const stored = auth ? await readStoredGmailSession(auth.sub) : null;
  const session = stored ?? await readGmailSession(request);
  if (session?.refreshToken) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: session.refreshToken }),
    }).catch(() => null);
  }
  if (auth) await deleteStoredGmailSession(auth.sub);
  return Response.json({ connected: false }, {
    headers: { 'Set-Cookie': clearSessionCookie(request), 'Cache-Control': 'no-store' },
  });
}
