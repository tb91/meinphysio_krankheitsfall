import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Nur für den Testlauf/die Vorführung: leert das Protokoll und stellt die Szenario-Uhr auf 07:40.
 * Bewusst anders gestaltet (Warnstreifen, Monospace), damit klar ist, dass das
 * keine Funktion für den Empfang ist. In Produktion würde es diesen Button nicht geben.
 */
export function TestRunReset() {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['outage'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  return (
    <div className="testrun" role="region" aria-label="Nur für den Testlauf">
      <span className="testrun-label">TESTLAUF</span>
      <button
        className="testrun-btn"
        disabled={reset.isPending}
        onClick={() => {
          if (confirm('Testlauf zurücksetzen? Das komplette Protokoll wird gelöscht und die Uhr wieder auf den Szenario-Start (07:40 Uhr) gestellt.')) reset.mutate();
        }}
      >
        {reset.isPending ? 'setze zurück…' : '↺ Testlauf zurücksetzen'}
      </button>
    </div>
  );
}
