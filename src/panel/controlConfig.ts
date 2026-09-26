import { fstatSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { durableCommandErrorStatuses } from "../control/errors.js";
import { ControlError } from "../control/errors.js";
import { agentsTablePath } from "../control/ccloopPort.js";
import type { ExecutionProfileRouter } from "../control/profiles.js";
import type { PartialSelection } from "../control/agentSelection.js";
import { controlConfigSchema, type ControlConfigV1 } from "../control/webProtocol.js";
import { idSchema, safeInteger } from "../control/schema.js";
import type { TrustedSchedulerPlanTarget } from "../scheduler/planFile.js";

export interface TrustedRepositoryConfig {
  repoId: string;
  displayName: string;
  path: string;
}

export interface TrustedPlanConfig {
  planId: string;
  repoId: string;
  displayName: string;
  path: string;
}

export interface TrustedControlConfigInput {
  epoch: string;
  stateDir: string;
  executablePath: string;
  /**
   * Null when no execution port is configured (ruling R5). Paired with `executionPort` by a
   * refinement below: the two can no longer disagree, which a free-standing string allowed.
   * Agent selection spec §6.6: the agents table replaces the single adapter config.
   */
  agentsTablePath: string | null;
  executionPort: "configured" | "unconfigured";
  archiveRoot: string;
  exportRoot: string;
  evidenceRoot: string;
  shutdownGraceMs: number;
  repositories: TrustedRepositoryConfig[];
  plans: TrustedPlanConfig[];
  /** Both null or both set (ruling R7). Null is a served state, not a boot failure. */
  defaultEstimatorProfileId: string | null;
  defaultEstimateMode: "strict" | "soft" | null;
}

export interface TrustedControlConfig {
  resolveTarget(input: unknown): TrustedSchedulerPlanTarget;
  resolveRepository(repoId: string): string;
  /** Agent selection spec §6.4 last paragraph (W5-M14): the profiles as observed for `selection`, the operator's default. */
  readView(selection: PartialSelection): Promise<ControlConfigV1>;
  readonly shutdownGraceMs: number;
}

const targetSchema = z.object({ repoId: idSchema, planId: idSchema }).strict();
const trustedControlConfigInputSchema = z.object({
  epoch: z.string().min(1),
  stateDir: z.string().min(1),
  executablePath: z.string().min(1),
  agentsTablePath: z.string().min(1).nullable(),
  executionPort: z.enum(["configured", "unconfigured"]),
  archiveRoot: z.string().min(1),
  exportRoot: z.string().min(1),
  evidenceRoot: z.string().min(1),
  shutdownGraceMs: safeInteger.positive(),
  repositories: z.array(z.object({ repoId: idSchema, displayName: z.string().min(1), path: z.string().min(1) }).strict()),
  plans: z.array(z.object({ planId: idSchema, repoId: idSchema, displayName: z.string().min(1), path: z.string().min(1) }).strict()),
  defaultEstimatorProfileId: idSchema.nullable(),
  defaultEstimateMode: z.enum(["strict", "soft"]).nullable(),
}).strict().superRefine((value, ctx) => {
  // The invariant is the pair, not either field: a configured port with no agents table, and a
  // profile with no mode, were both representable before and are the shapes that let a soft
  // adapter be driven as a strict one.
  if ((value.executionPort === "configured") !== (value.agentsTablePath !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agentsTablePath"], message: "execution-port-agents-table-mismatch" });
  }
  if ((value.defaultEstimatorProfileId === null) !== (value.defaultEstimateMode === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultEstimateMode"], message: "estimator-defaults-incomplete" });
  }
});

function invalid(detail?: string): never {
  throw new ControlError("control-trusted-config-invalid", detail);
}

interface PathWitness {
  input: string;
  kind: "directory" | "file";
  canonicalPath: string;
  components: Array<{ path: string; dev: string; ino: string }>;
}

function checkedPath(input: string, kind: "directory" | "file"): PathWitness {
  if (!isAbsolute(input) || resolve(input) !== input) invalid("path-not-absolute-canonical");
  let cursor = parse(input).root;
  const components: PathWitness["components"] = [];
  for (const part of input.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat;
    try { stat = lstatSync(cursor, { bigint: true }); }
    catch { invalid("path-missing"); }
    if (stat.isSymbolicLink()) throw new ControlError("control-path-symlink");
    components.push({ path: cursor, dev: String(stat.dev), ino: String(stat.ino) });
  }
  const stat = lstatSync(input);
  if ((kind === "directory" && !stat.isDirectory()) || (kind === "file" && !stat.isFile())) invalid(`path-not-${kind}`);
  return { input, kind, canonicalPath: realpathSync(input), components };
}

function revalidatePath(witness: PathWitness): string {
  const current = checkedPath(witness.input, witness.kind);
  if (
    current.canonicalPath !== witness.canonicalPath
    || current.components.length !== witness.components.length
    || current.components.some((component, index) =>
      component.path !== witness.components[index].path
      || component.dev !== witness.components[index].dev
      || component.ino !== witness.components[index].ino)
  ) throw new ControlError("control-path-changed");
  return current.canonicalPath;
}

function validateOpenFile(witness: PathWitness, fd: number): void {
  const expected = witness.components.at(-1);
  const opened = fstatSync(fd, { bigint: true });
  if (!expected || !opened.isFile() || String(opened.dev) !== expected.dev || String(opened.ino) !== expected.ino) {
    throw new ControlError("control-path-changed");
  }
}

function unique<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

function isDescendant(root: string, child: string): boolean {
  const suffix = relative(root, child);
  return suffix.length > 0 && !suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix);
}

export function createTrustedControlConfig(
  input: TrustedControlConfigInput,
  router: ExecutionProfileRouter,
): TrustedControlConfig {
  const parsedInput = trustedControlConfigInputSchema.safeParse(input);
  if (!parsedInput.success) invalid(parsedInput.error.issues[0]?.message);
  input = parsedInput.data;
  if (!unique(input.repositories, (entry) => entry.repoId) || !unique(input.plans, (entry) => entry.planId)) invalid("duplicate-id");

  checkedPath(input.stateDir, "directory");
  checkedPath(input.executablePath, "file");
  // Final review I-1 (2026-09-26): only the path's shape is checked here, exactly as ccloopPort's own
  // agentsTablePath does (the two share this one function). A missing table must not keep the panel
  // from assembling -- ccloop T5 fix I-1 / spec §12 I4 say a deleted table must not block recovering
  // a run already in flight, and this was the second, forgotten existence check that reintroduced the
  // block wave-2 I-1 thought it had removed (§13 D10 correction, §13.4). Existence and content are
  // ccloop's to judge, at capabilities and accept (agents-table-invalid).
  if (input.agentsTablePath !== null) agentsTablePath(input.agentsTablePath);
  checkedPath(input.archiveRoot, "directory");
  checkedPath(input.exportRoot, "directory");
  checkedPath(input.evidenceRoot, "directory");

  const repositories = new Map<string, TrustedRepositoryConfig & { witness: PathWitness }>();
  for (const entry of input.repositories) {
    if (!idSchema.safeParse(entry.repoId).success || !entry.displayName) invalid("repository");
    repositories.set(entry.repoId, { ...entry, witness: checkedPath(entry.path, "directory") });
  }
  const plans = new Map<string, TrustedPlanConfig & { witness: PathWitness }>();
  for (const entry of input.plans) {
    if (!idSchema.safeParse(entry.planId).success || !idSchema.safeParse(entry.repoId).success || !entry.displayName) invalid("plan");
    const repository = repositories.get(entry.repoId);
    if (!repository) invalid("plan-repository");
    const witness = checkedPath(entry.path, "file");
    if (!isDescendant(repository.witness.canonicalPath, witness.canonicalPath)) throw new ControlError("control-path-escape");
    plans.set(entry.planId, { ...entry, witness });
  }

  const profiles = router.list();
  // Ruling R7: no estimator named is a state, not an error. A name that does not resolve, or
  // resolves to a profile that cannot estimate, is still an error -- the operator asked for
  // something specific and did not get it.
  const defaultProfile = input.defaultEstimatorProfileId === null
    ? null
    : profiles.find((profile) => profile.snapshot.profile.profileId === input.defaultEstimatorProfileId) ?? invalid("default-estimator");
  if (defaultProfile !== null && !defaultProfile.snapshot.profile.allowedWorkKinds.includes("budget-estimate")) invalid("default-estimator");
  return Object.freeze({
    shutdownGraceMs: input.shutdownGraceMs,
    resolveTarget(raw: unknown) {
      const parsedTarget = targetSchema.safeParse(raw);
      if (!parsedTarget.success) throw new ControlError("control-target-not-allowed");
      const repository = repositories.get(parsedTarget.data.repoId);
      const plan = plans.get(parsedTarget.data.planId);
      if (!repository || !plan || plan.repoId !== repository.repoId) throw new ControlError("control-target-not-allowed");
      const repositoryPath = revalidatePath(repository.witness);
      const planPath = revalidatePath(plan.witness);
      if (!isDescendant(repositoryPath, planPath)) throw new ControlError("control-path-escape");
      const resolvedTarget = { repositoryPath, planPath } as TrustedSchedulerPlanTarget;
      Object.defineProperty(resolvedTarget, "validatePlanDescriptor", {
        enumerable: false,
        value(fd: number) {
          const currentRepositoryPath = revalidatePath(repository.witness);
          const currentPlanPath = revalidatePath(plan.witness);
          if (!isDescendant(currentRepositoryPath, currentPlanPath)) throw new ControlError("control-path-escape");
          validateOpenFile(plan.witness, fd);
        },
      });
      return Object.freeze(resolvedTarget);
    },
    /** Execution driver spec §3.1: the trusted path by repoId, its witness re-validated on every use. */
    resolveRepository(repoId: string): string {
      const repository = repositories.get(repoId);
      if (!repository) throw new ControlError("control-target-not-allowed");
      return revalidatePath(repository.witness);
    },
    async readView(selection: PartialSelection): Promise<ControlConfigV1> {
      const observations = await Promise.all(profiles.map((profile) => router.probe(profile, selection)));
      const view: ControlConfigV1 = {
        schema: "orca-control-config-v1",
        epoch: input.epoch,
        repositories: [...repositories.values()]
          .map(({ repoId, displayName }) => ({ repoId, displayName }))
          .sort((left, right) => left.repoId.localeCompare(right.repoId)),
        plans: [...plans.values()]
          .map(({ planId, repoId, displayName }) => ({ planId, repoId, displayName }))
          .sort((left, right) => left.planId.localeCompare(right.planId)),
        profiles: observations.map(({ profile, observed, observedAt, probeFailureCode }) => ({
          profileId: profile.snapshot.profile.profileId,
          profileHash: profile.profileHash,
          allowedWorkKinds: [...profile.snapshot.profile.allowedWorkKinds],
          contextTokenizer: profile.snapshot.profile.contextTokenizer,
          workMaxOutputTokens: profile.snapshot.profile.workMaxOutputTokens,
          declared: profile.snapshot.profile.capabilities,
          observed,
          observedAt,
          probeFailureCode,
        })).sort((left, right) => left.profileId.localeCompare(right.profileId)),
        defaults: defaultProfile === null || input.defaultEstimateMode === null ? null : {
          estimatorProfileId: defaultProfile.snapshot.profile.profileId,
          estimatorProfileHash: defaultProfile.profileHash,
          estimateMode: input.defaultEstimateMode,
        },
        executionPort: input.executionPort,
        errorCatalog: Object.entries(durableCommandErrorStatuses)
          .map(([code, status]) => ({ code, status }))
          .sort((left, right) => left.code.localeCompare(right.code)),
      };
      const parsed = controlConfigSchema.safeParse(view);
      if (!parsed.success) invalid(parsed.error.issues[0]?.message);
      return parsed.data;
    },
  });
}
