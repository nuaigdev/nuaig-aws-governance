import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from "./navigation";

describe("safeNextPath", () => {
  it("keeps an in-app path, including its query and fragment", () => {
    assert.equal(safeNextPath("/buckets/pii"), "/buckets/pii");
    assert.equal(
      safeNextPath("/buckets/pii?path=residents%2F2025%2F"),
      "/buckets/pii?path=residents%2F2025%2F",
    );
    assert.equal(safeNextPath("/admin/audit#latest"), "/admin/audit#latest");
  });

  it("falls back to the default when nothing was supplied", () => {
    assert.equal(safeNextPath(null), DEFAULT_SIGNED_IN_PATH);
    assert.equal(safeNextPath(undefined), DEFAULT_SIGNED_IN_PATH);
    assert.equal(safeNextPath(""), DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses to redirect off-site after a successful sign-in", () => {
    for (const hostile of [
      "https://evil.example",
      "http://evil.example",
      "//evil.example",
      "//evil.example/sign-in",
      "https://evil.example/buckets",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      assert.equal(
        safeNextPath(hostile),
        DEFAULT_SIGNED_IN_PATH,
        `${hostile} must not be followed`,
      );
    }
  });

  it("refuses backslash forms, which parsers disagree about", () => {
    assert.equal(safeNextPath("/\\evil.example"), DEFAULT_SIGNED_IN_PATH);
    assert.equal(safeNextPath("\\\\evil.example"), DEFAULT_SIGNED_IN_PATH);
  });

  it("refuses control characters used to disguise a destination", () => {
    assert.equal(safeNextPath("/buckets\nLocation: https://evil.example"), DEFAULT_SIGNED_IN_PATH);
    assert.equal(safeNextPath("/\u0000/evil"), DEFAULT_SIGNED_IN_PATH);
  });
});
