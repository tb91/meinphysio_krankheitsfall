// Rohdaten-Typen, 1:1 wie in data/*.json. Validierung (Zod) passiert im Import.

export type ServiceCode = 'KG' | 'MT' | 'MLD45' | 'KGG';
export type Weekday = 'mo' | 'di' | 'mi' | 'do' | 'fr';

/** ISO-8601 in UTC, z. B. "2026-09-07T06:00:00Z" */
export type UtcIso = string;
/** Kalenderdatum "YYYY-MM-DD" */
export type IsoDate = string;

export interface TerminoPatient {
  id: string | null;
  name: string;
  birth_date: IsoDate | null;
  phone: string | null;
  email: string | null;
}

export interface TerminoAppointment {
  id: string;
  location_id: string;
  practitioner_id: string;
  service: string;
  starts_at: UtcIso;
  duration_min: number;
  status: 'booked' | 'cancelled';
  patient: TerminoPatient | null;
  booked_at: UtcIso;
  updated_at: UtcIso;
}

export interface TerminoExport {
  tool: string;
  export_id: string;
  exported_at: UtcIso;
  window: { from: IsoDate; to: IsoDate };
  appointments: TerminoAppointment[];
}

export interface Praxis {
  id: string;
  name: string;
  adresse: string;
  termino_location_id: string;
}

export interface WorkInterval {
  /** Ortszeit Europe/Berlin, "HH:MM" */
  von: string;
  bis: string;
  praxis_id: string;
}

export interface Therapeut {
  id: string;
  vorname: string;
  nachname: string;
  qualifikationen: ServiceCode[];
  termino_practitioner_id: string;
  arbeitszeiten: Partial<Record<Weekday, WorkInterval[]>>;
}

export interface Patient {
  id: string;
  vorname: string;
  nachname: string;
  geburtsdatum: IsoDate;
  telefon: string | null;
  email: string | null;
  termino_patient_id: string | null;
}

export interface Verordnung {
  id: string;
  patient_id: string;
  ausstellungsdatum: IsoDate;
  diagnosegruppe: string;
  heilmittel: ServiceCode;
  verordnungsmenge: number;
  frequenz_pro_woche: number;
}

export interface MasterData {
  praxen: Praxis[];
  therapeuten: Therapeut[];
  patienten: Patient[];
  verordnungen: Verordnung[];
}
