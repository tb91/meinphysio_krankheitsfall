import { addMinutes, localDate, PRACTICE_TIME_ZONE } from './time.js';
import type { IsoDate, TerminoAppointment, UtcIso } from './types.js';

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
 * - nur gebuchte (nicht stornierte) Termine der Person
 * - Tageszugehörigkeit nach Ortszeit
 * - aufsteigend nach Startzeit, bei Gleichstand nach Termin-ID (deterministisch)
 */
export function buildWorklist(
  appointments: readonly TerminoAppointment[],
  query: WorklistQuery,
): WorklistItem[] {
  const timeZone = query.timeZone ?? PRACTICE_TIME_ZONE;

  return appointments
    .filter(
      (a) =>
        a.practitioner_id === query.practitionerId &&
        a.status === 'booked' &&
        localDate(a.starts_at, timeZone) === query.date,
    )
    .sort((a, b) => {
      const byTime = Date.parse(a.starts_at) - Date.parse(b.starts_at);
      if (byTime !== 0) return byTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((a, index) => ({
      position: index + 1,
      appointmentId: a.id,
      startsAt: a.starts_at,
      endsAt: addMinutes(a.starts_at, a.duration_min),
      locationId: a.location_id,
      service: a.service,
      patientName: a.patient?.name ?? 'Unbekannt',
      terminoPatientId: a.patient?.id ?? null,
    }));
}
