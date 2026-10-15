import { execFileSync } from "node:child_process";
import { writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { WebControlService } from "../../../src/control/webService.js";
import { deliverScheduledStart } from "../../../src/control/webDispatch.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import { createExecutionDriver, replenishStartWakes, type ExecutionDriver, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import { groupExecutionPendingInStore } from "../../../src/control/executionPending.js";
import { fakeCcloopPort, type FakeBehaviour } from "./driverPort.js";
import type { AgentsView, StartEnvelope } from "../../../src/control/executionPort.js";
import type { SyncskillOptions } from "../../../src/skills/syncskill.js";
import { profileSnapshot, webFixture, type WebFixtureOptions, type WebFixtureTask } from "./web.js";

/** A `ccloop run` stand-in for reconciliation criteria (created in Task 6). */
export const FAKE_CCLOOP_RUN = resolve("tests/control/fixtures/fake-ccloop-run.mjs");

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

export interface HarnessOptions {
  budgetMode?: "soft" | "strict";
  tokenPolicy?:WebFixtureOptions["tokenPolicy"];
  behaviour?: (workItemId: string) => FakeBehaviour;
  files?: (workItemId: string) => Record<string, string>;
  delayAccept?: () => Promise<void>;
  workTokens?: (workItemId: string) => number;
  duringCollect?: () => Promise<void>;
  /**
   * Agent selection spec §6.6 (plan T11): the killGraceMs ccloop answers at confirmation, frozen onto every work item
   * and run. The driver's synthetic ccloop keeps answering its own default (0), so only the frozen value can matter.
   */
  killGraceMs?: number;
  /** Agent selection plan T12: the plan's group agent layers (spec §6.2), so a criterion can freeze a reconcile slot that differs from the worker slot. */
  planAgents?: WebFixtureOptions["planAgents"];
  /** Audit 2026-09-26 (seat B): confirmation freezes a distinct configHash per selection (web.ts `distinctConfigHash`). */
  distinctConfigHash?: boolean;
  /** Audit 2026-09-26 (seat B): the configHash the synthetic ccloop's `accept` answers, instead of echoing the claim's. */
  acceptedConfigHash?: (envelope: StartEnvelope) => string;
  /** Syncskill integration plan Task 6: the syncskill both confirm (the freeze) and the driver (A2's injection) are given. */
  syncskill?: SyncskillOptions;
  agentKinds?: AgentsView;
  /** Issue fixes spec §4.4: the stop reason the synthetic ccloop states with a run's terminal (driverPort.ts). */
  stopReason?: (workItemId: string) => string | null;
  /** Issue-fixes spec §5.2: the control store's clock (ms); absent, Date.now. */
  storeNow?: () => number;
}

/**
 * A confirmed Web group whose repository is a real git repository on `main`, driven through a
 * synthetic ccloop. Task `x` writes `x` = "x\n" unless `files` says otherwise.
 */
export async function driverHarness(tasks: readonly WebFixtureTask[], options: HarnessOptions = {}) {
  const snapshot = profileSnapshot();
  const h = await webFixture(snapshot, tasks, { tokenPolicy:options.tokenPolicy, killGraceMs: options.killGraceMs, planAgents: options.planAgents, ...(options.distinctConfigHash ? { distinctConfigHash: true } : {}), ...(options.storeNow ? { storeNow: options.storeNow } : {}) });
  const repo = await realpath(join(h.root, "repo"));
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-qm", "base");
  const service = new WebControlService({ ...h.deps, knownRepository: (repoId: string) => repoId === "repo", ...(options.syncskill ? { syncskill: options.syncskill } : {}) });
  const confirmed = await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), budgetMode: options.budgetMode ?? "soft" }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const fake = fakeCcloopPort({
    capabilities: snapshot.profile.capabilities, behaviour: options.behaviour ?? (() => "succeed"),
    files: options.files ?? ((id) => ({ [id]: `${id}\n` })), delayAccept: options.delayAccept,
    workTokens: options.workTokens, duringCollect: options.duringCollect,
    ...(options.acceptedConfigHash ? { acceptedConfigHash: options.acceptedConfigHash } : {}),
    ...(options.stopReason ? { stopReason: options.stopReason } : {}),
  });
  fake.port.listAgents = options.agentKinds === undefined ? h.deps.port.listAgents : async () => options.agentKinds!;
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => repo,
    ccloopBin: FAKE_CCLOOP_RUN, agentsTablePath: join(h.root, "reconcile-agents.json"),
    ...(options.syncskill ? { syncskill: options.syncskill } : {}),
  };
  const dispatch = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  /** Start guard spec (2026-10-15) §3.2: while the group's execution is pending a second start is refused, so a later
   * claim is armed as the driver arms it (replenishStartWakes), then delivered. Claims keep the first start's revision.
   * A dispatch wake already waiting (a resume, start or no-start) is delivered as the driver would, not armed again. */
  const claim = async (): Promise<string> => {
    if (groupExecutionPendingInStore(h.store, "g")) {
      const waiting = h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get() !== undefined;
      if (!waiting && replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate }).length === 0) throw new Error("claim: the driver would arm no start wake");
    } else {
      const started = await service.start(h.command("start", {}));
      if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
    }
    const delivered = await deliverScheduledStart(dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    return delivered.runId;
  };
  const body = (runId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
  const until = async (driver: ExecutionDriver, predicate: () => boolean, rounds = 60): Promise<void> => {
    for (let i = 0; i < rounds && !predicate(); i += 1) await driver.round();
    if (!predicate()) throw new Error("the driver did not reach the expected state");
  };
  return { h, repo, service, fake, deps, dispatch, claim, body, until, driver: () => createExecutionDriver(deps) };
}
