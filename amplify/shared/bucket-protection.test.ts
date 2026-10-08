import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DENIED_ACTIONS,
  DENY_DELETION_SID,
  denyDeletionStatement,
  lifecycleExpiresData,
  NEVER_DENY,
  planPolicy,
  unsafeToModify,
  type BucketPolicy,
} from "./bucket-protection";

const BUCKET = "psl-clinical-records";

/** A statement a client might already have, which must survive untouched. */
const EXISTING_TLS_STATEMENT = {
  Sid: "DenyInsecureTransport",
  Effect: "Deny" as const,
  Principal: "*",
  Action: "s3:*",
  Resource: [`arn:aws:s3:::${BUCKET}`, `arn:aws:s3:::${BUCKET}/*`],
  Condition: { Bool: { "aws:SecureTransport": "false" } },
};

describe("denyDeletionStatement", () => {
  it("denies object, version and bucket deletion to every principal", () => {
    const statement = denyDeletionStatement(BUCKET);
    assert.equal(statement.Effect, "Deny");
    assert.equal(statement.Principal, "*");
    assert.ok(statement.Action?.includes("s3:DeleteObject"));
    // Without this the recoverable version could itself be removed.
    assert.ok(statement.Action?.includes("s3:DeleteObjectVersion"));
    assert.ok(statement.Action?.includes("s3:DeleteBucket"));
  });

  it("covers both the bucket and its objects", () => {
    const statement = denyDeletionStatement(BUCKET);
    assert.deepEqual(statement.Resource, [
      `arn:aws:s3:::${BUCKET}`,
      `arn:aws:s3:::${BUCKET}/*`,
    ]);
  });

  it("never denies anything the portal or the policy itself depends on", () => {
    const denied = new Set<string>(DENIED_ACTIONS);
    for (const action of Object.keys(NEVER_DENY)) {
      assert.equal(denied.has(action), false, `${action} must not be denied: ${NEVER_DENY[action]}`);
    }
  });
});

describe("planPolicy", () => {
  it("creates a policy when the bucket has none", () => {
    const plan = planPolicy(null, BUCKET);
    assert.equal(plan.change, "add");
    assert.equal(plan.policy.Statement.length, 1);
    assert.equal(plan.policy.Version, "2012-10-17");
  });

  it("preserves a statement somebody else put there", () => {
    // PutBucketPolicy replaces the whole document, so this is the case that
    // silently destroys a client's TLS-only rule if done by hand.
    const existing: BucketPolicy = {
      Version: "2012-10-17",
      Statement: [EXISTING_TLS_STATEMENT],
    };

    const plan = planPolicy(existing, BUCKET);
    assert.equal(plan.change, "add");
    assert.equal(plan.policy.Statement.length, 2);
    assert.deepEqual(plan.policy.Statement[0], EXISTING_TLS_STATEMENT);
    assert.deepEqual(plan.preserved, ["DenyInsecureTransport"]);
  });

  it("is a no-op when already applied", () => {
    const first = planPolicy(null, BUCKET);
    const second = planPolicy(first.policy, BUCKET);
    assert.equal(second.change, "none");
  });

  it("updates in place rather than duplicating the statement", () => {
    const stale: BucketPolicy = {
      Version: "2012-10-17",
      Statement: [
        { Sid: DENY_DELETION_SID, Effect: "Deny", Principal: "*", Action: "s3:DeleteObject" },
      ],
    };

    const plan = planPolicy(stale, BUCKET);
    assert.equal(plan.change, "update");
    assert.equal(
      plan.policy.Statement.filter((s) => s.Sid === DENY_DELETION_SID).length,
      1,
    );
  });

  it("keeps the existing policy Id if there is one", () => {
    const plan = planPolicy({ Version: "2012-10-17", Id: "ClientPolicy", Statement: [] }, BUCKET);
    assert.equal(plan.policy.Id, "ClientPolicy");
  });
});

describe("unsafeToModify", () => {
  it("allows a bucket with no policy, or an ordinary one", () => {
    assert.deepEqual(unsafeToModify(null), []);
    assert.deepEqual(unsafeToModify({ Statement: [EXISTING_TLS_STATEMENT] }), []);
  });

  it("refuses a policy that already denies policy management to everyone", () => {
    // Such a bucket may be unchangeable even by the account root; merging into
    // it could fail irrecoverably, so a human looks at it first.
    const bricked: BucketPolicy = {
      Statement: [
        {
          Sid: "NoPolicyChanges",
          Effect: "Deny",
          Principal: "*",
          Action: ["s3:PutBucketPolicy", "s3:DeleteBucketPolicy"],
          Resource: `arn:aws:s3:::${BUCKET}`,
        },
      ],
    };

    const problems = unsafeToModify(bricked);
    assert.equal(problems.length > 0, true);
    assert.match(problems[0], /may not be modifiable/);
  });
});

describe("lifecycleExpiresData", () => {
  it("flags an enabled expiration rule", () => {
    assert.equal(
      lifecycleExpiresData([{ Status: "Enabled", Expiration: { Days: 30 } }]),
      true,
    );
    assert.equal(
      lifecycleExpiresData([{ Status: "Enabled", NoncurrentVersionExpiration: { NoncurrentDays: 7 } }]),
      true,
    );
  });

  it("ignores a disabled rule and incomplete-upload housekeeping", () => {
    assert.equal(lifecycleExpiresData([{ Status: "Disabled", Expiration: { Days: 30 } }]), false);
    assert.equal(
      lifecycleExpiresData([
        { Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } },
      ]),
      false,
    );
  });

  it("treats no configuration as no expiry", () => {
    assert.equal(lifecycleExpiresData(undefined), false);
    assert.equal(lifecycleExpiresData([]), false);
  });
});
