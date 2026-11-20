import { localToUtc } from './time.js';
import type { UtcIso } from './types.js';

/**
 * Fahrplan der Termino-Exporte. Termino legt alle 5 Minuten einen Vollexport ab, im Dateinamen
 * steht die Ortszeit (Europe/Berlin): termino_export_2026-09-07_0805.json → 07.09.2026, 08:05 Uhr.
 * Ein Export ist "fällig", sobald die (Szenario-)Uhr seinen Zeitpunkt erreicht hat.
 */
export const IMPORT_INTERVAL_MIN = 5;

export interface ExportFile {
  file: string;
  /** Zeitpunkt laut Dateiname, UTC */
  exportedAt: UtcIso;
}

const FILE_PATTERN = /^termino_export_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\.json$/;

export function parseExportFile(name: string): ExportFile | null {
  const m = FILE_PATTERN.exec(name);
  if (!m) return null;
  return { file: name, exportedAt: localToUtc(m[1]!, `${m[2]}:${m[3]}`) };
}

/** Alle Exportdateien aus einer Verzeichnisliste, chronologisch. */
export function listExportFiles(names: readonly string[]): ExportFile[] {
  return names
    .map(parseExportFile)
    .filter((f): f is ExportFile => f !== null)
    .sort((a, b) => Date.parse(a.exportedAt) - Date.parse(b.exportedAt));
}

/** Neuester Export, dessen Zeitpunkt erreicht ist (Vollexport: nur der neueste zählt). */
export function latestDueExport(files: readonly ExportFile[], now: UtcIso): ExportFile | null {
  const due = files.filter((f) => Date.parse(f.exportedAt) <= Date.parse(now));
  return due.at(-1) ?? null;
}

/**
 * Ausgangsstand beim Start. ANNAHME: Liegt noch kein fälliger Export vor (Szenario startet 07:40,
 * erster Export 08:00), gilt der früheste Export als bekannter Stand.
 */
export function baselineExport(files: readonly ExportFile[], now: UtcIso): ExportFile | null {
  return latestDueExport(files, now) ?? files[0] ?? null;
}

/** Nummer des 5-Minuten-Takts, in dem ein Zeitpunkt liegt (für den Job-Rhythmus). */
export function importSlot(now: UtcIso): number {
  return Math.floor(Date.parse(now) / (IMPORT_INTERVAL_MIN * 60_000));
}
