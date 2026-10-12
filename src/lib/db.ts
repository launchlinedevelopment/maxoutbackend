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
    // Wix catalog import: one row per product, variant rows consolidated; never modify existing items.
    const catalogProducts=[["MAXOUT Core Gym Bag","69EA3F77D7F4D_15155",0,61.99,3],["MAXOUT Core Cap","69EA606B94B0A_7854",15,22,1],["MAXOUT Core Shorts","69EA61D83F94C_46345",0,27,1],["MAXOUT Core Bottle","69EE597225EAC_20175",21.37,27.37,3],["MAXOUT Core Pants","69EE7343B6CD1_15513",0,40.59,3],["MAXOUT Core Shaker","40970790592299693969",0,24,0.15],["MAXOUT Core Muscle Tank","53634290028971352483",0,27.33,0.109],["MAXOUT Core Tee","260430PODPQ5540#001",0,35,1],["MAXOUT Core Joggers","260501PODPX0030#001",0,35,2],["MAXOUT Apex Hoodie","260501PODRB4946#001",0,57.94,3],["MAXOUT Core Long Sleeve","69F4B87CB3D5C_18660",0,29.5,1],["MAXOUT Core Compression Shirt","260502PODRZ0677#001",0,28.5,1],["MAXOUT Core Hoodie","260507PODRB0315#001",0,55,2],["MAXOUT Core Sports Bra","260508PODAC0743#001",0,27.96,1],["MAXOUT Apex Tee","260512PODPQ0388#001",0,35,1],["MAXOUT Summer Tee","260528PODPQ6568#001",0,29,2],["MAXOUT Summer Tank","260528PODEG6600#001",0,28,1],["MAXOUT Summer Shorts","260528PODPW6619#001",0,25,2],["MAXOUT Core Racerback Tank","260531PODAC1136#001",0,24,3],["MAXOUT America Sweatpants","260705PODPX0928#011",0,45,3],["MAXOUT America Tee","260705PODPQ0855#001",0,30,1],["MAXOUT America Crop Top","260705PODAC1078#005",0,25,2],["MAXOUT America Sports Bra","260705PODCI1155#006",0,30,2],["MAXOUT Core Leggings","260706PODCJ2695#005",0,30,1],["MAXOUT BLACKOUT Tee","260707PODPQ2365#001",0,30,1],["MAXOUT BLACKOUT Sweatpants","260707PODPX2433#001",0,37,2],["MAXOUT BLACKOUT Crop Top","260708PODAC2587#001",0,25,1],["MAXOUT BLACKOUT Hoodie","260708PODRB2682#001",0,49,3],["MAXOUT BLACKOUT Crewneck","260727PODRA1389#001",0,41,2],["MAXOUT BLACKOUT Backpack","22705134123767062313",0,54.99,2],["MAXOUT BLACKOUT Compression","260730PODRZ2543#001",0,32,1],["MAXOUT BLACKOUT Yoga Shorts","261009PODCJ10985#001",0,32,1]] as [string,string,number,number,number][];
    for(const [name,sku,manufacturing,selling_price,weight] of catalogProducts){
      const shippingWeight=Math.max(1,Math.ceil(weight));
      const customer_shipping=({1:6,2:8,3:11,4:20} as Record<number,number>)[shippingWeight]||20;
      const drop=name.includes('BLACKOUT')?'BLACKOUT':name.includes('Summer')?'SUMMER':name.includes('Apex')?'APEX':name.includes('America')?'AMERICA':'CORE';
      const data={name,sku,drop,status:'Ready',manufacturing,selling_price,shipping_weight_lb:weight,customer_shipping,shipping:0,branding:0,packaging:0,other:0,source:'catalog_products.csv',notes:manufacturing?'':'Manufacturing cost not provided in catalog'};
      await client.query("INSERT INTO maxout_records(kind,data) SELECT 'products',$1::jsonb WHERE NOT EXISTS(SELECT 1 FROM maxout_records WHERE kind='products' AND (data->>'sku'=$2 OR lower(data->>'name')=lower($3)))",[JSON.stringify(data),sku,name]);
    }
    // Initial payments.csv snapshot. Order ID is the deduplication key.
    const importedPayments=[["10003","2026-07-23","MAXOUT Core Compression Shirt / MAXOUT Summer Tee / MAXOUT Summer Shorts",3,75.2,20,18],["10002","2026-05-12","MAXOUT Core Racerback Tank",1,29.5,6,0],["10001","2026-05-07","MAXOUT Apex Hoodie / MAXOUT Core Shorts / MAXOUT Core Tee",3,105.44,20,36]] as [string,string,string,number,number,number,number][];
    for(const [order_id,date,product,quantity,revenue,customer_shipping,discount] of importedPayments){
      const data={order_id,date,product,quantity,revenue,customer_shipping,discount,status:'Successful',source:'payments.csv'};
      await client.query("INSERT INTO maxout_records(kind,data) SELECT 'sales',$1::jsonb WHERE NOT EXISTS(SELECT 1 FROM maxout_records WHERE kind='sales' AND data->>'order_id'=$2)",[JSON.stringify(data),order_id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
