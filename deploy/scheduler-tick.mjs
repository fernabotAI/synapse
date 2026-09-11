const secret = process.env.SYNAPSE_SCHEDULER_SECRET?.trim();
if (!secret) throw new Error('SYNAPSE_SCHEDULER_SECRET is not configured');

const response = await fetch('http://127.0.0.1:3020/synapse/app/api/scheduler/tick', {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(300_000),
});
const payload = await response.text();
if (!response.ok) throw new Error(`Scheduler returned ${response.status}: ${payload.slice(0, 200)}`);
const summary = JSON.parse(payload);
console.log(`Synapse scheduler: ${summary.due ?? 0} due / ${summary.checked ?? 0} workspaces; ${summary.whatsapp?.pending ?? 0} WhatsApp jobs`);
