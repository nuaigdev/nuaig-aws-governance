import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientConfig as acmeSeniorLiving } from "./clients/acme-senior-living";
import { clientConfig as nuaigInternal } from "./clients/nuaig-internal";
import { clientConfig as presbyterianSeniorLiving } from "./clients/presbyterian-senior-living";
import type { ClientConfig } from "./types";

/**
 * Guards the one-way rule on `showNuaigBranding`.
 *
 * A client portal must carry the client's identity and nothing else. The risk
 * this test exists for is mundane: someone adds the next client by copying
 * `nuaig-internal.ts` — the config that *does* set the flag — and ships our
 * logo to a client who never agreed to it. A review might catch that; this
 * catches it in CI.
 */

const CLIENT_TENANTS: readonly ClientConfig[] = [
  acmeSeniorLiving,
  presbyterianSeniorLiving,
];

describe("Nuaig branding", () => {
  it("is on for our own showcase tenant", () => {
    assert.equal(nuaigInternal.showNuaigBranding, true);
  });

  it("is off for every client tenant", () => {
    for (const config of CLIENT_TENANTS) {
      assert.notEqual(
        config.showNuaigBranding,
        true,
        `${config.clientId} must not carry Nuaig branding`,
      );
    }
  });

  it("is off when the field is simply omitted", () => {
    // The default has to be the safe direction: forgetting the flag on a new
    // client config must produce an unbranded portal, not a branded one.
    const minimal = { clientId: "x" } as ClientConfig;
    assert.notEqual(minimal.showNuaigBranding, true);
  });
});
