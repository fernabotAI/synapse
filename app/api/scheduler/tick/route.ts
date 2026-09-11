import { createHash, timingSafeEqual } from 'node:crypto';
import { runDueSchedules } from '@/lib/scheduled-runner';
import { runPendingWhatsAppJobs } from '@/lib/whatsapp-worker';

function authorized(request: Request) {
  const expected = process.env.SYNAPSE_SCHEDULER_SECRET?.trim() ?? '';
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (expected.length < 32 || !supplied) return false;
  const expectedHash = createHash('sha256').update(expected).digest();
  const suppliedHash = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'No autorizado.' }, { status: 401 });
  try {
    const [schedules, whatsapp] = await Promise.all([runDueSchedules(), runPendingWhatsAppJobs()]);
    return Response.json({ ...schedules, whatsapp }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'No se pudo revisar la programación.' }, { status: 500 });
  }
}
