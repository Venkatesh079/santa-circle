import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { supabaseUrl, supabaseKey, authCookies, demo } from "./lib/config";

export async function proxy(request: NextRequest) {
  const pending: { name: string; value: string; options: CookieOptions }[] = [];
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (!demo) {
    const client = createServerClient(supabaseUrl, supabaseKey, {
      cookieOptions: authCookies,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(items, cacheHeaders) {
          for (const item of items) request.cookies.set(item.name, item.value);
          pending.push(...items);
          for (const [key, value] of Object.entries(cacheHeaders))
            headers.set(key, value);
        },
      },
    });
    await client.auth.getUser();
  }
  const response = NextResponse.next({ request });
  for (const { name, value, options } of pending)
    response.cookies.set(name, value, options);
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}
export const config = {
  matcher: ["/groups/:path*", "/create", "/join", "/signin"],
};
