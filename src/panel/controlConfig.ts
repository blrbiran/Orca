import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { durableCommandErrorStatuses } from "../control/errors.js";
import { ControlError } from "../control/errors.js";
import type { ExecutionProfileRouter } from "../control/profiles.js";
import { controlConfigSchema, type ControlConfigV1 } from "../control/webProtocol.js";
import { idSchema, safeInteger } from "../control/schema.js";

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
  resolveTarget(input: unknown): { repositoryPath: string; planPath: string };
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

function checkedPath(input: string, kind: "directory" | "file"): string {
  if (!isAbsolute(input) || resolve(input) !== input) invalid("path-not-absolute-canonical");
  let cursor = parse(input).root;
  for (const part of input.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat;
    try { stat = lstatSync(cursor); }
    catch { invalid("path-missing"); }
    if (stat.isSymbolicLink()) throw new ControlError("control-path-symlink");
  }
  const stat = lstatSync(input);
  if ((kind === "directory" && !stat.isDirectory()) || (kind === "file" && !stat.isFile())) invalid(`path-not-${kind}`);
  return realpathSync(input);
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

  const repositories = new Map<string, TrustedRepositoryConfig & { canonicalPath: string }>();
  for (const entry of input.repositories) {
    if (!idSchema.safeParse(entry.repoId).success || !entry.displayName) invalid("repository");
    repositories.set(entry.repoId, { ...entry, canonicalPath: checkedPath(entry.path, "directory") });
  }
  const plans = new Map<string, TrustedPlanConfig & { canonicalPath: string }>();
  for (const entry of input.plans) {
    if (!idSchema.safeParse(entry.planId).success || !idSchema.safeParse(entry.repoId).success || !entry.displayName) invalid("plan");
    const repository = repositories.get(entry.repoId);
    if (!repository) invalid("plan-repository");
    const canonicalPath = checkedPath(entry.path, "file");
    if (!isDescendant(repository.canonicalPath, canonicalPath)) throw new ControlError("control-path-escape");
    plans.set(entry.planId, { ...entry, canonicalPath });
  }

  const profiles = router.list();
  const defaultProfile = profiles.find((profile) => profile.snapshot.profile.profileId === input.defaultEstimatorProfileId);
  if (!defaultProfile || !defaultProfile.snapshot.profile.allowedWorkKinds.includes("budget-estimate")) invalid("default-estimator");
  return Object.freeze({
    shutdownGraceMs: input.shutdownGraceMs,
    resolveTarget(raw: unknown) {
      const target = targetSchema.safeParse(raw);
      if (!target.success) throw new ControlError("control-target-not-allowed");
      const repository = repositories.get(target.data.repoId);
      const plan = plans.get(target.data.planId);
      if (!repository || !plan || plan.repoId !== repository.repoId) throw new ControlError("control-target-not-allowed");
      return { repositoryPath: repository.canonicalPath, planPath: plan.canonicalPath };
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
