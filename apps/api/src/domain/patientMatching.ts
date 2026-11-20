import type { Patient, TerminoPatient } from './types.js';

/**
 * Zuordnung Termino-Patient:in → Stammdatensatz.
 *
 * 1. Verknüpfung über termino_patient_id → sicher.
 * 2. Sonst: gleiches Geburtsdatum UND (gleiche E-Mail ODER gleiche Telefonnummer ODER sehr ähnlicher Name)
 *    → nur ein Vorschlag. Wird nie automatisch verknüpft, der Empfang muss bestätigen.
 *    Beispiel: "Katrin Meier" (Termino) ↔ "Katrin Meyer" (Stammdaten).
 * 3. Sonst: unbekannt.
 */
export type PatientMatch =
  | { kind: 'linked'; patient: Patient }
  | { kind: 'fuzzy'; candidates: Patient[] }
  | { kind: 'unknown' };

export interface PatientIndex {
  byTerminoId: Map<string, Patient>;
  byBirthDate: Map<string, Patient[]>;
}

export function buildPatientIndex(patienten: readonly Patient[]): PatientIndex {
  const byTerminoId = new Map<string, Patient>();
  const byBirthDate = new Map<string, Patient[]>();
  for (const p of patienten) {
    if (p.termino_patient_id) byTerminoId.set(p.termino_patient_id, p);
    const list = byBirthDate.get(p.geburtsdatum) ?? [];
    list.push(p);
    byBirthDate.set(p.geburtsdatum, list);
  }
  return { byTerminoId, byBirthDate };
}

export function matchPatient(tp: TerminoPatient | null, index: PatientIndex): PatientMatch {
  if (!tp) return { kind: 'unknown' };

  if (tp.id) {
    const linked = index.byTerminoId.get(tp.id);
    if (linked) return { kind: 'linked', patient: linked };
  }

  if (!tp.birth_date) return { kind: 'unknown' };
  const candidates = (index.byBirthDate.get(tp.birth_date) ?? []).filter(
    (p) =>
      sameEmail(p.email, tp.email) ||
      samePhone(p.telefon, tp.phone) ||
      similarName(`${p.vorname} ${p.nachname}`, tp.name),
  );
  return candidates.length > 0 ? { kind: 'fuzzy', candidates } : { kind: 'unknown' };
}

function sameEmail(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function samePhone(a: string | null, b: string | null): boolean {
  const norm = (s: string) => s.replace(/[^\d+]/g, '');
  return !!a && !!b && norm(a) === norm(b);
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein-Distanz ≤ 2 auf normalisiertem Vollnamen (Tippfehler, Meier/Meyer). */
function similarName(a: string, b: string): boolean {
  return levenshtein(normalizeName(a), normalizeName(b)) <= 2;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length]!;
}
