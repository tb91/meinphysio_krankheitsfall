import { isFree, type SlotLedger } from './slotLedger.js';
import { addDays, localDate, localToUtc, weekdayOf } from './time.js';
import type { IsoDate, ServiceCode, TerminoAppointment, Therapeut, UtcIso } from './types.js';

/**
 * Ersatz-Vorschläge für einen ausgefallenen Termin.
 *
 * Reihenfolge der Präferenz:
 * 1. Gleiche Uhrzeit, gleicher Standort, andere Therapeut:in → für Patient:in ändert sich fast nichts.
 * 2. Andere Uhrzeit am selben Standort, möglichst nah an der ursprünglichen Zeit
 *    (heute oder an den Folgetagen, innerhalb des Export-Fensters).
 *
 * Bewusst nicht: Standortwechsel (Patient:innen kommen zu "ihrer" Praxis) und Anna selbst
 * an Folgetagen (Dauer der Krankheit unbekannt).
 */
export interface Suggestion {
  practitionerId: string;
  practitionerName: string;
  startsAt: UtcIso;
  durationMin: number;
  sameSlot: boolean;
  /** Termin läge nach der Frist für den Behandlungsbeginn der Verordnung */
  afterDeadline: boolean;
  reasons: string[];
}

export interface Interval {
  startsAt: UtcIso;
  durationMin: number;
}

export interface SuggestionInput {
  appointment: TerminoAppointment;
  serviceCode: ServiceCode | null;
  /** Interne Praxis-ID des Standorts des Termins */
  praxisId: string | null;
  therapeuten: readonly Therapeut[];
  ledger: SlotLedger;
  /** Andere Termine derselben Patient:in, die nicht überlappen dürfen */
  patientBusy: readonly Interval[];
  now: UtcIso;
  /** Wie viele Kalendertage ab dem Termintag durchsucht werden */
  searchDays?: number;
  /** Letzter zulässiger Tag (z. B. Behandlungsbeginn laut Verordnung) */
  deadline?: IsoDate | null;
  limit?: number;
}

const SLOT_STEP_MIN = 20;
/** Eine Verlegung auf eine andere Uhrzeit braucht Vorlauf, damit die Patient:in es schafft. */
export const MIN_LEAD_FOR_TIME_CHANGE_MIN = 60;
const MAX_PER_THERAPIST = 2;

function overlaps(a: Interval, b: Interval): boolean {
  const aStart = Date.parse(a.startsAt);
  const bStart = Date.parse(b.startsAt);
  return aStart < bStart + b.durationMin * 60_000 && bStart < aStart + a.durationMin * 60_000;
}

export function suggestReplacements(input: SuggestionInput): Suggestion[] {
  const { appointment: a, serviceCode, praxisId } = input;
  if (!serviceCode || !praxisId) return [];

  const searchDays = input.searchDays ?? 5;
  const limit = input.limit ?? 8;
  const duration = a.duration_min;
  const originalStart = Date.parse(a.starts_at);
  const now = Date.parse(input.now);
  const firstDay = localDate(a.starts_at);

  const found: Suggestion[] = [];

  for (let i = 0; i < searchDays; i++) {
    const date = addDays(firstDay, i);
    const weekday = weekdayOf(date);
    if (!weekday) continue;

    for (const t of input.therapeuten) {
      if (t.termino_practitioner_id === a.practitioner_id) continue;
      if (!t.qualifikationen.includes(serviceCode)) continue;

      for (const iv of t.arbeitszeiten[weekday] ?? []) {
        if (iv.praxis_id !== praxisId) continue;
        const ivStart = Date.parse(localToUtc(date, iv.von));
        const ivEnd = Date.parse(localToUtc(date, iv.bis));

        for (let s = ivStart; s + duration * 60_000 <= ivEnd; s += SLOT_STEP_MIN * 60_000) {
          const sameSlot = s === originalStart;
          const lead = sameSlot ? 0 : MIN_LEAD_FOR_TIME_CHANGE_MIN;
          if (s < now + lead * 60_000) continue;

          const startsAt = new Date(s).toISOString();
          if (!isFree(input.ledger, t.termino_practitioner_id, startsAt, duration)) continue;
          if (input.patientBusy.some((b) => overlaps(b, { startsAt, durationMin: duration }))) continue;

          found.push({
            practitionerId: t.termino_practitioner_id,
            practitionerName: `${t.vorname} ${t.nachname}`,
            startsAt,
            durationMin: duration,
            sameSlot,
            afterDeadline: !!input.deadline && date > input.deadline,
            reasons: [
              `darf ${serviceCode}`,
              `arbeitet ${iv.von}–${iv.bis} an diesem Standort`,
              'laut Termino und bisherigen Umbuchungen frei',
            ],
          });
        }
      }
    }
  }

  // Nächstliegend zur ursprünglichen Uhrzeit zuerst: Die Patient:in hat sich den Termin
  // so eingeplant. Ein 14-Uhr-Termin wird eher 15 Uhr als 8:40 Uhr.
  const distance = (s: Suggestion) => Math.abs(Date.parse(s.startsAt) - originalStart);
  found.sort(
    (x, y) =>
      Number(y.sameSlot) - Number(x.sameSlot) ||
      Number(x.afterDeadline) - Number(y.afterDeadline) ||
      distance(x) - distance(y) ||
      Date.parse(x.startsAt) - Date.parse(y.startsAt) ||
      x.practitionerId.localeCompare(y.practitionerId),
  );

  // Vielfalt: pro Therapeut:in höchstens zwei Vorschläge (gleiche Uhrzeit zählt immer).
  const perTherapist = new Map<string, number>();
  const result: Suggestion[] = [];
  for (const s of found) {
    const n = perTherapist.get(s.practitionerId) ?? 0;
    if (!s.sameSlot && n >= MAX_PER_THERAPIST) continue;
    perTherapist.set(s.practitionerId, n + 1);
    result.push(s);
    if (result.length >= limit) break;
  }
  return result;
}
