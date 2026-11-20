/**
 * Simulation des externen Import-Jobs (in echt z. B. ein Zapier-Zap, alle 5 Minuten).
 *
 * Läuft als eigener Prozess/Container und kennt nur die HTTP-Schnittstelle der API:
 * - fragt die Szenario-Uhr ab (GET /api/health),
 * - sobald ein neuer 5-Minuten-Takt beginnt, sucht er den neuesten fälligen
 *   termino_export_YYYY-MM-DD_HHMM.json und schickt ihn an POST /api/imports/termino.
 * Gibt es nichts Neues, wird das nur auf Log-Level "debug" gemeldet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportFilesIn } from '../data/caseData.js';
import { importSlot, latestDueExport } from '../domain/exportSchedule.js';
import { localTime } from '../domain/time.js';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const DATA_DIR = process.env.DATA_DIR ?? '../../data';
/** Wie oft die Szenario-Uhr abgefragt wird (echte Sekunden), nicht der Import-Takt. */
const POLL_MS = Number(process.env.SYNC_POLL_MS ?? 5000);

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function log(level: Level, message: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return;
  const line = { level, time: new Date().toISOString(), job: 'termino-sync', msg: message, ...data };
  (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(line));
}

let lastSlot: number | null = null;
let running = false;
/** Beim Start ist die API oft noch nicht bereit; das ist erwartbar und keine Warnung wert. */
let connectedOnce = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const health = await fetch(`${API_URL}/api/health`);
    if (!health.ok) throw new Error(`API ${health.status}`);
    const { now } = (await health.json()) as { now: string };
    connectedOnce = true;

    // Nur einmal pro 5-Minuten-Takt arbeiten. Springt die Uhr zurück (Testlauf-Reset), zählt das als neuer Takt.
    const slot = importSlot(now);
    if (slot === lastSlot) return;
    lastSlot = slot;
    const at = `${localTime(now)} Uhr`;

    const due = latestDueExport(exportFilesIn(DATA_DIR), now);
    if (!due) {
      log('debug', `${at}: Keine neuen Termino-Exporte`);
      return;
    }

    const res = await fetch(`${API_URL}/api/imports/termino`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: readFileSync(resolve(DATA_DIR, due.file), 'utf8'),
    });
    const body = (await res.json()) as { status?: string; diff?: unknown; error?: string };
    if (!res.ok) {
      log('error', `${at}: Import von ${due.file} fehlgeschlagen`, { status: res.status, error: body.error });
    } else if (body.status === 'imported') {
      log('info', `${at}: ${due.file} an die API übergeben`, { diff: body.diff });
    } else {
      log('debug', `${at}: Keine neuen Termino-Exporte (${due.file} bereits bekannt)`, { status: body.status });
    }
  } catch (err) {
    // API noch nicht bereit oder kurz weg: beim nächsten Abfragen erneut versuchen.
    lastSlot = null;
    log(connectedOnce ? 'warn' : 'debug', connectedOnce ? 'API nicht erreichbar, neuer Versuch folgt' : 'Warte auf API', {
      error: (err as Error).message,
    });
  } finally {
    running = false;
  }
}

log('info', 'Termino-Sync gestartet', { api: API_URL, dataDir: DATA_DIR, everyMinutes: 5 });
void tick();
setInterval(() => void tick(), POLL_MS);
