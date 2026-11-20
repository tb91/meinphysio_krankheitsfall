// Test-Hilfen: lädt die echten Case-Daten aus data/ und baut synthetische Termine.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MasterData, TerminoAppointment, TerminoExport } from '../domain/types.js';

const DATA_DIR =
  process.env.DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), 'utf8')) as T;
}

export const loadExport0800 = () => readJson<TerminoExport>('termino_export_2026-09-07_0800.json');
export const loadExport0805 = () => readJson<TerminoExport>('termino_export_2026-09-07_0805.json');

export function loadMasterData(): MasterData {
  return {
    praxen: readJson('praxen.json'),
    therapeuten: readJson('therapeuten.json'),
    patienten: readJson('patienten.json'),
    verordnungen: readJson('verordnungen.json'),
  };
}

export const ANNA = 'prac_01';
export const AUSFALLTAG = '2026-09-07';

let seq = 0;
export function appointment(overrides: Partial<TerminoAppointment> = {}): TerminoAppointment {
  seq += 1;
  return {
    id: `apt_t${String(seq).padStart(4, '0')}`,
    location_id: 'loc_01',
    practitioner_id: ANNA,
    service: 'Krankengymnastik',
    starts_at: '2026-09-07T06:00:00Z',
    duration_min: 20,
    status: 'booked',
    patient: {
      id: `pat_t${seq}`,
      name: `Test Person ${seq}`,
      birth_date: '1970-01-01',
      phone: '+49 151 00000000',
      email: 'test@example.com',
    },
    booked_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...overrides,
  };
}
