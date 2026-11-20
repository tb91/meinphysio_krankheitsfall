import { describe, expect, it } from 'vitest';
import { baselineExport, importSlot, latestDueExport, listExportFiles, parseExportFile } from './exportSchedule.js';

const names = [
  'termino_export_2026-09-07_0805.json',
  'patienten.json',
  'termino_export_2026-09-07_0800.json',
  'termino_export_kaputt.json',
];

describe('Fahrplan der Termino-Exporte', () => {
  it('liest die Ortszeit aus dem Dateinamen (08:05 Uhr = 06:05Z im Sommer)', () => {
    expect(parseExportFile('termino_export_2026-09-07_0805.json')?.exportedAt).toBe('2026-09-07T06:05:00.000Z');
    expect(parseExportFile('patienten.json')).toBeNull();
  });

  it('listet nur Exportdateien, chronologisch', () => {
    expect(listExportFiles(names).map((f) => f.file)).toEqual([
      'termino_export_2026-09-07_0800.json',
      'termino_export_2026-09-07_0805.json',
    ]);
  });

  it('ein Export ist erst fällig, wenn seine Uhrzeit erreicht ist', () => {
    const files = listExportFiles(names);
    expect(latestDueExport(files, '2026-09-07T05:40:00Z')).toBeNull(); // 07:40
    expect(latestDueExport(files, '2026-09-07T06:00:00Z')?.file).toBe('termino_export_2026-09-07_0800.json');
    expect(latestDueExport(files, '2026-09-07T06:04:59Z')?.file).toBe('termino_export_2026-09-07_0800.json');
    expect(latestDueExport(files, '2026-09-07T06:07:00Z')?.file).toBe('termino_export_2026-09-07_0805.json');
  });

  it('startet vor dem ersten Export mit dem frühesten Export als Ausgangsstand', () => {
    const files = listExportFiles(names);
    expect(baselineExport(files, '2026-09-07T05:40:00Z')?.file).toBe('termino_export_2026-09-07_0800.json');
    expect(baselineExport(files, '2026-09-07T07:00:00Z')?.file).toBe('termino_export_2026-09-07_0805.json');
    expect(baselineExport([], '2026-09-07T05:40:00Z')).toBeNull();
  });

  it('teilt die Zeit in 5-Minuten-Takte', () => {
    expect(importSlot('2026-09-07T06:00:00Z')).toBe(importSlot('2026-09-07T06:04:59Z'));
    expect(importSlot('2026-09-07T06:05:00Z')).toBe(importSlot('2026-09-07T06:00:00Z') + 1);
  });
});
