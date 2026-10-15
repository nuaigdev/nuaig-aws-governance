import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inviteEmailBody, inviteEmailSubject } from "./invite-email";
import { clientConfig as nuaigInternal } from "./clients/nuaig-internal";
import { clientConfig as psl } from "./clients/presbyterian-senior-living";
import type { ClientConfig } from "./types";

/** As Cognito passes them at deploy time, before substitution. */
const USERNAME = "{username}";
const CODE = "{####}";

function render(client: ClientConfig): string {
  return inviteEmailBody(client, USERNAME, CODE);
}

describe("inviteEmailSubject", () => {
  it("names the client rather than the product", () => {
    assert.match(inviteEmailSubject(psl), /Presbyterian Senior Living/);
  });
});

describe("inviteEmailBody", () => {
  it("carries both Cognito placeholders through untouched", () => {
    const html = render(psl);
    assert.ok(html.includes(USERNAME), "username placeholder missing");
    assert.ok(html.includes(CODE), "password placeholder missing");
  });

  it("links to the portal, and shows the URL for clients that strip links", () => {
    const html = render(psl);
    assert.ok(html.includes(`href="${psl.portalUrl}"`));
    // Twice: once as the button target, once as copyable text.
    assert.ok(html.split(psl.portalUrl).length - 1 >= 2);
  });

  it("explains what the portal is for", () => {
    const html = render(psl);
    assert.match(html, /view, download and upload/i);
  });

  it("names Microsoft Authenticator and does not imply a closed list", () => {
    const html = render(psl);
    assert.match(html, /Microsoft Authenticator/);
    assert.match(html, /any other app/i);
  });

  it("never names Nuaig in a client's invitation", () => {
    // The email reaches client staff, so it is one of the surfaces the
    // branding rule covers. Checked case-insensitively, since a stray
    // "NuAIg" or "nuaig.ai" would be just as wrong.
    assert.doesNotMatch(render(psl), /nuaig/i);
  });

  it("uses no SVG, which Gmail strips", () => {
    assert.doesNotMatch(render(psl), /<svg|\.svg/i);
  });

  it("shows the logo as an absolute URL, since email has no site root", () => {
    const html = render(psl);
    assert.ok(psl.emailLogo, "PSL should have a raster email logo");
    assert.ok(html.includes(`src="${psl.portalUrl}${psl.emailLogo!.path}"`));
  });

  it("gives the logo width and height attributes and an identifying alt", () => {
    const html = render(psl);
    assert.match(html, new RegExp(`width="${psl.emailLogo!.width}"`));
    assert.match(html, new RegExp(`height="${psl.emailLogo!.height}"`));
    assert.ok(html.includes(`alt="${psl.displayName}"`));
  });

  it("falls back to a text wordmark when a client has no raster logo", () => {
    const noLogo: ClientConfig = { ...psl, emailLogo: undefined };
    const html = inviteEmailBody(noLogo, USERNAME, CODE);
    assert.doesNotMatch(html, /<img/);
    assert.ok(html.includes(psl.displayName));
  });

  it("stays inside Cognito's 20,000 character limit for every client", () => {
    for (const client of [psl, nuaigInternal]) {
      const length = render(client).length;
      assert.ok(
        length < 20_000,
        `${client.clientId} invitation is ${length} characters`,
      );
    }
  });

  it("escapes nothing it should not — the client name reaches the markup", () => {
    assert.ok(render(psl).includes(psl.displayName));
  });
});
