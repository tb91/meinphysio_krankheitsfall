// API-Typen (gespiegelt aus apps/api/src/app/outage.ts) und Fetch-Helfer.

export type ContactChannel = 'phone' | 'sms' | 'email';

export interface Suggestion {
  practitionerId: string;
  practitionerName: string;
  startsAt: string;
  durationMin: number;
  sameSlot: boolean;
  afterDeadline: boolean;
  reasons: string[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: { kind: 'reception' | 'system'; name: string };
  action: 'appointment_cancelled' | 'appointment_rebooked' | 'patient_notified' | 'termino_synced';
  appointmentId: string;
  patientName: string;
  message: string;
}

export type Decision =
  | { kind: 'cancelled'; reason: string; at: string; by: string }
  | {
      kind: 'rebooked';
      at: string;
      by: string;
      to: { practitionerId: string; practitionerName: string; startsAt: string; locationName: string };
    };

export interface CaseView {
  position: number;
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  service: string;
  serviceCode: string | null;
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
    heilmittel: string;
    diagnosegruppe: string;
    ausstellungsdatum: string;
    menge: number;
    frequenzProWoche: number;
    startDeadline: string | null;
  } | null;
  contact: { channel: ContactChannel | null; urgent: boolean; minutesUntilStart: number; note: string | null };
  state: {
    status: 'open' | 'in_progress' | 'done';
    decision: Decision | null;
    notifiedVia: ContactChannel | null;
    terminoSynced: boolean;
    notificationEntryId: string | null;
    terminoSyncEntryId: string | null;
  };
  message: string | null;
  suggestions: Suggestion[];
  history: AuditEntry[];
}

export interface OutageView {
  now: string;
  date: string;
  practitioner: { id: string; name: string };
  importSummary: {
    exportId: string;
    exportedAt: string;
    received: number;
    imported: number;
    withWarnings: number;
    rejected: number;
  };
  progress: { total: number; decided: number; notified: number; synced: number; done: number };
  cases: CaseView[];
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Fehler ${res.status}`);
  return body as T;
}

export const api = {
  outage: () => request<OutageView>('/api/outage'),
  audit: () => request<{ entries: AuditEntry[] }>('/api/audit'),
  rebook: (id: string, body: { actorName: string; practitionerId: string; startsAt: string }) =>
    request<AuditEntry>(`/api/cases/${id}/rebook`, { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string, body: { actorName: string; reason: string }) =>
    request<AuditEntry>(`/api/cases/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),
  notify: (id: string, body: { actorName: string; channel: ContactChannel }) =>
    request<unknown>(`/api/cases/${id}/notify`, { method: 'POST', body: JSON.stringify(body) }),
  withdrawNotify: (id: string) => request<unknown>(`/api/cases/${id}/notify`, { method: 'DELETE' }),
  terminoSynced: (id: string, body: { actorName: string }) =>
    request<unknown>(`/api/cases/${id}/termino-synced`, { method: 'POST', body: JSON.stringify(body) }),
  withdrawTerminoSynced: (id: string) => request<unknown>(`/api/cases/${id}/termino-synced`, { method: 'DELETE' }),
  reset: () => request<{ ok: boolean }>('/api/demo/reset', { method: 'POST' }),
};
