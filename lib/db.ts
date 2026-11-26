import "server-only";
import { resolve } from "node:path";
import { SantaStore } from "./store";

// Keep the service in this module so development reloads replace its methods
// and validation data together. A global instance retains stale imported rules.
let cachedStore: SantaStore | undefined;
export function store() {
  if (!cachedStore) {
    if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD)
      throw new Error("Set ADMIN_PASSWORD before starting the production server.");
    cachedStore = new SantaStore(
      resolve(process.env.DATABASE_PATH || "data/santa.sqlite"),
      process.env.ADMIN_NAME || "admin",
      process.env.ADMIN_PASSWORD || "local-santa-admin",
    );
  }
  return cachedStore;
}
