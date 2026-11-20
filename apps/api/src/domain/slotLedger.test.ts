// Anforderung 2: Ein Slot, auf den umgebucht wurde, ist sofort belegt und kann nicht doppelt vergeben werden.
import { beforeAll, describe, expect, it } from 'vitest';
import { createSlotLedger, isFree, reserve, type SlotLedger } from './slotLedger.js';
import { appointment } from '../test-support/fixtures.js';

const MELTEM = 'prac_05';
const JONAS = 'prac_02';
const SLOT = '2026-09-07T09:00:00Z'; // 11:00 Berlin

function mustReserve(ledger: SlotLedger, refId: string, startsAt = SLOT, durationMin = 20, practitionerId = MELTEM) {
  const res = reserve(ledger, { practitionerId, startsAt, durationMin, refId });
  if (!res.ok) throw new Error(`unerwarteter Konflikt mit ${res.conflictsWith.refId}`);
  return res.ledger;
}

describe('reserve: Doppelbelegung verhindern', () => {
  let empty: SlotLedger;
  beforeAll(() => {
    empty = createSlotLedger([]);
  });

  it('belegt den Slot unmittelbar nach der ersten Umbuchung', () => {
    expect(isFree(empty, MELTEM, SLOT, 20)).toBe(true);
    const after = mustReserve(empty, 'apt_006541');
    expect(isFree(after, MELTEM, SLOT, 20)).toBe(false);
  });

  it('lehnt eine zweite Umbuchung auf denselben Slot ab und nennt den Konfliktfall', () => {
    const after = mustReserve(empty, 'apt_006541');
    const second = reserve(after, { practitionerId: MELTEM, startsAt: SLOT, durationMin: 20, refId: 'apt_006658' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.conflictsWith.refId).toBe('apt_006541');
  });

  it('erkennt auch teilweise Überschneidungen (40-Min.-MLD über einen 20-Min.-Slot)', () => {
    const after = mustReserve(empty, 'apt_kg', '2026-09-07T09:20:00Z', 20);
    const mld = reserve(after, { practitionerId: MELTEM, startsAt: SLOT, durationMin: 40, refId: 'apt_mld' });
    expect(mld.ok).toBe(false);
  });

  it('erlaubt direkt angrenzende Slots (Ende == Beginn)', () => {
    const after = mustReserve(empty, 'apt_1', SLOT, 20);
    const next = reserve(after, { practitionerId: MELTEM, startsAt: '2026-09-07T09:20:00Z', durationMin: 20, refId: 'apt_2' });
    expect(next.ok).toBe(true);
  });

  it('erlaubt dieselbe Uhrzeit bei einer anderen Therapeut:in', () => {
    const after = mustReserve(empty, 'apt_1');
    expect(isFree(after, JONAS, SLOT, 20)).toBe(true);
  });

  it('verschiebt bei erneuter Umbuchung desselben Falls statt zwei Slots zu blockieren', () => {
    const first = mustReserve(empty, 'apt_006541', SLOT);
    const moved = mustReserve(first, 'apt_006541', '2026-09-07T10:00:00Z');
    expect(isFree(moved, MELTEM, SLOT, 20)).toBe(true);
    expect(isFree(moved, MELTEM, '2026-09-07T10:00:00Z', 20)).toBe(false);
    expect(moved.reservations.filter((r) => r.refId === 'apt_006541')).toHaveLength(1);
  });

  it('verändert das ursprüngliche Ledger nicht (unveränderlich)', () => {
    mustReserve(empty, 'apt_1');
    expect(empty.reservations).toHaveLength(0);
    expect(isFree(empty, MELTEM, SLOT, 20)).toBe(true);
  });
});

describe('createSlotLedger: Belegung aus Termino', () => {
  it('blockiert Slots, die in Termino gebucht sind', () => {
    const ledger = createSlotLedger([appointment({ id: 'apt_x', practitioner_id: MELTEM, starts_at: SLOT })]);
    const res = reserve(ledger, { practitionerId: MELTEM, startsAt: SLOT, durationMin: 20, refId: 'apt_006541' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflictsWith.source).toBe('termino');
  });

  it('gibt stornierte Termino-Termine frei', () => {
    const ledger = createSlotLedger([
      appointment({ practitioner_id: MELTEM, starts_at: SLOT, status: 'cancelled' }),
    ]);
    expect(isFree(ledger, MELTEM, SLOT, 20)).toBe(true);
  });
});
