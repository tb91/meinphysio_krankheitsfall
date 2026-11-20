import type { CaseView } from './api';
import { shortLocation, time, untilLabel } from './format';

export function CaseList({
  cases,
  selectedId,
  onSelect,
}: {
  cases: CaseView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="panel case-list" aria-label="Betroffene Termine">
      <h2>
        Betroffene Termine <span className="muted">nach Startzeit</span>
      </h2>
      <ol>
        {cases.map((c) => {
          const m = c.contact.minutesUntilStart;
          const urgency = c.state.decision ? '' : m <= 60 ? 'urgent' : m <= 120 ? 'soon' : '';
          return (
            <li key={c.appointmentId}>
              <button
                className={`case-row ${c.appointmentId === selectedId ? 'selected' : ''} ${c.state.status}`}
                onClick={() => onSelect(c.appointmentId)}
              >
                <span className="case-time">{time(c.startsAt)}</span>
                <span className="case-main">
                  <span className="case-name">{c.patient.name}</span>
                  <span className="case-meta">
                    {c.serviceCode ?? c.service} · {shortLocation(c.location.name)}
                    {c.warnings.length > 0 && <span className="warn-count" title={c.warnings.join('\n')}>⚠ {c.warnings.length}</span>}
                  </span>
                </span>
                <span className="case-side">
                  {!c.state.decision && <span className={`until ${urgency}`}>{untilLabel(m)}</span>}
                  <Steps c={c} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Steps({ c }: { c: CaseView }) {
  const d = c.state.decision;
  return (
    <span className="steps" aria-label="Status">
      <span className={`step ${d ? 'ok' : ''}`} title="Entscheidung">
        {d ? (d.kind === 'cancelled' ? 'Abgesagt' : 'Umgebucht') : 'Offen'}
      </span>
      <span className={`dot ${c.state.notifiedVia ? 'ok' : ''}`} title="Patient:in informiert" />
      <span className={`dot ${c.state.terminoSynced ? 'ok' : ''}`} title="In Termino eingetragen" />
    </span>
  );
}
