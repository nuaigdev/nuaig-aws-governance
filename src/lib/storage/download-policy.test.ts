import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { downloadPresentation, extensionOf } from "./download-policy";

describe("extensionOf", () => {
  it("reads the extension from the last path segment", () => {
    assert.equal(extensionOf("reports/2025/summary.PDF"), "pdf");
    assert.equal(extensionOf("summary.tar.gz"), "gz");
  });

  it("returns empty for keys with no usable extension", () => {
    assert.equal(extensionOf("reports/README"), "");
    assert.equal(extensionOf("reports/.gitignore"), "");
    assert.equal(extensionOf("reports/trailing."), "");
    assert.equal(extensionOf("folder.name/file"), "");
  });
});

describe("downloadPresentation", () => {
  it("previews the allowlisted types inline, with the type pinned", () => {
    assert.deepEqual(downloadPresentation("care/plan.pdf"), {
      contentDisposition: "inline",
      contentType: "application/pdf",
    });
    assert.deepEqual(downloadPresentation("photos/front.JPG"), {
      contentDisposition: "inline",
      contentType: "image/jpeg",
    });
  });

  it("forces a download for anything not on the allowlist", () => {
    for (const key of ["notes.docx", "data.xlsx", "archive.zip", "README", "export.csv"]) {
      assert.equal(
        downloadPresentation(key).contentDisposition,
        "attachment",
        `${key} should download`,
      );
    }
  });

  it("never renders a type that can carry script", () => {
    // The whole reason this module exists. An SVG is a scriptable document,
    // and these buckets hold files the portal did not create.
    for (const key of [
      "logo.svg",
      "page.html",
      "page.htm",
      "doc.xhtml",
      "feed.xml",
      "saved.mhtml",
    ]) {
      assert.deepEqual(
        downloadPresentation(key),
        { contentDisposition: "attachment", contentType: "application/octet-stream" },
        `${key} must not be served inline`,
      );
    }
  });

  it("defeats a double extension that hides the real type", () => {
    // `evil.html.pdf` is served as application/pdf, so a browser parses it as a
    // PDF and fails rather than executing the HTML inside it.
    assert.deepEqual(downloadPresentation("evil.html.pdf"), {
      contentDisposition: "inline",
      contentType: "application/pdf",
    });
    // And the reverse never previews at all.
    assert.equal(downloadPresentation("evil.pdf.html").contentDisposition, "attachment");
  });
});
