import { NotImplementedError, type IsoDate, type TerminoAppointment, type UtcIso } from './types.js';

/**
 * Arbeitsliste des Empfangs: alle betroffenen Termine einer ausgefallenen Person an einem Tag,
 * in der Reihenfolge, in der sie abgearbeitet werden (frühester Start zuerst).
 */
export interface WorklistItem {
  /** 1-basiert, Reihenfolge der Abarbeitung */
  position: number;
  appointmentId: string;
  startsAt: UtcIso;
  endsAt: UtcIso;
  locationId: string;
  service: string;
  patientName: string;
  terminoPatientId: string | null;
}

export interface WorklistQuery {
  practitionerId: string;
  /** Kalendertag in Ortszeit (Europe/Berlin), nicht UTC */
  date: IsoDate;
  timeZone?: string;
}

/**
 * Erwartetes Verhalten (siehe worklist.test.ts):
 * - nur gebuchte (nicht stornierte) Termine der Person
 * - Tageszugehörigkeit nach Ortszeit Europe/Berlin
 * - aufsteigend nach Startzeit, bei Gleichstand deterministisch nach Termin-ID
 * - unabhängig von der Reihenfolge im Export
 */
export function buildWorklist(
  _appointments: readonly TerminoAppointment[],
  _query: WorklistQuery,
): WorklistItem[] {
  throw new NotImplementedError('buildWorklist');
}
