/**
 * Adds a deny-deletion statement to a client's bucket policy.
 *
 *   NEXT_PUBLIC_CLIENT_ID=<client> npx tsx scripts/protect-buckets.ts \
 *     --account <12-digit-id> [--profile <aws-profile>] [--dry-run]
 *
 * Run **after** `prepare:buckets` (which enables versioning) and **before**
 * the deployment. See `docs/deployment-plan.md`.
 *
 * ## What this protects against that nothing else does
 *
 * The portal's own roles already cannot delete. What they cannot constrain is
 * the *deployment* credentials, which are account-wide for the deployment
 * window — a mistyped `aws s3 rm --recursive` from an operator's terminal is
 * the realistic way this data gets destroyed, not the application. A bucket
 * policy Deny applies to every principal, including the account root, so it
 * covers that case.
 *
 * Deleting anything afterwards means deliberately editing the bucket policy
 * first. That is the intended posture, not a side effect.
 *
 * ## The trap this script exists to avoid
 *
 * `PutBucketPolicy` **replaces** the whole policy document; it does not merge.
 * Writing this statement by hand against a bucket that already carries one —
 * a TLS-only rule, a grant to a backup tool — silently removes it. Every
 * statement that is not ours is read first and carried through untouched, and
 * `--dry-run` prints exactly what would change.
 */
import {
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { activeClient } from "../config/index";
import {
  DENIED_ACTIONS,
  lifecycleExpiresData,
  planPolicy,
  unsafeToModify,
  type BucketPolicy,
} from "../amplify/shared/bucket-protection";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const profile = flag("profile");
if (profile) process.env.AWS_PROFILE = profile;

const ACCOUNT = flag("account");

function fail(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function errorName(error: unknown): string {
  return (error as { name?: string })?.name ?? "unknown";
}

async function main() {
  if (!ACCOUNT || !/^\d{12}$/.test(ACCOUNT)) {
    fail("--account <12-digit AWS account id> is required, e.g. --account 123456789012.");
  }

  if (activeClient.bucketProvisioning !== "existing") {
    fail(
      `Client "${activeClient.clientId}" provisions its own buckets. This script is for a ` +
        `client's pre-existing buckets; it will not modify policies on buckets the stack owns.`,
    );
  }

  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  console.log(
    `\n${DRY_RUN ? "DRY RUN — nothing will be changed.\n" : ""}` +
      `Client:  ${activeClient.displayName} (${activeClient.clientId})\n` +
      `Account: ${ACCOUNT}\n` +
      `Denying: ${DENIED_ACTIONS.join(", ")}\n` +
      `         to every principal, including the account root.\n`,
  );

  let blocked = 0;
  let changed = 0;

  for (const configured of activeClient.buckets) {
    const bucket = configured.bucketName;
    console.log(`— ${bucket}`);

    const probe = new S3Client({ region });
    let bucketRegion = region;
    try {
      const head = await probe.send(
        new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: ACCOUNT }),
      );
      bucketRegion = head.BucketRegion ?? region;
    } catch (error) {
      blocked += 1;
      console.error(`  ✗ cannot access this bucket in account ${ACCOUNT} (${errorName(error)}).`);
      continue;
    }

    const s3 = new S3Client({ region: bucketRegion });
    const owner = { Bucket: bucket, ExpectedBucketOwner: ACCOUNT };

    /* --------- versioning must already be on: order matters here -------- */
    const versioning = (await s3.send(new GetBucketVersioningCommand(owner))).Status;
    if (versioning !== "Enabled") {
      blocked += 1;
      console.error(
        `  ✗ versioning is "${versioning ?? "Off"}". This statement denies ` +
          `s3:PutBucketVersioning, so applying it now would lock versioning OFF. ` +
          `Run \`npm run prepare:buckets\` first.`,
      );
      continue;
    }
    console.log("  ✓ versioning is enabled");

    /* ------------------------- existing policy -------------------------- */
    let existing: BucketPolicy | null = null;
    try {
      const raw = (await s3.send(new GetBucketPolicyCommand(owner))).Policy;
      if (raw) existing = JSON.parse(raw) as BucketPolicy;
    } catch (error) {
      if (errorName(error) !== "NoSuchBucketPolicy") throw error;
    }

    const problems = unsafeToModify(existing);
    if (problems.length > 0) {
      blocked += 1;
      console.error(`  ✗ not safe to modify automatically:`);
      for (const problem of problems) console.error(`      ${problem}`);
      console.error(`      Review this bucket's policy by hand.`);
      continue;
    }

    /* --------------- lifecycle: a bucket policy cannot stop it ---------- */
    try {
      const rules = (await s3.send(new GetBucketLifecycleConfigurationCommand(owner))).Rules;
      if (lifecycleExpiresData(rules as unknown as Record<string, unknown>[])) {
        console.warn(
          `  ! a lifecycle rule on this bucket expires objects or old versions. ` +
            `Lifecycle is executed by S3 itself, not by a principal, so this policy ` +
            `does NOT stop it — that data is on a deletion schedule today. Raise with the client.`,
        );
      }
    } catch (error) {
      if (errorName(error) !== "NoSuchLifecycleConfiguration") throw error;
    }

    /* ------------------------------ apply ------------------------------- */
    const plan = planPolicy(existing, bucket);

    if (plan.preserved.length > 0) {
      console.log(`  · preserving ${plan.preserved.length} existing statement(s): ${plan.preserved.join(", ")}`);
    }

    if (plan.change === "none") {
      console.log("  ✓ deny-deletion statement already present and current");
      continue;
    }

    if (DRY_RUN) {
      console.log(`  • would ${plan.change} the deny-deletion statement. Resulting policy:`);
      console.log(
        JSON.stringify(plan.policy, null, 2)
          .split("\n")
          .map((line) => `      ${line}`)
          .join("\n"),
      );
      continue;
    }

    await s3.send(
      new PutBucketPolicyCommand({ ...owner, Policy: JSON.stringify(plan.policy) }),
    );
    changed += 1;
    console.log(`  ✓ deny-deletion statement ${plan.change === "add" ? "added" : "updated"}`);
  }

  console.log();

  if (blocked > 0) {
    fail(
      `${blocked} bucket(s) were not protected. Nothing partial was left behind on those — ` +
        `fix the cause above and re-run.`,
    );
  }

  if (DRY_RUN) {
    console.log("Dry run complete. Re-run without --dry-run to apply.\n");
    return;
  }

  console.log(
    `${changed} bucket policy change(s) applied.\n\n` +
      `To delete anything in these buckets from now on, the bucket policy has to be\n` +
      `edited first — deliberately, in the AWS console or CLI. That is the point.\n` +
      `The policy-management actions are NOT denied, so the account owner can always\n` +
      `reverse this in one action.\n`,
  );
}

main().catch((error: unknown) => {
  console.error("\nUnexpected failure:", error);
  process.exit(1);
});
