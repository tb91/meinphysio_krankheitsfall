import { z } from 'zod';
import { buildPatientIndex, matchPatient } from './patientMatching.js';
import { serviceCodeFor } from './services.js';
import type { MasterData, TerminoAppointment, UtcIso } from './types.js';

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

const timestamp = z.string().datetime({ offset: true });
const nullableString = z.string().nullable().optional().transform((v) => v ?? null);

const appointmentSchema = z.object({
  id: z.string().min(1),
  location_id: z.string().min(1),
  practitioner_id: z.string().min(1),
  service: z.string().min(1),
  starts_at: timestamp,
  duration_min: z.number().int().positive(),
  status: z.enum(['booked', 'cancelled']),
  patient: z
    .object({
      id: nullableString,
      name: z.string(),
      birth_date: nullableString,
      phone: nullableString,
      email: nullableString,
    })
    .nullable(),
  booked_at: timestamp,
  updated_at: timestamp,
});

const exportHeaderSchema = z.object({
  export_id: z.string().optional(),
  exported_at: z.string().optional(),
  appointments: z.array(z.unknown()),
});

/**
 * Wirft ImportFormatError nur, wenn der Export als Ganzes unbrauchbar ist (kein appointments-Array).
 * Einzelne kaputte Einträge werden abgelehnt, aber gezählt.
 */
export function processExport(raw: unknown, master: MasterData): ImportReport {
  const header = exportHeaderSchema.safeParse(raw);
  if (!header.success) {
    throw new ImportFormatError('Export hat kein gültiges "appointments"-Array');
  }

  const knownPractitioners = new Set(master.therapeuten.map((t) => t.termino_practitioner_id));
  const patientIndex = buildPatientIndex(master.patienten);
  const seenIds = new Set<string>();

  const results: ImportRecordResult[] = header.data.appointments.map((item, index) => {
    const rawId = isRecord(item) && typeof item.id === 'string' && item.id ? item.id : null;

    const parsed = appointmentSchema.safeParse(item);
    if (!parsed.success) {
      return {
        index,
        appointmentId: rawId,
        outcome: 'rejected',
        warnings: [],
        rejectReason: 'invalid_record',
        error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      };
    }

    const appt = parsed.data;
    if (seenIds.has(appt.id)) {
      return {
        index,
        appointmentId: appt.id,
        outcome: 'rejected',
        warnings: [],
        rejectReason: 'duplicate_id',
        error: `Termin-ID ${appt.id} kommt im Export mehrfach vor`,
      };
    }
    seenIds.add(appt.id);

    const warnings: ImportWarning[] = [];
    if (!knownPractitioners.has(appt.practitioner_id)) warnings.push('unknown_practitioner');
    if (!serviceCodeFor(appt.service)) warnings.push('unknown_service');

    const match = matchPatient(appt.patient, patientIndex);
    if (match.kind === 'fuzzy') warnings.push('patient_fuzzy_match');
    if (match.kind === 'unknown') warnings.push('patient_unknown');

    const phone = appt.patient?.phone || (match.kind === 'linked' ? match.patient.telefon : null);
    if (!phone) warnings.push('missing_phone');

    return {
      index,
      appointmentId: appt.id,
      outcome: warnings.length > 0 ? 'imported_with_warnings' : 'imported',
      warnings,
    };
  });

  const counts: Record<ImportOutcome, number> = { imported: 0, imported_with_warnings: 0, rejected: 0 };
  for (const r of results) counts[r.outcome] += 1;

  return {
    exportId: header.data.export_id ?? '',
    exportedAt: header.data.exported_at ?? '',
    received: header.data.appointments.length,
    results,
    counts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ExportDiff {
  added: string[];
  removed: string[];
  /** Termine, deren fachliche Felder sich geändert haben (Zeit, Status, Person, …) */
  changed: string[];
  unchanged: number;
}

/** Fachlich relevante Felder. `updated_at`/`booked_at` allein sind keine Änderung. */
function fingerprint(a: TerminoAppointment): string {
  return JSON.stringify([
    a.location_id,
    a.practitioner_id,
    a.service,
    a.starts_at,
    a.duration_min,
    a.status,
    a.patient,
  ]);
}

/** Vergleich zweier aufeinanderfolgender Vollexporte (alle 5 Minuten). */
export function diffExports(
  previous: readonly TerminoAppointment[],
  next: readonly TerminoAppointment[],
): ExportDiff {
  const prevById = new Map(previous.map((a) => [a.id, a]));
  const nextIds = new Set(next.map((a) => a.id));

  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;

  for (const a of next) {
    const before = prevById.get(a.id);
    if (!before) added.push(a.id);
    else if (fingerprint(before) !== fingerprint(a)) changed.push(a.id);
    else unchanged += 1;
  }

  const removed = previous.filter((a) => !nextIds.has(a.id)).map((a) => a.id);
  return { added, removed, changed, unchanged };
}
