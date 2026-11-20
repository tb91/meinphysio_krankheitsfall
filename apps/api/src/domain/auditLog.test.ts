// Anforderung 4: Nachvollziehbares Protokoll: "Patient:in A wurde von Empfang B um Uhrzeit X abgesagt."
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditEntry,
  createAuditLog,
  entriesForAppointment,
  InvalidAuditEntryError,
  recordCancellation,
  recordRebooking,
  type Actor,
} from './auditLog.js';
import { appointment } from '../test-support/fixtures.js';

const lisa: Actor = { kind: 'reception', name: 'Lisa Hartmann' };

// Sabine Czerny, 08:00 Uhr Mitte (entspricht apt_006541)
const czerny = appointment({
  id: 'apt_006541',
  starts_at: '2026-09-07T06:00:00Z',
  patient: {
    id: 'pat_02026',
    name: 'Sabine Czerny',
    birth_date: '1953-09-20',
    phone: '+49 151 55011007',
    email: 'sabine.czerny@example.com',
  },
});

const cancelAt = '2026-09-07T05:52:00Z'; // 07:52 Uhr Berlin

describe('recordCancellation', () => {
  let entry: AuditEntry;
  beforeAll(() => {
    const log = recordCancellation(createAuditLog(), {
      appointment: czerny,
      locationName: 'meinphysio+ Mitte',
      actor: lisa,
      at: cancelAt,
      reason: 'Therapeutin erkrankt, kein Ersatz verfügbar',
    });
    entry = log.entries[0]!;
  });

  it('hält fest, wer, wann, was, welcher Termin und welche Patient:in', () => {
    expect(entry).toMatchObject({
      action: 'appointment_cancelled',
      actor: lisa,
      at: cancelAt,
      appointmentId: 'apt_006541',
      patientName: 'Sabine Czerny',
      terminoPatientId: 'pat_02026',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.details).toMatchObject({ reason: 'Therapeutin erkrankt, kein Ersatz verfügbar' });
  });

  it('erzeugt einen lesbaren Satz mit Patient:in, Empfang und Uhrzeit in Ortszeit', () => {
    expect(entry.message).toContain('Sabine Czerny');
    expect(entry.message).toContain('Lisa Hartmann');
    expect(entry.message).toContain('abgesagt');
    expect(entry.message).toContain('07:52'); // Entscheidungszeitpunkt, Berlin
    expect(entry.message).toContain('08:00'); // ursprünglicher Termin, Berlin
    expect(entry.message).not.toContain('05:52'); // keine UTC-Zeit im Text
  });

  it('lehnt Einträge ohne Namen am Empfang ab (keine anonymen Entscheidungen)', () => {
    expect(() =>
      recordCancellation(createAuditLog(), {
        appointment: czerny,
        locationName: 'meinphysio+ Mitte',
        actor: { kind: 'reception', name: '  ' },
        at: cancelAt,
        reason: 'x',
      }),
    ).toThrow(InvalidAuditEntryError);
  });

  it('lehnt ungültige Zeitpunkte ab', () => {
    expect(() =>
      recordCancellation(createAuditLog(), {
        appointment: czerny,
        locationName: 'meinphysio+ Mitte',
        actor: lisa,
        at: 'gestern',
        reason: 'x',
      }),
    ).toThrow(InvalidAuditEntryError);
  });
});

describe('recordRebooking', () => {
  it('protokolliert alten und neuen Slot inklusive Ersatz-Therapeut:in', () => {
    const log = recordRebooking(createAuditLog(), {
      appointment: czerny,
      locationName: 'meinphysio+ Mitte',
      actor: lisa,
      at: cancelAt,
      to: {
        practitionerId: 'prac_05',
        practitionerName: 'Meltem Aydin',
        startsAt: '2026-09-07T09:00:00Z',
        locationName: 'meinphysio+ Mitte',
      },
    });
    const entry = log.entries[0]!;
    expect(entry.action).toBe('appointment_rebooked');
    expect(entry.details).toMatchObject({
      from: { practitionerId: 'prac_01', startsAt: '2026-09-07T06:00:00Z' },
      to: { practitionerId: 'prac_05', startsAt: '2026-09-07T09:00:00Z' },
    });
    expect(entry.message).toContain('Meltem Aydin');
    expect(entry.message).toContain('11:00'); // neuer Termin in Ortszeit
    expect(entry.message).toContain('Lisa Hartmann');
  });
});

describe('Audit-Log ist append-only und abfragbar', () => {
  it('verändert das bestehende Log nicht, sondern liefert ein neues', () => {
    const empty = createAuditLog();
    const one = recordCancellation(empty, {
      appointment: czerny,
      locationName: 'meinphysio+ Mitte',
      actor: lisa,
      at: cancelAt,
      reason: 'x',
    });
    expect(empty.entries).toHaveLength(0);
    expect(one.entries).toHaveLength(1);
  });

  it('liefert den Verlauf eines Termins chronologisch, auch bei Korrektur (erst umgebucht, dann abgesagt)', () => {
    let log = createAuditLog();
    log = recordRebooking(log, {
      appointment: czerny,
      locationName: 'meinphysio+ Mitte',
      actor: lisa,
      at: '2026-09-07T05:45:00Z',
      to: { practitionerId: 'prac_05', practitionerName: 'Meltem Aydin', startsAt: '2026-09-07T09:00:00Z', locationName: 'meinphysio+ Mitte' },
    });
    log = recordCancellation(log, {
      appointment: appointment({ id: 'apt_andere' }),
      locationName: 'meinphysio+ Mitte',
      actor: lisa,
      at: '2026-09-07T05:47:00Z',
      reason: 'x',
    });
    log = recordCancellation(log, {
      appointment: czerny,
      locationName: 'meinphysio+ Mitte',
      actor: { kind: 'reception', name: 'Tom Berger' },
      at: '2026-09-07T05:50:00Z',
      reason: 'Patientin kann nicht um 11 Uhr',
    });

    const history = entriesForAppointment(log, 'apt_006541');
    expect(history.map((e) => e.action)).toEqual(['appointment_rebooked', 'appointment_cancelled']);
    expect(history.map((e) => e.actor.name)).toEqual(['Lisa Hartmann', 'Tom Berger']);
  });
});
