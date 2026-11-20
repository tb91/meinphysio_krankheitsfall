import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Nur für den Testlauf/die Vorführung:
 * - "Testlauf zurücksetzen": leert das Protokoll, stellt die Szenario-Uhr auf 07:40 und den Termino-Ausgangsstand her.
 * - "Uhr auf 08:05": springt zum nächsten Termino-Export. Den Import macht der Sync-Job (wie im Betrieb),
 *   sobald er den neuen 5-Minuten-Takt sieht; das dauert ein paar Sekunden.
 * Bewusst anders gestaltet (Warnstreifen, Monospace), damit klar ist, dass das keine Funktion
 * für den Empfang ist. In Produktion gäbe es diese Buttons nicht.
 */
const IMPORT_TIME = '08:05';

export function TestRunReset() {
  const qc = useQueryClient();
  const [waitingForImport, setWaitingForImport] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['outage'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const reset = useMutation({ mutationFn: api.reset, onSuccess: refresh });
  const jump = useMutation({
    mutationFn: () => api.setClock(IMPORT_TIME),
    onSuccess: () => {
      refresh();
      setWaitingForImport(true);
    },
  });

  // Der Sync-Job fragt alle paar Sekunden die Uhr ab; so lange kurz "Import läuft" zeigen.
  useEffect(() => {
    if (!waitingForImport) return;
    const t = setTimeout(() => {
      setWaitingForImport(false);
      refresh();
    }, 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForImport]);

  const busy = reset.isPending || jump.isPending;

  return (
    <div className="testrun" role="region" aria-label="Nur für den Testlauf">
      <span className="testrun-label">TESTLAUF</span>
      <button
        className="testrun-btn"
        disabled={busy || waitingForImport}
        onClick={() => jump.mutate()}
      >
        {waitingForImport ? 'Import läuft…' : `» Uhr auf ${IMPORT_TIME} (Import)`}
      </button>
      <button
        className="testrun-btn"
        disabled={busy}
        onClick={() => {
          if (confirm('Testlauf zurücksetzen? Das komplette Protokoll wird gelöscht und die Uhr wieder auf den Szenario-Start (07:40 Uhr) gestellt.')) reset.mutate();
        }}
      >
        {reset.isPending ? 'setze zurück…' : '↺ Testlauf zurücksetzen'}
      </button>
    </div>
  );
}
