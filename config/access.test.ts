import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  accessibleBuckets,
  canRead,
  canUpload,
  grantedBuckets,
  isAdmin,
} from "./access";
import type { ClientConfig } from "./types";
import { ClientConfigError, validateClientConfig } from "./validate";

const config: ClientConfig = {
  clientId: "test-client",
  displayName: "Test Client",
  bucketProvisioning: "managed",
  buckets: [
    { id: "docs", label: "Docs", bucketName: "test-docs", description: "d", sensitivity: "standard" },
    { id: "pii", label: "PII", bucketName: "test-pii", description: "d", sensitivity: "sensitive" },
    { id: "fin", label: "Finance", bucketName: "test-fin", description: "d", sensitivity: "sensitive" },
  ],
  groups: [
    {
      id: "admin",
      label: "Administrator",
      description: "d",
      isAdmin: true,
      bucketAccess: [{ bucketId: "*", mode: "read-upload" }],
    },
    {
      id: "docs-team",
      label: "Docs Team",
      description: "d",
      bucketAccess: [{ bucketId: "docs", mode: "read-upload" }],
    },
    {
      id: "docs-reader",
      label: "Docs Reader",
      description: "d",
      bucketAccess: [{ bucketId: "docs", mode: "read" }],
    },
    {
      id: "pii-reader",
      label: "PII Reader",
      description: "d",
      bucketAccess: [{ bucketId: "pii", mode: "read" }],
    },
  ],
};

const groupsById = Object.fromEntries(config.groups.map((g) => [g.id, g]));

describe("accessibleBuckets", () => {
  it("grants nothing to a user with no groups", () => {
    assert.deepEqual(accessibleBuckets(config, []), []);
  });

  it("expands a wildcard grant to every bucket in config order", () => {
    const access = accessibleBuckets(config, ["admin"]);
    assert.deepEqual(
      access.map((a) => a.bucket.id),
      ["docs", "pii", "fin"],
    );
    assert.ok(access.every((a) => a.mode === "read-upload"));
  });

  it("returns only the buckets a scoped group grants", () => {
    const access = accessibleBuckets(config, ["pii-reader"]);
    assert.deepEqual(
      access.map((a) => a.bucket.id),
      ["pii"],
    );
  });

  it("unions across multiple groups", () => {
    const access = accessibleBuckets(config, ["docs-reader", "pii-reader"]);
    assert.deepEqual(
      access.map((a) => a.bucket.id),
      ["docs", "pii"],
    );
  });

  it("takes the most permissive mode when groups overlap, regardless of order", () => {
    for (const groups of [
      ["docs-reader", "docs-team"],
      ["docs-team", "docs-reader"],
    ]) {
      const docs = accessibleBuckets(config, groups).find((a) => a.bucket.id === "docs");
      assert.equal(docs?.mode, "read-upload", `order: ${groups.join(",")}`);
    }
  });

  it("records every group that contributed the access", () => {
    const docs = accessibleBuckets(config, ["docs-reader", "docs-team"]).find(
      (a) => a.bucket.id === "docs",
    );
    assert.deepEqual([...(docs?.viaGroups ?? [])].sort(), ["docs-reader", "docs-team"]);
  });

  it("ignores groups that no longer exist in config", () => {
    const access = accessibleBuckets(config, ["decommissioned", "pii-reader"]);
    assert.deepEqual(
      access.map((a) => a.bucket.id),
      ["pii"],
    );
  });

  it("does not duplicate a bucket when several groups grant it", () => {
    const access = accessibleBuckets(config, ["admin", "docs-team", "pii-reader"]);
    assert.equal(new Set(access.map((a) => a.bucket.id)).size, access.length);
  });
});

describe("canRead / canUpload", () => {
  it("read-only groups cannot upload", () => {
    assert.equal(canRead(config, ["pii-reader"], "pii"), true);
    assert.equal(canUpload(config, ["pii-reader"], "pii"), false);
  });

  it("read-upload groups can upload", () => {
    assert.equal(canUpload(config, ["docs-team"], "docs"), true);
  });

  it("neither applies to a bucket outside the user's grants", () => {
    assert.equal(canRead(config, ["docs-team"], "fin"), false);
    assert.equal(canUpload(config, ["docs-team"], "fin"), false);
  });

  it("an unknown bucket id is never readable or uploadable", () => {
    assert.equal(canRead(config, ["admin"], "no-such-bucket"), false);
    assert.equal(canUpload(config, ["admin"], "no-such-bucket"), false);
  });
});

describe("isAdmin", () => {
  it("is true only via a group marked isAdmin", () => {
    assert.equal(isAdmin(config, ["admin"]), true);
    assert.equal(isAdmin(config, ["docs-team", "pii-reader"]), false);
    assert.equal(isAdmin(config, []), false);
  });

  it("is not implied by reaching every bucket", () => {
    const wideButNotAdmin: ClientConfig = {
      ...config,
      groups: [
        ...config.groups,
        {
          id: "everything",
          label: "Everything",
          description: "d",
          bucketAccess: config.buckets.map((b) => ({ bucketId: b.id, mode: "read" as const })),
        },
      ],
    };
    assert.equal(accessibleBuckets(wideButNotAdmin, ["everything"]).length, 3);
    assert.equal(isAdmin(wideButNotAdmin, ["everything"]), false);
  });
});

describe("grantedBuckets", () => {
  it("expands the wildcard for IAM policy generation", () => {
    assert.deepEqual(
      grantedBuckets(config, groupsById.admin).map((g) => [g.bucket.bucketName, g.mode]),
      [
        ["test-docs", "read-upload"],
        ["test-pii", "read-upload"],
        ["test-fin", "read-upload"],
      ],
    );
  });

  it("returns physical bucket names, which is what a policy needs", () => {
    assert.deepEqual(
      grantedBuckets(config, groupsById["pii-reader"]).map((g) => g.bucket.bucketName),
      ["test-pii"],
    );
  });
});

describe("validateClientConfig", () => {
  const valid = () => structuredClone(config) as ClientConfig;

  it("accepts a well-formed config and returns it", () => {
    const input = valid();
    assert.equal(validateClientConfig(input), input);
  });

  it("rejects a grant pointing at an unknown bucket", () => {
    const broken = {
      ...valid(),
      groups: [
        ...config.groups,
        { id: "ghost", label: "Ghost", description: "d", bucketAccess: [{ bucketId: "nope", mode: "read" as const }] },
      ],
    };
    assert.throws(() => validateClientConfig(broken), ClientConfigError);
  });

  it("rejects a config with no admin group", () => {
    const broken = { ...valid(), groups: config.groups.filter((g) => !g.isAdmin) };
    assert.throws(() => validateClientConfig(broken), /no group is marked isAdmin/);
  });

  it("rejects more than one admin group", () => {
    const broken = {
      ...valid(),
      groups: [
        ...config.groups,
        { id: "admin2", label: "Admin 2", description: "d", isAdmin: true, bucketAccess: [{ bucketId: "*", mode: "read" as const }] },
      ],
    };
    assert.throws(() => validateClientConfig(broken), /more than one admin group/);
  });

  it("rejects an admin group that cannot reach every bucket", () => {
    const broken = {
      ...valid(),
      groups: config.groups.map((g) =>
        g.isAdmin ? { ...g, bucketAccess: [{ bucketId: "docs", mode: "read-upload" as const }] } : g,
      ),
    };
    assert.throws(() => validateClientConfig(broken), /cannot reach every bucket/);
  });

  it("rejects duplicate grants for the same bucket in one group", () => {
    const broken = {
      ...valid(),
      groups: config.groups.map((g) =>
        g.id === "docs-team"
          ? {
              ...g,
              bucketAccess: [
                { bucketId: "docs", mode: "read" as const },
                { bucketId: "docs", mode: "read-upload" as const },
              ],
            }
          : g,
      ),
    };
    assert.throws(() => validateClientConfig(broken), /grants the same bucket twice/);
  });

  it("rejects mixing a wildcard grant with per-bucket grants", () => {
    const broken = {
      ...valid(),
      groups: config.groups.map((g) =>
        g.isAdmin
          ? {
              ...g,
              bucketAccess: [
                { bucketId: "*", mode: "read-upload" as const },
                { bucketId: "docs", mode: "read" as const },
              ],
            }
          : g,
      ),
    };
    assert.throws(() => validateClientConfig(broken), /mixes a "\*" grant/);
  });

  it("rejects an S3-illegal physical bucket name", () => {
    const broken = {
      ...valid(),
      buckets: config.buckets.map((b) =>
        b.id === "docs" ? { ...b, bucketName: "Test_Docs" } : b,
      ),
    };
    assert.throws(() => validateClientConfig(broken), /S3-illegal bucketName/);
  });

  it("rejects a group id Cognito would not accept", () => {
    const broken = {
      ...valid(),
      groups: [
        ...config.groups,
        { id: "has spaces", label: "Bad", description: "d", bucketAccess: [{ bucketId: "docs", mode: "read" as const }] },
      ],
    };
    assert.throws(() => validateClientConfig(broken), /not a legal Cognito group name/);
  });

  it("reports every problem at once, not just the first", () => {
    const broken = {
      ...valid(),
      groups: [
        { id: "only", label: "Only", description: "d", bucketAccess: [{ bucketId: "ghost", mode: "read" as const }] },
      ],
    };
    assert.throws(
      () => validateClientConfig(broken),
      (error: unknown) => {
        assert.ok(error instanceof ClientConfigError);
        assert.match(error.message, /unknown bucket "ghost"/);
        assert.match(error.message, /no group is marked isAdmin/);
        return true;
      },
    );
  });
});
