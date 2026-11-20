import Fastify from 'fastify';
import pg from 'pg';

// Gerüst: nur Health-Check. Fachliche Routen folgen, sobald die Domänenlogik steht.
const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

app.get('/api/health', async () => {
  await pool.query('select 1');
  return { ok: true, now: process.env.NOW ?? new Date().toISOString() };
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
