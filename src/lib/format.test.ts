import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fileExtension,
  formatBytes,
  formatDateTime,
  formatRelative,
  keyBasename,
  keyPrefix,
  pluralise,
} from "./format";

describe("formatBytes", () => {
  it("formats whole bytes without a decimal", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1), "1 B");
    assert.equal(formatBytes(1023), "1023 B");
  });

  it("switches unit at 1024, binary-based like S3", () => {
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1024 * 1024), "1.0 MB");
    assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB");
  });

  it("keeps one decimal above KB so column widths stay stable", () => {
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(2_621_440), "2.5 MB");
  });

  it("caps at the largest known unit rather than inventing one", () => {
    assert.equal(formatBytes(1024 ** 5), "1024.0 TB");
  });

  it("renders an em dash for absent or nonsensical values", () => {
    assert.equal(formatBytes(undefined), "—");
    assert.equal(formatBytes(null), "—");
    assert.equal(formatBytes(Number.NaN), "—");
    assert.equal(formatBytes(-1), "—");
  });
});

describe("formatDateTime", () => {
  it("renders an em dash rather than 'Invalid Date'", () => {
    assert.equal(formatDateTime(null), "—");
    assert.equal(formatDateTime(undefined), "—");
    assert.equal(formatDateTime(""), "—");
    assert.equal(formatDateTime("not-a-date"), "—");
  });

  it("formats a valid ISO timestamp", () => {
    const result = formatDateTime("2026-03-04T09:30:00.000Z");
    assert.notEqual(result, "—");
    assert.match(result, /2026/);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");

  it("says 'Never' when there is no timestamp", () => {
    assert.equal(formatRelative(null, now), "Never");
    assert.equal(formatRelative(undefined, now), "Never");
  });

  it("scales the unit with the distance", () => {
    assert.match(formatRelative("2026-03-10T11:59:30.000Z", now), /second/);
    assert.match(formatRelative("2026-03-10T11:30:00.000Z", now), /minute/);
    assert.match(formatRelative("2026-03-10T06:00:00.000Z", now), /hour/);
    assert.match(formatRelative("2026-03-05T12:00:00.000Z", now), /day/);
    assert.match(formatRelative("2026-01-05T12:00:00.000Z", now), /month/);
    assert.match(formatRelative("2024-01-05T12:00:00.000Z", now), /year/);
  });
});

describe("S3 key helpers", () => {
  it("takes the basename of a nested key", () => {
    assert.equal(keyBasename("reports/2026/q1-summary.pdf"), "q1-summary.pdf");
    assert.equal(keyBasename("at-root.txt"), "at-root.txt");
  });

  it("treats a trailing slash as a folder and names it", () => {
    assert.equal(keyBasename("reports/2026/"), "2026");
  });

  it("returns the prefix including its trailing slash", () => {
    assert.equal(keyPrefix("reports/2026/q1.pdf"), "reports/2026/");
    assert.equal(keyPrefix("at-root.txt"), "");
  });

  it("extracts an uppercase extension", () => {
    assert.equal(fileExtension("reports/q1.pdf"), "PDF");
    assert.equal(fileExtension("archive.tar.gz"), "GZ");
  });

  it("has no extension for dotfiles or trailing dots", () => {
    assert.equal(fileExtension(".gitignore"), null);
    assert.equal(fileExtension("no-extension"), null);
    assert.equal(fileExtension("trailing."), null);
  });
});

describe("pluralise", () => {
  it("uses the singular for exactly one", () => {
    assert.equal(pluralise(1, "file"), "1 file");
    assert.equal(pluralise(0, "file"), "0 files");
    assert.equal(pluralise(2, "file"), "2 files");
  });

  it("accepts an irregular plural", () => {
    assert.equal(pluralise(2, "entry", "entries"), "2 entries");
  });
});
