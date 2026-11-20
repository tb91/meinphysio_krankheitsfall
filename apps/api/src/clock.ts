import type { UtcIso } from './domain/types.js';

/**
 * Szenario-Uhr: Das Szenario spielt am 07.09.2026 um 07:40 Uhr. Die Uhr startet bei NOW
 * und läuft ab Serverstart in Echtzeit weiter, damit Zeitstempel im Protokoll plausibel bleiben.
 * Ohne NOW gilt die echte Uhrzeit.
 *
 * `notBefore`: Nach einem Neustart läuft die Uhr ab dem letzten Protokolleintrag weiter
 * statt wieder bei NOW zu beginnen. Zeitstempel springen so nicht zurück.
 *
 * `reset()`: Nur für den Testlauf. Stellt die Uhr wieder auf NOW (z. B. 07:40 Uhr),
 * sinnvoll nur zusammen mit einem geleerten Protokoll.
 */
export interface Clock {
  now(): UtcIso;
  reset(): void;
}

export function createClock(nowEnv: string | undefined, notBefore?: UtcIso): Clock {
  if (!nowEnv) return { now: () => new Date().toISOString(), reset: () => {} };
  const configured = Date.parse(nowEnv);
  if (Number.isNaN(configured)) throw new Error(`NOW ist kein gültiger Zeitpunkt: ${nowEnv}`);

  let start = Math.max(configured, notBefore ? Date.parse(notBefore) : 0);
  let startedAt = Date.now();
  return {
    now: () => new Date(start + (Date.now() - startedAt)).toISOString(),
    reset: () => {
      start = configured;
      startedAt = Date.now();
    },
  };
}
