import { z } from "zod";
import { historySourcePinRef } from "./historySource.js";
import { conflictedNames, gitChild, gitOk, oneLine } from "./integrationGit.js";
import type { GroupIntegration } from "./integrationScheme.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const historyChainSchema = z.object({
  version: z.literal(1), contractHash: hash, base: sha, groupTip: sha,
  merges: z.array(z.object({ taskId: z.string().min(1), runId: z.string().min(1), sourceRef: z.string().min(1), sourceSha: sha,
    previous: sha, commit: sha }).strict()).min(1),
  targetTip: sha, artifactPaths: z.array(z.string().min(1)),
}).strict();
export type HistoryChain = z.infer<typeof historyChainSchema>;
export type HistoryBuild = { kind: "built"; chain: HistoryChain }
  | { kind: "blocked"; reason: string };

const parentsOf = async (repo: string, commit: string): Promise<string[] | null> => {
  const answer = await gitChild(repo, ["--no-replace-objects", "cat-file", "-p", commit]);
  return answer.code !== 0 ? null : answer.stdout.split("\n\n")[0]!.split("\n")
    .filter(line => line.startsWith("parent ")).map(line => line.slice("parent ".length));
};
const hasArtifact = async (repo: string, commit: string, path: string): Promise<boolean> => {
  const listing = await gitChild(repo, ["--no-replace-objects", "ls-tree", "-z", commit, "--", path]);
  return listing.code === 0 && listing.stdout.split("\0")
    .some(line => /^100(?:644|755) blob [a-f0-9]+\t/.test(line) && line.endsWith(`\t${path}`));
};

/** Re-read Git objects, not a DB row's claim about what parentage its commit has. */
export async function verifyHistoryChain(repo: string, chain: HistoryChain): Promise<boolean> {
  let previous = chain.base;
  for (const merge of chain.merges) {
    if (merge.previous !== previous) return false;
    const parents = await parentsOf(repo, merge.commit);
    if (parents?.length !== 2 || parents[0] !== previous || parents[1] !== merge.sourceSha) return false;
    previous = merge.commit;
  }
  if (chain.targetTip !== previous) {
    const parents = await parentsOf(repo, chain.targetTip);
    if (parents?.length !== 1 || parents[0] !== previous) return false;
  }
  for (const path of chain.artifactPaths) if (!(await hasArtifact(repo, chain.targetTip, path))) return false;
  return true;
}

/** Build all named merges in Git's object store without advancing the target ref. */
export async function buildHistoryChain(repo: string, groupId: string, base: string, groupTip: string,
  integration: GroupIntegration): Promise<HistoryBuild> {
  const scheme = integration.scheme;
  if (scheme.delivery !== "local" || !scheme.historyExpectation || !integration.frozen) return { kind: "blocked", reason: "history-contract-unavailable" };
  const expectation = scheme.historyExpectation, bindings = integration.historyBindings ?? [];
  if (bindings.length !== expectation.sourceRefs.length || bindings.some(binding => binding.contractHash !== integration.schemeHash))
    return { kind: "blocked", reason: "history-source-bindings-incomplete" };
  let current = base;
  const merges: HistoryChain["merges"] = [];
  for (const source of expectation.sourceRefs) {
    const matches = bindings.filter(binding => binding.taskId === source.taskId && binding.sourceRef === source.ref);
    if (matches.length !== 1) return { kind: "blocked", reason: `history-source-binding-invalid:${source.taskId}` };
    const bound = matches[0]!;
    const pin = historySourcePinRef(groupId, source.taskId, bound.runId);
    const pinned = await gitChild(repo, ["--no-replace-objects", "rev-parse", "--verify", "--quiet", `${pin}^{commit}`]);
    if (pinned.code !== 0 || pinned.stdout.trim() !== bound.sourceSha)
      return { kind: "blocked", reason: `history-source-pin-invalid:${source.ref}` };
    // Git drops duplicate parents; an identical first and second parent cannot prove a named merge.
    if (current === bound.sourceSha) return { kind: "blocked", reason: `history-source-equals-target:${source.ref}` };
    const merged = await gitChild(repo, ["--no-replace-objects", "merge-tree", "--write-tree", "--name-only", current, bound.sourceSha]);
    if (merged.code === 1) return { kind: "blocked", reason: `history-source-conflict:${source.ref}:${conflictedNames(merged.stdout).join(",")}` };
    if (merged.code !== 0) throw new Error(`git merge-tree: ${oneLine(merged.stderr)}`);
    const tree = merged.stdout.split("\n")[0]!.trim();
    const commit = (await gitOk(repo, ["--no-replace-objects", ...ORCA_IDENTITY, "commit-tree", tree, "-p", current, "-p", bound.sourceSha,
      "-m", `orca: merge ${source.ref} into ${scheme.target} (${groupId})`])).trim();
    merges.push({ taskId: source.taskId, runId: bound.runId, sourceRef: source.ref, sourceSha: bound.sourceSha, previous: current, commit });
    current = commit;
  }
  const common = (await gitOk(repo, ["--no-replace-objects", "merge-base", groupTip, base])).trim();
  const carried = await gitChild(repo, ["--no-replace-objects", "merge-tree", "--write-tree", "--name-only", `--merge-base=${common}`, current, groupTip]);
  if (carried.code === 1) return { kind: "blocked", reason: `history-group-tree-conflict:${conflictedNames(carried.stdout).join(",")}` };
  if (carried.code !== 0) throw new Error(`git merge-tree: ${oneLine(carried.stderr)}`);
  const tree = carried.stdout.split("\n")[0]!.trim();
  const currentTree = (await gitOk(repo, ["--no-replace-objects", "rev-parse", `${current}^{tree}`])).trim();
  if (tree !== currentTree) current = (await gitOk(repo, ["--no-replace-objects", ...ORCA_IDENTITY, "commit-tree", tree, "-p", current,
    "-m", `orca: carry ${groupId} work after named merges`])).trim();
  for (const path of expectation.artifactPaths ?? [])
    if (!(await hasArtifact(repo, current, path))) return { kind: "blocked", reason: `history-artifact-missing:${path}` };
  const chain = historyChainSchema.parse({ version: 1, contractHash: integration.schemeHash, base, groupTip,
    merges, targetTip: current, artifactPaths: [...(expectation.artifactPaths ?? [])] });
  // Every parent is an object in the registered repository; this final commit is publishable by one target CAS.
  await gitOk(repo, ["--no-replace-objects", "rev-parse", "--verify", `${chain.targetTip}^{commit}`]);
  return { kind: "built", chain };
}
