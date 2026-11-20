import { describe, expect, it } from 'vitest';
import {
  createAuditLog,
  recordCancellation,
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
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'done', notifiedVia: 'phone', terminoSynced: true });
  });

  it('setzt "informiert" zurück, wenn die Entscheidung danach geändert wird', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    log = recordRebooking(log, { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:44:00Z', to });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'in_progress', notifiedVia: null, decision: { kind: 'rebooked' } });
  });

  it('folgt der Eintragsreihenfolge, auch wenn die Uhr zurückspringt (z. B. nach Neustart)', () => {
    let log = recordRebooking(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:40:32Z', to });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:40:24Z', channel: 'phone' });
    expect(deriveCaseState(log.entries).notifiedVia).toBe('phone');
  });

  it('liefert die IDs der gültigen Bestätigungen, damit sie zurückgenommen werden können', () => {
    let log = recordCancellation(createAuditLog(), { appointment: appt, locationName: 'Mitte', actor: lisa, at: '2026-09-07T05:41:00Z', reason: 'x' });
    log = recordNotification(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'phone' });
    log = recordTerminoSync(log, { appointment: appt, actor: lisa, at: '2026-09-07T05:43:00Z' });
    const state = deriveCaseState(log.entries);
    expect(state.notificationEntryId).toBe(log.entries[1]!.id);
    expect(state.terminoSyncEntryId).toBe(log.entries[2]!.id);

    // Eintrag entfernt (zurückgenommen) → wieder offen
    const withoutNotification = log.entries.filter((e) => e.id !== state.notificationEntryId);
    expect(deriveCaseState(withoutNotification)).toMatchObject({ notifiedVia: null, notificationEntryId: null, status: 'in_progress' });
  });

  it('ignoriert "informiert" ohne vorherige Entscheidung', () => {
    const log = recordNotification(createAuditLog(), { appointment: appt, actor: lisa, at: '2026-09-07T05:42:00Z', channel: 'sms' });
    expect(deriveCaseState(log.entries)).toMatchObject({ status: 'open', notifiedVia: null });
  });
});

describe('recommendContact', () => {
  const now = '2026-09-07T05:40:00Z';

  it('Termin in weniger als 2 h: anrufen', () => {
    expect(recommendContact({ startsAt: '2026-09-07T06:00:00Z', now, phone: '+49 151 1', email: 'a@b' })).toMatchObject({ channel: 'phone', urgent: true });
  });

  it('dringend ohne Telefon: E-Mail mit Warnung', () => {
    const r = recommendContact({ startsAt: '2026-09-07T07:40:00Z', now, phone: null, email: 'a@b' });
    expect(r.channel).toBe('email');
    expect(r.note).toBeTruthy();
  });

  it('später: SMS an Mobilnummer, Anruf bei Festnetz', () => {
    expect(recommendContact({ startsAt: '2026-09-07T12:00:00Z', now, phone: '+49 151 55011007', email: null }).channel).toBe('sms');
    expect(recommendContact({ startsAt: '2026-09-07T12:00:00Z', now, phone: '+49 30 1234567', email: null }).channel).toBe('phone');
  });
});

describe('composeMessage', () => {
  it('nennt keine Krankheit der Mitarbeiterin und enthält die Ortszeit', () => {
    const text = composeMessage({ patientName: 'Sabine Czerny', originalStartsAt: '2026-09-07T06:00:00Z', locationName: 'meinphysio+ Mitte', decision: { kind: 'cancelled' } });
    expect(text).toContain('08:00');
    expect(text.toLowerCase()).not.toContain('krank');
  });
});
