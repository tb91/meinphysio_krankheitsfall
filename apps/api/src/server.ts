import Fastify from 'fastify';
import { z } from 'zod';
import {
  buildOutageView,
  cancelCommand,
  CommandError,
  notifyCommand,
  type OutageContext,
  rebookCommand,
  terminoSyncCommand,
} from './app/outage.js';
import { createClock } from './clock.js';
import { latestExportFile, loadMasterData, readExport } from './data/caseData.js';
import { appendAuditEntry, createPool, loadAuditLog, migrate, resetAuditLog, withDecisionLock } from './db.js';
import { type AuditEntry, type AuditLog, InvalidAuditEntryError } from './domain/auditLog.js';
import { processExport } from './domain/importer.js';
import { localDate } from './domain/time.js';
import type { TerminoAppointment, UtcIso } from './domain/types.js';

const DATA_DIR = process.env.DATA_DIR ?? '../../data';
// Szenario: Anna Weber (prac_01) fällt am Tag von NOW aus. Konfigurierbar für andere Ausfälle.
const PRACTITIONER_ID = process.env.OUTAGE_PRACTITIONER_ID ?? 'prac_01';

const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const latestEntryAt = (await loadAuditLog(pool)).entries.map((e) => e.at).sort().at(-1);
const clock = createClock(process.env.NOW, latestEntryAt);

// Import beim Start: neuester Export. Abgelehnte Einträge werden geloggt und nicht verwendet.
const exportFile = latestExportFile(DATA_DIR);
const raw = readExport(DATA_DIR, exportFile) as { appointments: TerminoAppointment[] };
const master = loadMasterData(DATA_DIR);
const importReport = processExport(raw, master);
const ctx: OutageContext = {
  master,
  appointments: importReport.results.filter((r) => r.outcome !== 'rejected').map((r) => raw.appointments[r.index]!),
  importReport,
  practitionerId: PRACTITIONER_ID,
  date: process.env.OUTAGE_DATE ?? localDate(clock.now()),
};

const app = Fastify({ logger: true });
app.log.info({ exportFile, counts: importReport.counts }, 'Termino-Export importiert');
for (const r of importReport.results.filter((x) => x.outcome === 'rejected')) {
  app.log.warn({ index: r.index, appointmentId: r.appointmentId, reason: r.rejectReason, error: r.error }, 'Termin abgelehnt');
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof CommandError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof InvalidAuditEntryError) return reply.status(400).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join('; ') });
  app.log.error(err);
  return reply.status(500).send({ error: 'Interner Fehler' });
});

app.get('/api/health', async () => {
  await pool.query('select 1');
  return { ok: true, now: clock.now() };
});

app.get('/api/outage', async () => buildOutageView(ctx, await loadAuditLog(pool), clock.now()));

app.get('/api/audit', async () => {
  const log = await loadAuditLog(pool);
  return { entries: [...log.entries].reverse() };
});

const actorName = z.string().trim().min(1, 'Bitte Namen am Empfang angeben');
const params = z.object({ id: z.string().min(1) });

type Command = (log: AuditLog, now: UtcIso) => AuditEntry;

/** Jede Entscheidung: Log lesen, prüfen, Eintrag anhängen, alles unter einem Lock. */
async function decide(command: Command): Promise<AuditEntry> {
  return withDecisionLock(pool, async (client, log) => {
    const entry = command(log, clock.now());
    await appendAuditEntry(client, entry);
    app.log.info({ action: entry.action, appointmentId: entry.appointmentId, actor: entry.actor.name }, entry.message);
    return entry;
  });
}

app.post('/api/cases/:id/rebook', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, practitionerId: z.string().min(1), startsAt: z.string().datetime({ offset: true }) }).parse(req.body);
  return decide((log, now) => rebookCommand(ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/cancel', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, reason: z.string().trim().min(1, 'Bitte Grund angeben') }).parse(req.body);
  return decide((log, now) => cancelCommand(ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/notify', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, channel: z.enum(['phone', 'sms', 'email']) }).parse(req.body);
  return decide((log, now) => notifyCommand(ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/termino-synced', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName }).parse(req.body);
  return decide((log, now) => terminoSyncCommand(ctx, log, now, { appointmentId: id, ...body }));
});

/** Nur für Demo/Video: Protokoll leeren. Keine Produktivfunktion. */
app.post('/api/demo/reset', async () => {
  await resetAuditLog(pool);
  return { ok: true };
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
