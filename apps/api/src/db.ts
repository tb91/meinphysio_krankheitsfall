import pg from 'pg';
import type { AuditEntry, AuditLog } from './domain/auditLog.js';

/**
 * Persistenz: das Audit-Log ist die einzige Quelle der Wahrheit für Entscheidungen.
 * Fallstatus und Belegung werden daraus abgeleitet. Append-only, keine Updates.
 */
export function createPool(connectionString: string | undefined): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  // Bricht die DB eine ruhende Verbindung ab (z. B. Neustart), darf das den Prozess nicht beenden.
  // Der Pool baut beim nächsten Request eine neue Verbindung auf.
  pool.on('error', (err) => console.error('Postgres-Verbindung verloren:', err.message));
  return pool;
}

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists audit_entries (
      seq                bigserial primary key,
      id                 uuid not null unique,
      at                 timestamptz not null,
      actor_kind         text not null,
      actor_name         text not null,
      action             text not null,
      appointment_id     text not null,
      patient_name       text not null,
      termino_patient_id text,
      details            jsonb not null,
      message            text not null
    );
    create index if not exists audit_entries_appointment on audit_entries (appointment_id);
  `);
}

type Queryable = Pick<pg.PoolClient, 'query'>;

export async function loadAuditLog(db: Queryable): Promise<AuditLog> {
  const res = await db.query('select * from audit_entries order by seq');
  return {
    entries: res.rows.map(
      (r): AuditEntry => ({
        id: r.id,
        at: (r.at as Date).toISOString(),
        actor: { kind: r.actor_kind, name: r.actor_name },
        action: r.action,
        appointmentId: r.appointment_id,
        patientName: r.patient_name,
        terminoPatientId: r.termino_patient_id,
        details: r.details,
        message: r.message,
      }),
    ),
  };
}

export async function appendAuditEntry(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `insert into audit_entries
       (id, at, actor_kind, actor_name, action, appointment_id, patient_name, termino_patient_id, details, message)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.id, e.at, e.actor.kind, e.actor.name, e.action, e.appointmentId, e.patientName, e.terminoPatientId, e.details, e.message],
  );
}

/**
 * Serialisiert alle Entscheidungen: liest das Log, prüft und schreibt in einer Transaktion
 * unter einem Advisory-Lock. So können zwei Personen am Empfang nicht gleichzeitig
 * denselben Slot vergeben.
 */
export async function withDecisionLock<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient, log: AuditLog) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(4711)');
    const log = await loadAuditLog(client);
    const result = await fn(client, log);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function resetAuditLog(pool: pg.Pool): Promise<void> {
  await pool.query('truncate audit_entries');
}
