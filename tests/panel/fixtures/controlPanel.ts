/**
 * A real Panel process for the web control acceptance tests: an ephemeral port, a temporary
 * stateDir, an allowlisted repository and plan, and token auth -- everything a browser uses.
 *
 * Two facts are not reachable from the browser and are settled through the same in-process
 * seams the run-time tests use: the estimate result and a run's terminal disposition, both of
 * which the adapter's own worker reports (Task 10 step 4's consumer smoke covers that side).
 * Every read that follows them is the Panel's HTTP answer, not a fixture's.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { writeArtifact } from "../../../src/control/archive.js";
import { deliverSchedulerWakes } from "../../../src/control/dispatch.js";
import { createWebWakeHandlers } from "../../../src/control/webDispatch.js";
import { settleHandoffRequest, type StopDeps } from "../../../src/control/stopIntent.js";
import { WebControlService } from "../../../src/control/webService.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { openControlStore, type ControlStore } from "../../../src/control/store.js";
import { groupViewSchema, type GroupViewV1 } from "../../../src/control/webProtocol.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
import { buildApi } from "../../../src/panel/api.js";
import { verifyControlJsonBody } from "../../../src/panel/controlApi.js";
import { createTrustedControlConfig } from "../../../src/panel/controlConfig.js";
import { ReviewsWriter } from "../../../src/panel/reviewsStore.js";
import { profileSnapshot } from "../../control/fixtures/web.js";

export const PANEL_TOKEN = "b".repeat(64);
export const GROUP = "grp-1";

export interface Paths {
  planPath: string;
  binary: string;
  adapter: string;
  repo: string;
}

export interface Panel {
  url: string;
  epoch: string;
  root: string;
  store: ControlStore;
  service: WebControlService;
  /** The same deps the Panel's own handoff delivery holds, so a test settles through production code. */
  stopDeps: StopDeps;
  /** The Panel process's own wake engine: the browser never triggers it, so the test does. */
  drainWakes(): Promise<void>;
  close(): Promise<void>;
}

export interface BootOptions {
  /** What the adapter reports about the worker and handoff profiles; the dispatcher re-probes on every claim. */
  capabilities?: () => Record<string, unknown>;
}

export interface Harness {
  /** A fresh temporary workspace: repository, plan, contract, adapter config and stateDir root. */
  workspace(): Promise<Paths>;
  /** Boot a Panel over that workspace; reopening the same stateDir under a new epoch is a restart. */
  boot(epoch: string, paths: Paths, options?: BootOptions): Promise<Panel>;
  dispose(): Promise<void>;
}

export function createHarness(): Harness {
  const booted: Panel[] = [];
  const roots: string[] = [];
  const snapshot = profileSnapshot();
  const healthy = (): Record<string, unknown> => snapshot.profile.capabilities as unknown as Record<string, unknown>;

  async function files(root: string): Promise<Paths> {
    const repo = join(root, "repo");
    await mkdir(join(repo, "plans"), { recursive: true });
    const contracts = join(root, "contracts");
    await mkdir(contracts);
    const contract = {
      objective: { taskId: "a", goal: "ship a", successCondition: "a passes", nonGoals: [] },
      context: { repoPath: repo, targetPaths: ["a.ts"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 100, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const contractPath = join(contracts, "a.json");
    await writeFile(contractPath, canonicalBytes(contract));
    const binary = join(root, "ccloop");
    const adapter = join(root, "adapter.json");
    await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
    await writeFile(adapter, "{}");
    const planPath = join(repo, "plans", "plan.json");
    await writeFile(planPath, JSON.stringify({
      targetRepo: repo, ccloopBin: binary, runsDir: root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
      goal: "Ship a", successConditions: ["a passes"],
      // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
      tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1, configHash: "c".repeat(64) }],
    }));
    return { planPath, binary, adapter, repo };
  }

  return {
    async workspace(): Promise<Paths> {
      const root = await realpath(await mkdtemp(join(tmpdir(), "orca-web-accept-")));
      roots.push(root);
      return files(root);
    },
    async boot(epoch, paths, options = {}): Promise<Panel> {
      const root = roots[roots.length - 1];
      const store = await openControlStore({ stateDir: join(root, "state") });
      const capabilities = options.capabilities ?? healthy;
      // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
      // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
      // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
      const port = {
        probeProfileCapabilities: async () => capabilities() as never,
        capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
        readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
        requestHandoff: async (_input: unknown, request: { requestId: string }) => ({ kind: "unknown", requestId: request.requestId }),
        collect: async () => ({ events: [], candidate: null, terminal: null }),
      } as unknown as ExecutionPort;
      const frozen = resolveProfile(snapshot, port);
      const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
      const trustedConfig = createTrustedControlConfig({
        epoch, stateDir: store.stateDir, executablePath: paths.binary, adapterConfigPath: paths.adapter,
      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
        archiveRoot: root, exportRoot: root, evidenceRoot: root, shutdownGraceMs: 1_000,
        repositories: [{ repoId: "repo", displayName: "Repo", path: paths.repo }],
        plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: paths.planPath }],
        defaultEstimatorProfileId: "all", defaultEstimateMode: "soft",
      }, router);
      const deps = {
        store, admissionGate: createAdmissionGate(), profileRouter: router, trustedConfig,
        defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: frozen.profileHash, estimateMode: "soft" as const }),
        estimatorObservation: (selected: typeof frozen) => ({ profile: selected, observed: selected.snapshot.profile.capabilities, probeFailureCode: null }),
        knownRepository: (repoId: string) => repoId === "repo",
      };
      const service = new WebControlService(deps);

      const app = express();
      app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));
      const reviews = new ReviewsWriter(join(root, "corrections"));
      await reviews.load();
      buildApi(app, {
        opts: { by: "operator", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: join(root, "corrections"), repos: [] },
        token: PANEL_TOKEN, reviews, statics: { get: () => undefined, indexHtml: undefined, names: [] },
        control: { store, epoch, config: trustedConfig, service },
      } as never);

      const server: Server = createServer(app);
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("panel has no port");
      const panel: Panel = {
        url: `http://127.0.0.1:${address.port}`, epoch, root, store, service, stopDeps: deps,
        drainWakes: async () => {
          await deliverSchedulerWakes(store, createWebWakeHandlers({ store, profileRouter: router, admissionGate: deps.admissionGate, service }));
        },
        close: async () => {
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
          store.close();
        },
      };
      booted.push(panel);
      return panel;
    },
    async dispose(): Promise<void> {
      for (const panel of booted) await panel.close().catch(() => undefined);
      for (const root of roots) await rm(root, { recursive: true, force: true });
    },
  };
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export async function get(panel: Panel, path: string, token = PANEL_TOKEN): Promise<Response> {
  return fetch(`${panel.url}${path}`, { headers: token === "" ? {} : { "x-orca-token": token } });
}

/** POST one command envelope exactly as `web/src/controlApi.ts` does. */
export async function command(panel: Panel, path: string, envelope: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${panel.url}${path}`, {
    method: "POST",
    headers: { "x-orca-token": PANEL_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  return { status: response.status, body: await json(response) };
}

export async function view(panel: Panel, groupId = GROUP): Promise<GroupViewV1> {
  const response = await get(panel, `/api/control/groups/${groupId}`);
  const body = await json(response);
  if (!response.ok) throw new Error(`group view refused (${response.status}): ${JSON.stringify(body)}`);
  return groupViewSchema.parse(body);
}

/** The revision the ledger is at right now -- what every next command must name. */
export async function revision(panel: Panel, groupId = GROUP): Promise<number> {
  return (await view(panel, groupId)).summary.commandRevision;
}

/** A run the adapter reported terminal: the worker's own settlement, not the panel's. */
export function settleRun(store: ControlStore, runId: string, state: string, checkpointId: string | null = null): void {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) throw new Error(`no run ${runId}`);
  const run = JSON.parse(String(row.body)) as Record<string, unknown>;
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, state, checkpointId, recoverable: checkpointId !== null }), runId);
}

/**
 * Settle the frozen run through the production handoff path -- the same call the adapter's
 * disposition report drives -- and then attach the checkpoint and handoff packet the worker's own
 * archive carries, with the packet written through the real content-addressed archiver. Nothing
 * here re-implements the ledger: the held task and untouched commitments are exactly what
 * `terminaliseRun` leaves, and the panel's snapshot identity still has to agree.
 */
export async function settleRecoverableWork(panel: Panel, runId: string, checkpointId: string): Promise<void> {
  const { store, stopDeps } = panel;
  const request = store.db.prepare("SELECT id FROM handoff_requests WHERE group_id=? AND run_id=?").get(GROUP, runId);
  if (!request) throw new Error(`handoff-stop froze no request for ${runId}`);
  settleHandoffRequest(stopDeps, { requestId: String(request.id), outcome: "settled-recoverable" });
  const run = JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
  // The handoff packet the worker would have archived: a checkpoint is only recoverable if its
  // evidence reference resolves, and the panel's own read path is what checks that.
  const packet = { schema: "orca-handoff-packet-v1", runId, taskId: run.taskId, result: "partial", unfinished: ["verify a passes"] };
  // Archived through the real content-addressed archiver: the panel's evidence read re-hashes the
  // bytes on disk, so a ledger row alone is a dangling reference and has to read as one.
  const handoff = await writeArtifact(store, `handoff-${runId}`, canonicalBytes(packet));
  const candidate = { checkpointId, groupId: GROUP, workItemId: run.workItemId, taskId: run.taskId, runId, generation: run.generation, graphVersion: run.graphVersion, targetVersion: run.targetVersion, usageHighWater: 0, result: "partial", artifacts: [], snapshot: null, handoff, missing: [], unresolvedRequestIds: [], stopProof: null, terminalOutcome: "cancelled" };
  store.transaction(() => {
    store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run(checkpointId, runId, sha256Canonical(candidate), canonicalBytes(candidate).toString("utf8"));
    store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, checkpointId, recoverable: true }), runId);
  });
}

/** One human edit of the goal-review reserve -- the smallest draft-legal mutation of the proposal. */
export function proposalEdit(tokens: number): Record<string, unknown> {
  return { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: tokens, provenance: "human" }] };
}
