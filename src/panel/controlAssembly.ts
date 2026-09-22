import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createAdmissionGate, type AdmissionGate } from "../control/admissionGate.js";
import { ControlError } from "../control/errors.js";
import { createCcloopExecutionPort } from "../control/ccloopPort.js";
import { createUnconfiguredControlPort } from "../control/unconfiguredPort.js";
import type { ExecutionPort } from "../control/executionPort.js";
import { deliverSchedulerWakes } from "../control/dispatch.js";
import { recoverControl } from "../control/recovery.js";
import { createWebWakeHandlers } from "../control/webDispatch.js";
import { createExecutionProfileRouter, resolveProfile, type ExecutionProfileRouter, type FrozenProfile } from "../control/profiles.js";
import { openControlStore, type ControlStore } from "../control/store.js";
import { WebControlService } from "../control/webService.js";
import { executionProfileSnapshotSchema } from "../control/webProtocol.js";
import { createTrustedControlConfig, type TrustedControlConfig } from "./controlConfig.js";
import { withAdmission } from "./controlLifecycle.js";
import { controlRepoKey } from "./controlOptions.js";
import type { ControlOptions } from "./server.js";

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
  /** spec §6: runs to completion before the server accepts anything. */
  recover(): Promise<void>;
  /** One delivery pass. Re-entrant calls while one is in flight are no-ops, not queued. */
  pump(): Promise<void>;
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
  repos: ReadonlyArray<{ projectKey: string; path: string }>;
  epoch: string;
  env: NodeJS.ProcessEnv;
}

/**
 * The execution port, chosen once. There is deliberately no third branch: a missing binary selects
 * the refusing port, never `legacyExecutionPort`, which has no ledger authority and no handoff
 * protocol. "Quietly ran the work somewhere else" is worse than "refused by name".
 */
function choosePort(control: ControlOptions, env: NodeJS.ProcessEnv): ExecutionPort {
  if (control.executionPort === "unconfigured") return createUnconfiguredControlPort();
  return createCcloopExecutionPort({
    binary: env.ORCA_CCLOOP_BIN!,
    adapter: "codex",
    adapterConfigPath: env.ORCA_CCLOOP_ADAPTER_CONFIG!,
    timeoutMs: PORT_TIMEOUT_MS,
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

  const port = choosePort(control, env);
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

  const config = createTrustedControlConfig({
    epoch,
    stateDir: store.stateDir,
    executablePath: process.execPath,
    adapterConfigPath: control.executionPort === "configured" ? env.ORCA_CCLOOP_ADAPTER_CONFIG! : null,
    executionPort: control.executionPort,
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

  const admissionGate = createAdmissionGate();
  const service = new WebControlService({
    store,
    admissionGate,
    profileRouter: router,
    trustedConfig: config,
    // Ruling R7: the commands that need an estimate refuse by name. Nothing is substituted, and in
    // particular no mode is guessed -- a guessed mode is how a soft adapter comes to be driven as
    // a strict one, which is the whole reason these are operator arguments.
    defaults: () => {
      if (estimator === null || control.estimateMode === null) throw new ControlError("control-estimator-unconfigured");
      return { estimatorProfileId: estimator.snapshot.profile.profileId, estimatorProfileHash: estimator.profileHash, estimateMode: control.estimateMode };
    },
  });

  const wakeHandlers = createWebWakeHandlers({ store, profileRouter: router, admissionGate, service });

  // spec §6. One pass at a time, and a re-entrant call is dropped rather than queued: the delivery
  // already drains the whole table, so a second concurrent pass would only race the single-writer
  // gate for rows the first one is about to take. Dropping is the correct answer, not a shortcut.
  let inFlight: Promise<void> | null = null;
  const pump = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    // Through the admission gate like every other write, so a pass cannot slip a claim past a
    // shutdown that has already begun draining.
    const pass = withAdmission({ admissionGate }, () => deliverSchedulerWakes(store, wakeHandlers))
      .then(() => undefined, () => undefined)
      .finally(() => { inFlight = null; });
    inFlight = pass;
    return pass;
  };

  let timer: NodeJS.Timeout | null = null;
  return Object.freeze({
    store, config, service, router, admissionGate, port, epoch,
    recover: async () => { await recoverControl(store, port, { handlers: wakeHandlers }); },
    pump,
    startPump(intervalMs: number): boolean {
      if (timer !== null) return false;
      // unref'd: the pump is a thing the process does while it is alive, never a reason for it to
      // stay alive. A panel that has closed its server should exit.
      timer = setInterval(() => { void pump(); }, intervalMs);
      timer.unref();
      return true;
    },
    close: () => { if (timer !== null) { clearInterval(timer); timer = null; } store.close(); },
  });
}
