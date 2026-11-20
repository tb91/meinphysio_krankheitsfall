import type { AuditEntry } from './auditLog.js';
import type { UtcIso } from './types.js';

/**
 * Zustand eines betroffenen Termins, abgeleitet aus dem Audit-Log (einzige Quelle der Wahrheit).
 *
 * Checkliste je Fall: Entscheidung → Patient:in informiert → in Termino nachgezogen.
 * Ändert sich die Entscheidung, gelten Information und Termino-Abgleich als offen,
 * denn die Patient:in kennt dann noch den alten Stand.
 *
 * Die Bestätigungen "informiert" und "in Termino" sind umschaltbar: Der Empfang kann einen
 * Klick zurücknehmen, dann wird der Eintrag entfernt (Produktentscheidung, nicht
 * sicherheitsrelevant). Dafür liefert der Zustand die ID des jeweils gültigen Eintrags.
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

export interface CaseState {
  status: 'open' | 'in_progress' | 'done';
  decision: Decision | null;
  notifiedVia: ContactChannel | null;
  terminoSynced: boolean;
  /** ID des gültigen "informiert"-Eintrags, zum Zurücknehmen */
  notificationEntryId: string | null;
  /** ID des gültigen "in Termino"-Eintrags, zum Zurücknehmen */
  terminoSyncEntryId: string | null;
}

export function deriveCaseState(entries: readonly AuditEntry[]): CaseState {
  let decision: Decision | null = null;
  let notification: AuditEntry | null = null;
  let terminoSync: AuditEntry | null = null;

  // Eintragsreihenfolge, nicht Zeitstempel: Uhren können springen
  // (Neustart, Zeitumstellung, abweichende Serveruhren).
  for (const e of entries) {
    switch (e.action) {
      case 'appointment_cancelled':
        decision = { kind: 'cancelled', reason: String(e.details.reason ?? ''), at: e.at, by: e.actor.name };
        notification = null;
        terminoSync = null;
        break;
      case 'appointment_rebooked':
        decision = { kind: 'rebooked', at: e.at, by: e.actor.name, to: e.details.to as Extract<Decision, { kind: 'rebooked' }>['to'] };
        notification = null;
        terminoSync = null;
        break;
      case 'patient_notified':
        if (decision) notification = e;
        break;
      case 'termino_synced':
        if (decision) terminoSync = e;
        break;
    }
  }

  const notifiedVia = (notification?.details.channel as ContactChannel | undefined) ?? null;
  const terminoSynced = terminoSync !== null;
  const status = !decision ? 'open' : notifiedVia && terminoSynced ? 'done' : 'in_progress';
  return {
    status,
    decision,
    notifiedVia,
    terminoSynced,
    notificationEntryId: notification?.id ?? null,
    terminoSyncEntryId: terminoSync?.id ?? null,
  };
}
