import { describe, expect, it } from "vitest";
import { applyAcceptAttempt, latestRunSnapshot, prepareAcceptAttempt } from "../../src/control/acceptAttempt.js";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readGroup } from "../../src/control/queries.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227), the command half: `accept-attempt` records an owner's intent on a terminal,
 * settled, failed run, or refuses by name. Nothing else moves here: the driver does the merge, checks and landing.
 * Named mutations (each seen red, Rule 9): drop a precondition from applyAcceptAttempt -> its row below goes green-to-red.
 */
type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" };
const payload = (runId: string) => ({ taskId: "a", runId, note: "read the diff; the checks are what matter" });
const accept = (t: T, runId: string, commandId?: string, context: Parameters<typeof withCommandContext>[1] | null = OWNER) =>
  send(t, t.h.command("accept-attempt", payload(runId), commandId), context);
const send = (t: T, command: ReturnType<T["h"]["command"]>, context: Parameters<typeof withCommandContext>[1] | null = OWNER) => {
  const call = () => t.service.acceptAttempt(command as never);
  return context === null ? call() : withCommandContext(command.commandId, context, call);
};
const code = (answer: unknown): string | undefined => (answer as { error?: { code?: string } }).error?.code;

async function closedFailure(options: HarnessOptions = {}) {
  const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "failed", sealedOwnerProof: true, ...options });
  const runId = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  const closed = t.service.closeRun(t.h.command("close-run", { runId }));
  if ("error" in closed) throw new Error(JSON.stringify(closed));
  await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
  return { t, runId, driver };
}

const patchGroup = (t: T, patch: Record<string, unknown>) => t.h.store.transaction(() => {
  const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, ...patch }), );
});

describe("accept-attempt: who may send it (criterion 15)", () => {
  it("is refused to a Web member, to the socket agent without a person token, and to a run Orca dispatched", () => {
    const body = payload("run-1");
    expect(permissionRefusal({ kind: "user", userId: "u2", name: "m", roles: ["member"] }, "accept-attempt", body)?.code).toBe("control-verb-human-only");
    expect(permissionRefusal({ kind: "agent", client: "cli:x" }, "accept-attempt", body)?.code).toBe("control-person-token-required");
    expect(permissionRefusal({ kind: "agent", client: "cli:x", dispatchedRun: "r", person: { userId: "u1", name: "o", roles: ["owner"] } }, "accept-attempt", body)?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal({ kind: "user", userId: "u1", name: "o", roles: ["owner"] }, "accept-attempt", body)).toBeNull();
  });
});

describe("accept-attempt: the intent (criterion 16)", { timeout: 60_000 }, () => {
  it("records the owner's intent on a closed failure, naming the snapshot it checked; a replay records nothing more", async () => {
    const { t, runId } = await closedFailure(); try {
      const first = t.h.command("accept-attempt", payload(runId), "acc-1");
      const answer = await send(t, first);
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested", runId, taskId: "a" } });
      const intent = t.body(runId).operatorAcceptance;
      expect(intent).toMatchObject({ commandId: "acc-1", principal: "user:owner", note: payload(runId).note, state: "pending", snapshot: latestRunSnapshot(t.h.store, runId) });
      const before = t.body(runId);
      expect(await send(t, first)).toEqual(answer);
      expect(t.body(runId)).toEqual(before);
      // A second, different command while the first is pending is refused by name.
      expect(code(await accept(t, runId, "acc-2"))).toBe("accept-attempt-pending");
    } finally { await t.h.dispose(); }
  });

  it("refuses a run that has not ended (not terminal)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true }); try {
      const runId = await t.claim();
      expect(code(await accept(t, runId))).toBe("accept-attempt-run-not-terminal");
    } finally { await t.h.dispose(); }
  });

  it("refuses a terminal failure whose accounting is not settled", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(code(await accept(t, runId))).toBe("accept-attempt-run-not-settled");
      expect(t.body(runId).operatorAcceptance).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("refuses a run that succeeded (an empty result: settled, the task blocked)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "settled");
      expect(code(await accept(t, runId))).toBe("accept-attempt-run-succeeded");
    } finally { await t.h.dispose(); }
  });

  it("refuses a run that is no longer the task's current one (retried)", async () => {
    const { t, runId } = await closedFailure(); try {
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried" } });
      expect(code(await accept(t, runId))).toBe("accept-attempt-run-not-current");
    } finally { await t.h.dispose(); }
  });

  it("refuses while a debug ladder holds the run", async () => {
    const { t, runId } = await closedFailure(); try {
      const prepared = await prepareAcceptAttempt(t.h.store, runId);
      const command = t.h.command("accept-attempt", payload(runId));
      const answer = withCommandContext(command.commandId, OWNER, () => applyAcceptAttempt({ store: t.h.store, ladderInProgress: () => "dbg-ladder" }, command, prepared));
      expect(answer).toMatchObject({ error: { code: "accept-attempt-debug-in-progress", message: "accept-attempt-debug-in-progress:dbg-ladder" } });
    } finally { await t.h.dispose(); }
  });

  it("refuses while a sibling landing of the group is reconciling", async () => {
    const { t, runId } = await closedFailure(); try {
      t.h.store.transaction(() => {
        const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
        // A stand-in for a sibling run in R: an active run row of the group whose state is reconciling.
        t.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) SELECT 'sibling',group_id,'b',generation,1,? FROM runs WHERE id=?")
          .run(JSON.stringify({ ...JSON.parse(String(row.body)), runId: "sibling", workItemId: "b", taskId: "b", state: "reconciling" }), runId);
      });
      expect(code(await accept(t, runId))).toBe("accept-attempt-group-reconciling");
    } finally { await t.h.dispose(); }
  });

  it("refuses a stopped group, and an archived one", async () => {
    const { t, runId } = await closedFailure(); try {
      await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect(code(await accept(t, runId))).toBe("stop-mode-conflict");
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
      expect(code(await accept(t, runId))).toBe("group-archived");
    } finally { await t.h.dispose(); }
  });

  it.each([
    ["a flow child", { flow: { role: "child", flowRunId: "fr-x" } }, "flow-child-managed"],
    ["a multi-directory group", { multiDir: { project: "p", dirs: [{ key: "a", repoId: "repo", kind: "repo" }, { key: "b", repoId: "r2", kind: "repo" }], landing: null } }, "accept-attempt-unsupported"],
    ["a dir group", { dirWorkspace: { dir: "/nowhere", vaultId: "a".repeat(64) } }, "accept-attempt-unsupported"],
  ])("refuses %s", async (_name, patch, expected) => {
    const { t, runId } = await closedFailure(); try {
      patchGroup(t, patch);
      expect(code(await accept(t, runId))).toBe(expected);
    } finally { await t.h.dispose(); }
  });

  it("refuses a run whose archive snapshot is missing, and one whose snapshot is partial, naming what is missing", async () => {
    const { t, runId } = await closedFailure(); try {
      const ref = latestRunSnapshot(t.h.store, runId)!;
      const partial = { ...JSON.parse((await readArtifact(t.h.store, ref)).toString()), missing: ["changed:repo/a"] };
      const forged = await writeArtifact(t.h.store, `snapshot-forged-${runId}`, Buffer.from(JSON.stringify(partial)));
      t.h.store.transaction(() => t.h.store.db.prepare("INSERT INTO outbox VALUES (?, 'archive', ?, 0)").run(`archive:forged-${runId}`, JSON.stringify({ runId, snapshot: forged, missing: ["changed:repo/a"] })));
      expect(await accept(t, runId)).toMatchObject({ error: { code: "accept-attempt-snapshot-partial", message: "accept-attempt-snapshot-partial:changed:repo/a" } });
      t.h.store.transaction(() => t.h.store.db.prepare("DELETE FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").run(runId));
      expect(code(await accept(t, runId))).toBe("accept-attempt-snapshot-missing");
      expect(t.body(runId).operatorAcceptance).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("refuses a command no person is accountable for", async () => {
    const { t, runId } = await closedFailure(); try {
      expect(code(await accept(t, runId, undefined, { client: "cli:x", principal: "agent:cli:x" }))).toBe("accept-attempt-person-required");
      expect(readGroup(t.h.store, "g").stopped).toBe(false);
    } finally { await t.h.dispose(); }
  });
});
