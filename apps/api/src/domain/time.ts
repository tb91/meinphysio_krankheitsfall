import type { IsoDate, UtcIso, Weekday } from './types.js';

// Alle Zeiten liegen intern in UTC. Ortszeit nur über Intl mit expliziter Zeitzone,
// nie mit hartkodiertem Offset (Sommer-/Winterzeit).
export const PRACTICE_TIME_ZONE = 'Europe/Berlin';

function parts(utc: UtcIso, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('de-DE', { timeZone, ...options }).formatToParts(new Date(utc))) {
    out[p.type] = p.value;
  }
  return out;
}

/** Kalendertag in Ortszeit, "YYYY-MM-DD" */
export function localDate(utc: UtcIso, timeZone = PRACTICE_TIME_ZONE): IsoDate {
  const p = parts(utc, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Uhrzeit in Ortszeit, "HH:MM" */
export function localTime(utc: UtcIso, timeZone = PRACTICE_TIME_ZONE): string {
  const p = parts(utc, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** z. B. "Mo 07.09., 08:00 Uhr" */
export function localDayTime(utc: UtcIso, timeZone = PRACTICE_TIME_ZONE): string {
  const p = parts(utc, timeZone, { weekday: 'short', day: '2-digit', month: '2-digit' });
  const weekday = (p.weekday ?? '').replace('.', '');
  return `${weekday} ${p.day}.${p.month}., ${localTime(utc, timeZone)} Uhr`;
}

export function addMinutes(utc: UtcIso, minutes: number): UtcIso {
  return new Date(Date.parse(utc) + minutes * 60_000).toISOString();
}

export function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Abstand der Zeitzone zu UTC in ms zum gegebenen Zeitpunkt (CEST = +2h). */
function offsetMs(utcMs: number, timeZone: string): number {
  const p = parts(new Date(utcMs).toISOString(), timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Ortszeit (Kalendertag + "HH:MM") → UTC. Funktioniert über Sommer-/Winterzeit hinweg. */
export function localToUtc(date: IsoDate, time: string, timeZone = PRACTICE_TIME_ZONE): UtcIso {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, h!, min!);
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone)).toISOString();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Wochentag eines Kalendertags; Wochenende → null (keine Arbeitszeiten). */
export function weekdayOf(date: IsoDate): Weekday | null {
  const map: (Weekday | null)[] = [null, 'mo', 'di', 'mi', 'do', 'fr', null];
  return map[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? null;
}

export function minutesBetween(fromUtc: UtcIso, toUtc: UtcIso): number {
  return Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / 60_000);
}
