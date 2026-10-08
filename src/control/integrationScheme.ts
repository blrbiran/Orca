import { z } from "zod";
import { sha256Canonical } from "./canonicalJson.js";
import { reconcileRecordSchema } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { safeInteger } from "./schema.js";
import type { ControlStore } from "./store.js";
import { integrationSchemeSchema } from "./webProtocol.js";
import { ChildSpawnFailed, ChildTimeout, runChild } from "./integrationGit.js";
import { readRepositorySettingsBody } from "./workspaceSettings.js";

/** Integration spec §3: what happens to a group's work once it lands on `orca/<g>`. The schema is the protocol's. */
export { integrationSchemeSchema };
export type IntegrationScheme = z.infer<typeof integrationSchemeSchema>;
export type Trigger = Extract<IntegrationScheme, { trigger: unknown }>["trigger"];
export type Method = Extract<IntegrationScheme, { method: unknown }>["method"];

/** Integration spec §3.1: the repository default; absent is keep (ruling R5), at the settings body's revision. */
export function readIntegrationDefault(store: ControlStore, repoId: string): { scheme: IntegrationScheme; revision: number } {
  const body = readRepositorySettingsBody(store, repoId);
  return { scheme: body?.integration ?? { delivery: "keep" }, revision: body?.revision ?? 0 };
}

/**
 * §8, the pattern half: git's own check-ref-format is the other half (checkBranchName). The spec's "no `@{`" needs no
 * clause of its own: the pattern admits neither `@` nor `{`.
 */
export function validBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name)
    && !name.includes("..") && !name.includes("//")
    && !name.endsWith("/") && !name.endsWith(".") && !name.endsWith(".lock");
}

export function validRemoteName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name);
}

export function schemeHash(scheme: IntegrationScheme): string {
  return sha256Canonical(scheme);
}

/**
 * The checks a scheme can fail that are not about the scheme: git could not answer (it could not be started, or it
 * outlived ORCA_INTEGRATION_TIMEOUT_MS), or the repository's trusted path could not be resolved. They are refused as
 * integration-preflight-failed naming the check, never as a bad name or a missing remote.
 */
export const GIT_CHECK = "git";
export const REPOSITORY_CHECK = "repository";
export const ENVIRONMENT_CHECKS: ReadonlySet<string> = new Set([GIT_CHECK, REPOSITORY_CHECK]);

/** git did not answer; the check it was serving is reported as GIT_CHECK. */
class GitUnanswered extends Error {}

/** One quiet git child in the target repository on the shared integration runner (integrationGit.ts). */
async function runGit(repo: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const answer = await runChild("git", args, { cwd: repo, quiet: true });
    return { ok: answer.code === 0, stdout: answer.stdout };
  } catch (error) {
    if (error instanceof ChildTimeout || error instanceof ChildSpawnFailed) throw new GitUnanswered(error.message);
    throw error;
  }
}

/** A check run whose git did not answer names GIT_CHECK. */
async function orGitCheck(check: () => Promise<string | null>): Promise<string | null> {
  try { return await check(); } catch (error) { if (error instanceof GitUnanswered) return GIT_CHECK; throw error; }
}

/**
 * §8: the pattern, and `git check-ref-format --branch <name>` printing the name unchanged. The pattern already refuses a
 * leading `-`, so the name cannot be read as an option (git 2.50 refuses a `--` separator for --branch).
 */
export async function checkBranchName(repo: string, name: string): Promise<boolean> {
  if (!validBranchName(name)) return false;
  const answer = await runGit(repo, ["check-ref-format", "--branch", name]);
  return answer.ok && answer.stdout === `${name}\n`;
}

/** The raw configured URL (not `git remote get-url`, which applies insteadOf); null when the remote is not configured. */
export async function remoteUrl(repo: string, remote: string): Promise<string | null> {
  const answer = await runGit(repo, ["config", "--get", `remote.${remote}.url`]);
  return answer.ok ? answer.stdout.trim() : null;
}

/**
 * Controller ruling (Task 7): the target a repository with no scheme yet is offered, as spec §3 names the default for
 * remote `origin` -- the branch refs/remotes/origin/HEAD points at, else the current branch, else none (a detached HEAD,
 * or git did not answer). Only local refs are read: no network.
 */
export async function suggestedTarget(repo: string): Promise<string | null> {
  const prefix = "refs/remotes/origin/";
  try {
    const remoteHead = await runGit(repo, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const pointed = remoteHead.stdout.trim();
    if (remoteHead.ok && pointed.startsWith(prefix)) return pointed.slice(prefix.length);
    const head = await runGit(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return head.ok ? head.stdout.trim() : null;
  } catch (error) {
    if (error instanceof GitUnanswered) return null;
    throw error;
  }
}

/** §3.3, the setters' check: null when the scheme may be stored, else the name of the check it failed. */
export function checkScheme(repo: string, scheme: IntegrationScheme): Promise<string | null> {
  return orGitCheck(() => schemeCheck(repo, scheme));
}

async function schemeCheck(repo: string, scheme: IntegrationScheme): Promise<string | null> {
  if (scheme.delivery === "keep") return null;
  if ("remote" in scheme && !validRemoteName(scheme.remote)) return "remote-name";
  if (!(await checkBranchName(repo, scheme.target))) return "target-name";
  if (!("remote" in scheme)) return null;
  const url = await remoteUrl(repo, scheme.remote);
  if (url === null) return "remote-missing";
  if (scheme.delivery === "github-pr" && githubRepoOf(url) === null) return "remote-not-github";
  return null;
}

/** The GitHub repository a remote URL names: https, scp-like and ssh:// shapes on github.com; anything else is null. */
export function githubRepoOf(remoteUrl: string): { host: string; slug: string } | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remoteUrl);
  return match === null ? null : { host: "github.com", slug: `${match[1]}/${match[2]}` };
}

/**
 * §3.3, confirm's preflight: the setters' check, then the target branch exists (the local ref for `local`; otherwise a
 * fetch of it from the remote, and when that fails, whether the remote answers at all), `squash` needs git 2.40
 * (`merge-tree --merge-base`), `github-pr` needs `gh auth status` for the remote's host. Null when every check passed,
 * else the name of the first that failed.
 */
export function preflightScheme(repo: string, scheme: IntegrationScheme, ghBin: string): Promise<string | null> {
  return orGitCheck(() => preflight(repo, scheme, ghBin));
}

async function preflight(repo: string, scheme: IntegrationScheme, ghBin: string): Promise<string | null> {
  const failed = await schemeCheck(repo, scheme);
  if (failed !== null || scheme.delivery === "keep") return failed;
  if (scheme.delivery === "local") {
    if (!(await runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${scheme.target}`])).ok) return "target";
  } else if (!(await runGit(repo, ["fetch", "--quiet", scheme.remote, `refs/heads/${scheme.target}`])).ok) {
    return (await runGit(repo, ["ls-remote", "--quiet", scheme.remote])).ok ? "target" : "remote";
  }
  if ("method" in scheme && scheme.method === "squash" && !gitAtLeast((await runGit(repo, ["--version"])).stdout, 2, 40)) return "git-version";
  if (scheme.delivery === "github-pr") {
    // schemeCheck has just parsed this URL as a GitHub one; a remote changed since is judged again here.
    const github = githubRepoOf((await remoteUrl(repo, scheme.remote)) ?? "");
    if (github === null) return "remote-not-github";
    const authenticated = await runChild(ghBin, ["auth", "status", "--hostname", github.host], { cwd: repo }).then((answer) => answer.code === 0, () => false);
    if (!authenticated) return "gh-auth";
  }
  return null;
}

function gitAtLeast(versionOutput: string, major: number, minor: number): boolean {
  const match = /^git version (\d+)\.(\d+)/.exec(versionOutput);
  return match !== null && (Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor));
}

const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
/** §4: the group's integration record, in the group body only for a non-keep scheme. */
const groupIntegrationSchema = z.object({
  scheme: integrationSchemeSchema, schemeHash: z.string().regex(/^[a-f0-9]{64}$/), frozen: z.boolean(),
  lastIntegrated: commit.nullable(), integratedCommit: commit.nullable(),
  state: z.enum(["idle", "blocked", "conflict", "resolving"]), reason: z.string().nullable(),
  pending: z.object({ schemeHash: z.string().regex(/^[a-f0-9]{64}$/), tip: commit, base: commit, new: commit }).strict().nullable(),
  conflict: z.object({ attempt: safeInteger, key: z.string(), base: commit, tip: commit, paths: z.array(z.string()) }).strict().nullable(),
  resolution: reconcileRecordSchema.nullable(),
  pr: z.object({ url: z.string(), number: safeInteger, ready: z.boolean() }).strict().nullable(),
  retryAfter: safeInteger.nullable(),
  /** Consecutive transient failures; drives the backoff, 0 after any success. */
  transient: safeInteger,
}).strict();
export type GroupIntegration = z.infer<typeof groupIntegrationSchema>;

/** §3.1: the group's record; null is keep (no field, ruling R5). A record that does not parse blocks the group by name. */
export function readGroupIntegration(group: unknown): GroupIntegration | null {
  if (typeof group !== "object" || group === null || !Object.hasOwn(group, "integration")) return null;
  const parsed = groupIntegrationSchema.safeParse((group as { integration: unknown }).integration);
  if (!parsed.success) throw new ControlError("recovery-blocked", "group-integration-invalid");
  return parsed.data;
}

/** §3.1, §4: a fresh record for a scheme copied into a group (unfrozen until confirm); null for keep. */
export function newGroupIntegration(scheme: IntegrationScheme): GroupIntegration | null {
  if (scheme.delivery === "keep") return null;
  return {
    scheme, schemeHash: schemeHash(scheme), frozen: false, lastIntegrated: null, integratedCommit: null, state: "idle", reason: null,
    pending: null, conflict: null, resolution: null, pr: null, retryAfter: null, transient: 0,
  };
}
