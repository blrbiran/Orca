import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Assembly plan Task 1 / design spec §3-§5. The one place that answers three questions a shipped
 * `orca panel` must answer before it builds anything: does the control plane mount, where does its
 * state live, and is there an execution port at all.
 *
 * It performs no I/O and creates nothing. That is deliberate: the answers are needed while arguments
 * are still being parsed, and a function that only computes strings can be judged without a criterion
 * ever reaching a real ~/.orca (CLAUDE.md Rule 17).
 */

/** spec §6. Chosen here rather than at the call site so a criterion can name the number. */
export const DEFAULT_CONTROL_WAKE_MS = 5000;

export type EstimateMode = "strict" | "soft";

export interface ControlOptionsResolution {
  /** False means `server.ts` passes no `control` dep, which is byte-for-byte today's behaviour. */
  enabled: boolean;
  stateDir: string | null;
  wakeIntervalMs: number;
  /**
   * Both null together or both set together (ruling R7). Null is "no estimator configured", which
   * is a served state, not a rejected boot -- the commands that need an estimate refuse by name.
   */
  estimatorProfileId: string | null;
  estimateMode: EstimateMode | null;
  /**
   * spec §9.2 (ruling R6). A per-process fact, and the only authority on it: `probeFailureCode` on
   * a profile answers a different, smaller question and is not read here or anywhere else to
   * answer this one (spec §9.3).
   */
  executionPort: "configured" | "unconfigured";
  /** At most one, in the fixed order below. Null means the plane may be built. */
  rejection: string | null;
}

/**
 * spec §4. Relocated by ORCA_CONTROL_DIR, read from the passed environment rather than from
 * `process.env` at import time -- a module-level constant would freeze the real home in.
 *
 * ⚠️ `~` is not expanded, matching `correctionsDir`: node does not expand it, so expanding it here
 * and not there would be the difference between two directories that look identical when printed.
 */
export function controlRoot(env: NodeJS.ProcessEnv): string {
  const override = env.ORCA_CONTROL_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca", "control");
}

const nonEmpty = (value: string | undefined): value is string => value !== undefined && value.length > 0;

/**
 * The off shape, in one place. A hand-built `PanelOptions` in a criterion uses this rather than
 * spelling six fields out, so a fixture cannot quietly disagree with what parsing produces.
 */
export const controlDisabled = (): Omit<ControlOptionsResolution, "rejection"> => ({
  enabled: false,
  stateDir: null,
  wakeIntervalMs: DEFAULT_CONTROL_WAKE_MS,
  estimatorProfileId: null,
  estimateMode: null,
  executionPort: "unconfigured",
});

export function resolveControlOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
  repos: Array<{ projectKey: string; path: string }>,
): ControlOptionsResolution {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  // Both variables or neither: a binary with no adapter config cannot be driven, and half a
  // configuration presented as a whole one is how a soft adapter gets treated as strict.
  const executionPort = nonEmpty(env.ORCA_CCLOOP_BIN) && nonEmpty(env.ORCA_CCLOOP_ADAPTER_CONFIG) ? "configured" : "unconfigured";

  const off = (): ControlOptionsResolution => ({ ...controlDisabled(), executionPort, rejection: null });

  // Ruling R1 mounts by default, but a plane over no repository can dispatch nothing, and 11 of the
  // 40 existing `parsePanelArgs` call sites name no --repo (measured 2026-09-22). Rejecting those
  // would turn boots that are green today red, so the answer for them is "off", not "rejected".
  if (args.includes("--no-control") || repos.length === 0) return off();

  const explicitStateDir = flag("--control-state-dir");
  let stateDir: string | null;
  if (nonEmpty(explicitStateDir)) {
    stateDir = explicitStateDir;
  } else if (repos.length === 1) {
    stateDir = join(controlRoot(env), repos[0]!.projectKey);
  } else {
    // spec §4: more than one --repo leaves no <repoKey> to name, so there is no default to fall
    // back on. Naming one anyway (a hash, the first key) would put a store somewhere nobody asked for.
    return { ...off(), enabled: true, rejection: "control-state-dir-required" };
  }

  const wakeText = flag("--control-wake-ms");
  let wakeIntervalMs = DEFAULT_CONTROL_WAKE_MS;
  if (wakeText !== undefined) {
    const parsed = Number(wakeText);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { ...off(), enabled: true, stateDir, rejection: "control-wake-ms-invalid" };
    }
    wakeIntervalMs = parsed;
  }

  // Ruling R7 (spec §10), the same shape as R5: an absent estimator does not stop a panel booting.
  // spec §6's worry was that a *guessed* mode treats a soft adapter as strict; nothing is guessed
  // here, because an unconfigured estimator refuses the commands that need one by name instead.
  const estimatorProfileId = flag("--estimator-profile");
  const estimateModeText = flag("--estimate-mode");
  const hasProfile = nonEmpty(estimatorProfileId);
  const hasMode = nonEmpty(estimateModeText);

  // Half a configuration is different from none: an operator who typed one of the two flags meant
  // to configure an estimator, and silently ignoring the half they did type would be the guess.
  if (hasProfile !== hasMode) {
    return { ...off(), enabled: true, stateDir, wakeIntervalMs, rejection: "control-estimator-incomplete" };
  }
  if (hasMode && estimateModeText !== "strict" && estimateModeText !== "soft") {
    return { ...off(), enabled: true, stateDir, wakeIntervalMs, rejection: "control-estimate-mode-invalid" };
  }

  return {
    enabled: true,
    stateDir,
    wakeIntervalMs,
    estimatorProfileId: hasProfile ? estimatorProfileId : null,
    estimateMode: hasMode ? (estimateModeText as EstimateMode) : null,
    executionPort,
    rejection: null,
  };
}
