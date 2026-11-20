import { NotImplementedError, type TerminoAppointment, type UtcIso } from './types.js';

/**
 * Protokoll aller Entscheidungen: wer hat wann was mit welchem Termin gemacht.
 * Append-only: Einträge werden nie geändert oder gelöscht, Korrekturen sind neue Einträge.
 */
export type AuditAction =
  | 'appointment_cancelled'
  | 'appointment_rebooked'
  | 'patient_notified'
  | 'termino_synced';

export interface Actor {
  kind: 'reception' | 'system';
  /** Name der Person am Empfang (ohne Auth: im UI eingegeben). Pflicht. */
  name: string;
}

export interface AuditEntry {
  id: string;
  /** Zeitpunkt der Entscheidung, UTC */
  at: UtcIso;
  actor: Actor;
  action: AuditAction;
  appointmentId: string;
  patientName: string;
  terminoPatientId: string | null;
  details: Record<string, unknown>;
  /** Lesbarer Satz in Ortszeit, z. B. für die Verlaufsanzeige im UI */
  message: string;
}

export interface AuditLog {
  readonly entries: readonly AuditEntry[];
}

export class InvalidAuditEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAuditEntryError';
  }
}

export interface CancellationInput {
  appointment: TerminoAppointment;
  locationName: string;
  actor: Actor;
  at: UtcIso;
  reason: string;
}

export interface RebookingInput {
  appointment: TerminoAppointment;
  locationName: string;
  actor: Actor;
  at: UtcIso;
  to: {
    practitionerId: string;
    practitionerName: string;
    startsAt: UtcIso;
    locationName: string;
  };
}

export function createAuditLog(): AuditLog {
  throw new NotImplementedError('createAuditLog');
}

/** Wirft InvalidAuditEntryError bei fehlendem Actor-Namen oder ungültigem Zeitpunkt. */
export function recordCancellation(_log: AuditLog, _input: CancellationInput): AuditLog {
  throw new NotImplementedError('recordCancellation');
}

export function recordRebooking(_log: AuditLog, _input: RebookingInput): AuditLog {
  throw new NotImplementedError('recordRebooking');
}

/** Verlauf eines Termins, chronologisch. */
export function entriesForAppointment(_log: AuditLog, _appointmentId: string): AuditEntry[] {
  throw new NotImplementedError('entriesForAppointment');
}
