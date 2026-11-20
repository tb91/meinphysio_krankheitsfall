import { describe, expect, it } from 'vitest';
import { createSlotLedger } from './slotLedger.js';
import { suggestReplacements, type SuggestionInput } from './suggestions.js';
import { localToUtc } from './time.js';
import type { Therapeut } from './types.js';
import { appointment } from '../test-support/fixtures.js';

const MITTE = 'praxis-mitte';
const KREUZBERG = 'praxis-kreuzberg';

function therapeut(id: string, quali: Therapeut['qualifikationen'], praxis: string, von = '08:00', bis = '12:00'): Therapeut {
  const day = [{ von, bis, praxis_id: praxis }];
  return {
    id,
    vorname: id,
    nachname: 'Test',
    qualifikationen: quali,
    termino_practitioner_id: id,
    arbeitszeiten: { mo: day, di: day, mi: day, do: day, fr: day },
  };
}

const jonas = therapeut('prac_jonas', ['KG', 'MT'], MITTE);
const nurKgg = therapeut('prac_kgg', ['KGG'], MITTE);
const kreuzberg = therapeut('prac_xb', ['KG'], KREUZBERG);

// Annas KG-Termin Mo 07.09., 08:00 Uhr in Mitte; jetzt ist es 07:40 Uhr.
const annaTermin = appointment({ id: 'apt_anna', starts_at: '2026-09-07T06:00:00Z' });

function input(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    appointment: annaTermin,
    serviceCode: 'KG',
    praxisId: MITTE,
    therapeuten: [jonas, nurKgg, kreuzberg],
    ledger: createSlotLedger([]),
    patientBusy: [],
    now: '2026-09-07T05:40:00Z',
    ...overrides,
  };
}

describe('localToUtc', () => {
  it('rechnet Sommer- und Winterzeit korrekt um', () => {
    expect(localToUtc('2026-09-07', '08:00')).toBe('2026-09-07T06:00:00.000Z');
    expect(localToUtc('2026-12-07', '08:00')).toBe('2026-12-07T07:00:00.000Z');
  });
});

describe('suggestReplacements', () => {
  it('schlägt zuerst dieselbe Uhrzeit bei einer Kolleg:in am selben Standort vor', () => {
    const [first] = suggestReplacements(input());
    expect(first).toMatchObject({ practitionerId: 'prac_jonas', startsAt: '2026-09-07T06:00:00.000Z', sameSlot: true });
  });

  it('berücksichtigt nur passende Qualifikation und denselben Standort', () => {
    const ids = new Set(suggestReplacements(input()).map((s) => s.practitionerId));
    expect(ids).toEqual(new Set(['prac_jonas']));
  });

  it('überspringt belegte Slots und verlangt bei Uhrzeitwechsel 60 Min. Vorlauf', () => {
    const ledger = createSlotLedger([appointment({ practitioner_id: 'prac_jonas', starts_at: '2026-09-07T06:00:00Z' })]);
    const [first] = suggestReplacements(input({ ledger }));
    expect(first?.sameSlot).toBe(false);
    expect(first?.startsAt).toBe('2026-09-07T06:40:00.000Z'); // 08:40 Uhr = jetzt + 60 Min.
  });

  it('schlägt keinen Slot vor, an dem die Patient:in schon einen anderen Termin hat', () => {
    const suggestions = suggestReplacements(input({ patientBusy: [{ startsAt: '2026-09-07T06:00:00Z', durationMin: 20 }] }));
    expect(suggestions.some((s) => s.startsAt === '2026-09-07T06:00:00.000Z')).toBe(false);
  });

  it('markiert Vorschläge nach der Verordnungsfrist und sortiert sie nach hinten', () => {
    const ledger = createSlotLedger(
      // Jonas ist am Montag komplett belegt
      Array.from({ length: 12 }, (_, i) =>
        appointment({ practitioner_id: 'prac_jonas', starts_at: new Date(Date.parse('2026-09-07T06:00:00Z') + i * 20 * 60_000).toISOString() }),
      ),
    );
    const suggestions = suggestReplacements(input({ ledger, deadline: '2026-09-07' }));
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => s.afterDeadline)).toBe(true);
  });

  it('liefert höchstens zwei Vorschläge pro Therapeut:in (plus gleiche Uhrzeit)', () => {
    const suggestions = suggestReplacements(input());
    expect(suggestions.filter((s) => !s.sameSlot && s.practitionerId === 'prac_jonas').length).toBeLessThanOrEqual(2);
  });

  it('bevorzugt Slots nahe der ursprünglichen Uhrzeit vor früheren Slots', () => {
    // Termin um 11:00 Uhr (09:00Z), Jonas ist um 11:00 belegt
    const spaet = appointment({ id: 'apt_spaet', starts_at: '2026-09-07T09:00:00Z' });
    const ledger = createSlotLedger([appointment({ practitioner_id: 'prac_jonas', starts_at: '2026-09-07T09:00:00Z' })]);
    const [first] = suggestReplacements(input({ appointment: spaet, ledger }));
    expect(['2026-09-07T08:40:00.000Z', '2026-09-07T09:20:00.000Z']).toContain(first?.startsAt);
  });

  it('liefert nichts, wenn Leistung oder Standort unbekannt sind', () => {
    expect(suggestReplacements(input({ serviceCode: null }))).toEqual([]);
    expect(suggestReplacements(input({ praxisId: null }))).toEqual([]);
  });
});
