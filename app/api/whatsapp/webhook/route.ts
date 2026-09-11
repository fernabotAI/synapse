import { createHmac, timingSafeEqual } from 'node:crypto';
import { readWhatsAppCredentials } from '@/lib/credential-store';
import { validWebhookSecret } from '@/lib/webhook-runner';
import { enqueueWhatsAppJob } from '@/lib/whatsapp-queue';
import { findWorkspaceByWhatsApp } from '@/lib/workspace-store';

type WhatsAppEntity = {
  id?: string;
  name?: string;
  whatsappWebhookId?: string;
  whatsappVerifyToken?: string;
  whatsappPhoneNumberId?: string;
};

type IncomingMessage = {
  id: string;
  from: string;
  text: string;
  messageType: 'text' | 'audio';
  mediaId?: string;
  phoneNumberId: string;
};

function plain(text: string, status = 200) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function validSignature(rawBody: string, appSecret: string, supplied: string) {
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function messageText(message: Record<string, unknown>) {
  const text = message.text as { body?: unknown } | undefined;
  if (typeof text?.body === 'string') return text.body;
  const button = message.button as { text?: unknown } | undefined;
  if (typeof button?.text === 'string') return button.text;
  const interactive = message.interactive as { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined;
  if (typeof interactive?.button_reply?.title === 'string') return interactive.button_reply.title;
  if (typeof interactive?.list_reply?.title === 'string') return interactive.list_reply.title;
  return '';
}

function incomingMessages(payload: unknown): IncomingMessage[] {
  if (!payload || typeof payload !== 'object') return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const result: IncomingMessage[] = [];
  for (const entry of entries) {
    const changes = entry && typeof entry === 'object' ? (entry as { changes?: unknown }).changes : null;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change && typeof change === 'object' ? (change as { value?: unknown }).value : null;
      if (!value || typeof value !== 'object') continue;
      const rawPhoneNumberId = (value as { metadata?: { phone_number_id?: unknown } }).metadata?.phone_number_id;
      const phoneNumberId = typeof rawPhoneNumberId === 'string' || typeof rawPhoneNumberId === 'number' ? String(rawPhoneNumberId) : '';
      const messages = (value as { messages?: unknown }).messages;
      if (!Array.isArray(messages)) continue;
      for (const item of messages) {
        if (!item || typeof item !== 'object') continue;
        const message = item as Record<string, unknown>;
        const id = typeof message.id === 'string' ? message.id : '';
        const from = typeof message.from === 'string' ? message.from : '';
        const text = messageText(message).trim();
        const audio = message.audio as { id?: unknown } | undefined;
        const mediaId = typeof audio?.id === 'string' ? audio.id : '';
        if (id && from && text) result.push({ id, from, text: text.slice(0, 12_000), messageType: 'text', phoneNumberId });
        else if (id && from && mediaId) result.push({ id, from, text: '', messageType: 'audio', mediaId, phoneNumberId });
      }
    }
  }
  return result.slice(0, 3);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const webhookId = url.searchParams.get('id')?.trim() ?? '';
  if (!/^[a-f0-9-]{16,80}$/i.test(webhookId)) return plain('Not found', 404);
  const workspace = await findWorkspaceByWhatsApp(webhookId);
  if (!workspace) return plain('Not found', 404);
  const entity = workspace.whatsapp as WhatsAppEntity;
  const mode = url.searchParams.get('hub.mode') ?? '';
  const token = url.searchParams.get('hub.verify_token') ?? '';
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  if (mode === 'subscribe' && challenge && validWebhookSecret(entity.whatsappVerifyToken ?? '', token)) return plain(challenge);
  return plain('Verification failed', 403);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const webhookId = url.searchParams.get('id')?.trim() ?? '';
  if (!/^[a-f0-9-]{16,80}$/i.test(webhookId)) return plain('Not found', 404);
  const workspace = await findWorkspaceByWhatsApp(webhookId);
  if (!workspace) return plain('Not found', 404);
  const credentials = await readWhatsAppCredentials(workspace.subject);
  if (!credentials) return plain('WhatsApp credentials missing', 503);
  if (Number(request.headers.get('content-length') ?? 0) > 250_000) return plain('Payload too large', 413);
  const rawBody = await request.text();
  if (rawBody.length > 250_000) return plain('Payload too large', 413);
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  if (!validSignature(rawBody, credentials.appSecret, signature)) return plain('Invalid signature', 401);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return plain('Invalid JSON', 400);
  }
  if ((payload as { object?: unknown })?.object !== 'whatsapp_business_account') return plain('EVENT_RECEIVED');
  const entity = workspace.whatsapp as WhatsAppEntity;
  const configuredPhoneId = entity.whatsappPhoneNumberId?.trim() ?? '';
  const messages = incomingMessages(payload).filter((message) => !configuredPhoneId || message.phoneNumberId === configuredPhoneId);
  for (const message of messages) {
    await enqueueWhatsAppJob({
      subject: workspace.subject,
      webhookId,
      messageId: message.id,
      from: message.from,
      text: message.text,
      messageType: message.messageType,
      mediaId: message.mediaId,
      phoneNumberId: configuredPhoneId || message.phoneNumberId,
    });
  }
  return plain('EVENT_RECEIVED');
}
