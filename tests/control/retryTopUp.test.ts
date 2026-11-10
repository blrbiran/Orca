import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import { orchestrationRevision } from "../../src/control/orchestration.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { appendTopUp } from "../../src/control/workTopUp.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import type { Amount } from "../../src/control/types.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";
import { requestState, stop } from "./fixtures/handoffHarness.js";

/**
 * Retry work top-up spec 2026-11-06 (revision 2) §4, criteria T1-T13 (T14's Web half: web/tests/budgetTopUps.test.tsx).
 * A `retry-task` with `work` appends a row the retried run and every later run of the task read (rowid(from_run_id) <
 * rowid(run)); no earlier run's funded-allowance check moves. A person may always; an agent up to the global
 * agentTopUpCap, summed per group; a run Orca dispatched never. Driven through the driver's synthetic ccloop, which books
 * { tokens: 10, activeMs: 5, attempts: 1, sessions: 1 } per run (driverPort.ts).
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const OWNER: Principal = { kind: "user", userId: "u-owner", name: "ana", roles: ["owner"] };
const MEMBER: Principal = { kind: "user", userId: "u-member", name: "bo", roles: ["member"] };
const AGENT: Principal = { kind: "agent", client: "cli" };
const DISPATCHED: Principal = { kind: "agent", client: "cli", dispatchedRun: "run-dispatched" };
const BY = { by: "ana", via: "web" };
const clientOf = (p: Principal) => (p.kind === "user" ? "web" : "cli");

const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const pokeWork = (t: Harness, taskId: string, change: (w: Record<string, any>) => void): void => {
  const w = work(t, taskId); change(w);
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(w), taskId);
};
const rows = (t: Harness): number => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM work_grant_top_ups").get()!.n);
const allowance = (t: Harness, runId: string) => readFundedAllowance(t.h.store, t.body(runId));
const code = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;

/** A retry of task `taskId` sent by `who` through the routes' own context (controlApi.ts routedCommandContext). */
function retry(t: Harness, who: Principal, taskId: string, payload: Record<string, unknown> = {}) {
  const command = t.h.command("retry-task", { taskId, ...payload } as never);
  return withCommandContext(command.commandId, routedCommandContext(clientOf(who), who, BY), () => t.service.retryTask(command));
}
function setCap(t: Harness, cap: Amount | null) {
  const command = t.h.rawCommand(`cap-${Math.random()}`, orchestrationRevision(t.h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 3, agentTopUpCap: cap });
  const answer = t.service.setOrchestrationSettings(command as never);
  if ("error" in answer) throw new Error(`cap refused: ${JSON.stringify(answer)}`);
}
/** Claim the next run of the group (the driver arms the start wake), as overGrantExit.test.ts claimAgain. */
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
async function failed(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  await t.until(driver, () => t.body(runId).state === "blocked");
}

/** An unlimited (optional-v1) group whose task a has authored attempts 1: its first run, failed, exhausts them. */
async function exhausted(options: HarnessOptions = {}, tasks = [{ taskId: "a" }], beforeClaim?: (t: Harness) => void) {
  const behaviour = { value: "failed" as FakeBehaviour };
  const t = await driverHarness(tasks, { tokenPolicy: "optional-v1", behaviour: () => behaviour.value, ...options });
  pokeWork(t, "a", (w) => { w.grant.work.attempts = 1; });
  beforeClaim?.(t);
  const first = await t.claim();
  const driver = t.driver();
  await failed(t, driver, first);
  return { t, driver, first, behaviour };
}

describe("T1: a person's top-up funds the retried run without moving the earlier run's check", { timeout: 120_000 }, () => {
  it("unlimited group, attempts exhausted: retry with work {attempts: 2} is applied, claimed with attempts 2, the first run still checks", async () => {
    const { t, driver, first } = await exhausted(); try {
      // Today's answer without a top-up (overGrantExit criterion 13): no exit.
      expect(code(retry(t, OWNER, "a"))!.message).toContain("authored-budget-exhausted");
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      expect(rows(t)).toBe(1);
      const second = await claimAgain(t, driver);
      const funded = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM funded_allowances WHERE run_id=?").get(second)!.body));
      expect(funded.grant.work.attempts).toBe(2);
      expect(t.body(second).grant.work.attempts).toBe(2);
      // The earlier run's check is byte for byte today's: its grant against the base.
      expect(allowance(t, first)!.grant.work.attempts).toBe(1);
      expect(allowance(t, second)!.grant.work.attempts).toBe(2);
      expect(group(t).status).not.toBe("blocked");
      // The new run runs to its terminal under the topped-up grant, and the read model stays whole.
      await failed(t, driver, second);
      expect(readControlGroup(t.h.store, "epoch", "g").schema).toBe("orca-control-group-v1");
    } finally { await t.h.dispose(); }
  });
});

describe("T14: an optional-policy run is dispatched with its funded grant, not the frozen authored ceiling", { timeout: 120_000 }, () => {
  it("a person's token top-up reaches ccloop's contract instead of being swallowed by the confirmed one", async () => {
    const { t, driver, first } = await exhausted(); try {
      const authored = work(t, "a").grant.work.tokens as number;
      // Without a top-up the dispatched ceiling is the contract's own declared number, exactly as before.
      const firstInput = readStartEnvelope(t.h.store, t.body(first)) as { work: { contract: { executionPolicy: { tokenBudget: number } } } };
      expect(firstInput.work.contract.executionPolicy.tokenBudget).toBe(99_000);
      expect(code(retry(t, OWNER, "a", { work: { tokens: 200_000, attempts: 2 } }))).toBeNull();
      const second = await claimAgain(t, driver);
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true; i++) await driver.round();
      const input = readStartEnvelope(t.h.store, t.body(second)) as { work: { contract: { executionPolicy: { tokenBudget: number } } } };
      const funded = allowance(t, second)!.grant.work.tokens as number;
      // The confirmed contract still says what the task authored; the dispatched one must say what was funded.
      expect(funded).toBeGreaterThan(authored);
      expect(input.work.contract.executionPolicy.tokenBudget).toBe(funded);
    } finally { await t.h.dispose(); }
  });
});

// Issue #205: after a top-up the work item's authored grant and the funded run's fresh grant differ by construction, so
// the closed-run admission must not demand they be equal; closing such a run used to strand the task at
// `task-not-retryable:run-state:settled-failed`.
describe("T15: a topped-up run that was closed can be retried again", { timeout: 120_000 }, () => {
  it("top-up, fail, close-run, then a second top-up retry is admitted and claims a fresh run", async () => {
    // The fixture group's attempts limit holds exactly two runs; a third needs room (T5 pins that refusal by name).
    const roomy = (t: Harness): void => {
      const limit = readControlGroup(t.h.store, "epoch", "g").ledger.groupLimit;
      expect(code(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10 } })))).toBeNull();
    };
    const { t, driver, first } = await exhausted({ sealedOwnerProof: true }, undefined, roomy); try {
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      const second = await claimAgain(t, driver);
      await failed(t, driver, second);
      expect(t.service.closeRun(t.h.command("close-run", { runId: second }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: false } });
      const closed = t.body(second);
      const usedBefore = group(t).used.tokens;
      expect(code(retry(t, OWNER, "a", { work: { attempts: 1 } }))).toBeNull();
      // The closed run's own accounting is untouched and its remainder is not released a second time.
      expect(t.body(second)).toMatchObject({ state: closed.state, grant: closed.grant, cumulative: closed.cumulative, terminalClosure: closed.terminalClosure });
      expect(group(t).used.tokens).toBe(usedBefore);
      const third = await claimAgain(t, driver);
      expect([first, second]).not.toContain(third);
      // authored 1 + top-ups 2 and 1 = 4, minus one attempt used by each of the two earlier runs.
      expect(allowance(t, third)!.grant.work.attempts).toBe(2);
    } finally { await t.h.dispose(); }
  });

  it("still refuses when the closed run's marker no longer verifies", async () => {
    const { t, driver } = await exhausted({ sealedOwnerProof: true }); try {
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      const second = await claimAgain(t, driver);
      await failed(t, driver, second);
      expect(t.service.closeRun(t.h.command("close-run", { runId: second }))).toMatchObject({ result: { kind: "run-closed" } });
      t.h.store.transaction(() => {
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(second)!.body));
        body.terminalClosure.highWater += 1;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), second);
      });
      expect(code(retry(t, OWNER, "a", { work: { attempts: 1 } }))!.message).toContain("retry-closure-invalid");
    } finally { await t.h.dispose(); }
  });
});

describe("T2: a retry without work is today's retry", { timeout: 120_000 }, () => {
  it("leaves no row, and the claimed grant is the base's remaining", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", behaviour: () => "failed" }); try {
      const first = await t.claim(); const driver = t.driver();
      await failed(t, driver, first);
      const answer = retry(t, OWNER, "a") as { result?: unknown };
      expect(answer.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: first });
      expect(rows(t)).toBe(0);
      const second = await claimAgain(t, driver);
      const base = work(t, "a").grant.work;
      expect(t.body(second).grant.work.attempts).toBe(base.attempts - 1);
      expect(t.body(second).grant.work.activeMs).toBe(base.activeMs - 5);
    } finally { await t.h.dispose(); }
  });
});

describe("T3, T9, T10: who may top up", { timeout: 120_000 }, () => {
  it("T3: an agent with cap null is refused retry-top-up-not-authorized and leaves no row; a person with cap null is applied", async () => {
    const { t } = await exhausted(); try {
      expect(code(retry(t, AGENT, "a", { work: { attempts: 2 } }))!.code).toBe("retry-top-up-not-authorized");
      expect(rows(t)).toBe(0);
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      expect(rows(t)).toBe(1);
    } finally { await t.h.dispose(); }
  });
  it("T9: a Web member (no person authority) with cap null is refused retry-top-up-not-authorized", async () => {
    const { t } = await exhausted(); try {
      expect(code(retry(t, MEMBER, "a", { work: { attempts: 2 } }))!.code).toBe("retry-top-up-not-authorized");
      expect(rows(t)).toBe(0);
    } finally { await t.h.dispose(); }
  });
  it("T10: a run Orca dispatched is refused retry-top-up-dispatched-run, booked", async () => {
    const { t } = await exhausted(); try {
      const booked = () => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM commands").get()!.n);
      const before = booked();
      const answer = code(retry(t, DISPATCHED, "a", { work: { attempts: 2 } }));
      expect(answer!.code).toBe("retry-top-up-dispatched-run");
      expect(rows(t)).toBe(0);
      expect(booked()).toBe(before + 1);
    } finally { await t.h.dispose(); }
  });
});

describe("T4: the agent cap is summed per group", { timeout: 120_000 }, () => {
  it("a second 60000-token top-up in one group passes a 100000 cap; a row of another group does not count", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { tokenPolicy: "optional-v1", behaviour: () => "failed" }); try {
      const driver = t.driver();
      const runA = await t.claim(); await failed(t, driver, runA);
      const runB = await t.claim(); await failed(t, driver, runB);
      setCap(t, { tokens: 100_000, activeMs: 0, attempts: 0, sessions: 0 });
      // Another group's agent top-up, already at the cap: it bounds that group, not this one.
      t.h.importDeferred("g2");
      appendTopUp(t.h.store, "g2", "x", runA, { amount: { tokens: 100_000, activeMs: 0, attempts: 0, sessions: 0 }, commandId: "other", by: "agent:cli", personAuthority: false, at: 1 });
      expect(code(retry(t, AGENT, "a", { work: { tokens: 60_000 } }))).toBeNull();
      const second = code(retry(t, AGENT, "b", { work: { tokens: 60_000 } }));
      expect(second!.code).toBe("retry-top-up-cap-exceeded");
      expect(second!.message).toContain("tokens");
      expect(rows(t)).toBe(2);
    } finally { await t.h.dispose(); }
  });
});

describe("T5: the retry-time headroom check", { timeout: 120_000 }, () => {
  it("a topped-up remaining above the group's attempts limit is refused group-budget-unavailable:attempts, no row", async () => {
    const { t } = await exhausted(); try {
      const status = work(t, "a").status;
      // A top-up of the group's whole attempts limit: the topped-up remaining cannot fit beside what the group holds.
      const g = group(t);
      expect(g.limit.tokens).toBeNull();
      const answer = code(retry(t, OWNER, "a", { work: { attempts: g.limit.attempts } }));
      expect(answer!.code).toBe("group-budget-unavailable");
      expect(answer!.message).toContain("attempts");
      expect(rows(t)).toBe(0);
      expect(work(t, "a").status).toBe(status);
    } finally { await t.h.dispose(); }
  });
});

describe("T6: an authorized agent may set the global cap", () => {
  const payload = { maxRunningGroups: 3, agentTopUpCap: { tokens: 1, activeMs: 0, attempts: 0, sessions: 0 } };
  it("a Web member is refused, while a socket agent can set the cap without a person token", () => {
    expect(permissionRefusal(MEMBER, "set-orchestration-settings", payload)?.code).toBe("control-verb-human-only");
    expect(permissionRefusal(AGENT, "set-orchestration-settings", payload)).toBeNull();
    expect(permissionRefusal(DISPATCHED, "set-orchestration-settings", payload)?.code).toBe("control-dispatched-run-refused");
    expect(permissionRefusal(OWNER, "set-orchestration-settings", payload)).toBeNull();
    // The rest of the verb stays open on the socket.
    expect(permissionRefusal(AGENT, "set-orchestration-settings", { maxRunningGroups: 3 })).toBeNull();
  });
});

describe("T7: a later top-up never reaches the run it was retried from", { timeout: 120_000 }, () => {
  it("after a second top-up the second run still computes the same grant and its check passes", async () => {
    const { t, driver } = await exhausted(); try {
      expect(code(retry(t, OWNER, "a", { work: { attempts: 1 } }))).toBeNull();
      const second = await claimAgain(t, driver);
      const before = JSON.stringify(allowance(t, second));
      await failed(t, driver, second);
      expect(code(retry(t, OWNER, "a", { work: { attempts: 1 } }))).toBeNull();
      expect(JSON.stringify(allowance(t, second))).toBe(before);
      const third = await claimAgain(t, driver);
      expect(allowance(t, third)!.grant.work.attempts).toBe(1);
    } finally { await t.h.dispose(); }
  });
});

describe("T8: the retried run's allowance continuation", { timeout: 120_000 }, () => {
  it("is admitted, and the continuation run's check passes", async () => {
    const { t, driver, behaviour } = await exhausted(); try {
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      behaviour.value = "stoppable";
      const second = await claimAgain(t, driver);
      await t.until(driver, () => t.body(second).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      behaviour.value = "succeed";
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: second, checkpointId: t.body(second).checkpointId as string }] } as never));
      expect(code(resumed)).toBeNull();
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      if (claimed.kind !== "claimed") throw new Error(`resume claim refused: ${JSON.stringify(claimed)}`);
      expect(allowance(t, claimed.runId)).not.toBeNull();
    } finally { await t.h.dispose(); }
  });
});

describe("T12, T13: what a top-up refuses", { timeout: 120_000 }, () => {
  it("T12: work on a fixed-branch task is refused retry-top-up-unsupported:finite-legacy and its grant is unchanged", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const limit = readControlGroup(t.h.store, "epoch", "g").ledger.groupLimit;
      expect(code(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } })))).toBeNull();
      const first = await t.claim(); const driver = t.driver();
      await failed(t, driver, first);
      const grant = JSON.stringify(work(t, "a").grant);
      const answer = code(retry(t, OWNER, "a", { work: { attempts: 2 } }));
      expect(answer!.code).toBe("retry-top-up-unsupported");
      expect(answer!.message).toContain("finite-legacy");
      expect(JSON.stringify(work(t, "a").grant)).toBe(grant);
      expect(rows(t)).toBe(0);
    } finally { await t.h.dispose(); }
  });
  it("T13: work {} is refused retry-top-up-empty; a token top-up on a null-token task is refused retry-top-up-no-effect:tokens", async () => {
    const { t } = await exhausted({}, [{ taskId: "a", tokenBudget: null } as never]); try {
      expect(work(t, "a").grant.work.tokens).toBeNull();
      expect(code(retry(t, OWNER, "a", { work: {} }))!.code).toBe("retry-top-up-empty");
      const noEffect = code(retry(t, OWNER, "a", { work: { tokens: 5, attempts: 1 } }));
      expect(noEffect!.code).toBe("retry-top-up-no-effect");
      expect(noEffect!.message).toContain("tokens");
      expect(rows(t)).toBe(0);
    } finally { await t.h.dispose(); }
  });
});

describe("T14: the task's budget view lists the top-up", { timeout: 120_000 }, () => {
  it("names the amount, who and when", async () => {
    const { t, first } = await exhausted(); try {
      expect(code(retry(t, OWNER, "a", { work: { attempts: 2 } }))).toBeNull();
      const item = readControlGroup(t.h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.topUps).toEqual([{ amount: { tokens: 0, activeMs: 0, attempts: 2, sessions: 0 }, by: "user:u-owner", at: expect.any(Number), fromRunId: first }]);
    } finally { await t.h.dispose(); }
  });
});
