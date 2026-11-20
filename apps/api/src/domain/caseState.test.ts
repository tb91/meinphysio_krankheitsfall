import { describe, expect, it } from 'vitest';
import {
  createAuditLog,
  recordCancellation,
  recordFailedCallAttempt,
  recordNotification,
  recordRebooking,
  recordTerminoSync,
  type Actor,
} from './auditLog.js';
import { deriveCaseState } from './caseState.js';
import { composeMessage, recommendContact } from './contact.js';
import { appointment } from '../test-support/fixtures.js';

const lisa: Actor = { kind: 'reception', name: 'Lisa' };
const appt = appointment({ id: 'apt_1', starts_at: '2026-09-07T06:00:00Z' });
const to = { practitionerId: 'prac_02', practitionerName: 'Jonas Brandt', startsAt: '2026-09-07T06:00:00Z', locationName: 'Mitte' };

describe('deriveCaseState', () => {
  it('ist offen ohne Einträge', () => {
    expect(deriveCaseState([]).status).toBe('open');
  });

  it('durchläuft Entscheidung → informiert → Termino', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'in_progress', decision: { kind: 'cancelled' } });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'phone' });
    log = recordTerminoSync(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:43:00Z' });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'done', notifiedChannels: ['phone'], informed: true, terminoSynced: true });
  });

  it('setzt "informiert" zurück, wenn die Entscheidung danach geändert wird', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    log = recordRebooking(log, { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:44:00Z', to });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'in_progress', notifiedChannels: [], decision: { kind: 'rebooked' } });
  });

  it('folgt der Eintragsreihenfolge, auch wenn die Uhr zurückspringt (z. B. nach Neustart)', () => {
    let log = recordRebooking(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:40:32Z', to });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:40:24Z', channel: 'phone' });
    expect(deriveCaseState(log.entries).notifiedChannels).toEqual(['phone']);
  });

  it('liefert die IDs der gültigen Bestätigungen, damit sie zurückgenommen werden können', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'phone' });
    log = recordTerminoSync(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:43:00Z' });
    const state = deriveCaseState(log.entries);
    expect(state.notificationEntryIds.phone).toBe(log.entries[1]!.id);
    expect(state.terminoSyncEntryId).toBe(log.entries[2]!.id);

    // Eintrag entfernt (zurückgenommen) → wieder offen
    const withoutNotification = log.entries.filter((e) => e.id !== state.notificationEntryIds.phone);
    expect(deriveCaseState(withoutNotification)).toMatchObject({ notifiedChannels: [], notificationEntryIds: {}, informed: false, status: 'in_progress' });
  });

  it('zählt erfolglose Anrufe; sie bleiben bestehen, auch wenn danach per SMS informiert wird', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordFailedCallAttempt(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z' });
    log = recordFailedCallAttempt(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:44:00Z' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:45:00Z', channel: 'sms' });
    expect(deriveCaseState(log.entries)).toMatchObject({ failedCallAttempts: 2, notifiedChannels: ['sms'] });
    expect(log.entries.filter((e) => e.action === 'call_attempt_failed')).toHaveLength(2);
    expect(log.entries[1]!.message).toContain('nicht erreicht');
  });

  it('setzt die Anrufversuche bei einer neuen Entscheidung zurück', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordFailedCallAttempt(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z' });
    log = recordRebooking(log, { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:43:00Z', to });
    expect(deriveCaseState(log.entries).failedCallAttempts).toBe(0);
  });

  it('schriftlich gilt erst als informiert, wenn SMS und E-Mail bestätigt sind', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    expect(deriveCaseState(log.entries).informed).toBe(false);
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:43:00Z', channel: 'email' });
    expect(deriveCaseState(log.entries)).toMatchObject({ informed: true, notifiedChannels: ['sms', 'email'] });
  });

  it('ohne E-Mail-Adresse reicht die SMS', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    expect(deriveCaseState(log.entries, ['sms']).informed).toBe(true);
  });

  it('ignoriert "informiert" ohne vorherige Entscheidung', () => {
    const log = recordNotification(createAuditLog(), { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'open', notifiedChannels: [] });
  });
});

describe('recommendContact', () => {
  const now = '2026-09-07T05:40:00Z';
  const soon = '2026-09-07T06:00:00Z'; // in 20 Min.
  const later = '2026-09-07T12:00:00Z'; // in > 2 h

  it('Termin in ≤ 2 h: erst Anruf, dann SMS + E-Mail', () => {
    const r = recommendContact({ startsAt: soon, now, phone: '+49 151 1', email: 'a@b' });
    expect(r).toMatchObject({ urgent: true, steps: [['phone'], ['sms', 'email']], next: ['phone'] });
  });

  it('telefonisch nicht erreicht: als Nächstes SMS + E-Mail', () => {
    const r = recommendContact({ startsAt: soon, now, phone: '+49 151 1', email: 'a@b', failedCallAttempts: 1 });
    expect(r.next).toEqual(['sms', 'email']);
    expect(r.note).toContain('nicht erreicht');
  });

  it('dringend ohne Telefon: E-Mail mit Warnung', () => {
    const r = recommendContact({ startsAt: '2026-09-07T07:40:00Z', now, phone: null, email: 'a@b' });
    expect(r.next).toEqual(['email']);
    expect(r.note).toBeTruthy();
  });

  it('Termin in > 2 h: immer SMS + E-Mail, auch an Festnetznummern', () => {
    expect(recommendContact({ startsAt: later, now, phone: '+49 30 1234567', email: 'a@b' })).toMatchObject({
      urgent: false,
      steps: [['sms', 'email']],
      next: ['sms', 'email'],
    });
  });

  it('nutzt nur vorhandene Kanäle', () => {
    expect(recommendContact({ startsAt: later, now, phone: null, email: 'a@b' }).next).toEqual(['email']);
    expect(recommendContact({ startsAt: later, now, phone: '+49 151 1', email: null }).next).toEqual(['sms']);
  });
});

describe('composeMessage', () => {
  it('nennt keine Krankheit der Mitarbeiterin und enthält die Ortszeit', () => {
    const text = composeMessage({ patientName: 'Sabine Czerny', originalStartsAt: '2026-09-07T06:00:00Z', locationName: 'meinphysio+ Mitte', decision: { kind: 'cancelled' } });
    expect(text).toContain('08:00');
    expect(text.toLowerCase()).not.toContain('krank');
  });
});
