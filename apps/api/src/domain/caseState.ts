import type { AuditEntry } from './auditLog.js';
import type { UtcIso } from './types.js';

/**
 * Zustand eines betroffenen Termins, abgeleitet aus dem Audit-Log (einzige Quelle der Wahrheit).
 *
 * Checkliste je Fall: Entscheidung → Patient:in informiert → in Termino nachgezogen.
 * Ändert sich die Entscheidung, gelten Information und Termino-Abgleich als offen,
 * denn die Patient:in kennt dann noch den alten Stand.
 *
 * Informiert gilt eine Patient:in, wenn sie telefonisch erreicht wurde ODER alle verfügbaren
 * schriftlichen Kanäle (SMS und E-Mail) bestätigt sind.
 *
 * Die Bestätigungen je Kanal und "in Termino" sind umschaltbar: Der Empfang kann einen
 * Klick zurücknehmen, dann wird der Eintrag entfernt (Produktentscheidung, nicht
 * sicherheitsrelevant). Dafür liefert der Zustand die IDs der gültigen Einträge.
 */
export type Decision =
  | { kind: 'cancelled'; reason: string; at: UtcIso; by: string }
  | {
      kind: 'rebooked';
      at: UtcIso;
      by: string;
      to: { practitionerId: string; practitionerName: string; startsAt: UtcIso; locationName: string };
    };

export type ContactChannel = 'phone' | 'sms' | 'email';
export const CHANNELS: readonly ContactChannel[] = ['phone', 'sms', 'email'];

export interface CaseState {
  status: 'open' | 'in_progress' | 'done';
  decision: Decision | null;
  /** Bestätigte Kanäle seit der aktuellen Entscheidung (phone = telefonisch erreicht) */
  notifiedChannels: ContactChannel[];
  informed: boolean;
  /** IDs der gültigen "informiert"-Einträge je Kanal, zum Zurücknehmen */
  notificationEntryIds: Partial<Record<ContactChannel, string>>;
  terminoSynced: boolean;
  /** ID des gültigen "in Termino"-Eintrags, zum Zurücknehmen */
  terminoSyncEntryId: string | null;
  /** Erfolglose Anrufversuche seit der aktuellen Entscheidung */
  failedCallAttempts: number;
}

/** Telefonisch erreicht, oder alle verfügbaren schriftlichen Kanäle erledigt. */
export function isInformed(notified: readonly ContactChannel[], writtenChannels: readonly ContactChannel[]): boolean {
  if (notified.includes('phone')) return true;
  return writtenChannels.length > 0 && writtenChannels.every((ch) => notified.includes(ch));
}

/**
 * @param writtenChannels Für diese Patient:in verfügbare schriftliche Kanäle
 *   (SMS nur mit Telefonnummer, E-Mail nur mit Adresse). Standard: beide.
 */
export function deriveCaseState(
  entries: readonly AuditEntry[],
  writtenChannels: readonly ContactChannel[] = ['sms', 'email'],
): CaseState {
  let decision: Decision | null = null;
  let notifications: Partial<Record<ContactChannel, AuditEntry>> = {};
  let terminoSync: AuditEntry | null = null;
  let failedCallAttempts = 0;

  const resetFollowUps = () => {
    notifications = {};
    terminoSync = null;
    failedCallAttempts = 0;
  };

  // Eintragsreihenfolge, nicht Zeitstempel: Uhren können springen
  // (Neustart, Zeitumstellung, abweichende Serveruhren).
  for (const e of entries) {
    switch (e.action) {
      case 'appointment_cancelled':
        decision = { kind: 'cancelled', reason: String(e.details.reason ?? ''), at: e.at, by: e.actor.name };
        resetFollowUps();
        break;
      case 'appointment_rebooked':
        decision = { kind: 'rebooked', at: e.at, by: e.actor.name, to: e.details.to as Extract<Decision, { kind: 'rebooked' }>['to'] };
        resetFollowUps();
        break;
      case 'patient_notified':
        if (decision) notifications[e.details.channel as ContactChannel] = e;
        break;
      case 'call_attempt_failed':
        if (decision) failedCallAttempts += 1;
        break;
      case 'termino_synced':
        if (decision) terminoSync = e;
        break;
    }
  }

  const notifiedChannels = CHANNELS.filter((ch) => notifications[ch]);
  const informed = !!decision && isInformed(notifiedChannels, writtenChannels);
  const terminoSynced = terminoSync !== null;
  const status = !decision ? 'open' : informed && terminoSynced ? 'done' : 'in_progress';

  return {
    status,
    decision,
    notifiedChannels,
    informed,
    notificationEntryIds: Object.fromEntries(notifiedChannels.map((ch) => [ch, notifications[ch]!.id])),
    terminoSynced,
    terminoSyncEntryId: (terminoSync as AuditEntry | null)?.id ?? null,
    failedCallAttempts,
  };
}
