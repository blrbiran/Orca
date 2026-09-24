import { execFileSync } from "node:child_process";
import { writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { WebControlService } from "../../../src/control/webService.js";
import { deliverScheduledStart } from "../../../src/control/webDispatch.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import { createExecutionDriver, type ExecutionDriver, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import { fakeCcloopPort, type FakeBehaviour } from "./driverPort.js";
import { profileSnapshot, webFixture, type WebFixtureTask } from "./web.js";

/** A `ccloop run` stand-in for reconciliation criteria (created in Task 6). */
export const FAKE_CCLOOP_RUN = resolve("tests/control/fixtures/fake-ccloop-run.mjs");

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

export interface HarnessOptions {
  budgetMode?: "soft" | "strict";
  behaviour?: (workItemId: string) => FakeBehaviour;
  files?: (workItemId: string) => Record<string, string>;
  delayAccept?: () => Promise<void>;
}

/**
 * A confirmed Web group whose repository is a real git repository on `main`, driven through a
 * synthetic ccloop. Task `x` writes `x` = "x\n" unless `files` says otherwise.
 */
export async function driverHarness(tasks: readonly WebFixtureTask[], options: HarnessOptions = {}) {
  const snapshot = profileSnapshot();
  const h = await webFixture(snapshot, tasks);
  const repo = await realpath(join(h.root, "repo"));
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-qm", "base");
  const service = new WebControlService({ ...h.deps, knownRepository: (repoId: string) => repoId === "repo" });
  const confirmed = service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: options.budgetMode ?? "soft" }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const fake = fakeCcloopPort({
    capabilities: snapshot.profile.capabilities, behaviour: options.behaviour ?? (() => "succeed"),
    files: options.files ?? ((id) => ({ [id]: `${id}\n` })), delayAccept: options.delayAccept,
  });
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => repo,
    ccloopBin: FAKE_CCLOOP_RUN, adapterConfigPath: join(h.root, "reconcile-adapter.json"),
  };
  const dispatch = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  /** A fresh start command and its delivery: one more claimed run. */
  const claim = async (): Promise<string> => {
    const started = await service.start(h.command("start", {}));
    if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
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
