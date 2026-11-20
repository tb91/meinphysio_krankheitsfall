import type { AuditEntry } from './auditLog.js';
import type { UtcIso } from './types.js';

/**
 * Zustand eines betroffenen Termins, abgeleitet aus dem Audit-Log (einzige Quelle der Wahrheit).
 *
 * Checkliste je Fall: Entscheidung → Patient:in informiert → in Termino nachgezogen.
 * Ändert sich die Entscheidung, gelten Information und Termino-Abgleich als offen,
 * denn die Patient:in kennt dann noch den alten Stand.
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
}

export function deriveCaseState(entries: readonly AuditEntry[]): CaseState {
  let decision: Decision | null = null;
  let notifiedVia: ContactChannel | null = null;
  let terminoSynced = false;

  // Eintragsreihenfolge, nicht Zeitstempel: das Log ist append-only, Uhren können springen
  // (Neustart, Zeitumstellung, abweichende Serveruhren).
  for (const e of entries) {
    switch (e.action) {
      case 'appointment_cancelled':
        decision = { kind: 'cancelled', reason: String(e.details.reason ?? ''), at: e.at, by: e.actor.name };
        notifiedVia = null;
        terminoSynced = false;
        break;
      case 'appointment_rebooked':
        decision = { kind: 'rebooked', at: e.at, by: e.actor.name, to: e.details.to as Extract<Decision, { kind: 'rebooked' }>['to'] };
        notifiedVia = null;
        terminoSynced = false;
        break;
      case 'patient_notified':
        if (decision) notifiedVia = e.details.channel as ContactChannel;
        break;
      case 'termino_synced':
        if (decision) terminoSynced = true;
        break;
    }
  }

  const status = !decision ? 'open' : notifiedVia && terminoSynced ? 'done' : 'in_progress';
  return { status, decision, notifiedVia, terminoSynced };
}
