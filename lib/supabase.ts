import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl, authCookies } from "./config";
export async function supabase() {
  const jar = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: authCookies,
    cookies: {
      getAll: () => jar.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Read-only server component; proxy persists refreshed cookies. */
        }
      },
    },
  });
}
