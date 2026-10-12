import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const state = globalThis as unknown as { maxoutPool?: Pool; maxoutInit?: Promise<void> };

export function db(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  if (!state.maxoutPool) {
    state.maxoutPool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
  }
  return state.maxoutPool;
}

export async function init(): Promise<void> {
  if (!state.maxoutInit) {
    state.maxoutInit = setup().catch(error => {
      state.maxoutInit = undefined;
      throw error;
    });
  }
  return state.maxoutInit;
}

async function setup(): Promise<void> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Prevent first-time setup from racing across concurrent Vercel function instances.
    await client.query('SELECT pg_advisory_xact_lock(5182026)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS maxout_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','marketing','accounting','designer')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    // Do not create a foreign-key relationship to legacy or unrelated users tables.
    // The authenticated API controls created_by; it remains an audit identifier.
    await client.query(`
      CREATE TABLE IF NOT EXISTS maxout_records (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by BIGINT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS maxout_records_kind_idx ON maxout_records(kind)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS maxout_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    const owner = await client.query("SELECT id FROM maxout_users WHERE role = 'owner' LIMIT 1");
    if (!owner.rowCount) {
      const ownerPassword = process.env.OWNER_PASSWORD;
      const staffPassword = process.env.STAFF_INITIAL_PASSWORD;
      if (!ownerPassword || !staffPassword) {
        throw new Error('OWNER_PASSWORD and STAFF_INITIAL_PASSWORD are required for initial setup');
      }
      await client.query(
        "INSERT INTO maxout_users(username,password_hash,role) VALUES($1,$2,'owner') ON CONFLICT (username) DO NOTHING",
        ['NoahAlter', await bcrypt.hash(ownerPassword, 12)]
      );
    }
    const staffPassword = process.env.STAFF_INITIAL_PASSWORD;
    if (staffPassword) {
      const hash = await bcrypt.hash(staffPassword, 12);
      for (const [username, role] of [
        ['Marketing','marketing'],
        ['Accounting','accounting'],
        ['Designer','designer']
      ]) {
        await client.query(
          'INSERT INTO maxout_users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT (username) DO NOTHING',
          [username, hash, role]
        );
      }
    }
    for (const [key,value] of [
      ['bank_balance',0], ['branding_default',1.5], ['processing_rate',0.027], ['processing_fixed',0.05]
    ] as const) {
      await client.query('INSERT INTO maxout_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO NOTHING',
        [key,JSON.stringify(value)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
