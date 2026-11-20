// Anforderung 1: Die Arbeitsliste ist nach Startzeit sortiert. In dieser Reihenfolge arbeitet der Empfang ab.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorklist, type WorklistItem } from './worklist.js';
import { ANNA, AUSFALLTAG, appointment, loadExport0805 } from '../test-support/fixtures.js';

const query = { practitionerId: ANNA, date: AUSFALLTAG };

describe('buildWorklist: echte Daten, Annas Ausfall am 07.09.2026', () => {
  const { appointments } = loadExport0805();
  let list: WorklistItem[];
  beforeAll(() => {
    list = buildWorklist(appointments, query);
  });

  it('enthält genau Annas 14 gebuchte Termine des Tages', () => {
    expect(list).toHaveLength(14);
  });

  it('ist streng aufsteigend nach Startzeit sortiert', () => {
    const starts = list.map((i) => Date.parse(i.startsAt));
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
    }
  });

  it('beginnt mit dem 08:00-Termin und endet mit dem 17:00-Termin (Ortszeit)', () => {
    expect(list[0]?.appointmentId).toBe('apt_006541'); // 06:00Z = 08:00 Berlin, Mitte
    expect(list.at(-1)?.appointmentId).toBe('apt_004880'); // 15:00Z = 17:00 Berlin, Kreuzberg
  });

  it('nummeriert die Positionen lückenlos ab 1', () => {
    expect(list.map((i) => i.position)).toEqual(Array.from({ length: 14 }, (_, k) => k + 1));
  });

  it('lässt stornierte Termine weg (apt_002941, Peter Albrecht)', () => {
    expect(list.map((i) => i.appointmentId)).not.toContain('apt_002941');
  });

  it('listet beide Termine von Marek Kowalski, da beide umgebucht/abgesagt werden müssen', () => {
    expect(list.filter((i) => i.patientName === 'Marek Kowalski')).toHaveLength(2);
  });

  it('liefert dieselbe Reihenfolge unabhängig von der Reihenfolge im Export', () => {
    const reversed = buildWorklist([...appointments].reverse(), query);
    expect(reversed.map((i) => i.appointmentId)).toEqual(list.map((i) => i.appointmentId));
  });
});

describe('buildWorklist: Randfälle', () => {
  it('sortiert bei gleicher Startzeit deterministisch nach Termin-ID', () => {
    const b = appointment({ id: 'apt_b', starts_at: '2026-09-07T07:00:00Z' });
    const a = appointment({ id: 'apt_a', starts_at: '2026-09-07T07:00:00Z' });
    const early = appointment({ id: 'apt_z', starts_at: '2026-09-07T06:00:00Z' });
    expect(buildWorklist([b, a, early], query).map((i) => i.appointmentId)).toEqual([
      'apt_z',
      'apt_a',
      'apt_b',
    ]);
  });

  it('ordnet den Tag nach Berliner Ortszeit zu, nicht nach UTC', () => {
    const kurzNachMitternacht = appointment({ id: 'apt_in', starts_at: '2026-09-06T22:30:00Z' }); // 00:30 am 07.09.
    const spaetAbends = appointment({ id: 'apt_out', starts_at: '2026-09-07T22:30:00Z' }); // 00:30 am 08.09.
    const ids = buildWorklist([kurzNachMitternacht, spaetAbends], query).map((i) => i.appointmentId);
    expect(ids).toEqual(['apt_in']);
  });

  it('ignoriert Termine anderer Therapeut:innen', () => {
    const fremd = appointment({ practitioner_id: 'prac_02' });
    expect(buildWorklist([fremd], query)).toEqual([]);
  });

  it('berechnet das Ende aus der Dauer', () => {
    const mld = appointment({ starts_at: '2026-09-07T12:40:00Z', duration_min: 40 });
    expect(buildWorklist([mld], query)[0]?.endsAt).toBe('2026-09-07T13:20:00.000Z');
  });
});
