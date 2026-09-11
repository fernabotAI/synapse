import { userGmailFetch } from '@/lib/user-gmail';

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64Url(value: string) {
  return utf8Base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { to?: string; subject?: string; body?: string };
    const to = body.to?.trim() ?? '';
    const subject = body.subject?.trim() ?? '';
    const content = body.body?.trim() ?? '';
    if (!/^\S+@\S+\.\S+$/.test(to)) return Response.json({ error: 'El destinatario del borrador no es válido.' }, { status: 400 });
    if (!subject || subject.length > 300) return Response.json({ error: 'El asunto debe contener entre 1 y 300 caracteres.' }, { status: 400 });
    if (!content || content.length > 50_000) return Response.json({ error: 'El cuerpo del borrador debe contener entre 1 y 50.000 caracteres.' }, { status: 400 });

    const mime = [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${utf8Base64(subject)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      content,
    ].join('\r\n');
    const result = await userGmailFetch(request, '/drafts', {
      method: 'POST',
      body: JSON.stringify({ message: { raw: base64Url(mime) } }),
    });
    const draft = await result.response.json() as { id?: string; message?: { id?: string; threadId?: string } };
    return Response.json({ draftId: draft.id, messageId: draft.message?.id, threadId: draft.message?.threadId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo crear el borrador.' }, { status: 401 });
  }
}
