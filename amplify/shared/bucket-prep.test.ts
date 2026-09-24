import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowsDelete,
  normaliseVersioning,
  parseOrigins,
  planCors,
  policyEnforcesTls,
  PORTAL_CORS_RULE_ID,
  portalCorsRule,
} from "./bucket-prep";

const ORIGIN = "https://main.d1234abcd.amplifyapp.com";

describe("parseOrigins", () => {
  it("accepts an https origin and trims a trailing slash", () => {
    assert.deepEqual(parseOrigins(`${ORIGIN}/`), [ORIGIN]);
  });

  it("refuses to run without an origin", () => {
    assert.throws(() => parseOrigins(undefined), /not set/);
    assert.throws(() => parseOrigins("  "), /not set/);
  });

  it("refuses wildcards, plain http and paths", () => {
    assert.throws(() => parseOrigins("*"), /Wildcard/);
    assert.throws(() => parseOrigins("https://*.example.com"), /Wildcard/);
    assert.throws(() => parseOrigins("http://portal.example.com"), /https/);
    assert.throws(() => parseOrigins("https://portal.example.com/app"), /origin only/);
  });

  it("allows localhost over http for development", () => {
    assert.deepEqual(parseOrigins("http://localhost:3000"), ["http://localhost:3000"]);
  });
});

describe("portalCorsRule", () => {
  it("never permits DELETE", () => {
    assert.equal(allowsDelete([portalCorsRule([ORIGIN])]), false);
  });
});

describe("planCors", () => {
  it("adds the portal rule to a bucket with no CORS configuration", () => {
    const plan = planCors([], [ORIGIN]);
    assert.equal(plan.change, "add");
    assert.equal(plan.rules.length, 1);
    assert.equal(plan.rules[0].ID, PORTAL_CORS_RULE_ID);
  });

  it("keeps rules that belong to other applications", () => {
    const other = { ID: "other-app", AllowedOrigins: ["https://other.example.com"], AllowedMethods: ["GET"] };
    const plan = planCors([other], [ORIGIN]);
    assert.equal(plan.change, "add");
    assert.deepEqual(plan.rules[0], other);
    assert.equal(plan.rules.length, 2);
  });

  it("is a no-op when the rule is already current", () => {
    const first = planCors([], [ORIGIN]);
    const second = planCors(first.rules, [ORIGIN]);
    assert.equal(second.change, "none");
  });

  it("updates in place when the origin changes, without duplicating", () => {
    const first = planCors([], [ORIGIN]);
    const second = planCors(first.rules, ["https://new.example.com"]);
    assert.equal(second.change, "update");
    assert.equal(second.rules.filter((rule) => rule.ID === PORTAL_CORS_RULE_ID).length, 1);
    assert.deepEqual(second.rules[0].AllowedOrigins, ["https://new.example.com"]);
  });
});

describe("allowsDelete", () => {
  it("flags an existing rule that permits DELETE, whatever its case", () => {
    assert.equal(
      allowsDelete([{ AllowedOrigins: ["*"], AllowedMethods: ["get", "delete"] }]),
      true,
    );
  });
});

describe("normaliseVersioning", () => {
  it("treats a never-versioned bucket as Off", () => {
    assert.equal(normaliseVersioning(undefined), "Off");
    assert.equal(normaliseVersioning("Enabled"), "Enabled");
    assert.equal(normaliseVersioning("Suspended"), "Suspended");
  });
});

describe("policyEnforcesTls", () => {
  it("recognises a deny-on-insecure-transport statement", () => {
    const policy = JSON.stringify({
      Statement: [
        {
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ],
    });
    assert.equal(policyEnforcesTls(policy), true);
  });

  it("returns false for no policy, or an unrelated one", () => {
    assert.equal(policyEnforcesTls(undefined), false);
    assert.equal(policyEnforcesTls("not json"), false);
    assert.equal(
      policyEnforcesTls(JSON.stringify({ Statement: [{ Effect: "Allow", Action: "s3:GetObject" }] })),
      false,
    );
  });
});
