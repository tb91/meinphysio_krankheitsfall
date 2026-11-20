import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function AuditPanel() {
  const qc = useQueryClient();
  const audit = useQuery({ queryKey: ['audit'], queryFn: api.audit, refetchInterval: 5000 });
  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['outage'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  const entries = audit.data?.entries ?? [];

  return (
    <section className="panel audit">
      <header className="audit-head">
        <h2>
          Protokoll <span className="muted">neueste zuerst</span>
        </h2>
        <button
          className="link"
          onClick={() => {
            if (confirm('Demo zurücksetzen? Das komplette Protokoll wird gelöscht.')) reset.mutate();
          }}
        >
          Demo zurücksetzen
        </button>
      </header>
      {entries.length === 0 ? (
        <p className="muted">Noch keine Entscheidungen.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>{e.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
