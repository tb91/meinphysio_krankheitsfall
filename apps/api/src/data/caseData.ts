import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MasterData, TerminoExport } from '../domain/types.js';

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as T;
}

/** Stammdaten und Verordnungen (unsere Systeme). */
export function loadMasterData(dir: string): MasterData {
  return {
    praxen: readJson(dir, 'praxen.json'),
    therapeuten: readJson(dir, 'therapeuten.json'),
    patienten: readJson(dir, 'patienten.json'),
    verordnungen: readJson(dir, 'verordnungen.json'),
  };
}

/** Neuester Termino-Export im Verzeichnis (Dateiname enthält Datum und Uhrzeit). */
export function latestExportFile(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => /^termino_export_.*\.json$/.test(f))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error(`Kein Termino-Export in ${dir} gefunden`);
  return latest;
}

/** Roh eingelesen; validiert wird im Import (processExport). */
export function readExport(dir: string, file: string): unknown {
  return readJson<unknown>(dir, file);
}

export function readTypedExport(dir: string, file: string): TerminoExport {
  return readJson<TerminoExport>(dir, file);
}
