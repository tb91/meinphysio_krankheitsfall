import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function AuditPanel() {
  const audit = useQuery({ queryKey: ['audit'], queryFn: api.audit, refetchInterval: 5000 });
  const entries = audit.data?.entries ?? [];

  return (
    <section className="panel audit">
      <header className="audit-head">
        <h2>
          Protokoll <span className="muted">neueste zuerst</span>
        </h2>
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
