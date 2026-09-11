import { gmailFetchWithSession, type GmailSession } from '@/lib/gmail';
import { readStoredGmailSession, writeStoredGmailSession } from '@/lib/gmail-store';

export type GmailMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
};

function decodeBody(data?: string) {
  if (!data) return '';
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function textBody(part?: GmailPart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBody(part.body.data);
  for (const child of part.parts ?? []) {
    const content = textBody(child);
    if (content.trim()) return content;
  }
  return decodeBody(part.body?.data);
}

async function fetchWithSavedSession(subject: string, session: GmailSession, path: string, init?: RequestInit) {
  const result = await gmailFetchWithSession(session, path, init);
  if (result.refreshed) await writeStoredGmailSession(subject, result.session);
  return result;
}

export async function readGmailMessages(subject: string, query: string, maxResults: number) {
  let session = await readStoredGmailSession(subject);
  if (!session) throw new Error('Conecta Gmail nuevamente para usar esta herramienta.');
  const safeQuery = (query.trim() || 'in:inbox newer_than:7d').slice(0, 500);
  const safeMaximum = Math.min(10, Math.max(1, Math.round(maxResults) || 5));
  const listed = await fetchWithSavedSession(subject, session, `/messages?q=${encodeURIComponent(safeQuery)}&maxResults=${safeMaximum}`);
  session = listed.session;
  const list = await listed.response.json() as { messages?: Array<{ id?: string }> };
  const messages: GmailMessage[] = [];
  for (const item of list.messages ?? []) {
    if (!item.id) continue;
    const result = await fetchWithSavedSession(subject, session, `/messages/${encodeURIComponent(item.id)}?format=full`);
    session = result.session;
    const message = await result.response.json() as { id?: string; snippet?: string; payload?: GmailPart };
    const headers = message.payload?.headers ?? [];
    const header = (name: string) => headers.find((entry) => entry.name?.toLowerCase() === name)?.value ?? '';
    messages.push({
      id: message.id ?? item.id,
      from: header('from'),
      to: header('to'),
      subject: header('subject') || '(Sin asunto)',
      date: header('date'),
      snippet: message.snippet ?? '',
      body: textBody(message.payload).trim().slice(0, 8_000),
    });
  }
  return { query: safeQuery, messages };
}

function utf8Base64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

export async function createGmailDraft(subject: string, to: string, mailSubject: string, body: string) {
  if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error('El destinatario del borrador no es válido.');
  if (!mailSubject.trim()) throw new Error('El asunto del borrador está vacío.');
  const session = await readStoredGmailSession(subject);
  if (!session) throw new Error('Conecta Gmail nuevamente para crear borradores.');
  const mime = [
    `To: ${to.trim()}`,
    `Subject: =?UTF-8?B?${utf8Base64(mailSubject.trim())}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body.slice(0, 50_000),
  ].join('\r\n');
  const result = await fetchWithSavedSession(subject, session, '/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: Buffer.from(mime, 'utf8').toString('base64url') } }),
  });
  const draft = await result.response.json() as { id?: string };
  return draft;
}
