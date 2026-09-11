import { userGmailFetch } from '@/lib/user-gmail';

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
};

function decodeBody(data?: string) {
  if (!data) return '';
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') || 'in:inbox newer_than:7d').slice(0, 500);
    const maxResults = Math.min(10, Math.max(1, Number(url.searchParams.get('max')) || 5));
    const listed = await userGmailFetch(request, `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`);
    const list = await listed.response.json() as { messages?: Array<{ id: string }> };
    const messages = await Promise.all((list.messages ?? []).map(async ({ id }) => {
      const result = await userGmailFetch(request, `/messages/${encodeURIComponent(id)}?format=full`);
      const message = await result.response.json() as GmailMessage;
      const headers = message.payload?.headers ?? [];
      const header = (name: string) => headers.find((item) => item.name?.toLowerCase() === name)?.value ?? '';
      return {
        id: message.id,
        threadId: message.threadId,
        from: header('from'),
        to: header('to'),
        subject: header('subject') || '(Sin asunto)',
        date: header('date'),
        snippet: message.snippet ?? '',
        body: textBody(message.payload).trim().slice(0, 12_000),
      };
    }));
    return Response.json({ query, count: messages.length, messages }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudieron leer los correos.' }, { status: 401 });
  }
}
