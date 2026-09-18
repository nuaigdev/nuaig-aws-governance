import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBucketPolicy,
  buildPermissionsBoundary,
  FORBIDDEN_ACTIONS,
  type PolicyDocument,
} from "./bucket-policy";

/** Every action mentioned in any Allow statement of a document. */
function allowedActions(doc: PolicyDocument): string[] {
  return doc.Statement.filter((s) => s.Effect === "Allow").flatMap((s) => [
    ...s.Action,
  ]);
}

function statement(doc: PolicyDocument, sid: string) {
  return doc.Statement.find((s) => s.Sid === sid);
}

describe("buildBucketPolicy", () => {
  it("returns null for a group with no grants", () => {
    assert.equal(buildBucketPolicy([]), null);
  });

  it("grants list and read on every granted bucket", () => {
    const doc = buildBucketPolicy([
      { bucketName: "b-one", mode: "read" },
      { bucketName: "b-two", mode: "read-upload" },
    ])!;

    assert.deepEqual(statement(doc, "ListGrantedBuckets")?.Resource, [
      "arn:aws:s3:::b-one",
      "arn:aws:s3:::b-two",
    ]);
    assert.deepEqual(statement(doc, "ReadGrantedObjects")?.Resource, [
      "arn:aws:s3:::b-one/*",
      "arn:aws:s3:::b-two/*",
    ]);
  });

  it("grants upload only on read-upload buckets", () => {
    const doc = buildBucketPolicy([
      { bucketName: "read-only", mode: "read" },
      { bucketName: "writable", mode: "read-upload" },
    ])!;

    assert.deepEqual(statement(doc, "UploadNewObjects")?.Resource, [
      "arn:aws:s3:::writable/*",
    ]);
  });

  it("omits the upload statement entirely when no bucket allows upload", () => {
    const doc = buildBucketPolicy([{ bucketName: "read-only", mode: "read" }])!;
    assert.equal(statement(doc, "UploadNewObjects"), undefined);
    assert.ok(!allowedActions(doc).includes("s3:PutObject"));
  });

  /* ---- The constraint that matters most ---- */

  it("never allows a destructive action, for any grant combination", () => {
    const combinations: ("read" | "read-upload")[][] = [
      ["read"],
      ["read-upload"],
      ["read", "read-upload"],
      ["read-upload", "read-upload"],
    ];

    for (const modes of combinations) {
      const doc = buildBucketPolicy(
        modes.map((mode, i) => ({ bucketName: `bucket-${i}`, mode })),
      )!;
      const allowed = allowedActions(doc);
      for (const forbidden of FORBIDDEN_ACTIONS) {
        assert.ok(
          !allowed.includes(forbidden),
          `${forbidden} was allowed for modes [${modes.join(", ")}]`,
        );
      }
    }
  });

  it("adds an explicit Deny for destructive actions that no Allow can override", () => {
    const doc = buildBucketPolicy([{ bucketName: "b", mode: "read-upload" }])!;
    const deny = statement(doc, "DenyDestructiveActionsAlways");

    assert.equal(deny?.Effect, "Deny");
    for (const forbidden of FORBIDDEN_ACTIONS) {
      assert.ok(deny?.Action.includes(forbidden), `${forbidden} not denied`);
    }
    assert.deepEqual(deny?.Resource, ["arn:aws:s3:::b", "arn:aws:s3:::b/*"]);
  });

  it("never grants anything outside the buckets it was given", () => {
    const doc = buildBucketPolicy([{ bucketName: "only-this", mode: "read-upload" }])!;

    for (const stmt of doc.Statement) {
      for (const resource of stmt.Resource) {
        assert.match(
          resource,
          /^arn:aws:s3:::only-this(\/\*)?$/,
          `unexpected resource ${resource}`,
        );
      }
    }
  });

  it("never emits a bare wildcard resource", () => {
    const doc = buildBucketPolicy([{ bucketName: "b", mode: "read-upload" }])!;
    for (const stmt of doc.Statement) {
      assert.ok(!stmt.Resource.includes("*"), `${stmt.Sid} used a wildcard resource`);
    }
  });
});

describe("buildPermissionsBoundary", () => {
  const boundary = buildPermissionsBoundary(["b-one", "b-two"]);

  it("caps S3 access to the configured buckets", () => {
    const ceiling = statement(boundary, "S3CeilingForPortalGroups");
    assert.deepEqual(ceiling?.Resource, [
      "arn:aws:s3:::b-one",
      "arn:aws:s3:::b-one/*",
      "arn:aws:s3:::b-two",
      "arn:aws:s3:::b-two/*",
    ]);
  });

  it("denies every destructive action across all resources", () => {
    const deny = statement(boundary, "NeverDestructive");
    assert.equal(deny?.Effect, "Deny");
    assert.deepEqual(deny?.Resource, ["*"]);
    for (const forbidden of FORBIDDEN_ACTIONS) {
      assert.ok(deny?.Action.includes(forbidden), `${forbidden} not denied`);
    }
  });

  it("denies IAM entirely, so the portal cannot widen its own access", () => {
    const deny = statement(boundary, "NeverTouchIam");
    assert.equal(deny?.Effect, "Deny");
    assert.ok(deny?.Action.includes("iam:*"));
  });

  it("allows no S3 action beyond read, list and upload", () => {
    const ceiling = statement(boundary, "S3CeilingForPortalGroups")!;
    const s3Actions = ceiling.Action.filter((a) => a.startsWith("s3:"));
    assert.deepEqual(
      [...s3Actions].sort(),
      [
        "s3:AbortMultipartUpload",
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:ListMultipartUploadParts",
        "s3:PutObject",
      ].sort(),
    );
  });

  it("a bucket outside the boundary is unreachable even if a policy grants it", () => {
    // The boundary's Allow does not mention `other-bucket`, so an inline policy
    // naming it has no effect: a boundary is an intersection, not a union.
    const ceiling = statement(boundary, "S3CeilingForPortalGroups")!;
    assert.ok(
      !ceiling.Resource.some((r) => r.includes("other-bucket")),
      "boundary unexpectedly covers a bucket outside the config",
    );
  });
});
