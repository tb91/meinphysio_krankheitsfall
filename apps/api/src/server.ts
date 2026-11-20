import Fastify from 'fastify';
import { z } from 'zod';
import {
  buildOutageView,
  cancelCommand,
  CommandError,
  failedCallCommand,
  type LogChange,
  notifyCommand,
  type OutageContext,
  rebookCommand,
  terminoSyncCommand,
  withdrawNotificationCommand,
  withdrawTerminoSyncCommand,
} from './app/outage.js';
import { createClock } from './clock.js';
import { exportFilesIn, loadMasterData, readExport } from './data/caseData.js';
import {
  appendAuditEntry,
  createPool,
  deleteAuditEntries,
  loadAuditLog,
  migrate,
  resetAuditLog,
  withDecisionLock,
} from './db.js';
import { type AuditEntry, type AuditLog, InvalidAuditEntryError } from './domain/auditLog.js';
import { baselineExport } from './domain/exportSchedule.js';
import { diffExports, ImportFormatError, processExport } from './domain/importer.js';
import { localDate, localToUtc } from './domain/time.js';
import type { TerminoAppointment, UtcIso } from './domain/types.js';

const DATA_DIR = process.env.DATA_DIR ?? '../../data';
// Szenario: Anna Weber (prac_01) fällt am Tag von NOW aus. Konfigurierbar für andere Ausfälle.
const PRACTITIONER_ID = process.env.OUTAGE_PRACTITIONER_ID ?? 'prac_01';

const pool = createPool(process.env.DATABASE_URL);
await migrate(pool);
const latestEntryAt = (await loadAuditLog(pool)).entries.map((e) => e.at).sort().at(-1);
const clock = createClock(process.env.NOW, latestEntryAt);

// LOG_LEVEL=debug zeigt auch Routine-Meldungen ("keine neuen Exporte", jeder Request).
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, disableRequestLogging: true });
app.addHook('onResponse', async (req, reply) => {
  req.log.debug({ method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'Request');
});

const master = loadMasterData(DATA_DIR);
const OUTAGE_DATE = process.env.OUTAGE_DATE ?? localDate(clock.now());

/**
 * Datenstand aus einem Termino-Vollexport. Abgelehnte Einträge werden geloggt und nicht verwendet.
 * Entscheidungen hängen an der Termin-ID im Protokoll und überleben jeden Re-Import.
 */
function buildContext(raw: unknown, previous: OutageContext | null): OutageContext {
  const importReport = processExport(raw, master);
  const all = (raw as { appointments: TerminoAppointment[] }).appointments;
  const appointments = importReport.results.filter((r) => r.outcome !== 'rejected').map((r) => all[r.index]!);
  const diff = previous ? diffExports(previous.appointments, appointments) : null;
  for (const r of importReport.results.filter((x) => x.outcome === 'rejected')) {
    app.log.warn({ index: r.index, appointmentId: r.appointmentId, reason: r.rejectReason, error: r.error }, 'Termin abgelehnt');
  }
  return {
    master,
    appointments,
    importReport,
    lastDiff: diff ? { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length } : null,
    practitionerId: PRACTITIONER_ID,
    date: OUTAGE_DATE,
  };
}

/** Ausgangsstand: neuester fälliger Export, vor dem ersten Export der früheste (siehe exportSchedule.ts). */
function loadBaseline(): OutageContext {
  const file = baselineExport(exportFilesIn(DATA_DIR), clock.now());
  if (!file) throw new Error(`Kein Termino-Export in ${DATA_DIR} gefunden`);
  const ctx = buildContext(readExport(DATA_DIR, file.file), null);
  app.log.info({ file: file.file, exportId: ctx.importReport.exportId, counts: ctx.importReport.counts }, 'Termino-Ausgangsstand geladen');
  return ctx;
}

// Aktueller Datenstand; wird durch Importe (alle 5 Min. von außen) ersetzt.
const store = { ctx: loadBaseline() };

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof CommandError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof ImportFormatError) return reply.status(400).send({ error: err.message });
  if (err instanceof InvalidAuditEntryError) return reply.status(400).send({ error: err.message });
  if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => i.message).join('; ') });
  // Fastify-eigene Client-Fehler (z. B. leerer JSON-Body) nicht als 500 ausgeben.
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message });
  app.log.error(err);
  return reply.status(500).send({ error: 'Interner Fehler' });
});

app.get('/api/health', async () => {
  await pool.query('select 1');
  return { ok: true, now: clock.now() };
});

app.get('/api/outage', async () => buildOutageView(store.ctx, await loadAuditLog(pool), clock.now()));

app.get('/api/audit', async () => {
  const log = await loadAuditLog(pool);
  return { entries: [...log.entries].reverse() };
});

const actorName = z.string().trim().min(1, 'Bitte Namen am Empfang angeben');
const params = z.object({ id: z.string().min(1) });

type Command = (log: AuditLog, now: UtcIso) => LogChange | AuditEntry;

/** Jede Änderung: Log lesen, prüfen, Einträge entfernen/anhängen, alles unter einem Lock. */
async function decide(command: Command): Promise<LogChange> {
  return withDecisionLock(pool, async (client, log) => {
    const result = command(log, clock.now());
    const change: LogChange = 'remove' in result ? result : { add: result, remove: [] };
    if (change.remove.length > 0) {
      await deleteAuditEntries(client, change.remove);
      app.log.info({ removed: change.remove }, 'Bestätigung zurückgenommen');
    }
    if (change.add) {
      await appendAuditEntry(client, change.add);
      app.log.info({ action: change.add.action, appointmentId: change.add.appointmentId, actor: change.add.actor.name }, change.add.message);
    }
    return change;
  });
}

app.post('/api/cases/:id/rebook', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, practitionerId: z.string().min(1), startsAt: z.string().datetime({ offset: true }) }).parse(req.body);
  return decide((log, now) => rebookCommand(store.ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/cancel', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, reason: z.string().trim().min(1, 'Bitte Grund angeben') }).parse(req.body);
  return decide((log, now) => cancelCommand(store.ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/notify', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName, channel: z.enum(['phone', 'sms', 'email']) }).parse(req.body);
  return decide((log, now) => notifyCommand(store.ctx, log, now, { appointmentId: id, ...body }));
});

app.post('/api/cases/:id/call-failed', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName }).parse(req.body);
  return decide((log, now) => failedCallCommand(store.ctx, log, now, { appointmentId: id, ...body }));
});

app.delete('/api/cases/:id/notify/:channel', async (req) => {
  const { id, channel } = params.extend({ channel: z.enum(['phone', 'sms', 'email']) }).parse(req.params);
  return decide((log) => withdrawNotificationCommand(store.ctx, log, { appointmentId: id, channel }));
});

app.post('/api/cases/:id/termino-synced', async (req) => {
  const { id } = params.parse(req.params);
  const body = z.object({ actorName }).parse(req.body);
  return decide((log, now) => terminoSyncCommand(store.ctx, log, now, { appointmentId: id, ...body }));
});

app.delete('/api/cases/:id/termino-synced', async (req) => {
  const { id } = params.parse(req.params);
  return decide((log) => withdrawTerminoSyncCommand(store.ctx, log, { appointmentId: id }));
});

/**
 * Eingang für Termino-Exporte. In echt ruft das ein externer Job auf (z. B. Zapier, alle 5 Min.),
 * hier der Container "termino-sync". Idempotent: derselbe Export (export_id) ändert nichts.
 */
app.post('/api/imports/termino', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
  const head = (req.body ?? {}) as { export_id?: unknown; exported_at?: unknown };
  const current = store.ctx.importReport;
  if (head.export_id === current.exportId) {
    app.log.debug({ exportId: current.exportId }, 'Keine neuen Termino-Daten (Export bereits importiert)');
    return { status: 'unchanged', exportId: current.exportId };
  }
  if (typeof head.exported_at === 'string' && Date.parse(head.exported_at) < Date.parse(current.exportedAt)) {
    app.log.warn({ exportId: head.export_id, current: current.exportId }, 'Älterer Termino-Export ignoriert');
    return { status: 'outdated', exportId: head.export_id };
  }
  const next = buildContext(req.body, store.ctx);
  store.ctx = next;
  app.log.info(
    { exportId: next.importReport.exportId, exportedAt: next.importReport.exportedAt, counts: next.importReport.counts, diff: next.lastDiff },
    'Termino-Export importiert',
  );
  return { status: 'imported', exportId: next.importReport.exportId, counts: next.importReport.counts, diff: next.lastDiff };
});

/**
 * Nur für Testlauf/Video: Szenario-Uhr auf eine Ortszeit am Ausfalltag stellen (z. B. 08:05).
 * Den Import löst das bewusst nicht direkt aus: Das übernimmt der Sync-Job, sobald er den
 * neuen 5-Minuten-Takt sieht. So läuft auch der Test über denselben Weg wie im Betrieb.
 */
app.post('/api/demo/clock', async (req) => {
  const { localTime } = z
    .object({ localTime: z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit als HH:MM') })
    .parse(req.body);
  clock.set(localToUtc(OUTAGE_DATE, localTime));
  app.log.info({ now: clock.now() }, `Szenario-Uhr auf ${localTime} Uhr gestellt (Testlauf)`);
  return { ok: true, now: clock.now() };
});

/** Nur für Testlauf/Video: Protokoll leeren, Szenario-Uhr auf NOW (07:40) und Termino-Ausgangsstand. Keine Produktivfunktion. */
app.post('/api/demo/reset', async () => {
  await resetAuditLog(pool);
  clock.reset();
  store.ctx = loadBaseline();
  return { ok: true, now: clock.now() };
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
