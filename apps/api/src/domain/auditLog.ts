import { randomUUID } from 'node:crypto';
import { isValidTimestamp, localDayTime, localTime } from './time.js';
import type { TerminoAppointment, UtcIso } from './types.js';

/**
 * Protokoll aller Entscheidungen: wer hat wann was mit welchem Termin gemacht.
 * Entscheidungen (umbuchen, absagen) sind append-only: Korrekturen sind neue Einträge.
 * Ausnahme: Die Bestätigungen "informiert" und "in Termino" kann der Empfang zurücknehmen,
 * dann wird der Eintrag entfernt statt ein Gegeneintrag geschrieben (siehe caseState.ts).
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
  return { entries: [] };
}

function validate(actor: Actor, at: UtcIso): void {
  if (!actor.name || actor.name.trim() === '') {
    throw new InvalidAuditEntryError('Entscheidung ohne Namen am Empfang ist nicht erlaubt');
  }
  if (!isValidTimestamp(at)) {
    throw new InvalidAuditEntryError(`Ungültiger Zeitpunkt: ${at}`);
  }
}

function actorLabel(actor: Actor): string {
  return actor.kind === 'reception' ? `${actor.name.trim()} (Empfang)` : `${actor.name.trim()} (System)`;
}

function baseEntry(input: { appointment: TerminoAppointment; actor: Actor; at: UtcIso }) {
  return {
    id: randomUUID(),
    at: input.at,
    actor: input.actor,
    appointmentId: input.appointment.id,
    patientName: input.appointment.patient?.name ?? 'Unbekannt',
    terminoPatientId: input.appointment.patient?.id ?? null,
  };
}

function append(log: AuditLog, entry: AuditEntry): AuditLog {
  return { entries: [...log.entries, entry] };
}

export function recordCancellation(log: AuditLog, input: CancellationInput): AuditLog {
  validate(input.actor, input.at);
  const base = baseEntry(input);
  const { appointment: a } = input;

  return append(log, {
    ...base,
    action: 'appointment_cancelled',
    details: {
      reason: input.reason,
      from: { practitionerId: a.practitioner_id, startsAt: a.starts_at, locationName: input.locationName },
    },
    message:
      `${localTime(input.at)} Uhr: Termin von ${base.patientName} ` +
      `(${localDayTime(a.starts_at)}, ${input.locationName}) wurde von ${actorLabel(input.actor)} abgesagt. ` +
      `Grund: ${input.reason}`,
  });
}

export function recordRebooking(log: AuditLog, input: RebookingInput): AuditLog {
  validate(input.actor, input.at);
  if (!isValidTimestamp(input.to.startsAt)) {
    throw new InvalidAuditEntryError(`Ungültiger neuer Termin: ${input.to.startsAt}`);
  }
  const base = baseEntry(input);
  const { appointment: a, to } = input;

  return append(log, {
    ...base,
    action: 'appointment_rebooked',
    details: {
      from: { practitionerId: a.practitioner_id, startsAt: a.starts_at, locationName: input.locationName },
      to,
    },
    message:
      `${localTime(input.at)} Uhr: Termin von ${base.patientName} ` +
      `(${localDayTime(a.starts_at)}, ${input.locationName}) wurde von ${actorLabel(input.actor)} umgebucht ` +
      `auf ${localDayTime(to.startsAt)} bei ${to.practitionerName} (${to.locationName}).`,
  });
}

const CHANNEL_LABEL = { phone: 'per Telefon', sms: 'per SMS', email: 'per E-Mail' } as const;

export interface NotificationInput {
  appointment: TerminoAppointment;
  actor: Actor;
  at: UtcIso;
  channel: keyof typeof CHANNEL_LABEL;
}

/** Nichts wird versendet: der Empfang bestätigt, dass er informiert hat. */
export function recordNotification(log: AuditLog, input: NotificationInput): AuditLog {
  validate(input.actor, input.at);
  const base = baseEntry(input);
  return append(log, {
    ...base,
    action: 'patient_notified',
    details: { channel: input.channel },
    message: `${localTime(input.at)} Uhr: ${base.patientName} wurde von ${actorLabel(input.actor)} ${CHANNEL_LABEL[input.channel]} informiert.`,
  });
}

export interface TerminoSyncInput {
  appointment: TerminoAppointment;
  actor: Actor;
  at: UtcIso;
}

/** Termino hat keine Schreib-API: der Empfang bestätigt, dass die Änderung dort eingetragen ist. */
export function recordTerminoSync(log: AuditLog, input: TerminoSyncInput): AuditLog {
  validate(input.actor, input.at);
  const base = baseEntry(input);
  return append(log, {
    ...base,
    action: 'termino_synced',
    details: {},
    message: `${localTime(input.at)} Uhr: Änderung für ${base.patientName} wurde von ${actorLabel(input.actor)} in Termino eingetragen.`,
  });
}

/**
 * Verlauf eines Termins in Eintragsreihenfolge. Bewusst nicht nach Zeitstempel sortiert:
 * das Log ist append-only, die Reihenfolge ist verlässlicher als Uhren.
 */
export function entriesForAppointment(log: AuditLog, appointmentId: string): AuditEntry[] {
  return log.entries.filter((e) => e.appointmentId === appointmentId);
}
