import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ExportFile, listExportFiles } from '../domain/exportSchedule.js';
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

/** Termino-Exporte im Verzeichnis, chronologisch nach Zeitpunkt im Dateinamen. */
export function exportFilesIn(dir: string): ExportFile[] {
  return listExportFiles(readdirSync(dir));
}

/** Roh eingelesen; validiert wird im Import (processExport). */
export function readExport(dir: string, file: string): unknown {
  return readJson<unknown>(dir, file);
}

export function readTypedExport(dir: string, file: string): TerminoExport {
  return readJson<TerminoExport>(dir, file);
}
