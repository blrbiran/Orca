import type { PanelCorrections } from "../control/correctionCommands.js";
import { advanceFlowRuns } from "../flow/kernel.js";
import { createPanelFlow, type PanelFlow } from "./flowAssembly.js";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createAdmissionGate, type AdmissionGate } from "../control/admissionGate.js";
import { ControlError } from "../control/errors.js";
import { createCcloopExecutionPort } from "../control/ccloopPort.js";
import { createUnconfiguredControlPort } from "../control/unconfiguredPort.js";
import type { ExecutionPort } from "../control/executionPort.js";
import { deliverSchedulerWakes } from "../control/dispatch.js";
import { recoverControl } from "../control/recovery.js";
import { createExecutionDriver, type CrashPoint, type ExecutionDriver } from "../control/executionDriver.js";
import { controlWorkspaceRoots } from "../control/workspace.js";
import { createWebWakeHandlers } from "../control/webDispatch.js";
import { resolveAstGrepBin } from "../control/requirementOverview.js";
import { createExecutionProfileRouter, resolveProfile, type ExecutionProfileRouter, type FrozenProfile } from "../control/profiles.js";
import { openControlStore, type ControlStore } from "../control/store.js";
import { WebControlService } from "../control/webService.js";
import { syncskillOptionsFromEnv } from "../skills/syncskill.js";
import { executionProfileSnapshotSchema } from "../control/webProtocol.js";
import { createTrustedControlConfig, type TrustedControlConfig } from "./controlConfig.js";
import { applyPanelShutdown, withAdmission } from "./controlLifecycle.js";
import { controlRepoKey } from "./controlOptions.js";
import { readCorrectionList } from "../control/correctionState.js";
import { createCorrectionExporter } from "../memory/correctionExport.js";
import type { ControlOptions } from "./server.js";
import { DISPATCHED_PERSON_DIRNAME } from "../control/commandClient.js";
import { vaultPathOfRepoId } from "../flow/groups.js";

/**
 * Assembly plan Task 5. Everything above `server.ts` stays as it was; this turns parsed options into
 * the four objects the control plane needs and hands back something the process can close.
 *
 * The shape of every refusal here follows rulings R5 and R7: a panel that cannot *do* the work still
 * boots and still serves the reads, because the reads are what a person needs after a crash. What it
 * cannot do, it refuses by name.
 */

/** spec §4: the store's siblings live under the relocated root, so one variable moves all of them. */
const ARCHIVE = "archive";
const EXPORT = "export";
const EVIDENCE = "evidence";

/** Not an operator choice: how long a shutdown waits, not what it means. */
const SHUTDOWN_GRACE_MS = 30_000;
/** A ccloop subprocess call that has not answered in this long is not going to. */
const PORT_TIMEOUT_MS = 60_000;

/**
 * Ruling R5's shape, applied one level further out. A control store is a single-writer resource:
 * the second `orca panel` on the same repository cannot have it, and must not, because two writers
 * against one ledger is the corruption the lock exists to prevent.
 *
 * But refusing to *boot* the second panel would be wrong for the same reason refusing to boot
 * without a port is wrong -- the panel is mostly a read-only decision viewer, and taking that away
 * from the second person on a machine buys nothing. So the second panel boots without the plane and
 * says why on stderr.
 *
 * ⚠️ This is a decision, not a ruling: reversible, and recorded here because it changes what
 * `orca panel` does when run twice. Before this slice a second panel simply worked, because there
 * was no store to contend for.
 */
const CONTENDED = new Set(["control-writer-active", "control-recovery-busy", "control-owner-changed"]);

/**
 * ⚠️ A pre-existing race in `src/control/store.ts`, reachable only now that panels contend for a
 * store. The owner file is created with `openSync(..., "wx")` and written immediately afterwards, so
 * a second process that reads it in between sees zero bytes and `JSON.parse` throws a plain
 * `SyntaxError`, not a `ControlError`.
 *
 * It is handled here rather than fixed there (CLAUDE.md Rule 3: this slice does not rewrite the
 * store's locking), and it is reported rather than swallowed, because the same symptom after a crash
 * means a genuinely unreadable lock and not a busy one. Either way this panel must not take the
 * store, so it boots without the plane and says which file it could not read.
 */
function unreadableOwner(error: unknown): boolean {
  return error instanceof SyntaxError && /JSON/i.test(error.message);
}

export interface ControlRuntime {
  store: ControlStore;
  config: TrustedControlConfig;
  service: WebControlService;
  router: ExecutionProfileRouter;
  admissionGate: AdmissionGate;
  port: ExecutionPort;
  epoch: string;
  /** Execution driver spec §2.1: present only when an execution port is configured. */
  driver: ExecutionDriver | null;
  /** Flow engine spec §8.2: the flow kernel's production ports; present only with a driver (nothing else runs a flow). */
  flow: PanelFlow | null;
  /** spec §6: runs to completion before the server accepts anything. */
  recover(): Promise<void>;
  /** One delivery pass. Re-entrant calls while one is in flight are no-ops, not queued. */
  pump(): Promise<void>;
  /**
   * spec §6: close the gate, write exactly one shutdown identity for this epoch, stop the timer.
   * Answers whether this call was the one that ran it, so a second signal is observably a no-op
   * rather than a second ledger identity discovered as a conflict.
   */
  shutdown(): Promise<boolean>;
  /**
   * Owned by the process, not by a request. Answers whether it armed the timer: idempotence that
   * cannot be observed is idempotence that cannot be judged, and a second timer would double every
   * delivery pass for the life of the process.
   */
  startPump(intervalMs: number): boolean;
  close(): void;
}

export interface ControlAssemblyInput {
  control: ControlOptions;
  repos: ReadonlyArray<{ projectKey: string; path: string; kind?: "dir" }>;
  epoch: string;
  env: NodeJS.ProcessEnv;
  /** Issue 92: why the boot left ORCA_CCLOOP_BIN unset (the installed ccloop could not be used); served in the config read. */
  executionPortReason?: string;
  /** Test-only fault injection for the execution driver (spec §7.2 R1). Never set by the CLI. */
  driverCrash?: (point: CrashPoint) => void;
  /**
   * Test-only (agent selection spec §9 criterion 8, plan T16): wraps the chosen port, before any profile or service
   * is built on it, so a criterion can record which selection each gate asked ccloop about. Never set by the CLI.
   */
  wrapPort?: (port: ExecutionPort) => ExecutionPort;
  /**
   * Control run decisions plan Task 10: the panel's corrections store and resolved identity, the very values
   * `/api/corrections` records with (cross-plan resolution 1). Absent, reject-pending-decision is refused by name.
   */
  corrections?: { dir: string; by: string; panel?: PanelCorrections };
  /** Corrections-to-ccmem spec 2026-10-21 As-built: present only with `--ccmem-corrections` (and `corrections`). */
  ccmemCorrections?: { ccmemBin: string; env: NodeJS.ProcessEnv };
}

/**
 * The execution port, chosen once. There is deliberately no third branch: a missing binary selects
 * the refusing port, never `legacyExecutionPort`, which has no ledger authority and no handoff
 * protocol. "Quietly ran the work somewhere else" is worse than "refused by name".
 */
function choosePort(control: ControlOptions, env: NodeJS.ProcessEnv, dispatchedPersonDir: () => string | undefined): ExecutionPort {
  if (control.executionPort === "unconfigured") return createUnconfiguredControlPort();
  return createCcloopExecutionPort({
    binary: env.ORCA_CCLOOP_BIN!,
    agentsTablePath: env.ORCA_AGENTS_TABLE!,
    timeoutMs: PORT_TIMEOUT_MS,
    dispatchedPersonDir,
  });
}

/**
 * Execution profile snapshots come from files the operator names, never from anything derived here.
 * A snapshot pins content hashes of an adapter config, a model policy and proof documents; inventing
 * any of those would make a frozen identity that nothing was actually frozen against.
 *
 * ⚠️ Zero profiles is a state, not an error, for the same reason no port and no estimator are:
 * a panel with no profile serves every read and can start nothing. It is reported, not fatal.
 */
function loadProfiles(paths: ReadonlyArray<string>, port: ExecutionPort): FrozenProfile[] {
  return paths.map((path) => {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new ControlError("control-profile-invalid", `unreadable:${path}`); }
    const parsed = executionProfileSnapshotSchema.safeParse(raw);
    if (!parsed.success) throw new ControlError("control-profile-invalid", `file:${path}`);
    return resolveProfile(parsed.data, port);
  });
}

export async function assembleControlRuntime(input: ControlAssemblyInput): Promise<ControlRuntime | null> {
  const { control, repos, env, epoch } = input;
  if (!control.enabled || control.stateDir === null) throw new ControlError("control-trusted-config-invalid", "assembly-called-while-disabled");

  // CLI v2 spec §15.3-§15.4: known once the store has canonicalised its directory, below; no run is dispatched before.
  let dispatchedPersonDir: string | undefined;
  const chosen = choosePort(control, env, () => dispatchedPersonDir);
  const port = input.wrapPort ? input.wrapPort(chosen) : chosen;
  const profiles = loadProfiles(control.profilePaths, port);
  const router = createExecutionProfileRouter(profiles);

  // Created with explicit modes rather than inherited from the umask, and only underneath the
  // relocated root, so a criterion that sets ORCA_CONTROL_DIR cannot reach a person's real ~/.orca.
  // An existing directory keeps whatever mode it has: it is someone's, and its mode is their decision.
  const stateDir = control.stateDir;
  let store: ControlStore;
  try { store = await openControlStore({ stateDir, recovery: true }); }
  catch (error) {
    if (error instanceof ControlError && CONTENDED.has(error.code)) return null;
    if (unreadableOwner(error)) {
      process.stderr.write(`orca-panel: ${join(stateDir, "service-lock", "owner.json")} could not be read; this panel serves reviews and decisions only\n`);
      return null;
    }
    throw error;
  }
  // The store canonicalises its own directory; its siblings are built from that rather than from
  // the spelling we were given, because /tmp is a symlink on this platform and the trusted config
  // refuses a path with a symlink in it.
  const root = store.stateDir;
  for (const child of [ARCHIVE, EXPORT, EVIDENCE]) mkdirSync(join(root, child), { recursive: true, mode: 0o700 });
  // CLI v2 spec §15.3: the ORCA_PERSON_DIR of every run Orca dispatches -- empty, so a dispatched CLI finds no token.
  // Created 0700; an existing one keeps its mode (Rule 17). Registered in the accounts spec's Correction (plan Task 10).
  dispatchedPersonDir = join(root, DISPATCHED_PERSON_DIRNAME);
  mkdirSync(dispatchedPersonDir, { recursive: true, mode: 0o700 });

  const config = createTrustedControlConfig({
    epoch,
    stateDir: store.stateDir,
    executablePath: process.execPath,
    agentsTablePath: control.executionPort === "configured" ? env.ORCA_AGENTS_TABLE! : null,
    executionPort: control.executionPort,
    ...(input.executionPortReason === undefined ? {} : { executionPortReason: input.executionPortReason }),
    archiveRoot: join(root, ARCHIVE),
    exportRoot: join(root, EXPORT),
    evidenceRoot: join(root, EVIDENCE),
    shutdownGraceMs: SHUTDOWN_GRACE_MS,
    // Resolved, for the same reason as the roots above: the trusted config refuses a path that
    // traverses a symlink, and an operator typing a path through /tmp has not done anything wrong.
    repositories: repos.map((repo) => ({ repoId: controlRepoKey(repo.projectKey), displayName: repo.projectKey, path: realpathSync(repo.path) })),
    plans: control.plans.map((plan) => ({ planId: plan.planId, repoId: plan.repoId, displayName: plan.planId, path: realpathSync(plan.path) })),
    defaultEstimatorProfileId: control.estimatorProfileId,
    defaultEstimateMode: control.estimateMode,
  }, router);

  const estimator = control.estimatorProfileId === null
    ? null
    : router.list().find((profile) => profile.snapshot.profile.profileId === control.estimatorProfileId) ?? null;

  // Flow engine spec §5.2: a `dir` flow group's repository id names its run's vault ($ORCA_VAULT_DIR, Rule 17); every
  // other id is a trusted repository of the config, as before.
  const resolveRepository = (repoId: string): string => vaultPathOfRepoId(env, repoId) ?? config.resolveRepository(repoId);

  const admissionGate = createAdmissionGate();
  const service = new WebControlService({
    store,
    // Agent selection W6-19: confirm resolves selections through the very port the profiles probe.
    port,
    // Syncskill integration spec §10.5: confirm looks up each declared skills profile (ORCA_SYNCSKILL_BIN, unset = none).
    syncskill: syncskillOptionsFromEnv(env),
    admissionGate,
    profileRouter: router,
    trustedConfig: config,
    // Flow engine spec §14.2: the flow verbs act through the kernel's production ports, made below with the driver.
    flowDeps: () => flow?.deps ?? null,
    // Review finding I4: a flow starts only on a registered `dir` project's folder; its settings key is the project's.
    flowProjects: () => repos.filter((repo) => repo.kind === "dir").map((repo) => ({ repoId: controlRepoKey(repo.projectKey), path: repo.path })),
    // Dir-requirements spec §5.1: the same `dir` entries, by repo id -- a requirement on one is a dir group (its folder frozen
    // at open), import-plan and the debug opens on one are refused, and a dispatched run may not open a requirement on one.
    dirProjectOf: (repoId: string) => {
      const found = repos.find((repo) => repo.kind === "dir" && controlRepoKey(repo.projectKey) === repoId);
      return found === undefined ? null : { path: found.path };
    },
    // Execution driver spec §2.1: a workspace mode means something only to a driver, so an unconfigured
    // panel knows no repository here and refuses set-workspace-mode as it did before this slice.
    knownRepository: control.executionPort === "configured"
      ? (repoId: string) => config.hasRepository(repoId)
      : undefined,
    // Integration spec §3.3: the path the integration setters' git checks run in (only a known repository is checked).
    resolveRepository: (repoId: string) => resolveRepository(repoId),
    // Debug task plan Task 6: correction-debug-open finds the repository a correction's projectKey names among these.
    listRepositories: () => config.listRepositories(),
    // A correction recorded on the panel names the panel's project key; its repository's repoId is that key's.
    repoIdOfProjectKey: controlRepoKey,
    // Ruling R7: the commands that need an estimate refuse by name. Nothing is substituted, and in
    // particular no mode is guessed -- a guessed mode is how a soft adapter comes to be driven as
    // a strict one, which is the whole reason these are operator arguments.
    ...(input.corrections === undefined ? {} : { correctionsDir: input.corrections.dir, correctionsBy: input.corrections.by }),
    // Debug task plan Task 11: the panel's key, clock, closed rule and review marks, for correction-record/-withdraw.
    ...(input.corrections?.panel === undefined ? {} : { panelCorrections: input.corrections.panel }),
    defaults: () => {
      if (estimator === null || control.estimateMode === null) return null;
      return { estimatorProfileId: estimator.snapshot.profile.profileId, estimatorProfileHash: estimator.profileHash, estimateMode: control.estimateMode };
    },
  });

  const wakeHandlers = createWebWakeHandlers({ store, profileRouter: router, admissionGate, service });

  // Corrections-to-ccmem As-built: closed corrections go to ccmem off the pump's path -- started, never awaited, at most one
  // pass per PASS_INTERVAL_MS -- so a slow or missing ccmem never holds the control plane.
  const correctionsDir = input.corrections?.dir;
  const correctionExporter = input.ccmemCorrections === undefined || correctionsDir === undefined ? null : createCorrectionExporter({
    ccmemBin: input.ccmemCorrections.ccmemBin, env: input.ccmemCorrections.env, correctionsDir,
    listCorrections: () => readCorrectionList({ store, correctionsDir, listRepositories: () => config.listRepositories(), repoIdOfProjectKey: controlRepoKey }),
    repositoryPath: (repoId) => config.listRepositories().find((repository) => repository.repoId === repoId)?.path ?? null,
    log: (line) => process.stderr.write(line),
  });

  // spec §6. One pass at a time, and a re-entrant call is dropped rather than queued: the delivery
  // already drains the whole table, so a second concurrent pass would only race the single-writer
  // gate for rows the first one is about to take. Dropping is the correct answer, not a shortcut.
  let driver: ExecutionDriver | null = null;
  let inFlight: Promise<void> | null = null;
  const pump = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    void correctionExporter?.maybeRun();
    // Through the admission gate like every other write, so a pass cannot slip a claim past a
    // shutdown that has already begun draining.
    // Kanban spec 2026-10-20 §3.1: with a driver, confirmed groups start on their own before the wakes are delivered (each
    // start is the service's own start path, which takes the admission gate itself). Without one nothing would run them.
    // System debug task spec 2026-10-21: Orca's own debug groups (the escalation ladder) are opened, confirmed and folded
    // first, so one that was just confirmed starts in the same pass; a due integration check (kanban §7 layer 1) is
    // started without being waited for.
    // Flow engine spec §8.2: flow runs advance at their step boundaries before the auto-start pass, so a child a step just
    // opened and confirmed starts in the same pass.
    const autoStart = driver === null || flow === null ? Promise.resolve() : service.systemDebugPass().then(() => service.checksPass())
      // A flow error never skips the auto-start pass of every other group (advanceFlowRuns records a run's own error on it).
      .then(() => flow!.refreshAgents().then(() => advanceFlowRuns(flow!.deps)).catch((error: unknown) => {
        process.stderr.write(`orca-control: flow pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }))
      // Tester round 2 spec §7.2: unlimited-token groups a person created are confirmed before the auto-start pass, so one
      // confirmed here starts in the same pass. Refusals are booked (one per proposal version) and written here.
      .then(() => autoConfirmStep(service))
      .then(() => service.autoStart()).then(() => service.autoResolveIntegrationConflicts()).then(() => undefined, (error: unknown) => {
      process.stderr.write(`orca-control: auto-start pass failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
    const pass = autoStart.then(() => withAdmission({ admissionGate }, () => deliverSchedulerWakes(store, wakeHandlers)))
      // A delivered wake is a claimed run the driver can now start (spec §2.1).
      .then((delivery) => { if (delivery.delivered.length > 0) driver?.kick(); }, () => undefined)
      .finally(() => { inFlight = null; });
    inFlight = pass;
    return pass;
  };

  // Execution driver spec §2.1: only with a configured port. Unconfigured, nothing here runs and no
  // directory is created, so the panel is what it was before this slice.
  let flow: PanelFlow | null = null;
  if (control.executionPort === "configured") {
    flow = createPanelFlow({
      store, env, router, port, admissionGate, confirm: (command) => service.confirm(command as never), kick: () => driver?.kick(),
      importDeps: { store, trustedConfig: config, profileRouter: router, defaults: () => {
        if (estimator === null || control.estimateMode === null) return null;
        return { estimatorProfileId: estimator.snapshot.profile.profileId, estimatorProfileHash: estimator.profileHash, estimateMode: control.estimateMode };
      } },
    });
    driver = createExecutionDriver({
      store, router, admissionGate, roots: controlWorkspaceRoots(store.stateDir),
      resolveRepository,
      // Dir-requirements spec §6.1 (Rule 17): a dir group's vault is found from this environment, never os.homedir().
      env,
      ccloopBin: env.ORCA_CCLOOP_BIN!, agentsTablePath: env.ORCA_AGENTS_TABLE!, dispatchedPersonDir, astGrepBin: resolveAstGrepBin(env),
      // Handoff grace: the run's frozen killGraceMs + 60 s (driverHandoff.handoffGraceMsOf, agent selection spec §6.6).
      // *** ERRATUM (ccloop consolidation step 1, 2026-10-01, Orca session be653b22, ruling R5) *** the grace is max(killGraceMs, frozen recovery window + 5 s) + 60 s.
      kickPump: () => { void pump(); }, crash: input.driverCrash,
      // Syncskill integration spec §10.6: A2 injects a run's frozen skills with the same ORCA_SYNCSKILL_BIN confirm froze them with.
      syncskill: syncskillOptionsFromEnv(env),
    });
  }

  let timer: NodeJS.Timeout | null = null;
  const stopTimer = () => { if (timer !== null) { clearInterval(timer); timer = null; } };

  // One shutdown per runtime, by a latch rather than by hoping the signal arrives once. A second
  // SIGTERM while the first is still draining must not write a second ledger identity for the same
  // epoch, and `applyPanelShutdown` is not the place to discover that -- it would be a conflict.
  let shutdownRun: Promise<boolean> | null = null;

  return Object.freeze({
    store, config, service, router, admissionGate, port, epoch, driver, flow,
    recover: async () => {
      await recoverControl(store, port, { handlers: wakeHandlers }, { driverOwnsWebRuns: driver !== null });
      await service.recoverAgentUpdates();
      driver?.kick();
    },
    shutdown() {
      if (shutdownRun !== null) return shutdownRun.then(() => false);
      // The timer stops first: a pass that starts after the gate begins draining would be refused
      // anyway, and one that is already in flight is what the drain exists to wait for.
      stopTimer();
      // Execution driver spec §2.1: the driver's timer stops and its step in flight finishes first, then
      // the pump's pass, then the shutdown is written -- freezing no run the driver owns (spec §4).
      shutdownRun = (async () => {
        await driver?.stop();
        await inFlight;
        await applyPanelShutdown({ store, profileRouter: router, admissionGate, epoch, shutdownGraceMs: config.shutdownGraceMs, exemptDriverRuns: driver !== null });
        return true;
      })();
      return shutdownRun;
    },
    pump,
    startPump(intervalMs: number): boolean {
      if (timer !== null) return false;
      // unref'd: the pump is a thing the process does while it is alive, never a reason for it to
      // stay alive. A panel that has closed its server should exit.
      timer = setInterval(() => { void pump(); }, intervalMs);
      timer.unref();
      driver?.start(intervalMs);
      return true;
    },
    // Controller ruling P10: a shutdown already stopped the driver and awaited it; close does not
    // start a second, un-awaited stop behind it.
    close: () => { stopTimer(); if (shutdownRun === null) void driver?.stop(); store.close(); },
  });
}

/**
 * Tester round 2 spec §7.2 (review M1): the pump's automatic-confirm step. Refusals (booked, one per proposal version) are
 * written one line each; a pass that fails is written and swallowed, so the auto-start and integration-conflict passes
 * chained after it still run.
 */
export function autoConfirmStep(
  service: { autoConfirmUnlimitedPass(): Promise<{ refused: Array<{ groupId: string; code: string }> }> },
  write: (line: string) => void = (line) => { process.stderr.write(line); },
): Promise<void> {
  return service.autoConfirmUnlimitedPass().then(({ refused }) => {
    for (const { groupId, code } of refused) write(`orca-control: automatic confirm of ${groupId} refused: ${code}\n`);
  }, (error: unknown) => { write(`orca-control: automatic confirm pass failed: ${error instanceof Error ? error.message : String(error)}\n`); });
}
