/**
 * Lists the S3 buckets in an AWS account and prints a config skeleton.
 *
 *   npx tsx scripts/discover-buckets.ts --account <12-digit-id> [--profile <aws-profile>]
 *
 * Exists because the physical bucket names are the one thing a deployment
 * cannot infer. The portal is agnostic to them — nothing is hardcoded — but the
 * generated IAM policy and the permissions boundary name bucket ARNs literally,
 * which is inherent to least-privilege and not a shortcut. So the names have to
 * be in the config before a deploy, and reading them out of the account is
 * faster and less error-prone than asking the client to type them.
 *
 * What it cannot do is decide *which* bucket holds what. Bucket names are often
 * not self-describing, and mapping the wrong one to "Clinical Records" would put
 * a Sensitive badge on the wrong data and grant the wrong group access to it.
 * That mapping is a judgement for the client; this script leaves it blank and
 * says so in the output.
 *
 * ## Strictly read-only
 *
 * ListBuckets, GetBucketLocation and GetBucketVersioning. It writes nothing,
 * to the account or to disk — the skeleton goes to stdout for a human to paste
 * and edit.
 */
import {
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  ListBucketsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const args = process.argv.slice(2);

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

  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const s3 = new S3Client({ region });

  // ExpectedBucketOwner guards against a mistyped profile pointing somewhere else.
  const listed = await s3.send(new ListBucketsCommand({}));
  const owner = listed.Owner?.ID;
  const buckets = listed.Buckets ?? [];

  if (buckets.length === 0) {
    fail(`No buckets are visible to these credentials in account ${ACCOUNT}.`);
  }

  console.log(`\nAccount ${ACCOUNT}${owner ? ` (owner ${owner.slice(0, 12)}…)` : ""}`);
  console.log(`${buckets.length} bucket(s) visible. Read-only: nothing was changed.\n`);

  const rows: { bucket: string; region: string; versioning: string; created: string }[] = [];

  for (const bucket of buckets) {
    const name = bucket.Name;
    if (!name) continue;

    let bucketRegion = "unknown";
    let versioning = "unknown";

    try {
      const location = await s3.send(
        new GetBucketLocationCommand({ Bucket: name, ExpectedBucketOwner: ACCOUNT }),
      );
      // S3 reports us-east-1 as null, for historical reasons.
      bucketRegion = location.LocationConstraint ?? "us-east-1";

      const scoped = new S3Client({ region: bucketRegion });
      const status = await scoped.send(
        new GetBucketVersioningCommand({ Bucket: name, ExpectedBucketOwner: ACCOUNT }),
      );
      versioning = status.Status ?? "Off";
    } catch (error) {
      versioning = `unreadable (${errorName(error)})`;
    }

    rows.push({
      bucket: name,
      region: bucketRegion,
      versioning,
      created: bucket.CreationDate?.toISOString().slice(0, 10) ?? "",
    });
  }

  console.table(rows);

  const offVersioning = rows.filter((row) => row.versioning === "Off" || row.versioning === "Suspended");
  if (offVersioning.length > 0) {
    console.log(
      `Versioning is not enabled on: ${offVersioning.map((r) => r.bucket).join(", ")}.\n` +
        `\`npm run prepare:buckets\` turns it on for the four configured buckets — it is\n` +
        `load-bearing for the no-overwrite guarantee, not optional.\n`,
    );
  }

  console.log("─".repeat(72));
  console.log("Config skeleton — paste into config/clients/<client-id>.ts and edit.");
  console.log("The label, description and sensitivity of each bucket are deliberately");
  console.log("left as TODO: only the client can say which bucket holds what, and");
  console.log("guessing would mislabel sensitive data and misdirect group access.");
  console.log("─".repeat(72));
  console.log();
  console.log("  buckets: [");
  for (const row of rows) {
    console.log("    {");
    console.log(`      id: "TODO_ID",                 // documents | pii | financial | clinical`);
    console.log(`      label: "TODO_LABEL",           // shown in the UI`);
    console.log(`      bucketName: ${JSON.stringify(row.bucket)},`);
    console.log(`      description: "TODO_DESCRIPTION",`);
    console.log(`      sensitivity: "TODO",           // "standard" | "sensitive"`);
    console.log("    },");
  }
  console.log("  ],");
  console.log();

  const regions = new Set(rows.map((row) => row.region));
  if (regions.size > 1) {
    console.log(
      `NOTE: these buckets span regions (${[...regions].join(", ")}). The portal addresses\n` +
        `each bucket by its own region, but deploy the stack in the region holding most of\n` +
        `them to keep latency and any cross-region transfer sensible.\n`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("\nUnexpected failure:", error);
  process.exit(1);
});
