import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT_ATTRIBUTE,
  checkUploadType,
} from "./upload-policy";

describe("checkUploadType", () => {
  it("accepts every type the client asked for", () => {
    for (const extension of ALLOWED_UPLOAD_EXTENSIONS) {
      const verdict = checkUploadType(`resident-record.${extension}`);
      assert.equal(verdict.allowed, true, `.${extension} should be accepted`);
      assert.equal(verdict.message, "");
    }
  });

  it("ignores case, since the extension comes from the user's filesystem", () => {
    assert.equal(checkUploadType("REPORT.PDF").allowed, true);
    assert.equal(checkUploadType("Report.DocX").allowed, true);
  });

  it("refuses scripts and executables", () => {
    for (const name of [
      "payload.exe",
      "run.sh",
      "macro.js",
      "sheet.xlsm",
      "page.html",
      "vector.svg",
      "archive.zip",
    ]) {
      const verdict = checkUploadType(name);
      assert.equal(verdict.allowed, false, `${name} should be refused`);
      assert.match(verdict.message, /cannot be uploaded/);
    }
  });

  it("judges only the final extension, so a double extension cannot pass", () => {
    const verdict = checkUploadType("invoice.pdf.exe");
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.extension, "exe");
  });

  it("refuses a file with no extension at all", () => {
    const verdict = checkUploadType("README");
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.extension, "");
  });

  it("refuses a dotfile, which has a leading dot but no extension", () => {
    assert.equal(checkUploadType(".bashrc").allowed, false);
  });

  it("refuses a name ending in a bare dot", () => {
    assert.equal(checkUploadType("report.").allowed, false);
  });

  it("reads the extension from the file name, not from a directory above it", () => {
    assert.equal(checkUploadType("/home/.config/notes.txt").allowed, true);
    assert.equal(checkUploadType("docs.pdf/payload.exe").allowed, false);
  });

  it("offers the picker the same list it enforces", () => {
    assert.equal(
      UPLOAD_ACCEPT_ATTRIBUTE,
      ALLOWED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(","),
    );
  });

  it("never accepts a type that could render as a page in the browser", () => {
    const renderable = ["html", "htm", "svg", "xhtml", "js", "mhtml"];
    for (const extension of renderable) {
      assert.equal(
        (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension),
        false,
        `.${extension} must never be in the upload allowlist`,
      );
    }
  });
});
