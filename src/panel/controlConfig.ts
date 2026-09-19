import { fstatSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { durableCommandErrorStatuses } from "../control/errors.js";
import { ControlError } from "../control/errors.js";
import type { ExecutionProfileRouter } from "../control/profiles.js";
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
  adapterConfigPath: string;
  archiveRoot: string;
  exportRoot: string;
  evidenceRoot: string;
  shutdownGraceMs: number;
  repositories: TrustedRepositoryConfig[];
  plans: TrustedPlanConfig[];
  defaultEstimatorProfileId: string;
  defaultEstimateMode: "strict" | "soft";
}

export interface TrustedControlConfig {
  resolveTarget(input: unknown): TrustedSchedulerPlanTarget;
  readView(): Promise<ControlConfigV1>;
  readonly shutdownGraceMs: number;
}

const targetSchema = z.object({ repoId: idSchema, planId: idSchema }).strict();
const trustedControlConfigInputSchema = z.object({
  epoch: z.string().min(1),
  stateDir: z.string().min(1),
  executablePath: z.string().min(1),
  adapterConfigPath: z.string().min(1),
  archiveRoot: z.string().min(1),
  exportRoot: z.string().min(1),
  evidenceRoot: z.string().min(1),
  shutdownGraceMs: safeInteger.positive(),
  repositories: z.array(z.object({ repoId: idSchema, displayName: z.string().min(1), path: z.string().min(1) }).strict()),
  plans: z.array(z.object({ planId: idSchema, repoId: idSchema, displayName: z.string().min(1), path: z.string().min(1) }).strict()),
  defaultEstimatorProfileId: idSchema,
  defaultEstimateMode: z.enum(["strict", "soft"]),
}).strict();

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
  checkedPath(input.adapterConfigPath, "file");
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
  const defaultProfile = profiles.find((profile) => profile.snapshot.profile.profileId === input.defaultEstimatorProfileId);
  if (!defaultProfile || !defaultProfile.snapshot.profile.allowedWorkKinds.includes("budget-estimate")) invalid("default-estimator");
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
    async readView(): Promise<ControlConfigV1> {
      const observations = await Promise.all(profiles.map((profile) => router.probe(profile)));
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
        defaults: {
          estimatorProfileId: defaultProfile.snapshot.profile.profileId,
          estimatorProfileHash: defaultProfile.profileHash,
          estimateMode: input.defaultEstimateMode,
        },
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
