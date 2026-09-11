export function whatsappText(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, (_match, label: string, url: string) => /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\.[a-z]{2,})?$/i.test(label.trim()) ? label.trim() : `${label.trim()} (${url})`)
    .trim()
    .slice(0, 4_000);
}

export function normalizeWhatsAppRecipient(value: string) {
  const digits = value.replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export async function sendWhatsAppMessage(phoneNumberId: string, to: string, text: string, accessToken: string) {
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION?.trim() || 'v26.0';
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: whatsappText(text) },
    }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json() as { error?: { message?: string } };
      detail = payload.error?.message?.slice(0, 240) ?? '';
    } catch {
      detail = '';
    }
    throw new Error(`Meta no pudo enviar la respuesta (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}
