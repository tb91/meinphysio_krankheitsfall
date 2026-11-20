import type { ContactChannel } from './caseState.js';
import { localDayTime, minutesBetween } from './time.js';
import type { UtcIso } from './types.js';

/**
 * Welcher Kanal für welche Patient:in? Entscheidend ist, ob die Nachricht rechtzeitig ankommt.
 * - Termin in ≤ 2 h: anrufen. Eine E-Mail wird so kurzfristig oft nicht gelesen.
 * - Später: SMS an Mobilnummern, sonst Anruf; ohne Telefon E-Mail.
 */
export const URGENT_THRESHOLD_MIN = 120;

export interface ContactRecommendation {
  channel: ContactChannel | null;
  urgent: boolean;
  minutesUntilStart: number;
  note: string | null;
}

export function isMobileNumber(phone: string): boolean {
  return /^\+49\s?1[5-7]/.test(phone.trim()) || /^01[5-7]/.test(phone.trim());
}

export function recommendContact(input: {
  startsAt: UtcIso;
  now: UtcIso;
  phone: string | null;
  email: string | null;
}): ContactRecommendation {
  const minutesUntilStart = minutesBetween(input.now, input.startsAt);
  const urgent = minutesUntilStart <= URGENT_THRESHOLD_MIN;
  const { phone, email } = input;

  if (urgent) {
    if (phone) return { channel: 'phone', urgent, minutesUntilStart, note: null };
    if (email) {
      return {
        channel: 'email',
        urgent,
        minutesUntilStart,
        note: 'Keine Telefonnummer. Eine E-Mail kommt so kurzfristig evtl. nicht an: Patient:in am Empfang abfangen.',
      };
    }
    return { channel: null, urgent, minutesUntilStart, note: 'Keine Kontaktdaten: Patient:in am Empfang abfangen.' };
  }

  if (phone) {
    return isMobileNumber(phone)
      ? { channel: 'sms', urgent, minutesUntilStart, note: null }
      : { channel: 'phone', urgent, minutesUntilStart, note: 'Festnetznummer, daher Anruf statt SMS.' };
  }
  if (email) return { channel: 'email', urgent, minutesUntilStart, note: null };
  return { channel: null, urgent, minutesUntilStart, note: 'Keine Kontaktdaten hinterlegt.' };
}

/**
 * Textvorschlag für Anruf/SMS/E-Mail. Grund wird neutral formuliert
 * (Gesundheitsdaten der Mitarbeiterin gehen Patient:innen nichts an).
 */
export function composeMessage(input: {
  patientName: string;
  originalStartsAt: UtcIso;
  locationName: string;
  decision:
    | { kind: 'cancelled' }
    | { kind: 'rebooked'; practitionerName: string; startsAt: UtcIso; sameSlot: boolean };
}): string {
  const greeting = `Guten Tag ${input.patientName},`;
  const original = `Ihr Termin am ${localDayTime(input.originalStartsAt)} bei ${input.locationName}`;
  const sign = 'Viele Grüße, Ihr Team von meinphysio+';

  if (input.decision.kind === 'cancelled') {
    return `${greeting} ${original} muss leider kurzfristig ausfallen, da Ihre Therapeutin verhindert ist. Bitte melden Sie sich bei uns, damit wir einen neuen Termin finden. ${sign}`;
  }
  if (input.decision.sameSlot) {
    return `${greeting} ${original} findet wie geplant statt, allerdings bei ${input.decision.practitionerName}, da Ihre Therapeutin heute verhindert ist. ${sign}`;
  }
  return `${greeting} ${original} muss leider verlegt werden, da Ihre Therapeutin verhindert ist. Neuer Termin: ${localDayTime(input.decision.startsAt)} bei ${input.decision.practitionerName}. Passt das nicht, rufen Sie uns bitte an. ${sign}`;
}
