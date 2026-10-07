import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { KNOWN_CLIENT_IDS } from "./index";

/**
 * Guards the duplication in `config/index.ts`.
 *
 * The resolver is a `switch` over literal ids rather than a map built from the
 * config objects, so that a client's bundle does not carry every other
 * client's bucket names. The price is that a new client has to be added in two
 * places. This test is what makes that price safe to pay: it fails if a config
 * file exists that the resolver cannot reach, which would otherwise show up as
 * a confusing "no config under config/clients/" at deploy time.
 */

const clientsDir = join(dirname(fileURLToPath(import.meta.url)), "clients");

function clientIdsOnDisk(): string[] {
  return readdirSync(clientsDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

describe("client registration", () => {
  it("registers every config file under config/clients/", () => {
    // Every client config is named after its id, so the filenames are the
    // expected id set. A file the resolver cannot reach is dead weight at best
    // and an undeployable client at worst.
    assert.deepEqual([...KNOWN_CLIENT_IDS].sort(), clientIdsOnDisk());
  });

  it("lists no client that has no config file", () => {
    const onDisk = new Set(clientIdsOnDisk());
    for (const id of KNOWN_CLIENT_IDS) {
      assert.ok(onDisk.has(id), `${id} is listed but config/clients/${id}.ts does not exist`);
    }
  });
});
