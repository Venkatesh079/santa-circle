import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type PoolConfig } from 'pg';

export function postgresConnectionString(value: string, vercel = Boolean(process.env.VERCEL)) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URI.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // pg defaults to plaintext when a copied pooler URI has no SSL options.
  // Keep local development working, but require verified TLS for hosted DBs.
  if (vercel || !local) {
    const mode = url.searchParams.get('sslmode');
    if (!mode || ['disable', 'allow', 'prefer'].includes(mode))
      url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

export function postgresPoolConfig(value: string, caCertificate = process.env.DATABASE_SSL_CA, vercel = Boolean(process.env.VERCEL)): PoolConfig {
  const connectionString = postgresConnectionString(value, vercel);
  if (!caCertificate?.trim()) return { connectionString };
  const ca = caCertificate.replace(/\\n/g, '\n').trim();
  if (!ca.startsWith('-----BEGIN CERTIFICATE-----') || !ca.endsWith('-----END CERTIFICATE-----'))
    throw new Error('DATABASE_SSL_CA must contain the complete PEM certificate downloaded from Supabase Database Settings.');
  const url = new URL(connectionString);
  // pg replaces the entire ssl object when SSL parameters occur in the URI.
  // Supply the CA and verification together so sslmode cannot discard the CA.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl'])
    url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}

// All statements in a transaction use one connection. AsyncLocalStorage keeps
// concurrent Vercel requests from sharing another request's transaction.
export class PgDatabase {
  private readonly context = new AsyncLocalStorage<PoolClient>();
  readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  prepare(sql: string) {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    const query = async (values: unknown[]) => {
      const client = this.context.getStore();
      if (client) return client.query(text, values);
      const connection = await this.pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SET LOCAL search_path TO santa_app, pg_catalog');
        const result = await connection.query(text, values);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    };
    return {
      get: async (...values: unknown[]) => (await query(values)).rows[0],
      all: async (...values: unknown[]) => (await query(values)).rows,
      run: async (...values: unknown[]) => ({ changes: (await query(values)).rowCount ?? 0 }),
    };
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO santa_app, pg_catalog');
      // Serialize exchange mutations across all instances, like BEGIN IMMEDIATE
      // in the local backend. Reads continue to use committed snapshots.
      await client.query('SELECT id FROM exchange WHERE id = 1 FOR UPDATE');
      const value = await this.context.run(client, fn);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
