import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';

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
