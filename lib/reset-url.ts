type Environment = Record<string, string | undefined>;

export function buildPasswordResetLink(token: string, env: Environment = process.env) {
  const configured = env.APP_URL?.trim();
  if (!configured && env.NODE_ENV === "production") throw new Error("Set APP_URL to the app's public HTTPS origin before generating reset links.");
  const origin = new URL(configured || "http://127.0.0.1:3000");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!['https:', 'http:'].includes(origin.protocol) || (env.NODE_ENV === "production" && origin.protocol !== "https:" && !loopback)
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("APP_URL must be the app's origin, using HTTPS in production. HTTP localhost is supported for local testing.");
  }
  const link = new URL("/reset-password", origin);
  // Fragments stay in the browser rather than being sent in request URLs or referrers.
  link.hash = new URLSearchParams({ token }).toString();
  return link.href;
}
