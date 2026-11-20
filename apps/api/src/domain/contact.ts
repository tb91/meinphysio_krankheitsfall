import type { ContactChannel } from './caseState.js';
import { localDayTime, minutesBetween } from './time.js';
import type { UtcIso } from './types.js';

/**
 * Wie wird eine Patient:in informiert? Entscheidend ist, ob die Nachricht rechtzeitig ankommt.
 * - Termin in ≤ 2 h: erst Anruf, bei "nicht erreicht" schriftlich.
 *   Eine E-Mail allein wird so kurzfristig oft nicht gelesen.
 * - Termin in > 2 h: direkt schriftlich.
 * Schriftlich heißt immer SMS UND E-Mail (soweit vorhanden), nicht entweder/oder.
 * SMS auch an Festnetznummern: viele Anbieter lesen sie dort vor.
 */
export const URGENT_THRESHOLD_MIN = 120;

export interface ContactRecommendation {
  /** Stufen in Prioritätsreihenfolge, z. B. [['phone'], ['sms', 'email']] */
  steps: ContactChannel[][];
  /** Was jetzt zu tun ist (eine Stufe; mehrere Kanäle = alle davon) */
  next: ContactChannel[];
  /** Schriftliche Kanäle, die für diese Patient:in verfügbar sind */
  written: ContactChannel[];
  urgent: boolean;
  minutesUntilStart: number;
  note: string | null;
}

export function writtenChannels(phone: string | null, email: string | null): ContactChannel[] {
  return [...(phone ? (['sms'] as const) : []), ...(email ? (['email'] as const) : [])];
}

export function recommendContact(input: {
  startsAt: UtcIso;
  now: UtcIso;
  phone: string | null;
  email: string | null;
  failedCallAttempts?: number;
}): ContactRecommendation {
  const minutesUntilStart = minutesBetween(input.now, input.startsAt);
  const urgent = minutesUntilStart <= URGENT_THRESHOLD_MIN;
  const { phone, email } = input;
  const failed = input.failedCallAttempts ?? 0;
  const written = writtenChannels(phone, email);

  const steps = [urgent && phone ? (['phone'] as ContactChannel[]) : [], written].filter((s) => s.length > 0);
  const next = (failed > 0 ? steps.filter((s) => !s.includes('phone')) : steps)[0] ?? [];

  let note: string | null = null;
  if (!phone && !email) note = 'Keine Kontaktdaten: Patient:in am Empfang abfangen.';
  else if (urgent && !phone) {
    note = 'Keine Telefonnummer. Eine E-Mail kommt so kurzfristig evtl. nicht an: Patient:in am Empfang abfangen.';
  } else if (failed > 0) {
    note = `Telefonisch ${failed}× nicht erreicht.${next.length ? ` Weiter per ${next.map(label).join(' + ')}.` : ''}`;
  }

  return { steps, next, written, urgent, minutesUntilStart, note };
}

function label(ch: ContactChannel): string {
  return ch === 'phone' ? 'Anruf' : ch === 'sms' ? 'SMS' : 'E-Mail';
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
