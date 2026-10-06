import { describe, expect, it } from "vitest";
import { applyWebCommand, type WebCommandContext } from "../../src/control/commandLedger.js";
import { withCommandClient } from "../../src/control/commandClient.js";
import { createGroup } from "../../src/control/commands.js";
import type { EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import type { GroupInput } from "../../src/control/types.js";
import { openTestStore } from "./fixtures/store.js";

// Agent entry spec §6: the ledger path stamps commands.client from the call's context, and the client is in neither hash.
const group: GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};

function raw(commandId: string): RawAuthorityCommandV1 {
  return { schema: "orca-raw-command-v1", commandId, expectedRevision: 1, actorId: "panel-operator", verb: "handoff-stop", target: { kind: "group", groupId: "g1" }, payload: {} };
}

function persist(store: Parameters<typeof applyWebCommand>[0], commandId: string) {
  const command = raw(commandId);
  return applyWebCommand(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: "2026-09-20T10:00:00.000Z" } }) as EffectiveAuthorityCommandV1,
    apply: (context: WebCommandContext) => ({
      status: 202,
      body: {
        schema: "orca-command-success-v1", commandId, actorId: command.actorId, verb: command.verb, target: command.target,
        commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt: "2026-09-20T10:00:00.000Z",
          handoffDeadlineAt: "2026-09-20T10:00:00.000Z", frozenRunIds: [], requestIds: [] },
      },
    }) as never,
  });
}

const SELECT = "SELECT client,raw_request_hash,effective_payload_hash,authority_command_hash,body_json FROM commands WHERE group_id='g1' AND id=?";

describe("command client on the ledger path (spec §6)", () => {
  it("stamps the client inside withCommandClient and leaves null outside", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      withCommandClient("c-in", "cli:x", () => persist(h.store, "c-in"));
      expect(h.store.db.prepare(SELECT).get("c-in")).toMatchObject({ client: "cli:x" });
      // The first command moved the revision on, so the outside case uses a fresh store (expectedRevision 1 again).
    } finally { await h.dispose(); }
    const h2 = await openTestStore();
    try {
      createGroup(h2.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      persist(h2.store, "c-out");
      expect(h2.store.db.prepare(SELECT).get("c-out")).toMatchObject({ client: null });
    } finally { await h2.dispose(); }
  });

  it("keeps the client out of every hash and the response body", async () => {
    const rows = [];
    for (const client of ["cli:x", null]) {
      const h = await openTestStore();
      try {
        createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
        if (client === null) persist(h.store, "same");
        else withCommandClient("same", client, () => persist(h.store, "same"));
        rows.push(h.store.db.prepare(SELECT).get("same"));
      } finally { await h.dispose(); }
    }
    expect(rows[0]).toMatchObject({ client: "cli:x" });
    expect(rows[1]).toMatchObject({ client: null });
    const { client: _a, ...withClient } = rows[0] as Record<string, unknown>;
    const { client: _b, ...without } = rows[1] as Record<string, unknown>;
    expect(withClient).toEqual(without);
  });
});
