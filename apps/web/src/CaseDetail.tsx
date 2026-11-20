import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CaseView, type ContactChannel, type Suggestion } from './api';
import { CHANNEL_LABEL, dayTime, germanDate, shortLocation, time, untilLabel } from './format';

const DEFAULT_REASON = 'Therapeutin ausgefallen, kein passender Ersatztermin';

export function CaseDetail({ c, actorName, onNext }: { c: CaseView; actorName: string; onNext: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['outage'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
  };
  const opts = { onSuccess: () => { setEditing(false); refresh(); }, onError: refresh };

  const rebook = useMutation({ mutationFn: (s: Suggestion) => api.rebook(c.appointmentId, { actorName, practitionerId: s.practitionerId, startsAt: s.startsAt }), ...opts });
  const cancel = useMutation({ mutationFn: () => api.cancel(c.appointmentId, { actorName, reason }), ...opts });
  // Umschalter: erneuter Klick auf die aktive Bestätigung nimmt sie zurück (Eintrag wird entfernt).
  const notify = useMutation({
    mutationFn: (channel: ContactChannel) =>
      c.state.notifiedChannels.includes(channel)
        ? api.withdrawNotify(c.appointmentId, channel)
        : api.notify(c.appointmentId, { actorName, channel }),
    ...opts,
  });
  const callFailed = useMutation({ mutationFn: () => api.callFailed(c.appointmentId, { actorName }), ...opts });
  const synced = useMutation({
    mutationFn: () =>
      c.state.terminoSynced
        ? api.withdrawTerminoSynced(c.appointmentId)
        : api.terminoSynced(c.appointmentId, { actorName }),
    ...opts,
  });

  const busy = rebook.isPending || cancel.isPending || notify.isPending || callFailed.isPending || synced.isPending;
  const error = rebook.error ?? cancel.error ?? notify.error ?? callFailed.error ?? synced.error;
  const noName = !actorName;
  const disabled = busy || noName;
  const d = c.state.decision;
  const openWritten = c.contact.written.filter((ch) => !c.state.notifiedChannels.includes(ch));
  const showDecision = !d || editing;

  async function copyMessage() {
    if (!c.message) return;
    try {
      await navigator.clipboard.writeText(c.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Zwischenablage nicht verfügbar: Text ist markierbar */
    }
  }

  return (
    <article className="panel detail">
      <header className="detail-head">
        <div>
          <h2>{c.patient.name}</h2>
          <p className="muted">
            {dayTime(c.startsAt)} – {time(c.endsAt)} · {c.service} ({c.durationMin} Min.) · {c.location.name}
          </p>
        </div>
        {!d && <span className={`until big ${c.contact.minutesUntilStart <= 60 ? 'urgent' : c.contact.minutesUntilStart <= 120 ? 'soon' : ''}`}>{untilLabel(c.contact.minutesUntilStart)}</span>}
      </header>

      {noName && <p className="banner warn">Bitte oben deinen Namen eintragen. Jede Entscheidung wird mit Namen protokolliert.</p>}
      {error && <p className="banner error">{error.message}</p>}

      <div className="facts">
        <section>
          <h3>Kontakt</h3>
          <p>
            Tel.: {c.patient.phone ? <a href={`tel:${c.patient.phone.replace(/\s/g, '')}`}>{c.patient.phone}</a> : <em>keine</em>}
            <br />
            E-Mail: {c.patient.email ?? <em>keine</em>}
          </p>
          {c.contact.steps.length > 0 && (
            <p className="recommend">
              Reihenfolge: {c.contact.steps.map(stepLabel).join(' → ')}
              <span className="muted"> {c.contact.urgent ? '(Termin in ≤ 2 h)' : '(Termin in > 2 h)'}</span>
            </p>
          )}
          {/* Hinweis zu Anrufversuchen steht direkt bei den Buttons in Schritt 2 */}
          {c.contact.note && c.state.failedCallAttempts === 0 && <p className="note">{c.contact.note}</p>}
        </section>
        <section>
          <h3>Verordnung</h3>
          {c.verordnung ? (
            <p>
              {c.verordnung.heilmittel}, {c.verordnung.diagnosegruppe}, {c.verordnung.menge}× ({c.verordnung.frequenzProWoche}×/Woche)
              <br />
              ausgestellt {germanDate(c.verordnung.ausstellungsdatum)}
              {c.verordnung.startDeadline && (
                <>
                  <br />
                  <strong>Behandlungsbeginn bis {germanDate(c.verordnung.startDeadline)}</strong>
                </>
              )}
            </p>
          ) : (
            <p className="muted">nicht gefunden</p>
          )}
        </section>
      </div>

      {c.warnings.length > 0 && (
        <ul className="warnings">
          {c.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {/* Schritt 1: Entscheidung */}
      <section className="step-block">
        <h3>
          <span className={`num ${d ? 'ok' : ''}`}>1</span> Entscheiden
        </h3>
        {d && !editing && (
          <div className="decision">
            <p>
              {d.kind === 'cancelled' ? (
                <>
                  <strong>Abgesagt</strong>: {d.reason}
                </>
              ) : (
                <>
                  <strong>Umgebucht</strong> auf {dayTime(d.to.startsAt)} bei {d.to.practitionerName} ({shortLocation(d.to.locationName)})
                </>
              )}
              <span className="muted"> · von {d.by} um {time(d.at)} Uhr</span>
            </p>
            <button className="link" onClick={() => setEditing(true)} disabled={disabled}>
              Entscheidung ändern
            </button>
          </div>
        )}
        {showDecision && (
          <>
            {c.suggestions.length === 0 ? (
              <p className="muted">Kein passender freier Slot am Standort in den nächsten Tagen gefunden.</p>
            ) : (
              <ul className="suggestions">
                {c.suggestions.map((s) => (
                  <li key={`${s.practitionerId}-${s.startsAt}`} className={s.sameSlot ? 'same' : ''}>
                    <div>
                      <strong>{dayTime(s.startsAt)}</strong> · {s.practitionerName}
                      {s.sameSlot && <span className="tag good">gleiche Uhrzeit</span>}
                      {s.afterDeadline && <span className="tag bad">nach VO-Frist</span>}
                      <div className="reasons">{s.reasons.join(' · ')}</div>
                    </div>
                    <button onClick={() => rebook.mutate(s)} disabled={disabled}>
                      Umbuchen
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="cancel-row">
              <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Grund der Absage" />
              <button className="danger" onClick={() => cancel.mutate()} disabled={disabled || !reason.trim()}>
                Absagen
              </button>
              {editing && (
                <button className="link" onClick={() => setEditing(false)}>
                  Abbrechen
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* Schritt 2: Informieren */}
      <section className={`step-block ${d ? '' : 'locked'}`}>
        <h3>
          <span className={`num ${c.state.informed ? 'ok' : ''}`}>2</span> Patient:in informieren
        </h3>
        {c.message ? (
          <>
            <p className="message">{c.message}</p>
            <div className="actions">
              <button className="secondary" onClick={copyMessage}>
                {copied ? 'Kopiert ✓' : 'Text kopieren'}
              </button>
              {channelOrder(c).map((ch) => {
                const active = c.state.notifiedChannels.includes(ch);
                const unavailable = ch === 'email' ? !c.patient.email : !c.patient.phone;
                if (ch === 'phone') {
                  return (
                    <CallButton
                      key={ch}
                      reached={active}
                      disabled={disabled || unavailable}
                      onReached={() => notify.mutate('phone')}
                      onNotReached={() => callFailed.mutate()}
                      onWithdraw={() => notify.mutate('phone')}
                    />
                  );
                }
                return (
                  <button
                    key={ch}
                    className={active ? 'confirmed' : 'secondary'}
                    aria-pressed={active}
                    disabled={disabled || unavailable}
                    onClick={() => notify.mutate(ch)}
                  >
                    {active && '✓ '}Per {CHANNEL_LABEL[ch]} informiert
                  </button>
                );
              })}
            </div>
            {c.state.failedCallAttempts > 0 && (
              <p className="note">
                Telefonisch {c.state.failedCallAttempts}× nicht erreicht (bleibt im Protokoll).
                {!c.state.informed && c.contact.next.length > 0 && ` Weiter per ${stepLabel(c.contact.next)}.`}
              </p>
            )}
            {!c.state.informed && openWritten.length > 0 && openWritten.length < c.contact.written.length && (
              <p className="note">Noch offen: {stepLabel(openWritten)}. Schriftlich immer über alle Kanäle informieren.</p>
            )}
            <p className="muted small">
              Es wird nichts automatisch versendet. Der Text ist ein Vorschlag. Erneuter Klick auf eine grüne Markierung nimmt sie
              zurück.
            </p>
          </>
        ) : (
          <p className="muted">Erst nach der Entscheidung.</p>
        )}
      </section>

      {/* Schritt 3: Termino */}
      <section className={`step-block ${d ? '' : 'locked'}`}>
        <h3>
          <span className={`num ${c.state.terminoSynced ? 'ok' : ''}`}>3</span> In Termino eintragen
        </h3>
        {d ? (
          <>
            <p>
              {d.kind === 'cancelled'
                ? `Termin ${c.appointmentId} in Termino stornieren.`
                : `Termin ${c.appointmentId} in Termino auf ${d.to.practitionerName}, ${dayTime(d.to.startsAt)} verlegen.`}
            </p>
            <div className="actions">
              <button
                className={c.state.terminoSynced ? 'confirmed' : 'secondary'}
                aria-pressed={c.state.terminoSynced}
                onClick={() => synced.mutate()}
                disabled={disabled}
              >
                {c.state.terminoSynced && '✓ '}In Termino erledigt
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Erst nach der Entscheidung.</p>
        )}
      </section>

      {/* Schritt 4: Weiter */}
      <section className="step-block">
        <h3>
          <span className={`num ${c.state.status === 'done' ? 'ok' : ''}`}>4</span> Weiter
        </h3>
        <div className="actions">
          <button className="secondary" onClick={onNext}>
            Nächster offener Termin →
          </button>
        </div>
      </section>

      {c.history.length > 0 && (
        <section className="history">
          <h3>Verlauf</h3>
          <ul>
            {c.history.map((e) => (
              <li key={e.id}>{e.message}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Kanäle in Prioritätsreihenfolge des Falls, nicht verfügbare hinten angehängt. */
function channelOrder(c: CaseView): ContactChannel[] {
  const all: ContactChannel[] = ['phone', 'sms', 'email'];
  const prioritized = c.contact.steps.flat();
  return [...prioritized, ...all.filter((ch) => !prioritized.includes(ch))];
}

/** z. B. ['sms', 'email'] → "SMS + E-Mail" */
function stepLabel(step: ContactChannel[]): string {
  return step.map((ch) => CHANNEL_LABEL[ch]).join(' + ');
}

/**
 * Anruf in zwei Schritten: "Angerufen" → teilt sich in "Erreicht" | "Nicht erreicht".
 * Erreicht = informiert per Anruf (grün, umschaltbar). Nicht erreicht = Versuch wird protokolliert,
 * der Button steht danach wieder auf "Angerufen" für einen weiteren Versuch.
 */
function CallButton({
  reached,
  disabled,
  onReached,
  onNotReached,
  onWithdraw,
}: {
  reached: boolean;
  disabled: boolean;
  onReached: () => void;
  onNotReached: () => void;
  onWithdraw: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (reached) {
    return (
      <button className="call-btn confirmed" aria-pressed disabled={disabled} onClick={onWithdraw}>
        ✓ Per Anruf erreicht
      </button>
    );
  }
  if (asking) {
    return (
      <span className="call-btn split" role="group" aria-label="Ergebnis des Anrufs">
        <button
          className="split-yes"
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onReached();
          }}
        >
          Erreicht
        </button>
        <button
          className="split-no"
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onNotReached();
          }}
        >
          Nicht erreicht
        </button>
      </span>
    );
  }
  return (
    <button className="call-btn secondary" disabled={disabled} onClick={() => setAsking(true)}>
      Angerufen
    </button>
  );
}
