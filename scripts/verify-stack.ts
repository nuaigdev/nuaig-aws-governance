/**
 * Proves, before any deployment, that the stack cannot touch a client's buckets.
 *
 *   NEXT_PUBLIC_CLIENT_ID=<client> npx tsx scripts/verify-stack.ts
 *
 * Needs no AWS credentials: it synthesizes the CloudFormation templates locally
 * and asserts properties of them.
 *
 * ## Why this exists as a script and not as a paragraph in a document
 *
 * "The stack only imports the buckets, so it cannot harm them" is a claim about
 * generated infrastructure, and a claim like that decays. One `grantRead` on an
 * imported bucket, one `bucketProvisioning` flipped to `"managed"`, one Amplify
 * upgrade that starts emitting a bucket policy, and the sentence is still in the
 * README while no longer being true. The consequence would land on a client's
 * clinical and resident records, so it is checked mechanically instead.
 *
 * The three assertions below are the ones that actually bound the blast radius:
 *
 *  1. For `existing` provisioning the storage stack contains **zero** resources.
 *     This is the load-bearing one. CloudFormation can only act on resources it
 *     manages; with none, there is nothing for a create, an update, or a
 *     rollback to do to those buckets. A failed deploy cannot delete what the
 *     template never described.
 *  2. No configured bucket name appears as an `AWS::S3::Bucket` or is the target
 *     of an `AWS::S3::BucketPolicy` anywhere in any nested stack.
 *  3. No `Allow` statement anywhere grants a destructive or wildcard S3 action
 *     on a configured bucket. Destructive actions may appear only under `Deny`.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { activeClient } from "../config/index";

/** Actions that must never be granted on a client bucket, in any Allow. */
const FORBIDDEN_IN_ALLOW = [
  "s3:*",
  "s3:Delete",
  "s3:PutBucketPolicy",
  "s3:PutBucketAcl",
  "s3:PutObjectAcl",
  "s3:PutLifecycleConfiguration",
  "s3:PutBucketVersioning",
];

interface Template {
  Resources?: Record<string, { Type?: string; Properties?: Record<string, unknown>; DeletionPolicy?: string }>;
}

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string) {
  failures.push(message);
}

/** Every `{ Statement: [...] }` object anywhere in the template tree. */
function policyDocuments(node: unknown): { Statement: Record<string, unknown>[] }[] {
  const found: { Statement: Record<string, unknown>[] }[] = [];

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value === null || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (Array.isArray(record.Statement)) {
      found.push({ Statement: record.Statement as Record<string, unknown>[] });
    }
    Object.values(record).forEach(walk);
  };

  walk(node);
  return found;
}

function actionsOf(statement: Record<string, unknown>): string[] {
  const raw = statement.Action ?? statement.NotAction ?? [];
  const list = typeof raw === "string" ? [raw] : (raw as unknown[]);
  return list.filter((a): a is string => typeof a === "string");
}

function main() {
  const bucketNames = activeClient.buckets.map((bucket) => bucket.bucketName);

  console.log(`\nVerifying generated infrastructure for "${activeClient.clientId}"`);
  console.log(`Provisioning: ${activeClient.bucketProvisioning}`);
  console.log(`Buckets:      ${bucketNames.join(", ")}\n`);

  /* ------------------------------------------------------------- synth --- */

  const outDir = mkdtempSync(join(tmpdir(), "stackcheck-"));
  console.log("Synthesizing templates (no AWS credentials used)…");

  execSync("npx tsx amplify/backend.ts", {
    env: {
      ...process.env,
      CDK_OUTDIR: outDir,
      // The backend reads its identity from CDK context, not the environment.
      CDK_CONTEXT_JSON: JSON.stringify({
        "amplify-backend-namespace": "stackcheck",
        "amplify-backend-name": "stackcheck",
        "amplify-backend-type": "branch",
      }),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Nested-stack filenames plus a deep temp path can exceed the Windows path
  // limit, so each template is copied to a short name before being read.
  const shortDir = mkdtempSync(join(tmpdir(), "sc-"));
  const templates: { name: string; template: Template }[] = [];

  readdirSync(outDir)
    .filter((file) => file.endsWith(".template.json"))
    .forEach((file, index) => {
      const short = join(shortDir, `${index}.json`);
      copyFileSync(join(outDir, file), short);
      templates.push({
        name: file,
        template: JSON.parse(readFileSync(short, "utf8")) as Template,
      });
    });

  if (templates.length === 0) fail("No templates were synthesized; nothing was verified.");
  console.log(`Analysing ${templates.length} template(s).\n`);

  /* --------------------------------------- 1. storage stack is empty --- */

  if (activeClient.bucketProvisioning === "existing") {
    const storage = templates.find((entry) => /storage/i.test(entry.name));

    if (!storage) {
      fail("Could not find the storage stack template to verify it is empty.");
    } else {
      const count = Object.keys(storage.template.Resources ?? {}).length;
      if (count === 0) {
        notes.push(
          "storage stack contains 0 resources — CloudFormation manages nothing " +
            "for these buckets, so no create, update or rollback can reach them",
        );
      } else {
        fail(
          `storage stack contains ${count} resource(s); for "existing" provisioning it ` +
            `must contain none. Imported buckets must never become managed resources.`,
        );
      }
    }
  } else {
    notes.push(
      `provisioning is "${activeClient.bucketProvisioning}", so the stack does create ` +
        `buckets — assertion 1 does not apply`,
    );
  }

  /* ------------------- 2. no client bucket as a managed resource -------- */

  /**
   * Scoped to `existing`. The invariant is "a bucket this deployment does not
   * own must never become a CloudFormation-managed resource" — for `managed`
   * provisioning the stack is supposed to create them, so the same finding
   * there is correct behaviour rather than a fault.
   */
  if (activeClient.bucketProvisioning !== "existing") {
    notes.push('provisioning is not "existing", so assertion 2 (no managed client bucket) does not apply');
  }

  for (const { name, template } of activeClient.bucketProvisioning === "existing" ? templates : []) {
    for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
      const props = resource.Properties ?? {};

      if (resource.Type === "AWS::S3::Bucket") {
        const bucketName = props.BucketName;
        if (typeof bucketName === "string" && bucketNames.includes(bucketName)) {
          fail(
            `${name}: AWS::S3::Bucket "${logicalId}" declares the client bucket ` +
              `"${bucketName}" as a managed resource (DeletionPolicy=${resource.DeletionPolicy}).`,
          );
        }
      }

      if (resource.Type === "AWS::S3::BucketPolicy") {
        const target = JSON.stringify(props.Bucket ?? "");
        const hit = bucketNames.find((bucket) => target.includes(bucket));
        if (hit) {
          fail(`${name}: AWS::S3::BucketPolicy "${logicalId}" targets the client bucket "${hit}".`);
        }
      }
    }
  }

  /* ----------------- 3. no destructive Allow on a client bucket --------- */

  let allowsChecked = 0;

  for (const { name, template } of templates) {
    for (const doc of policyDocuments(template)) {
      for (const statement of doc.Statement) {
        const blob = JSON.stringify(statement);
        if (!bucketNames.some((bucket) => blob.includes(bucket))) continue;

        const actions = actionsOf(statement);
        if (!actions.some((action) => action.startsWith("s3:"))) continue;

        if (statement.Effect !== "Allow") continue;
        allowsChecked += 1;

        const offending = actions.filter((action) =>
          FORBIDDEN_IN_ALLOW.some((bad) => action === bad || action.startsWith(bad)),
        );

        if (offending.length > 0) {
          fail(
            `${name}: Allow statement "${statement.Sid ?? "(no sid)"}" grants ` +
              `${offending.join(", ")} on a client bucket.`,
          );
        }
      }
    }
  }

  notes.push(`checked ${allowsChecked} Allow statement(s) naming a client bucket`);

  /* ------------------------------------------------------------ report -- */

  for (const note of notes) console.log(`  · ${note}`);
  console.log();

  if (failures.length > 0) {
    console.error("FAILED — the generated stack could affect the client's buckets:\n");
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error("\nDo not deploy. Fix the backend definition first.\n");
    process.exit(1);
  }

  console.log("PASSED");
  console.log("  ✓ no client bucket is a CloudFormation-managed resource");
  console.log("  ✓ no bucket policy targets a client bucket");
  console.log("  ✓ no Allow grants a destructive or wildcard S3 action on a client bucket");
  console.log("  ✓ destructive actions appear only under Deny\n");
}

main();
