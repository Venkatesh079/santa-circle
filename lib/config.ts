type Environment = Record<string, string | undefined>;

function isPublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // Older Supabase projects may use the public anon JWT.
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return (
      JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon"
    );
  } catch {
    return false;
  }
}

export function readDeployment(env: Environment) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  const production = env.VERCEL_ENV === "production";
  const demoAllowed =
    !production &&
    (env.NODE_ENV !== "production" ||
      env.VERCEL_ENV === "preview" ||
      env.SANTA_CIRCLE_DEMO === "true");

  if (!url && !key && demoAllowed)
    return { supabaseUrl: "", supabaseKey: "", demo: true };
  if (!url || !key)
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for this deployment.",
    );
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("The Supabase project URL is invalid.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    endpoint.hostname,
  );
  const localHttp = !production && loopback && endpoint.protocol === "http:";
  if (
    (!localHttp && endpoint.protocol !== "https:") ||
    (production && loopback) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      "Use an HTTPS Supabase project URL. Local development also supports HTTP on localhost.",
    );
  }
  if (!isPublicKey(key))
    throw new Error(
      "Use the Supabase publishable key or legacy anon key in the public key variable.",
    );
  return { supabaseUrl: url, supabaseKey: key, demo: false };
}

export const { supabaseUrl, supabaseKey, demo } = readDeployment(process.env);

// All auth clients run on the server, including session refresh.
export const authCookies = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
