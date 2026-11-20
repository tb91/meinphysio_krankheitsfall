import { NotImplementedError, type MasterData, type TerminoAppointment, type UtcIso } from './types.js';

/**
 * Import eines Termino-Vollexports. Grundsatz: kein Termin geht still verloren.
 * Jeder Eintrag im Export erscheint genau einmal im Report: importiert, importiert mit Warnungen,
 * oder abgelehnt mit Grund.
 */
export type ImportOutcome = 'imported' | 'imported_with_warnings' | 'rejected';

export type ImportWarning =
  /** Termino-Patient:in hat keine Verknüpfung, aber plausibler Treffer in Stammdaten (z. B. Meier/Meyer) */
  | 'patient_fuzzy_match'
  /** Kein Stammdatensatz gefunden */
  | 'patient_unknown'
  /** practitioner_id fehlt in therapeuten.json (z. B. prac_03) */
  | 'unknown_practitioner'
  /** Termino-Leistung lässt sich keinem Heilmittel-Code zuordnen */
  | 'unknown_service'
  /** Keine Telefonnummer, nur E-Mail oder gar nichts */
  | 'missing_phone';

export type ImportRejectReason = 'invalid_record' | 'duplicate_id';

export interface ImportRecordResult {
  /** Position im Export-Array, damit auch Einträge ohne gültige ID nachvollziehbar sind */
  index: number;
  appointmentId: string | null;
  outcome: ImportOutcome;
  warnings: ImportWarning[];
  rejectReason?: ImportRejectReason;
  /** Menschlich lesbarer Grund bei Ablehnung */
  error?: string;
}

export interface ImportReport {
  exportId: string;
  exportedAt: UtcIso;
  /** Anzahl Einträge im Export */
  received: number;
  results: ImportRecordResult[];
  counts: Record<ImportOutcome, number>;
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/**
 * Verarbeitet einen Rohexport (unbekannte Struktur, wird validiert).
 * Wirft ImportFormatError nur, wenn der Export als Ganzes unbrauchbar ist (kein appointments-Array).
 * Einzelne kaputte Einträge werden abgelehnt, aber gezählt.
 */
export function processExport(_raw: unknown, _master: MasterData): ImportReport {
  throw new NotImplementedError('processExport');
}

export interface ExportDiff {
  added: string[];
  removed: string[];
  /** Termine, deren fachliche Felder sich geändert haben (Zeit, Status, Person, …) */
  changed: string[];
  unchanged: number;
}

/** Vergleich zweier aufeinanderfolgender Vollexporte (alle 5 Minuten). */
export function diffExports(
  _previous: readonly TerminoAppointment[],
  _next: readonly TerminoAppointment[],
): ExportDiff {
  throw new NotImplementedError('diffExports');
}
