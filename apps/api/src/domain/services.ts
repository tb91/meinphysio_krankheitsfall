import type { ServiceCode } from './types.js';

/**
 * Termino-Leistungsbezeichnung → interner Heilmittel-Code.
 * Achtung: "Lymphdrainage 45 Min." ist in Termino mit 40 Min. gebucht. Die Dauer kommt
 * deshalb immer aus dem Export, nie aus dem Namen.
 */
export const TERMINO_SERVICE_TO_CODE: Readonly<Record<string, ServiceCode>> = {
  Krankengymnastik: 'KG',
  'Manuelle Therapie': 'MT',
  'Lymphdrainage 45 Min.': 'MLD45',
  'Geraetegestuetzte Krankengymnastik': 'KGG',
};

export function serviceCodeFor(terminoService: string): ServiceCode | null {
  return TERMINO_SERVICE_TO_CODE[terminoService] ?? null;
}
