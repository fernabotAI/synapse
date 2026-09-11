type TranscriptionCredentials = { Google?: string; OpenAI?: string };

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

function providerError(status: number, provider: string) {
  return new Error(`${provider} no pudo procesar el audio (${status}).`);
}

function validMediaHost(hostname: string) {
  return hostname === 'lookaside.fbsbx.com'
    || hostname.endsWith('.facebook.com')
    || hostname.endsWith('.fbcdn.net');
}

function normalizedAudioMimeType(value: string) {
  const mimeType = value.split(';')[0].trim().toLowerCase();
  if (mimeType === 'application/ogg') return 'audio/ogg';
  return mimeType.startsWith('audio/') ? mimeType : '';
}

async function responseBytes(response: Response) {
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_AUDIO_BYTES) throw new Error('El audio supera el máximo permitido de 12 MB.');
  if (!response.body) throw new Error('Meta devolvió el audio vacío.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error('El audio supera el máximo permitido de 12 MB.');
    }
    chunks.push(value);
  }
  if (!total) throw new Error('Meta devolvió el audio vacío.');
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function downloadWhatsAppAudio(mediaId: string, accessToken: string) {
  if (!/^[a-z0-9_-]{8,160}$/i.test(mediaId)) throw new Error('El identificador del audio no es válido.');
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION?.trim() || 'v26.0';
  const metadataResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!metadataResponse.ok) throw providerError(metadataResponse.status, 'Meta');
  const metadata = await metadataResponse.json() as { url?: unknown; mime_type?: unknown; file_size?: unknown };
  const mediaUrl = typeof metadata.url === 'string' ? new URL(metadata.url) : null;
  if (!mediaUrl || mediaUrl.protocol !== 'https:' || !validMediaHost(mediaUrl.hostname)) throw new Error('Meta devolvió una ubicación de audio no permitida.');
  const declaredSize = Number(metadata.file_size ?? 0);
  if (declaredSize > MAX_AUDIO_BYTES) throw new Error('El audio supera el máximo permitido de 12 MB.');
  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!mediaResponse.ok) throw providerError(mediaResponse.status, 'Meta');
  const mimeType = normalizedAudioMimeType(
    typeof metadata.mime_type === 'string' ? metadata.mime_type : mediaResponse.headers.get('content-type') ?? '',
  );
  if (!mimeType) throw new Error('El archivo recibido no tiene un formato de audio compatible.');
  return { bytes: await responseBytes(mediaResponse), mimeType };
}

async function transcribeWithGoogle(bytes: Buffer, mimeType: string, apiKey: string) {
  const model = encodeURIComponent(process.env.SYNAPSE_TRANSCRIPTION_MODEL?.trim() || 'gemini-3.7-flash');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: 'Transcribe fielmente este mensaje de voz. Conserva nombres propios y lugares. Devuelve únicamente la transcripción, sin comentarios ni formato adicional.' },
        { inlineData: { mimeType, data: bytes.toString('base64') } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2_048 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw providerError(response.status, 'Google');
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  return payload.candidates?.[0]?.content?.parts?.flatMap((part) => typeof part.text === 'string' ? [part.text] : []).join('\n').trim() ?? '';
}

async function transcribeWithOpenAI(bytes: Buffer, mimeType: string, apiKey: string) {
  const form = new FormData();
  form.set('model', process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe');
  const audioBytes = new Uint8Array(bytes.byteLength);
  audioBytes.set(bytes);
  form.set('file', new Blob([audioBytes], { type: mimeType }), mimeType === 'audio/ogg' ? 'voice.ogg' : 'voice.audio');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw providerError(response.status, 'OpenAI');
  const payload = await response.json() as { text?: unknown };
  return typeof payload.text === 'string' ? payload.text.trim() : '';
}

export async function transcribeWhatsAppAudio(
  mediaId: string,
  accessToken: string,
  credentials: TranscriptionCredentials,
) {
  const audio = await downloadWhatsAppAudio(mediaId, accessToken);
  const transcript = credentials.Google?.trim()
    ? await transcribeWithGoogle(audio.bytes, audio.mimeType, credentials.Google.trim())
    : credentials.OpenAI?.trim()
      ? await transcribeWithOpenAI(audio.bytes, audio.mimeType, credentials.OpenAI.trim())
      : '';
  if (!transcript) {
    if (!credentials.Google?.trim() && !credentials.OpenAI?.trim()) throw new Error('Conecta Google u OpenAI para transcribir mensajes de voz.');
    throw new Error('No se detectó voz comprensible en el audio.');
  }
  return transcript.slice(0, 12_000);
}
