import { NotImplementedError, type TerminoAppointment, type UtcIso } from './types.js';

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

/** Baut das Ledger aus dem Export. Nur `booked` belegt, `cancelled` gibt frei. */
export function createSlotLedger(_appointments: readonly TerminoAppointment[]): SlotLedger {
  throw new NotImplementedError('createSlotLedger');
}

/**
 * Reserviert einen Slot für eine Umbuchung.
 * - Überschneidung (auch teilweise) mit bestehender Reservierung derselben Person → Konflikt
 * - direkt angrenzende Slots (Ende == Start) sind erlaubt
 * - erneute Reservierung für denselben `refId` verschiebt (alte Reservierung wird freigegeben)
 */
export function reserve(_ledger: SlotLedger, _request: ReservationRequest): ReserveResult {
  throw new NotImplementedError('reserve');
}

export function isFree(
  _ledger: SlotLedger,
  _practitionerId: string,
  _startsAt: UtcIso,
  _durationMin: number,
): boolean {
  throw new NotImplementedError('isFree');
}
