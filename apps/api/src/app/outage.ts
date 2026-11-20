import {
  type Actor,
  type AuditEntry,
  type AuditLog,
  recordCancellation,
  recordFailedCallAttempt,
  recordNotification,
  recordRebooking,
  recordTerminoSync,
} from '../domain/auditLog.js';
import { type CaseState, type ContactChannel, deriveCaseState } from '../domain/caseState.js';
import { composeMessage, type ContactRecommendation, recommendContact, writtenChannels } from '../domain/contact.js';
import type { ImportReport } from '../domain/importer.js';
import { buildPatientIndex, matchPatient, type PatientIndex } from '../domain/patientMatching.js';
import { serviceCodeFor } from '../domain/services.js';
import { createSlotLedger, reserve, type SlotLedger } from '../domain/slotLedger.js';
import { type Interval, type Suggestion, suggestReplacements } from '../domain/suggestions.js';
import type { IsoDate, MasterData, Praxis, ServiceCode, TerminoAppointment, UtcIso } from '../domain/types.js';
import { findVerordnung, startDeadline } from '../domain/verordnung.js';
import { buildWorklist, type WorklistItem } from '../domain/worklist.js';

/**
 * Anwendungslogik für den Ausfall-Fall: verbindet Import, Arbeitsliste, Vorschläge und Protokoll.
 * Alles hier ist eine Funktion von (Daten, Audit-Log, Zeit). Persistenz macht der Aufrufer.
 */
export interface OutageContext {
  master: MasterData;
  appointments: TerminoAppointment[];
  importReport: ImportReport;
  practitionerId: string;
  date: IsoDate;
}

export interface CaseView {
  position: number;
  appointmentId: string;
  startsAt: UtcIso;
  endsAt: UtcIso;
  durationMin: number;
  service: string;
  serviceCode: ServiceCode | null;
  location: { id: string; name: string };
  patient: {
    name: string;
    terminoId: string | null;
    birthDate: string | null;
    phone: string | null;
    email: string | null;
    match: 'linked' | 'fuzzy' | 'unknown';
  };
  warnings: string[];
  verordnung: {
    heilmittel: ServiceCode;
    diagnosegruppe: string;
    ausstellungsdatum: IsoDate;
    menge: number;
    frequenzProWoche: number;
    /** Frist für Behandlungsbeginn, nur gesetzt wenn keine frühere Behandlung erkennbar ist */
    startDeadline: IsoDate | null;
  } | null;
  contact: ContactRecommendation;
  state: CaseState;
  message: string | null;
  suggestions: Suggestion[];
  history: AuditEntry[];
}

export interface OutageView {
  now: UtcIso;
  date: IsoDate;
  practitioner: { id: string; name: string };
  importSummary: {
    exportId: string;
    exportedAt: UtcIso;
    received: number;
    imported: number;
    withWarnings: number;
    rejected: number;
  };
  progress: { total: number; decided: number; notified: number; synced: number; done: number };
  cases: CaseView[];
}

export class CommandError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Derived {
  worklist: WorklistItem[];
  byId: Map<string, TerminoAppointment>;
  states: Map<string, CaseState>;
  entries: Map<string, AuditEntry[]>;
  ledger: SlotLedger;
  patientIndex: PatientIndex;
  praxisByLocation: Map<string, Praxis>;
}

function derive(ctx: OutageContext, log: AuditLog): Derived {
  const worklist = buildWorklist(ctx.appointments, { practitionerId: ctx.practitionerId, date: ctx.date });
  const byId = new Map(ctx.appointments.map((a) => [a.id, a]));

  const entries = new Map<string, AuditEntry[]>();
  for (const e of log.entries) {
    const list = entries.get(e.appointmentId) ?? [];
    list.push(e);
    entries.set(e.appointmentId, list);
  }

  const patientIndex = buildPatientIndex(ctx.master.patienten);
  const contacts = new Map(worklist.map((w) => [w.appointmentId, contactOf(byId.get(w.appointmentId)!, patientIndex)]));
  const states = new Map(
    worklist.map((w) => {
      const c = contacts.get(w.appointmentId)!;
      return [w.appointmentId, deriveCaseState(entries.get(w.appointmentId) ?? [], writtenChannels(c.phone, c.email))];
    }),
  );

  // Belegung = Termino + aktuell gültige Umbuchungen (abgesagte/geänderte geben frei).
  let ledger = createSlotLedger(ctx.appointments);
  for (const w of worklist) {
    const d = states.get(w.appointmentId)?.decision;
    if (d?.kind !== 'rebooked') continue;
    const res = reserve(ledger, {
      practitionerId: d.to.practitionerId,
      startsAt: d.to.startsAt,
      durationMin: byId.get(w.appointmentId)!.duration_min,
      refId: w.appointmentId,
    });
    if (res.ok) ledger = res.ledger;
  }

  return {
    worklist,
    byId,
    states,
    entries,
    ledger,
    patientIndex,
    praxisByLocation: new Map(ctx.master.praxen.map((p) => [p.termino_location_id, p])),
  };
}

/** Kontaktdaten: aus Termino, ergänzt um sicher verknüpfte Stammdaten. */
function contactOf(appt: TerminoAppointment, index: PatientIndex): { phone: string | null; email: string | null } {
  const match = matchPatient(appt.patient, index);
  const linked = match.kind === 'linked' ? match.patient : null;
  return {
    phone: appt.patient?.phone || linked?.telefon || null,
    email: appt.patient?.email || linked?.email || null,
  };
}

function patientBusy(ctx: OutageContext, d: Derived, appt: TerminoAppointment): Interval[] {
  const pid = appt.patient?.id;
  if (!pid) return [];
  const affected = new Set(d.worklist.map((w) => w.appointmentId));
  const busy: Interval[] = [];
  for (const a of ctx.appointments) {
    // Annas Termine finden in ursprünglicher Form nicht statt.
    if (a.status !== 'booked' || a.patient?.id !== pid || affected.has(a.id)) continue;
    busy.push({ startsAt: a.starts_at, durationMin: a.duration_min });
  }
  for (const w of d.worklist) {
    if (w.appointmentId === appt.id || w.terminoPatientId !== pid) continue;
    const dec = d.states.get(w.appointmentId)?.decision;
    if (dec?.kind === 'rebooked') busy.push({ startsAt: dec.to.startsAt, durationMin: d.byId.get(w.appointmentId)!.duration_min });
  }
  return busy;
}

function suggestionsFor(ctx: OutageContext, d: Derived, appt: TerminoAppointment, now: UtcIso, deadline: IsoDate | null, limit?: number) {
  return suggestReplacements({
    appointment: appt,
    serviceCode: serviceCodeFor(appt.service),
    praxisId: d.praxisByLocation.get(appt.location_id)?.id ?? null,
    therapeuten: ctx.master.therapeuten,
    ledger: d.ledger,
    patientBusy: patientBusy(ctx, d, appt),
    now,
    deadline,
    limit,
  });
}

function buildCase(ctx: OutageContext, d: Derived, item: WorklistItem, now: UtcIso): CaseView {
  const appt = d.byId.get(item.appointmentId)!;
  const code = serviceCodeFor(appt.service);
  const praxis = d.praxisByLocation.get(appt.location_id);
  const match = matchPatient(appt.patient, d.patientIndex);
  const linked = match.kind === 'linked' ? match.patient : null;
  const warnings: string[] = [];

  if (match.kind === 'fuzzy') {
    const c = match.candidates.map((p) => `${p.vorname} ${p.nachname} (geb. ${p.geburtsdatum})`).join(', ');
    warnings.push(`Nicht sicher mit Stammdaten verknüpft. Möglicher Treffer: ${c}. Bitte prüfen und in Termino verknüpfen.`);
  }
  if (match.kind === 'unknown') warnings.push('Kein Stammdatensatz gefunden, daher auch keine Verordnung prüfbar.');
  if (!code) warnings.push(`Leistung "${appt.service}" ist keinem Heilmittel zugeordnet.`);

  const { phone, email } = contactOf(appt, d.patientIndex);
  if (!phone) warnings.push('Keine Telefonnummer hinterlegt.');

  const sameDay = d.worklist.filter((w) => w.terminoPatientId && w.terminoPatientId === item.terminoPatientId);
  if (sameDay.length > 1) {
    warnings.push(`Patient:in hat heute ${sameDay.length} betroffene Termine. Mögliche Doppelbuchung prüfen.`);
  }

  // Verordnung: nur für sicher verknüpfte Patient:innen.
  const vo = linked ? findVerordnung(ctx.master.verordnungen, linked.id, code) : null;
  let deadline: IsoDate | null = null;
  if (linked && !vo) warnings.push('Keine passende Verordnung gefunden.');
  if (vo) {
    const earlier = ctx.appointments.some(
      (a) => a.status === 'booked' && a.patient?.id === appt.patient?.id && Date.parse(a.starts_at) < Date.parse(appt.starts_at),
    );
    // Konservativ: Ohne sichtbare frühere Behandlung gilt die Frist für den Behandlungsbeginn.
    if (!earlier) {
      deadline = startDeadline(vo);
      warnings.push(`Erstbehandlung: laut Verordnung muss die Behandlung bis ${deadline} beginnen.`);
    }
  }

  const state = d.states.get(item.appointmentId)!;
  const locationName = praxis?.name ?? appt.location_id;
  let message: string | null = null;
  if (state.decision) {
    message = composeMessage({
      patientName: item.patientName,
      originalStartsAt: appt.starts_at,
      locationName,
      decision:
        state.decision.kind === 'cancelled'
          ? { kind: 'cancelled' }
          : {
              kind: 'rebooked',
              practitionerName: state.decision.to.practitionerName,
              startsAt: state.decision.to.startsAt,
              sameSlot: Date.parse(state.decision.to.startsAt) === Date.parse(appt.starts_at),
            },
    });
  }

  return {
    position: item.position,
    appointmentId: appt.id,
    startsAt: appt.starts_at,
    endsAt: item.endsAt,
    durationMin: appt.duration_min,
    service: appt.service,
    serviceCode: code,
    location: { id: appt.location_id, name: locationName },
    patient: {
      name: item.patientName,
      terminoId: appt.patient?.id ?? null,
      birthDate: appt.patient?.birth_date ?? null,
      phone,
      email,
      match: match.kind,
    },
    warnings,
    verordnung: vo
      ? {
          heilmittel: vo.heilmittel,
          diagnosegruppe: vo.diagnosegruppe,
          ausstellungsdatum: vo.ausstellungsdatum,
          menge: vo.verordnungsmenge,
          frequenzProWoche: vo.frequenz_pro_woche,
          startDeadline: deadline,
        }
      : null,
    contact: recommendContact({ startsAt: appt.starts_at, now, phone, email, failedCallAttempts: state.failedCallAttempts }),
    state,
    message,
    suggestions: suggestionsFor(ctx, d, appt, now, deadline),
    history: d.entries.get(appt.id) ?? [],
  };
}

export function buildOutageView(ctx: OutageContext, log: AuditLog, now: UtcIso): OutageView {
  const d = derive(ctx, log);
  const cases = d.worklist.map((w) => buildCase(ctx, d, w, now));
  const t = ctx.master.therapeuten.find((x) => x.termino_practitioner_id === ctx.practitionerId);
  const states = cases.map((c) => c.state);

  return {
    now,
    date: ctx.date,
    practitioner: { id: ctx.practitionerId, name: t ? `${t.vorname} ${t.nachname}` : ctx.practitionerId },
    importSummary: {
      exportId: ctx.importReport.exportId,
      exportedAt: ctx.importReport.exportedAt,
      received: ctx.importReport.received,
      imported: ctx.importReport.counts.imported,
      withWarnings: ctx.importReport.counts.imported_with_warnings,
      rejected: ctx.importReport.counts.rejected,
    },
    progress: {
      total: cases.length,
      decided: states.filter((s) => s.decision).length,
      notified: states.filter((s) => s.informed).length,
      synced: states.filter((s) => s.terminoSynced).length,
      done: states.filter((s) => s.status === 'done').length,
    },
    cases,
  };
}

// ---------- Befehle: liefern den neuen Protokolleintrag, schreiben nichts selbst ----------

function requireCase(ctx: OutageContext, d: Derived, appointmentId: string): TerminoAppointment {
  if (!d.worklist.some((w) => w.appointmentId === appointmentId)) {
    throw new CommandError(404, `Termin ${appointmentId} gehört nicht zum Ausfall`);
  }
  return d.byId.get(appointmentId)!;
}

function reception(name: string): Actor {
  return { kind: 'reception', name };
}

function lastEntry(log: AuditLog): AuditEntry {
  return log.entries.at(-1)!;
}

export function rebookCommand(
  ctx: OutageContext,
  log: AuditLog,
  now: UtcIso,
  input: { appointmentId: string; actorName: string; practitionerId: string; startsAt: UtcIso },
): AuditEntry {
  const d = derive(ctx, log);
  const appt = requireCase(ctx, d, input.appointmentId);

  // Nur zulässige Slots: dieselben Regeln wie die Vorschläge (Qualifikation, Arbeitszeit, Vorlauf, Patient:in frei).
  const target = Date.parse(input.startsAt);
  const allowed = suggestionsFor(ctx, d, appt, now, null, Number.POSITIVE_INFINITY).find(
    (s) => s.practitionerId === input.practitionerId && Date.parse(s.startsAt) === target,
  );

  const res = reserve(d.ledger, {
    practitionerId: input.practitionerId,
    startsAt: new Date(target).toISOString(),
    durationMin: appt.duration_min,
    refId: appt.id,
  });
  if (!res.ok) {
    const other = d.byId.get(res.conflictsWith.refId)?.patient?.name;
    throw new CommandError(
      409,
      res.conflictsWith.source === 'rebooking'
        ? `Slot ist inzwischen vergeben (Umbuchung für ${other ?? res.conflictsWith.refId}).`
        : 'Slot ist in Termino bereits belegt.',
    );
  }
  if (!allowed) throw new CommandError(422, 'Dieser Slot ist für den Termin nicht zulässig.');

  const t = ctx.master.therapeuten.find((x) => x.termino_practitioner_id === input.practitionerId)!;
  const locationName = d.praxisByLocation.get(appt.location_id)?.name ?? appt.location_id;
  return lastEntry(
    recordRebooking(log, {
      appointment: appt,
      locationName,
      actor: reception(input.actorName),
      at: now,
      to: { practitionerId: input.practitionerId, practitionerName: `${t.vorname} ${t.nachname}`, startsAt: allowed.startsAt, locationName },
    }),
  );
}

export function cancelCommand(
  ctx: OutageContext,
  log: AuditLog,
  now: UtcIso,
  input: { appointmentId: string; actorName: string; reason: string },
): AuditEntry {
  const d = derive(ctx, log);
  const appt = requireCase(ctx, d, input.appointmentId);
  const locationName = d.praxisByLocation.get(appt.location_id)?.name ?? appt.location_id;
  return lastEntry(
    recordCancellation(log, { appointment: appt, locationName, actor: reception(input.actorName), at: now, reason: input.reason }),
  );
}

/**
 * Änderung am Protokoll. Bestätigungen sind umschaltbar: ein Klick legt einen Eintrag an,
 * ein zweiter entfernt ihn wieder. Ein Kanalwechsel ersetzt den bisherigen Eintrag.
 * So entsteht pro Fall höchstens ein gültiger "informiert"- und "in Termino"-Eintrag.
 */
export interface LogChange {
  add: AuditEntry | null;
  remove: string[];
}

const NO_CHANGE: LogChange = { add: null, remove: [] };

function requireDecidedCase(ctx: OutageContext, d: Derived, appointmentId: string, message: string) {
  const appt = requireCase(ctx, d, appointmentId);
  const state = d.states.get(appt.id)!;
  if (!state.decision) throw new CommandError(409, message);
  return { appt, state };
}

export function notifyCommand(
  ctx: OutageContext,
  log: AuditLog,
  now: UtcIso,
  input: { appointmentId: string; actorName: string; channel: ContactChannel },
): LogChange {
  const d = derive(ctx, log);
  const { appt, state } = requireDecidedCase(ctx, d, input.appointmentId, 'Erst entscheiden, dann informieren.');
  // Kanäle sind unabhängig (SMS und E-Mail werden beide verschickt): nur hinzufügen, nichts ersetzen.
  if (state.notifiedChannels.includes(input.channel)) return NO_CHANGE;
  return {
    add: lastEntry(recordNotification(log, { appointment: appt, actor: reception(input.actorName), at: now, channel: input.channel })),
    remove: [],
  };
}

export function withdrawNotificationCommand(
  ctx: OutageContext,
  log: AuditLog,
  input: { appointmentId: string; channel: ContactChannel },
): LogChange {
  const d = derive(ctx, log);
  const state = d.states.get(requireCase(ctx, d, input.appointmentId).id)!;
  const id = state.notificationEntryIds[input.channel];
  return id ? { add: null, remove: [id] } : NO_CHANGE;
}

/** Angerufen, nicht erreicht: wird immer protokolliert und nie entfernt. */
export function failedCallCommand(
  ctx: OutageContext,
  log: AuditLog,
  now: UtcIso,
  input: { appointmentId: string; actorName: string },
): LogChange {
  const d = derive(ctx, log);
  const { appt } = requireDecidedCase(ctx, d, input.appointmentId, 'Erst entscheiden, dann anrufen.');
  return { add: lastEntry(recordFailedCallAttempt(log, { appointment: appt, actor: reception(input.actorName), at: now })), remove: [] };
}

export function terminoSyncCommand(
  ctx: OutageContext,
  log: AuditLog,
  now: UtcIso,
  input: { appointmentId: string; actorName: string },
): LogChange {
  const d = derive(ctx, log);
  const { appt, state } = requireDecidedCase(ctx, d, input.appointmentId, 'Es gibt noch keine Entscheidung zum Nachtragen.');
  if (state.terminoSynced) return NO_CHANGE;
  return { add: lastEntry(recordTerminoSync(log, { appointment: appt, actor: reception(input.actorName), at: now })), remove: [] };
}

export function withdrawTerminoSyncCommand(ctx: OutageContext, log: AuditLog, input: { appointmentId: string }): LogChange {
  const d = derive(ctx, log);
  const state = d.states.get(requireCase(ctx, d, input.appointmentId).id)!;
  return state.terminoSyncEntryId ? { add: null, remove: [state.terminoSyncEntryId] } : NO_CHANGE;
}
