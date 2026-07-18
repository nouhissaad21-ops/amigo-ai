import path from "node:path";
import type { NextConfig } from "next";
const isDevelopment = process.env.NODE_ENV === "development";
const isStaticExport = process.env.STATIC_EXPORT === "true";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const serverRoutes: Pick<NextConfig, "rewrites" | "headers"> = isStaticExport
  ? {}
  : {
      async rewrites() {
        return [
          {
            source: "/backend/:path*",
            destination: `${process.env.INTERNAL_API_URL ?? "http://localhost:4000"}/:path*`,
          },
        ];
      },
      async headers() {
        return [
          {
            source: "/:path*",
            headers: [
              { key: "Content-Security-Policy", value: contentSecurityPolicy },
              {
                key: "Referrer-Policy",
                value: "strict-origin-when-cross-origin",
              },
              { key: "X-Content-Type-Options", value: "nosniff" },
              { key: "X-Frame-Options", value: "DENY" },
              {
                key: "Permissions-Policy",
                value: "camera=(), microphone=(), geolocation=()",
              },
              { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
              {
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              },
            ],
          },
        ];
      },
    };
const config: NextConfig = {
  output: isStaticExport ? "export" : "standalone",
  trailingSlash: isStaticExport,
  images: { unoptimized: isStaticExport },
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  poweredByHeader: false,
  ...serverRoutes,
};
export default config;
