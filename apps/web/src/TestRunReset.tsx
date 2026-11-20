import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Nur für den Testlauf/die Vorführung: setzt das komplette Protokoll zurück.
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
          if (confirm('Testlauf zurücksetzen? Das komplette Protokoll wird gelöscht.')) reset.mutate();
        }}
      >
        {reset.isPending ? 'setze zurück…' : '↺ Protokoll zurücksetzen'}
      </button>
    </div>
  );
}
