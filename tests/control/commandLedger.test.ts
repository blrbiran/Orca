import { describe, expect, it } from "vitest";
import { applyWebCommand, lookupCommandResult, preflightWebCommand, type StoredCommandOutcome, type WebCommandContext, type WebCommandInput } from "../../src/control/commandLedger.js";
import { createGroup, setGroupStopped } from "../../src/control/commands.js";
import { ControlError } from "../../src/control/errors.js";
import { readVersions } from "../../src/control/queries.js";
import type { CommandLookupV1, CommandSuccessV1, EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import type { GroupInput } from "../../src/control/types.js";
import { openTestStore } from "./fixtures/store.js";

const deadlineA = "2026-09-20T10:00:00.000Z";
const deadlineB = "2026-09-20T11:00:00.000Z";
const group: GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};
type CommandBody = CommandLookupV1["body"];

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

function accepted(context: WebCommandContext): StoredCommandOutcome<CommandSuccessV1> {
  const handoffDeadlineAt = (context.effectiveCommand.payload as { handoffDeadlineAt: string }).handoffDeadlineAt;
  return {
    status: 202,
    body: {
      schema: "orca-command-success-v1",
      commandId: context.rawCommand.commandId,
      actorId: context.rawCommand.actorId,
      verb: context.rawCommand.verb,
      target: context.rawCommand.target,
      commandRevision: context.nextCommandRevision,
      projectionSeq: context.nextProjectionSeq,
      effectivePayloadHash: context.effectivePayloadHash,
      authorityCommandHash: context.authorityCommandHash,
      result: {
        kind: "handoff-stopped",
        stopRevision: context.nextCommandRevision,
        acceptedAt: deadlineA,
        handoffDeadlineAt,
        frozenRunIds: [],
        requestIds: [],
      },
    },
  };
}

describe("web command ledger", () => {
  it("replays the persisted effective default before reading changed defaults", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const defaults = { deadline: deadlineA };
      let calls = 0;
      const first = applyWebCommand(h.store, input(raw(), () => defaults.deadline, (context) => {
        calls += 1;
        return accepted(context);
      }));
      defaults.deadline = deadlineB;
      const replay = applyWebCommand(h.store, input(raw(), () => {
        throw new Error("dynamic default was read during replay");
      }, () => {
        throw new Error("command effect was repeated");
      }));

      expect(replay).toEqual(first);
      expect(first.body).toMatchObject({ result: { kind: "handoff-stopped", handoffDeadlineAt: deadlineA } });
      expect(calls).toBe(1);
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 2, projectionSeq: 2 });
      expect(lookupCommandResult(h.store, "g1", "web-stop")).toEqual({
        schema: "orca-command-lookup-v1",
        originalStatus: 202,
        body: first.body,
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
        command_revision: 2,
        projection_seq: 2,
      });
      expect(JSON.parse(String(row?.body_json))).toEqual(first.body);
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
      applyWebCommand(h.store, input(raw(), () => deadlineA, accepted));
      expect(() => preflightWebCommand(h.store, change(raw()) as RawAuthorityCommandV1)).toThrow("command-id-conflict");
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

  it("persists a stale revision before expansion with null effective identity fields", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let expansions = 0;
      const stale: WebCommandInput<CommandBody> = {
        rawCommand: raw("stale-before-expansion", 0),
        expand: () => {
          expansions += 1;
          throw new ControlError("profile-changed");
        },
        apply: () => { throw new Error("stale command must not apply"); },
      };
      const first = applyWebCommand(h.store, stale);
      expect(first).toEqual({
        status: 409,
        body: { error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision: 1, evidenceIds: [], retryable: false } },
      });
      expect(expansions).toBe(0);
      expect(h.store.db.prepare(`SELECT effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash
        FROM commands WHERE group_id='g1' AND id='stale-before-expansion'`).get()).toEqual({
        effective_payload_json: null,
        effective_payload_hash: null,
        authority_command_json: null,
        authority_command_hash: null,
      });

      setGroupStopped(h.store, "g1", true, { commandId: "legacy-stop-after-stale", expectedRevision: 1, by: "human" });
      expect(applyWebCommand(h.store, stale)).toEqual(first);
      expect(expansions).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("fails authority sequence overflow atomically", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      h.store.db.prepare("UPDATE groups SET revision=? WHERE id='g1'").run(Number.MAX_SAFE_INTEGER);
      const overflow = input(raw("overflow", Number.MAX_SAFE_INTEGER), () => deadlineA, accepted);
      expect(() => applyWebCommand(h.store, overflow)).toThrow("control-sequence-overflow");
      expect(lookupCommandResult(h.store, "g1", "overflow")).toBeNull();
      expect(readVersions(h.store, "g1").commandRevision).toBe(Number.MAX_SAFE_INTEGER);
    } finally {
      await h.dispose();
    }
  });

  it("preflights current commands without writes and durably stores stale conflicts for final apply replay", async () => {
    const h = await openTestStore();
    try {
      const before = h.store.db.prepare("SELECT total_changes() AS n").get();
      expect(preflightWebCommand(h.store, raw("preflight", 0))).toBeNull();
      expect(h.store.db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const afterCreate = h.store.db.prepare("SELECT total_changes() AS n").get();
      expect(preflightWebCommand(h.store, raw("current", 1))).toBeNull();
      expect(h.store.db.prepare("SELECT total_changes() AS n").get()).toEqual(afterCreate);
      const stale = preflightWebCommand<CommandBody>(h.store, raw("preflight", 0));
      expect(stale).toMatchObject({ status: 409, body: { error: { code: "revision-conflict", commandRevision: 1 } } });
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 1, projectionSeq: 1 });
      setGroupStopped(h.store, "g1", true, { commandId: "advance", expectedRevision: 1, by: "human" });
      expect(preflightWebCommand(h.store, raw("preflight", 0))).toEqual(stale);
      expect(applyWebCommand(h.store, input(raw("preflight", 0), () => { throw new Error("replay expanded"); }, accepted))).toEqual(stale);
    } finally { await h.dispose(); }
  });

  it("rolls back a preflight conflict if its transaction cannot commit", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const interruptedStore = {
        ...h.store,
        transaction: <T>(fn: () => T): T => h.store.transaction(() => {
          fn();
          expect(lookupCommandResult(h.store, "g1", "preflight-interrupted")).toMatchObject({ originalStatus: 409 });
          throw new Error("preflight-before-commit");
        }),
      };
      expect(() => preflightWebCommand(interruptedStore, raw("preflight-interrupted", 0))).toThrow("preflight-before-commit");
      expect(lookupCommandResult(h.store, "g1", "preflight-interrupted")).toBeNull();
      expect(preflightWebCommand(h.store, raw("preflight-interrupted", 0))).toMatchObject({ status: 409 });
    } finally { await h.dispose(); }
  });

  it("keeps one global command namespace across process epochs", async () => {
    const h = await openTestStore();
    try {
      const make = (epoch: string): WebCommandInput<CommandSuccessV1> => {
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
          apply: (context) => ({ status: 200, body: {
            schema: "orca-command-success-v1",
            commandId: context.rawCommand.commandId,
            actorId: context.rawCommand.actorId,
            verb: "shutdown",
            target: context.rawCommand.target,
            commandRevision: null,
            projectionSeq: null,
            effectivePayloadHash: context.effectivePayloadHash,
            authorityCommandHash: context.authorityCommandHash,
            result: { kind: "shutdown", groups: [] },
          } }),
          authorityChanged: false,
        };
      };
      const before = h.store.db.prepare("SELECT total_changes() AS n").get();
      expect(preflightWebCommand(h.store, make("epoch-a").rawCommand)).toBeNull();
      expect(h.store.db.prepare("SELECT total_changes() AS n").get()).toEqual(before);
      const first = applyWebCommand(h.store, make("epoch-a"));
      expect(first.body).toMatchObject({ commandRevision: null, projectionSeq: null });
      expect(preflightWebCommand(h.store, make("epoch-a").rawCommand)).toEqual(first);
      expect(() => preflightWebCommand(h.store, make("epoch-b").rawCommand)).toThrow("command-id-conflict");
      expect(() => applyWebCommand(h.store, { ...make("epoch-b"), expand: () => { throw new Error("conflict expanded"); } }))
        .toThrow("command-id-conflict");
    } finally {
      await h.dispose();
    }
  });

  it("durably converts expected domain errors and rolls back their partial writes before replay", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let calls = 0;
      const rejected = input<CommandBody>(raw("thrown"), () => deadlineA, () => {
        calls += 1;
        h.store.db.prepare("INSERT INTO meta VALUES ('partial-domain-write','bad')").run();
        throw new ControlError("group-budget-unavailable");
      });
      const first = applyWebCommand(h.store, rejected);
      expect(first).toEqual({
        status: 422,
        body: { error: { code: "group-budget-unavailable", message: "group-budget-unavailable", commandRevision: 1, evidenceIds: [], retryable: false } },
      });
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='partial-domain-write'").get()).toBeUndefined();
      expect(applyWebCommand(h.store, { ...rejected, apply: () => { throw new Error("durable error repeated"); } })).toEqual(first);
      expect(calls).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it.each([
    ["control-invalid-stop", 400],
    ["group-not-found", 404],
    ["graph-version-conflict", 409],
    ["duplicate-task-id", 422],
    ["graph-dangling-dependency", 422],
    ["graph-cycle", 422],
    ["control-capability-unsupported", 422],
    ["budget-overflow", 422],
    ["numeric-overflow", 422],
    ["control-recovery-required", 423],
  ] as const)("durably classifies the %s command error family", async (code, status) => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let calls = 0;
      const rejected = input<CommandBody>(raw(`error-${code}`), () => deadlineA, () => {
        calls += 1;
        throw new ControlError(code);
      });
      const first = applyWebCommand(h.store, rejected);
      expect(first).toEqual({
        status,
        body: { error: { code, message: code, commandRevision: 1, evidenceIds: [], retryable: false } },
      });
      expect(applyWebCommand(h.store, rejected)).toEqual(first);
      expect(calls).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("persists and replays expected expansion failures without inventing an effective command", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let expansions = 0;
      const rejected: WebCommandInput<CommandBody> = {
        rawCommand: raw("expand-profile-changed"),
        expand: () => {
          expansions += 1;
          h.store.db.prepare("INSERT INTO meta VALUES ('partial-expansion-write','bad')").run();
          throw new ControlError("profile-changed");
        },
        apply: () => { throw new Error("failed expansion must not apply"); },
      };
      const first = applyWebCommand(h.store, rejected);
      expect(first).toEqual({
        status: 409,
        body: { error: { code: "profile-changed", message: "profile-changed", commandRevision: 1, evidenceIds: [], retryable: false } },
      });
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='partial-expansion-write'").get()).toBeUndefined();
      expect(applyWebCommand(h.store, rejected)).toEqual(first);
      expect(expansions).toBe(1);
      expect(h.store.db.prepare(`SELECT effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash
        FROM commands WHERE group_id='g1' AND id='expand-profile-changed'`).get()).toEqual({
        effective_payload_json: null,
        effective_payload_hash: null,
        authority_command_json: null,
        authority_command_hash: null,
      });
    } finally {
      await h.dispose();
    }
  });

  it("persists global expansion failures with a null command revision", async () => {
    const h = await openTestStore();
    try {
      let expansions = 0;
      const rawCommand: RawAuthorityCommandV1 = {
        schema: "orca-raw-command-v1",
        commandId: "shutdown-expansion-error",
        expectedRevision: 0,
        actorId: "system:shutdown",
        verb: "shutdown",
        target: { kind: "global", epoch: "epoch-a" },
        payload: { shutdownAcceptedAt: deadlineA, shutdownDeadlineAt: deadlineB },
      };
      const rejected: WebCommandInput<CommandBody> = {
        rawCommand,
        expand: () => {
          expansions += 1;
          throw new ControlError("control-capability-unsupported");
        },
        apply: () => { throw new Error("failed expansion must not apply"); },
      };
      const first = applyWebCommand(h.store, rejected);
      expect(first).toEqual({
        status: 422,
        body: { error: { code: "control-capability-unsupported", message: "control-capability-unsupported", commandRevision: null, evidenceIds: [], retryable: false } },
      });
      expect(applyWebCommand(h.store, rejected)).toEqual(first);
      expect(expansions).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("rolls unexpected expansion failures back without recording a command result", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let expansions = 0;
      const broken: WebCommandInput<CommandBody> = {
        rawCommand: raw("broken-expansion"),
        expand: () => {
          expansions += 1;
          h.store.db.prepare("INSERT INTO meta VALUES ('partial-broken-expansion','bad')").run();
          throw new ControlError("control-sequence-overflow");
        },
        apply: () => { throw new Error("broken expansion must not apply"); },
      };
      expect(() => applyWebCommand(h.store, broken)).toThrow("control-sequence-overflow");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='partial-broken-expansion'").get()).toBeUndefined();
      expect(lookupCommandResult(h.store, "g1", "broken-expansion")).toBeNull();
      expect(() => applyWebCommand(h.store, broken)).toThrow("control-sequence-overflow");
      expect(expansions).toBe(2);
    } finally {
      await h.dispose();
    }
  });

  it("rolls unexpected failures back without recording a command result", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const broken = input<CommandBody>(raw("broken"), () => deadlineA, () => {
        h.store.db.prepare("INSERT INTO meta VALUES ('partial-internal-write','bad')").run();
        throw new Error("unexpected-internal");
      });
      expect(() => applyWebCommand(h.store, broken)).toThrow("unexpected-internal");
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key='partial-internal-write'").get()).toBeUndefined();
      expect(lookupCommandResult(h.store, "g1", "broken")).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's path refusal is
  // control-agents-table-invalid now (agent selection spec §6.6); the five codes still each roll back in both phases.
  it.each((["control-sequence-overflow", "control-peer-timeout", "control-binary-invalid", "control-agents-table-invalid", "control-peer-exit"] as const)
    .flatMap((code) => (["expand", "apply"] as const).map((phase) => [code, phase] as const)))("rolls explicitly non-durable %s failures back during %s", async (code, phase) => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      let calls = 0;
      const fail = () => {
        calls += 1;
        h.store.db.prepare("INSERT INTO meta VALUES (?, 'bad')").run(`partial-${code}`);
        throw new ControlError(code);
      };
      const command = input<CommandBody>(raw(`non-durable-${code}`), () => deadlineA, fail);
      const broken = phase === "expand" ? { ...command, expand: fail } : command;
      expect(() => applyWebCommand(h.store, broken)).toThrow(code);
      expect(h.store.db.prepare("SELECT value FROM meta WHERE key=?").get(`partial-${code}`)).toBeUndefined();
      expect(lookupCommandResult(h.store, "g1", `non-durable-${code}`)).toBeNull();
      expect(() => applyWebCommand(h.store, broken)).toThrow(code);
      expect(calls).toBe(2);
    } finally {
      await h.dispose();
    }
  });

  it("rejects invalid success and error bodies without committing, and validates lookup rows", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      const invalidSuccess = input<CommandBody>(raw("invalid-success"), () => deadlineA, (context) => {
        const outcome = accepted(context);
        return { ...outcome, body: { ...outcome.body, commandRevision: -1 } as CommandSuccessV1 };
      });
      expect(() => applyWebCommand(h.store, invalidSuccess)).toThrow("control-command-result-invalid");
      expect(lookupCommandResult(h.store, "g1", "invalid-success")).toBeNull();
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 1, projectionSeq: 1 });

      const invalidError = input<CommandBody>(raw("invalid-error"), () => deadlineA, () => ({
        status: 422,
        body: { error: { code: "group-budget-unavailable", message: "bad", commandRevision: -1, evidenceIds: [], retryable: false } },
      } as StoredCommandOutcome<CommandBody>));
      expect(() => applyWebCommand(h.store, invalidError)).toThrow("control-command-result-invalid");
      expect(lookupCommandResult(h.store, "g1", "invalid-error")).toBeNull();

      const valid = applyWebCommand(h.store, input(raw("corrupt-lookup"), () => deadlineA, accepted));
      expect(valid.status).toBe(202);
      h.store.db.prepare("UPDATE commands SET body_json='{}' WHERE group_id='g1' AND id='corrupt-lookup'").run();
      expect(() => lookupCommandResult(h.store, "g1", "corrupt-lookup")).toThrow("control-command-result-invalid");
    } finally {
      await h.dispose();
    }
  });
});
