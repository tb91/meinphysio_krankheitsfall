import type { TerminoAppointment, UtcIso } from './types.js';

/**
 * Belegungsbuch: welche Therapeut:in ist wann belegt. Quelle sind die gebuchten Termino-Termine
 * plus alle Umbuchungen, die der Empfang in dieser Sitzung bereits entschieden hat.
 *
 * Unveränderlich: jede Reservierung liefert ein neues Ledger. Das macht Konflikte testbar und
 * verhindert, dass zwei Fälle denselben Slot "gleichzeitig" bekommen.
 */
export interface Reservation {
  practitionerId: string;
  startsAt: UtcIso;
  durationMin: number;
  source: 'termino' | 'rebooking';
  /** Termino-Termin-ID bzw. ID des umgebuchten Falls */
  refId: string;
}

export interface SlotLedger {
  readonly reservations: readonly Reservation[];
}

export interface ReservationRequest {
  practitionerId: string;
  startsAt: UtcIso;
  durationMin: number;
  /** ID des Falls (ursprünglicher Termin), der umgebucht wird */
  refId: string;
}

export type ReserveResult =
  | { ok: true; ledger: SlotLedger }
  | { ok: false; reason: 'conflict'; conflictsWith: Reservation };

interface Interval {
  practitionerId: string;
  startsAt: UtcIso;
  durationMin: number;
}

/** Halboffene Intervalle [start, end): angrenzende Slots überschneiden sich nicht. */
function overlaps(a: Interval, b: Interval): boolean {
  if (a.practitionerId !== b.practitionerId) return false;
  const aStart = Date.parse(a.startsAt);
  const bStart = Date.parse(b.startsAt);
  const aEnd = aStart + a.durationMin * 60_000;
  const bEnd = bStart + b.durationMin * 60_000;
  return aStart < bEnd && bStart < aEnd;
}

/** Nur `booked` belegt, `cancelled` gibt frei. */
export function createSlotLedger(appointments: readonly TerminoAppointment[]): SlotLedger {
  return {
    reservations: appointments
      .filter((a) => a.status === 'booked')
      .map((a) => ({
        practitionerId: a.practitioner_id,
        startsAt: a.starts_at,
        durationMin: a.duration_min,
        source: 'termino' as const,
        refId: a.id,
      })),
  };
}

/**
 * - Überschneidung (auch teilweise) mit bestehender Reservierung derselben Person → Konflikt
 * - direkt angrenzende Slots (Ende == Start) sind erlaubt
 * - erneute Reservierung für denselben `refId` verschiebt (alte Umbuchung wird freigegeben)
 */
export function reserve(ledger: SlotLedger, request: ReservationRequest): ReserveResult {
  // Eine frühere Umbuchung desselben Falls zählt nicht als Konflikt, sie wird ersetzt.
  const remaining = ledger.reservations.filter(
    (r) => !(r.source === 'rebooking' && r.refId === request.refId),
  );

  const conflict = remaining.find((r) => overlaps(r, request));
  if (conflict) return { ok: false, reason: 'conflict', conflictsWith: conflict };

  return {
    ok: true,
    ledger: { reservations: [...remaining, { ...request, source: 'rebooking' }] },
  };
}

export function isFree(
  ledger: SlotLedger,
  practitionerId: string,
  startsAt: UtcIso,
  durationMin: number,
): boolean {
  return !ledger.reservations.some((r) => overlaps(r, { practitionerId, startsAt, durationMin }));
}
