import "server-only";
import { resolve } from "node:path";
import { Pool } from "pg";
import { SantaStore } from "./store";
import { PgDatabase, postgresPoolConfig } from "./postgres";
import { PostgresStore } from "./postgres-store";

let cachedStore: SantaStore | PostgresStore | undefined;
let initialization: Promise<void> | undefined;
export function store() {
  if (!cachedStore) {
    const password = process.env.ADMIN_PASSWORD;
    if (process.env.NODE_ENV === "production" && !password)
      throw new Error("Set ADMIN_PASSWORD before starting the production server.");
    if (process.env.VERCEL && !process.env.DATABASE_URL)
      throw new Error("Set DATABASE_URL to your Supabase PostgreSQL pooler connection string. Local SQLite cannot persist data on Vercel.");
    if (process.env.DATABASE_URL) {
      const pool = new Pool({ ...postgresPoolConfig(process.env.DATABASE_URL), max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
      pool.on('error', error => console.error('PostgreSQL idle connection failed', error));
      const backend = new PostgresStore(new PgDatabase(pool));
      // Initialization is retried after a transient connection failure.
      const ready = () => initialization ??= backend.initialize(process.env.ADMIN_NAME || 'admin', password || 'local-santa-admin').catch(error => { initialization = undefined; throw error; });
      cachedStore = new Proxy(backend, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== 'function') return value;
          return async (...args: unknown[]) => { await ready(); return value.apply(target, args); };
        },
      });
    } else {
      cachedStore = new SantaStore(resolve(process.env.DATABASE_PATH || "data/santa.sqlite"), process.env.ADMIN_NAME || "admin", password || "local-santa-admin");
    }
  }
  return cachedStore;
}
