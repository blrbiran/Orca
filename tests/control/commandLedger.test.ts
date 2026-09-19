import { describe, expect, it } from "vitest";
import { applyWebCommand, lookupCommandResult, type WebCommandInput } from "../../src/control/commandLedger.js";
import { createGroup, setGroupStopped } from "../../src/control/commands.js";
import { readVersions } from "../../src/control/queries.js";
import type { EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import type { GroupInput } from "../../src/control/types.js";
import { openTestStore } from "./fixtures/store.js";

const deadlineA = "2026-09-20T10:00:00.000Z";
const deadlineB = "2026-09-20T11:00:00.000Z";
const group: GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};

function raw(commandId = "web-stop", expectedRevision = 1): RawAuthorityCommandV1 {
  return {
    schema: "orca-raw-command-v1",
    commandId,
    expectedRevision,
    actorId: "panel-operator",
    verb: "handoff-stop",
    target: { kind: "group", groupId: "g1" },
    payload: {},
  };
}

function input<T>(
  command: RawAuthorityCommandV1,
  deadline: () => string,
  run: WebCommandInput<T>["apply"],
): WebCommandInput<T> {
  return {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: deadline() } }) as EffectiveAuthorityCommandV1,
    apply: run,
  };
}

describe("web command ledger", () => {
  it("replays the persisted effective default before reading changed defaults", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const defaults = { deadline: deadlineA };
      let calls = 0;
      const first = applyWebCommand(h.store, input(raw(), () => defaults.deadline, ({ effectiveCommand }) => {
        calls += 1;
        return { status: 202, body: { selected: (effectiveCommand.payload as { handoffDeadlineAt: string }).handoffDeadlineAt } };
      }));
      defaults.deadline = deadlineB;
      const replay = applyWebCommand(h.store, input(raw(), () => {
        throw new Error("dynamic default was read during replay");
      }, () => {
        throw new Error("command effect was repeated");
      }));

      expect(replay).toEqual(first);
      expect(first.body).toEqual({ selected: deadlineA });
      expect(calls).toBe(1);
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 2, projectionSeq: 2 });
      expect(lookupCommandResult(h.store, "g1", "web-stop")).toEqual({
        schema: "orca-command-lookup-v1",
        originalStatus: 202,
        body: { selected: deadlineA },
      });
      const row = h.store.db.prepare(`SELECT actor_id,verb,target_json,expected_revision,raw_request_json,raw_request_hash,
        effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash,original_status,
        body_json,response_bytes,command_revision,projection_seq FROM commands WHERE group_id='g1' AND id='web-stop'`).get();
      expect(row).toMatchObject({
        actor_id: "panel-operator",
        verb: "handoff-stop",
        target_json: '{"groupId":"g1","kind":"group"}',
        expected_revision: 1,
        effective_payload_json: `{"handoffDeadlineAt":"${deadlineA}"}`,
        original_status: 202,
        body_json: `{"selected":"${deadlineA}"}`,
        command_revision: 2,
        projection_seq: 2,
      });
      expect(String(row?.raw_request_json)).toContain('"payload":{}');
      for (const hash of [row?.raw_request_hash,row?.effective_payload_hash,row?.authority_command_hash]) expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(new Set([row?.raw_request_hash,row?.effective_payload_hash,row?.authority_command_hash]).size).toBe(3);
      expect(String(row?.authority_command_json)).toContain('"schema":"orca-authority-command-v1"');
      expect(Buffer.from(row?.response_bytes as Uint8Array).toString("utf8")).toBe(row?.body_json);
    } finally {
      await h.dispose();
    }
  });

  it.each([
    ["actor", (value: RawAuthorityCommandV1) => ({ ...value, actorId: "different" })],
    ["verb", (value: RawAuthorityCommandV1) => ({ ...value, verb: "pause-dispatch", payload: {} })],
    ["target", (value: RawAuthorityCommandV1) => ({ ...value, verb: "continue-task", target: { kind: "task", groupId: "g1", taskId: "T1" }, payload: { predecessorRunId: "r1", checkpointId: "c1" } })],
    ["revision", (value: RawAuthorityCommandV1) => ({ ...value, expectedRevision: 0 })],
    ["raw payload", (value: RawAuthorityCommandV1) => ({ ...value, payload: { handoffDeadlineAt: deadlineB } })],
  ] as const)("rejects same-ID changes to %s before expansion or stale-revision evaluation", async (_label, change) => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      applyWebCommand(h.store, input(raw(), () => deadlineA, () => ({ status: 202, body: { selected: deadlineA } })));
      expect(() => applyWebCommand(h.store, {
        rawCommand: change(raw()) as RawAuthorityCommandV1,
        expand: () => { throw new Error("must not expand a conflicting replay"); },
        apply: () => { throw new Error("must not apply a conflicting replay"); },
      })).toThrow("command-id-conflict");
    } finally {
      await h.dispose();
    }
  });

  it("persists stale revisions and application 4xx outcomes for immutable replay", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const stale = input(raw("stale", 0), () => deadlineA, () => { throw new Error("stale command applied"); });
      const staleResult = applyWebCommand(h.store, stale);
      expect(staleResult.status).toBe(409);
      expect(staleResult.body).toMatchObject({ error: { code: "revision-conflict", commandRevision: 1, retryable: false } });

      setGroupStopped(h.store, "g1", true, { commandId: "legacy-stop", expectedRevision: 1, by: "human" });
      expect(applyWebCommand(h.store, stale)).toEqual(staleResult);

      const rejected = input(raw("rejected", 2), () => deadlineA, () => ({
        status: 422,
        body: { error: { code: "control-capability-unsupported", message: "unsupported", commandRevision: 2, evidenceIds: [], retryable: false } },
      }));
      const first = applyWebCommand(h.store, rejected);
      expect(first.status).toBe(422);
      expect(applyWebCommand(h.store, { ...rejected, apply: () => { throw new Error("durable 4xx repeated"); } })).toEqual(first);
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 2, projectionSeq: 2 });
    } finally {
      await h.dispose();
    }
  });

  it("fails authority sequence overflow atomically", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      h.store.db.prepare("UPDATE groups SET revision=? WHERE id='g1'").run(Number.MAX_SAFE_INTEGER);
      const overflow = input(raw("overflow", Number.MAX_SAFE_INTEGER), () => deadlineA, () => ({ status: 202, body: { selected: deadlineA } }));
      expect(() => applyWebCommand(h.store, overflow)).toThrow("control-sequence-overflow");
      expect(lookupCommandResult(h.store, "g1", "overflow")).toBeNull();
      expect(readVersions(h.store, "g1").commandRevision).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      await h.dispose();
    }
  });

  it("keeps one global command namespace across process epochs", async () => {
    const h = await openTestStore();
    try {
      const make = (epoch: string): WebCommandInput<{ stopped: true }> => {
        const rawCommand: RawAuthorityCommandV1 = {
          schema: "orca-raw-command-v1",
          commandId: "shutdown-1",
          expectedRevision: 0,
          actorId: "system:shutdown",
          verb: "shutdown",
          target: { kind: "global", epoch },
          payload: { shutdownAcceptedAt: deadlineA, shutdownDeadlineAt: deadlineB },
        };
        return {
          rawCommand,
          expand: () => ({ ...rawCommand, schema: "orca-authority-command-v1" }),
          apply: () => ({ status: 200, body: { stopped: true } }),
          authorityChanged: false,
        };
      };
      applyWebCommand(h.store, make("epoch-a"));
      expect(() => applyWebCommand(h.store, { ...make("epoch-b"), expand: () => { throw new Error("conflict expanded"); } }))
        .toThrow("command-id-conflict");
    } finally {
      await h.dispose();
    }
  });
});
