// Anforderung 3: Jeder Termin aus dem Termino-Export wird nachweisbar verarbeitet. Nichts geht still verloren.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  diffExports,
  ImportFormatError,
  processExport,
  type ExportDiff,
  type ImportReport,
} from './importer.js';
import { appointment, loadExport0800, loadExport0805, loadMasterData } from '../test-support/fixtures.js';

const master = loadMasterData();

function resultFor(report: ImportReport, id: string) {
  return report.results.find((r) => r.appointmentId === id);
}

describe('processExport: Vollständigkeit mit echtem Export 08:05', () => {
  const raw = loadExport0805();
  let report: ImportReport;
  beforeAll(() => {
    report = processExport(raw, master);
  });

  it('zählt alle 1928 empfangenen Termine', () => {
    expect(report.received).toBe(1928);
    expect(report.results).toHaveLength(1928);
  });

  it('führt jede Termin-ID genau einmal im Report', () => {
    const exportIds = raw.appointments.map((a) => a.id).sort();
    const reportIds = report.results.map((r) => r.appointmentId).sort();
    expect(reportIds).toEqual(exportIds);
  });

  it('die Zähler summieren sich zur Anzahl empfangener Termine', () => {
    const { imported, imported_with_warnings, rejected } = report.counts;
    expect(imported + imported_with_warnings + rejected).toBe(report.received);
  });

  it('übernimmt Kopf-Metadaten des Exports', () => {
    expect(report.exportId).toBe(raw.export_id);
    expect(report.exportedAt).toBe(raw.exported_at);
  });
});

describe('processExport: unsaubere Daten werden importiert, aber markiert', () => {
  let report: ImportReport;
  beforeAll(() => {
    report = processExport(loadExport0805(), master);
  });

  it('Katrin Meier (Termino) ↔ Katrin Meyer (Stammdaten): unscharfer Treffer, kein stilles Mergen', () => {
    const r = resultFor(report, 'apt_006026');
    expect(r?.outcome).toBe('imported_with_warnings');
    expect(r?.warnings).toContain('patient_fuzzy_match');
  });

  it('Lena Krause ohne Stammdatensatz: importiert mit Warnung patient_unknown', () => {
    const r = resultFor(report, 'apt_006658');
    expect(r?.outcome).toBe('imported_with_warnings');
    expect(r?.warnings).toContain('patient_unknown');
  });

  it('Termine von prac_03 (fehlt in therapeuten.json) werden nicht verworfen', () => {
    for (const id of ['apt_002170', 'apt_001852', 'apt_002671', 'apt_002315', 'apt_002257']) {
      expect(resultFor(report, id)?.warnings).toContain('unknown_practitioner');
    }
  });

  it('Gisela Neumann ohne Telefonnummer wird markiert', () => {
    expect(resultFor(report, 'apt_004102')?.warnings).toContain('missing_phone');
  });
});

describe('processExport: kaputte Einträge', () => {
  const base = loadExport0805();

  it('lehnt einen ungültigen Eintrag ab, zählt ihn aber und verarbeitet den Rest weiter', () => {
    const broken = { ...appointment(), starts_at: 'kein-datum' };
    const raw = { ...base, appointments: [appointment(), broken, appointment()] };
    const report = processExport(raw, master);
    expect(report.received).toBe(3);
    expect(report.results).toHaveLength(3);
    expect(report.counts.rejected).toBe(1);
    expect(report.results[1]).toMatchObject({ index: 1, outcome: 'rejected', rejectReason: 'invalid_record' });
    expect(report.results[1]?.error).toBeTruthy();
  });

  it('nimmt auch Einträge ohne ID in den Report auf (über den Index nachvollziehbar)', () => {
    const { id: _ignored, ...ohneId } = appointment();
    const report = processExport({ ...base, appointments: [ohneId] }, master);
    expect(report.results).toEqual([
      expect.objectContaining({ index: 0, appointmentId: null, outcome: 'rejected' }),
    ]);
  });

  it('markiert doppelte Termin-IDs statt eine still zu überschreiben', () => {
    const a = appointment({ id: 'apt_dup' });
    const raw = { ...base, appointments: [a, { ...a, starts_at: '2026-09-07T08:00:00Z' }] };
    const report = processExport(raw, master);
    expect(report.results).toHaveLength(2);
    expect(report.results[1]).toMatchObject({ outcome: 'rejected', rejectReason: 'duplicate_id' });
  });

  it('akzeptiert einen leeren Export', () => {
    const report = processExport({ ...base, appointments: [] }, master);
    expect(report.received).toBe(0);
    expect(report.results).toEqual([]);
  });

  it('wirft ImportFormatError, wenn der Export als Ganzes unbrauchbar ist', () => {
    expect(() => processExport({ tool: 'termino' }, master)).toThrow(ImportFormatError);
    expect(() => processExport(null, master)).toThrow(ImportFormatError);
  });
});

describe('diffExports: Re-Import 08:00 → 08:05', () => {
  let diff: ExportDiff;
  beforeAll(() => {
    diff = diffExports(loadExport0800().appointments, loadExport0805().appointments);
  });

  it('erkennt den neu gebuchten Termin', () => {
    expect(diff.added).toEqual(['apt_006783']);
  });

  it('erkennt Verschiebung (apt_003565) und Stornierung (apt_004498) als Änderung', () => {
    expect([...diff.changed].sort()).toEqual(['apt_003565', 'apt_004498']);
  });

  it('meldet keine verschwundenen Termine und verliert keinen Termin in der Bilanz', () => {
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged + diff.changed.length + diff.added.length).toBe(1928);
  });
});
