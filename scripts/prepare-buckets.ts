/**
 * Readies a client's existing buckets for the portal.
 *
 *   NEXT_PUBLIC_CLIENT_ID=<client> PORTAL_ALLOWED_ORIGINS=https://<portal-url> \
 *     npx tsx scripts/prepare-buckets.ts --account <12-digit-id> [--dry-run] [--profile <aws-profile>]
 *
 * Run by whoever deploys, using the deployment identity, after the portal has a
 * URL. See `docs/deployment-plan.md`, Part B.
 *
 * ## What it may change, and what it never touches
 *
 * Two things, both additive:
 *  1. **Versioning** is switched on if it is off or suspended. It changes no
 *     existing object; it is what makes an accidental overwrite recoverable.
 *  2. **CORS**: the portal's rule is added or updated in place. Rules belonging
 *     to anything else are preserved, and the portal's rule never allows DELETE.
 *
 * It only *reports* public-access blocking, TLS-only policy and encryption.
 * It never deletes, never writes an object, and never edits a bucket policy,
 * ACL, lifecycle rule or encryption setting.
 *
 * Refuses to run against a config that provisions its own buckets (those are
 * created correctly by the stack). `--account` is required: every call carries it
 * as the expected bucket owner, so a wrong profile or a bucket in another
 * account fails instead of being modified.
 */
import {
  GetBucketCorsCommand,
  GetBucketEncryptionCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { activeClient } from "../config/index";
import {
  allowsDelete,
  normaliseVersioning,
  parseOrigins,
  planCors,
  policyEnforcesTls,
  type CorsRule,
} from "../amplify/shared/bucket-prep";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const accountIndex = args.indexOf("--account");
const ACCOUNT = accountIndex === -1 ? undefined : args[accountIndex + 1];

const profileIndex = args.indexOf("--profile");
if (profileIndex !== -1) {
  const profile = args[profileIndex + 1];
  if (!profile) fail("--profile needs a value.");
  process.env.AWS_PROFILE = profile;
}

interface Row {
  bucket: string;
  versioning: string;
  cors: string;
  publicAccessBlocked: string;
  tlsOnly: string;
  encryption: string;
}

function fail(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function errorName(error: unknown): string {
  return (error as { name?: string })?.name ?? "";
}

async function main() {
  if (activeClient.bucketProvisioning !== "existing") {
    fail(
      `Client "${activeClient.clientId}" has bucketProvisioning "${activeClient.bucketProvisioning}". ` +
        `This script prepares a client's existing buckets; managed buckets are configured by the stack.`,
    );
  }

  let origins: string[];
  try {
    origins = parseOrigins(process.env.PORTAL_ALLOWED_ORIGINS);
  } catch (error) {
    return fail((error as Error).message);
  }

  if (!ACCOUNT || !/^\d{12}$/.test(ACCOUNT)) {
    fail("--account <12-digit AWS account id> is required, e.g. --account 123456789012.");
  }
  const account = ACCOUNT;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be changed.\n" : ""}` +
      `Client:   ${activeClient.displayName} (${activeClient.clientId})\n` +
      `Account:  ${account}\n` +
      `Origins:  ${origins.join(", ")}\n`,
  );

  const rows: Row[] = [];
  let problems = 0;

  for (const configured of activeClient.buckets) {
    const bucket = configured.bucketName;
    console.log(`— ${bucket}`);

    // Bucket lookups need the bucket's own region; HeadBucket tells us.
    const head = new S3Client({ region: region ?? "us-east-1" });
    let bucketRegion = region ?? "us-east-1";
    try {
      const result = await head.send(
        new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: account }),
      );
      bucketRegion = result.BucketRegion ?? bucketRegion;
    } catch (error) {
      const name = errorName(error);
      problems += 1;
      console.error(
        name === "NotFound"
          ? `  ✗ Bucket does not exist. Check the name in config/clients/${activeClient.clientId}.ts.`
          : `  ✗ Cannot access this bucket in account ${account} (${name || "unknown error"}). ` +
              `It may belong to another account, or the identity lacks permission.`,
      );
      rows.push({
        bucket,
        versioning: "—",
        cors: "—",
        publicAccessBlocked: "—",
        tlsOnly: "—",
        encryption: "—",
      });
      continue;
    }

    const s3 = new S3Client({ region: bucketRegion });
    const owner = { Bucket: bucket, ExpectedBucketOwner: account };

    /* ----------------------------------------------------- Versioning --- */
    let versioning = normaliseVersioning(
      (await s3.send(new GetBucketVersioningCommand(owner))).Status,
    );
    if (versioning !== "Enabled") {
      if (DRY_RUN) {
        console.log(`  • Versioning is ${versioning}: would enable.`);
      } else {
        await s3.send(
          new PutBucketVersioningCommand({
            ...owner,
            VersioningConfiguration: { Status: "Enabled" },
          }),
        );
        versioning = "Enabled";
        console.log("  ✓ Versioning enabled.");
      }
    } else {
      console.log("  ✓ Versioning already enabled.");
    }

    /* --------------------------------------------------------- CORS --- */
    let existing: CorsRule[] = [];
    try {
      existing = ((await s3.send(new GetBucketCorsCommand(owner))).CORSRules ?? []) as CorsRule[];
    } catch (error) {
      if (errorName(error) !== "NoSuchCORSConfiguration") throw error;
    }

    if (allowsDelete(existing)) {
      console.warn(
        "  ! An existing CORS rule on this bucket permits DELETE. It was not created by " +
          "this tool and is left alone, but the portal never uses it. Raise with the client.",
      );
    }

    const plan = planCors(existing, origins);
    let corsStatus: string;
    if (plan.change === "none") {
      corsStatus = "current";
      console.log("  ✓ CORS already allows the portal.");
    } else if (DRY_RUN) {
      corsStatus = `would ${plan.change}`;
      console.log(`  • CORS: would ${plan.change} the portal rule (${existing.length} existing rule(s) kept).`);
    } else {
      await s3.send(
        new PutBucketCorsCommand({ ...owner, CORSConfiguration: { CORSRules: plan.rules } }),
      );
      corsStatus = plan.change === "add" ? "added" : "updated";
      console.log(`  ✓ CORS ${corsStatus} for the portal.`);
    }

    /* ---------------------------------------------- Report only ------- */
    let publicAccessBlocked = "no";
    try {
      const block = (await s3.send(new GetPublicAccessBlockCommand(owner)))
        .PublicAccessBlockConfiguration;
      publicAccessBlocked =
        block?.BlockPublicAcls &&
        block.IgnorePublicAcls &&
        block.BlockPublicPolicy &&
        block.RestrictPublicBuckets
          ? "yes"
          : "partial";
    } catch (error) {
      if (errorName(error) !== "NoSuchPublicAccessBlockConfiguration") throw error;
    }

    let policy: string | undefined;
    try {
      policy = (await s3.send(new GetBucketPolicyCommand(owner))).Policy;
    } catch (error) {
      if (errorName(error) !== "NoSuchBucketPolicy") throw error;
    }
    const tlsOnly = policyEnforcesTls(policy) ? "yes" : "no";

    let encryption = "none reported";
    try {
      const rule = (await s3.send(new GetBucketEncryptionCommand(owner))).ServerSideEncryptionConfiguration
        ?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
      if (rule) encryption = rule;
    } catch (error) {
      if (errorName(error) !== "ServerSideEncryptionConfigurationNotFoundError") throw error;
    }

    if (publicAccessBlocked !== "yes") {
      console.warn("  ! Public access is not fully blocked on this bucket. Reported to the client, not changed.");
    }

    rows.push({
      bucket,
      versioning: versioning === "Enabled" ? "Enabled" : `${versioning} (dry run)`,
      cors: corsStatus,
      publicAccessBlocked,
      tlsOnly,
      encryption,
    });
  }

  console.log("\nSummary");
  console.table(rows);

  if (encryptionUsesKms(rows)) {
    console.warn(
      "\nA bucket uses SSE-KMS. The group roles do not grant KMS access, so downloads from " +
        "it will fail until that is addressed. Raise before go-live.",
    );
  }

  if (problems > 0) fail(`${problems} bucket(s) could not be prepared. Fix the above and re-run.`);
  console.log(DRY_RUN ? "\nDry run complete. Re-run without --dry-run to apply." : "\nBuckets are ready.");
}

function encryptionUsesKms(rows: readonly Row[]): boolean {
  return rows.some((row) => row.encryption.toLowerCase().includes("kms"));
}

main().catch((error: unknown) => {
  console.error("\nUnexpected failure:", error);
  process.exit(1);
});
