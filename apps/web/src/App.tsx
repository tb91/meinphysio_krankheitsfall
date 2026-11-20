import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { AuditPanel } from './AuditPanel';
import { CaseDetail } from './CaseDetail';
import { CaseList } from './CaseList';
import { germanDate, longDate, time } from './format';

const NAME_KEY = 'ausfall.actorName';

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [actorName, setActorName] = useState(readName);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Mehrere Personen am Empfang: regelmäßig neu laden, damit alle denselben Stand sehen.
  const outage = useQuery({ queryKey: ['outage'], queryFn: api.outage, refetchInterval: 5000 });

  useEffect(() => {
    try {
      localStorage.setItem(NAME_KEY, actorName);
    } catch {
      /* ohne Storage geht es auch */
    }
  }, [actorName]);

  const view = outage.data;
  const cases = view?.cases ?? [];
  const selected = cases.find((c) => c.appointmentId === selectedId) ?? cases.find((c) => c.state.status !== 'done') ?? cases[0];

  // Automatische Auswahl festhalten, sonst springt die Ansicht weg, sobald der Fall erledigt ist.
  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.appointmentId);
  }, [selectedId, selected]);

  function selectNextOpen() {
    if (!selected) return;
    const after = cases.filter((c) => c.position > selected.position && c.state.status !== 'done');
    const next = after[0] ?? cases.find((c) => c.state.status !== 'done' && c.appointmentId !== selected.appointmentId);
    if (next) setSelectedId(next.appointmentId);
  }

  if (outage.isLoading) return <div className="loading">Lade Termine…</div>;
  if (outage.isError || !view) {
    return <div className="loading error">API nicht erreichbar: {String(outage.error)}</div>;
  }

  const p = view.progress;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Ausfall-Assistent</h1>
          <p className="subtitle">
            <strong>{view.practitioner.name}</strong> fällt aus · {longDate(view.date)} · jetzt {time(view.now)} Uhr
          </p>
        </div>
        <label className={`actor ${actorName.trim() ? '' : 'missing'}`}>
          <span>Am Empfang</span>
          <input
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="Dein Name (Pflicht)"
            aria-label="Name am Empfang"
          />
        </label>
      </header>

      <section className="progress" aria-label="Fortschritt">
        <Progress label="Entschieden" value={p.decided} total={p.total} />
        <Progress label="Informiert" value={p.notified} total={p.total} />
        <Progress label="In Termino" value={p.synced} total={p.total} />
        <p className="import-note">
          Termino-Export {time(view.importSummary.exportedAt)} Uhr: {view.importSummary.received} Termine,{' '}
          {view.importSummary.withWarnings} mit Hinweisen, {view.importSummary.rejected} abgelehnt.
          <br />
          Änderungen werden <strong>nicht automatisch</strong> in Termino übertragen.
        </p>
      </section>

      <main className="workspace">
        <CaseList cases={cases} selectedId={selected?.appointmentId ?? null} onSelect={setSelectedId} />
        {selected ? (
          <CaseDetail key={selected.appointmentId} c={selected} actorName={actorName.trim()} onNext={selectNextOpen} />
        ) : (
          <div className="panel empty">Keine betroffenen Termine am {germanDate(view.date)}.</div>
        )}
      </main>

      <AuditPanel />
    </div>
  );
}

function Progress({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress-item">
      <div className="progress-head">
        <span>{label}</span>
        <strong>
          {value}/{total}
        </strong>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
