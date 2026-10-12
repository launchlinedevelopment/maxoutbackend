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
      ['bank_balance',0], ['branding_default',0], ['processing_rate',0.027], ['processing_fixed',0.05]
    ] as const) {
      await client.query('INSERT INTO maxout_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO NOTHING',
        [key,JSON.stringify(value)]);
    }
    // Workbook snapshot (MAXOUT Command Center (1).xlsx), non-destructive and repeatable.
    // Only update entries previously populated by the old automatic seed; respect manual edits.
    const workbookProducts = [["1523914729834283008","MAXOUT BLACKOUT Tee","Tee","Ready",10.55,5,30,6,"Tapstitch",""],["1523915041248776192","MAXOUT BLACKOUT Sweatpants","Pants","Ready",17.48,8.37,37,8,"Tapstitch",""],["1524294296038236160","MAXOUT BLACKOUT Tank Top","Tank","Ready",10.97,4.25,25,6,"Tapstitch",""],["1524295720755224576","MAXOUT BLACKOUT Hoodie","Hoodie","Ready",21.4,10.3,49,11,"Tapstitch",""],["1531131481584521216","MAXOUT BLACKOUT Crewneck","Hoodie","Ready",15.07,6.6,41,8,"Tapstitch",""],["1532206434987769856","MAXOUT BLACKOUT Compression","Tee","Ready",12.39,5.91,32,6,"Tapstitch",""],["22705134123767062313","MAXOUT BLACKOUT Backpack","Bag","Ready",45.9,8.29,48.99,8,"Printful","Maybe find better price?"],["1558255326191636480","MAXOUT BLACKOUT Yoga Shorts","Shorts","Design",15.48,5,32,6,"Tapstitch",""]] as const;
    for (const [sku,name,category,status,manufacturing,shipping,selling_price,customer_shipping,supplier,notes] of workbookProducts) {
      const data={drop:'BLACKOUT',sku,name,category,status,manufacturing,shipping,branding:0,packaging:0,other:0,selling_price,discount:0,customer_shipping,supplier,notes,source:'MAXOUT Command Center (1).xlsx'};
      await client.query(`UPDATE maxout_records SET data=$1::jsonb,updated_at=now()
        WHERE kind='products' AND data->>'sku'=$2
        AND data->>'source'='MAXOUT Business Command Center - Updated.xlsx'`,
        [JSON.stringify(data),sku]);
      await client.query(`INSERT INTO maxout_records(kind,data)
        SELECT 'products',$1::jsonb WHERE NOT EXISTS (
          SELECT 1 FROM maxout_records WHERE kind='products' AND data->>'sku'=$2
        )`,[JSON.stringify(data),sku]);
    }
    await client.query(`INSERT INTO maxout_records(kind,data)
      SELECT 'expenses',$1::jsonb WHERE NOT EXISTS (
        SELECT 1 FROM maxout_records WHERE kind='expenses'
        AND data->>'source_key'='workbook-expense-2026-10-05-modeling'
      )`,[JSON.stringify({date:'2026-10-05',vendor:'Modeling | Micahel Bodnar',category:'Marketing',description:'Modeling for BLACKOUT Compression shirt',drop:'BLACKOUT',amount:10,payment_method:'Cash',status:'Paid',recurring:'No',notes:"Noah's Money, Not Company's",company_funded:false,source_key:'workbook-expense-2026-10-05-modeling'})]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
