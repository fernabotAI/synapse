import { readAuthSession } from '@/lib/auth';
import { gmailFetchWithSession, readGmailSession } from '@/lib/gmail';
import { readStoredGmailSession, writeStoredGmailSession } from '@/lib/gmail-store';

export async function authenticatedGmailSession(request: Request) {
  const auth = await readAuthSession(request);
  if (!auth) throw new Error('La sesión venció. Vuelve a iniciar sesión.');
  let session = await readStoredGmailSession(auth.sub);
  if (!session) {
    session = await readGmailSession(request);
    if (session) await writeStoredGmailSession(auth.sub, session);
  }
  if (!session) throw new Error('Conecta una cuenta de Gmail antes de ejecutar este nodo.');
  return { auth, session };
}

export async function userGmailFetch(request: Request, path: string, init?: RequestInit) {
  const { auth, session } = await authenticatedGmailSession(request);
  const result = await gmailFetchWithSession(session, path, init);
  if (result.refreshed) await writeStoredGmailSession(auth.sub, result.session);
  return result;
}
