import type { NextConfig } from "next";

/**
 * Response headers for every route.
 *
 * Deliberately modest: no Content-Security-Policy. The browser talks directly to
 * Cognito, AppSync and S3 (signed URLs), and Next injects inline scripts, so a
 * CSP tight enough to be meaningful needs per-deployment origins and nonces.
 * That is a decision to make with a security reviewer, not a default to guess.
 * These headers are the ones that are safe everywhere.
 */
const securityHeaders = [
  // The portal is served only over HTTPS (Amplify Hosting terminates TLS).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Nothing should frame a page that shows client data.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Keeps file paths in URLs (`?path=`) from leaking to other sites.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
