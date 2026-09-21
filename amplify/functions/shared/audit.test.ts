import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serialiseDetail, writeAuditEvent, type AuditCapableClient } from "./audit";
import type { Caller } from "./identity";

const caller: Caller = {
  sub: "sub-1",
  username: "user-1",
  email: "someone@example.invalid",
  groups: ["admin"],
};

/** A fake data client that records what it was asked to write. */
function recordingClient(errors?: { message: string }[]) {
  const written: Record<string, unknown>[] = [];
  const client = {
    models: {
      AuditEvent: {
        create: async (record: Record<string, unknown>) => {
          written.push(record);
          return { data: null, errors };
        },
      },
    },
  } as unknown as AuditCapableClient;
  return { client, written };
}

describe("serialiseDetail", () => {
  it("serialises an object to a JSON string, which AWSJSON requires", () => {
    assert.equal(serialiseDetail({ prefix: "", files: 3 }), '{"prefix":"","files":3}');
  });

  it("passes an already-serialised string through unchanged", () => {
    assert.equal(serialiseDetail('{"a":1}'), '{"a":1}');
  });

  it("maps absent detail to null", () => {
    assert.equal(serialiseDetail(undefined), null);
    assert.equal(serialiseDetail(null), null);
  });
});

describe("writeAuditEvent", () => {
  it("never hands the data client a raw object for detail", async () => {
    const { client, written } = recordingClient();
    await writeAuditEvent(client, "test-client", caller, {
      action: "FILE_LIST",
      outcome: "SUCCESS",
      detail: { prefix: "", folders: 3 },
    });
    assert.equal(typeof written[0].detail, "string");
  });

  it("takes actor fields from the caller, not the entry", async () => {
    const { client, written } = recordingClient();
    await writeAuditEvent(client, "test-client", caller, {
      action: "FILE_DOWNLOAD",
      outcome: "SUCCESS",
    });
    assert.equal(written[0].actorSub, "sub-1");
    assert.equal(written[0].actorEmail, "someone@example.invalid");
    assert.deepEqual(written[0].actorGroups, ["admin"]);
  });

  it("throws when the write is rejected, so admin actions cannot proceed unlogged", async () => {
    const { client } = recordingClient([{ message: "invalid value" }]);
    await assert.rejects(
      () =>
        writeAuditEvent(client, "test-client", caller, {
          action: "USER_CREATED",
          outcome: "SUCCESS",
        }),
      /Failed to write audit event: invalid value/,
    );
  });
});
