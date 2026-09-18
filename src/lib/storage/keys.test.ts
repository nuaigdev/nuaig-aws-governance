import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { joinKey, nextAvailableKey, sanitiseFileName, splitExtension } from "./keys";

/** Builds an `exists` probe over a fixed set of keys, recording what was asked. */
function bucket(existing: string[]) {
  const asked: string[] = [];
  const set = new Set(existing);
  return {
    asked,
    exists: async (key: string) => {
      asked.push(key);
      return set.has(key);
    },
  };
}

describe("splitExtension", () => {
  it("splits a simple extension", () => {
    assert.deepEqual(splitExtension("report.pdf"), {
      stem: "report",
      extension: ".pdf",
    });
  });

  it("keeps the folder prefix on the stem", () => {
    assert.deepEqual(splitExtension("2026/q1/report.pdf"), {
      stem: "2026/q1/report",
      extension: ".pdf",
    });
  });

  it("treats a compound archive extension as one unit", () => {
    assert.deepEqual(splitExtension("backup.tar.gz"), {
      stem: "backup",
      extension: ".tar.gz",
    });
  });

  it("does not treat a dotfile's leading dot as an extension", () => {
    assert.deepEqual(splitExtension(".gitignore"), {
      stem: ".gitignore",
      extension: "",
    });
  });

  it("handles a name with no extension", () => {
    assert.deepEqual(splitExtension("LICENSE"), { stem: "LICENSE", extension: "" });
  });
});

describe("nextAvailableKey", () => {
  it("uses the desired key when nothing is there", async () => {
    const { exists } = bucket([]);
    assert.equal(await nextAvailableKey("report.pdf", exists), "report.pdf");
  });

  /* The core guarantee. */
  it("never returns a key that already exists", async () => {
    const { exists } = bucket(["report.pdf"]);
    const result = await nextAvailableKey("report.pdf", exists);
    assert.notEqual(result, "report.pdf");
    assert.equal(result, "report (2).pdf");
  });

  it("keeps counting past consecutive collisions", async () => {
    const { exists } = bucket(["a.txt", "a (2).txt", "a (3).txt"]);
    assert.equal(await nextAvailableKey("a.txt", exists), "a (4).txt");
  });

  it("inserts the counter before the extension, not after", async () => {
    const { exists } = bucket(["backup.tar.gz"]);
    assert.equal(await nextAvailableKey("backup.tar.gz", exists), "backup (2).tar.gz");
  });

  it("deduplicates within the folder prefix", async () => {
    const { exists } = bucket(["2026/q1/report.pdf"]);
    assert.equal(
      await nextAvailableKey("2026/q1/report.pdf", exists),
      "2026/q1/report (2).pdf",
    );
  });

  it("handles a name with no extension", async () => {
    const { exists } = bucket(["LICENSE"]);
    assert.equal(await nextAvailableKey("LICENSE", exists), "LICENSE (2)");
  });

  it("checks the desired key first and stops at the first free one", async () => {
    const probe = bucket(["a.txt"]);
    await nextAvailableKey("a.txt", probe.exists);
    assert.deepEqual(probe.asked, ["a.txt", "a (2).txt"]);
  });

  it("gives up rather than looping forever when everything collides", async () => {
    const exists = async () => true;
    await assert.rejects(
      () => nextAvailableKey("a.txt", exists, 5),
      /Could not find an unused name/,
    );
  });
});

describe("sanitiseFileName", () => {
  it("strips a path, keeping only the file name", () => {
    assert.equal(sanitiseFileName("C:\\Users\\someone\\report.pdf"), "report.pdf");
    assert.equal(sanitiseFileName("/etc/passwd"), "passwd");
  });

  it("defeats traversal segments", () => {
    assert.equal(sanitiseFileName("../../../etc/passwd"), "passwd");
    assert.equal(sanitiseFileName("..\\..\\secret.txt"), "secret.txt");
  });

  it("strips leading dots so a upload cannot become a dotfile", () => {
    assert.equal(sanitiseFileName("...hidden"), "hidden");
  });

  it("removes control characters that would break S3 listing XML", () => {
    assert.equal(sanitiseFileName("bad\u0000name\u001f.txt"), "badname.txt");
  });

  it("falls back to a placeholder rather than an empty key", () => {
    assert.equal(sanitiseFileName("..."), "unnamed-file");
    assert.equal(sanitiseFileName("   "), "unnamed-file");
    assert.equal(sanitiseFileName("/"), "unnamed-file");
  });

  it("leaves an ordinary name untouched", () => {
    assert.equal(sanitiseFileName("Q1 Report (final).pdf"), "Q1 Report (final).pdf");
  });
});

describe("joinKey", () => {
  it("joins a prefix and a name", () => {
    assert.equal(joinKey("2026/q1", "a.pdf"), "2026/q1/a.pdf");
  });

  it("does not double the separator", () => {
    assert.equal(joinKey("2026/q1/", "a.pdf"), "2026/q1/a.pdf");
  });

  it("puts a root-level file at the root", () => {
    assert.equal(joinKey("", "a.pdf"), "a.pdf");
  });
});
