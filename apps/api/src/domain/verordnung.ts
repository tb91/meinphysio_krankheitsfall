import { addDays } from './time.js';
import type { IsoDate, ServiceCode, Verordnung } from './types.js';

/**
 * ANNAHME (gegen Heilmittel-Richtlinie zu prüfen): Die Behandlung muss innerhalb von 28 Tagen
 * nach Ausstellung beginnen. Hat die Patient:in noch keinen Termin gehabt, darf eine Verlegung
 * nicht hinter diese Frist rutschen, sonst verfällt die Verordnung.
 */
export const BEHANDLUNGSBEGINN_FRIST_TAGE = 28;

export function startDeadline(vo: Verordnung): IsoDate {
  return addDays(vo.ausstellungsdatum, BEHANDLUNGSBEGINN_FRIST_TAGE);
}

/** Neueste Verordnung der Patient:in für das Heilmittel (bei mehreren). */
export function findVerordnung(
  verordnungen: readonly Verordnung[],
  patientId: string,
  heilmittel: ServiceCode | null,
): Verordnung | null {
  const own = verordnungen
    .filter((v) => v.patient_id === patientId && (!heilmittel || v.heilmittel === heilmittel))
    .sort((a, b) => b.ausstellungsdatum.localeCompare(a.ausstellungsdatum));
  return own[0] ?? null;
}
