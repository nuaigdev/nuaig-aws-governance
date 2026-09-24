/**
 * Pure logic behind `scripts/prepare-buckets.ts`, which readies a client's
 * *existing* buckets for the portal.
 *
 * Kept free of AWS clients so the rules that decide what may be written to a
 * client's bucket are unit-tested. The two things the script may change on a
 * bucket — versioning and CORS — are both additive, and this file is where that
 * is guaranteed: it never produces a rule that permits DELETE, and it never
 * removes a CORS rule it did not create.
 */

/** Marks the CORS rule this portal owns, so re-runs update it in place. */
export const PORTAL_CORS_RULE_ID = "nuaig-portal";

export interface CorsRule {
  ID?: string;
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders?: string[];
  ExposeHeaders?: string[];
  MaxAgeSeconds?: number;
}

/**
 * Methods the portal's browser needs. DELETE is deliberately absent — the same
 * ceiling the IAM policy enforces, stated again at the bucket.
 */
export const PORTAL_CORS_METHODS = ["GET", "HEAD", "PUT", "POST"] as const;

/**
 * Validates the portal origins passed on the command line.
 *
 * A CORS rule with a wildcard or plain-http origin on a bucket holding client
 * data would be worse than none, so this refuses both. `http://localhost` is
 * allowed only for local development against a non-client bucket.
 */
export function parseOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      "PORTAL_ALLOWED_ORIGINS is not set. Set it to the portal's URL, for example " +
        "https://main.d1234abcd.amplifyapp.com",
    );
  }

  for (const origin of origins) {
    if (origin.includes("*")) {
      throw new Error(`Wildcard origins are not allowed: "${origin}".`);
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`"${origin}" is not a valid origin. Use the full URL, e.g. https://example.com.`);
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`"${origin}" must be an origin only, with no path or query.`);
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) {
      throw new Error(`"${origin}" must use https.`);
    }
  }

  return [...new Set(origins)];
}

/** The rule this portal needs on each bucket. */
export function portalCorsRule(origins: readonly string[]): CorsRule {
  return {
    ID: PORTAL_CORS_RULE_ID,
    AllowedOrigins: [...origins],
    AllowedMethods: [...PORTAL_CORS_METHODS],
    AllowedHeaders: ["*"],
    // ETag completes multipart uploads; the metadata header carries the
    // "uploaded by" stamp the file browser displays.
    ExposeHeaders: ["ETag", "x-amz-version-id", "x-amz-meta-uploaded-by"],
    MaxAgeSeconds: 3000,
  };
}

export interface CorsPlan {
  /** The full rule set to write. */
  readonly rules: CorsRule[];
  readonly change: "none" | "add" | "update";
}

/**
 * Merges the portal's rule into whatever the bucket already has.
 *
 * Every rule that is not ours is preserved untouched: the client's buckets may
 * serve other applications, and breaking them is not this tool's business.
 */
export function planCors(existing: readonly CorsRule[], origins: readonly string[]): CorsPlan {
  const desired = portalCorsRule(origins);
  const others = existing.filter((rule) => rule.ID !== PORTAL_CORS_RULE_ID);
  const current = existing.find((rule) => rule.ID === PORTAL_CORS_RULE_ID);

  if (current && sameRule(current, desired)) {
    return { rules: [...existing], change: "none" };
  }

  return {
    rules: [...others, desired],
    change: current ? "update" : "add",
  };
}

function sameRule(a: CorsRule, b: CorsRule): boolean {
  const set = (values?: readonly string[]) => JSON.stringify([...(values ?? [])].sort());
  return (
    set(a.AllowedOrigins) === set(b.AllowedOrigins) &&
    set(a.AllowedMethods) === set(b.AllowedMethods) &&
    set(a.AllowedHeaders) === set(b.AllowedHeaders) &&
    set(a.ExposeHeaders) === set(b.ExposeHeaders) &&
    (a.MaxAgeSeconds ?? 0) === (b.MaxAgeSeconds ?? 0)
  );
}

/** True when any rule in the set would let a browser DELETE. */
export function allowsDelete(rules: readonly CorsRule[]): boolean {
  return rules.some((rule) =>
    rule.AllowedMethods.some((method) => method.toUpperCase() === "DELETE"),
  );
}

export type VersioningState = "Enabled" | "Suspended" | "Off";

export function normaliseVersioning(status: string | undefined): VersioningState {
  if (status === "Enabled") return "Enabled";
  if (status === "Suspended") return "Suspended";
  return "Off";
}

/**
 * Best-effort check for an SSL-only bucket policy. It only reports: a bucket
 * policy belongs to the client's account and is never edited by this tool.
 */
export function policyEnforcesTls(policyJson: string | undefined): boolean {
  if (!policyJson) return false;
  try {
    const policy = JSON.parse(policyJson) as {
      Statement?: { Effect?: string; Condition?: Record<string, Record<string, unknown>> }[];
    };
    return (policy.Statement ?? []).some(
      (statement) =>
        statement.Effect === "Deny" &&
        Object.values(statement.Condition ?? {}).some((condition) =>
          Object.keys(condition).some((key) => key.toLowerCase() === "aws:securetransport"),
        ),
    );
  } catch {
    return false;
  }
}
