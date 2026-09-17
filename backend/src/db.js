import pg from 'pg';

const { Pool } = pg;

const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

export const pool = new Pool({ ...connection, ssl });

export async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (process.env.NODE_ENV !== 'production') {
    console.log('db query', { rows: result.rowCount, ms: Date.now() - start });
  }
  return result;
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
