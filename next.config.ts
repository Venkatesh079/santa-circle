import type { NextConfig } from "next";
import { demo } from "./lib/config";

const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: demo
    ? {
        "/*": [
          "./supabase/migrations/*.sql",
          "./lib/demo-bootstrap.sql",
          "./node_modules/@electric-sql/pglite/dist/*.wasm",
          "./node_modules/@electric-sql/pglite/dist/*.data",
        ],
      }
    : {},
};
export default config;
