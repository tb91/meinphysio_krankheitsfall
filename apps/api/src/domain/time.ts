import type { IsoDate, UtcIso } from './types.js';

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
