// Test-Hilfen: lädt die echten Case-Daten aus data/ und baut synthetische Termine.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMasterData as loadFrom, readTypedExport } from '../data/caseData.js';
import type { MasterData, TerminoAppointment, TerminoExport } from '../domain/types.js';

const DATA_DIR =
  process.env.DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data');

export const loadExport0800 = (): TerminoExport => readTypedExport(DATA_DIR, 'termino_export_2026-09-07_0800.json');
export const loadExport0805 = (): TerminoExport => readTypedExport(DATA_DIR, 'termino_export_2026-09-07_0805.json');
export const loadMasterData = (): MasterData => loadFrom(DATA_DIR);

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
