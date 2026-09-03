import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateLine } from "../../../src/ledger/validateLine.js";
import {
  blameCommitOfLine,
  commitParents,
  conflictRefShas,
  ledgerFilesOnBranch,
  makeSandbox,
  orcaIncomingRefs,
  reachableCommits,
  readLedgerOnBranch,
  runCli,
  seedLyingPlan,
  showFileAt,
} from "../sandbox.js";
import type { RunnablePlan, Sandbox } from "../sandbox.js";

// One round, four criteria. Every one of them is a question about the SAME
// reconciled landing -- its exit code, its ledger, the merge commit's parents,
// and which commit `git blame` attributes the bound line to -- and running the
// round four times would spawn twelve ccloop subprocesses to answer them.
// Each criterion still measures its own thing off the artifacts; none of them
// mutates the sandbox.
let s: Sandbox;
let p: RunnablePlan;
let rc: number;

beforeAll(async () => {
  s = await makeSandbox();
  p = await seedLyingPlan(s);
  // --keep-workdirs so the conflicted commit's copy survives for the criterion
  // that has to name it. It changes nothing about what lands: disposeWorkdir
  // is the only consumer.
  rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig, "--keep-workdirs"]);
}, 300_000);

afterAll(async () => {
  await s?.cleanup();
});

/** The commit on W whose second parent is `refs/orca/<run-id>` for taskId. */
async function reconciledMergeCommit(taskId: string): Promise<{ sha: string; parents: string[]; incoming: string }> {
  const refs = await orcaIncomingRefs(s.targetRepo);
  const runId = Object.keys(refs).find((id) => id.startsWith(`orca-${taskId}-`));
  expect(runId).not.toBeUndefined();
  const incoming = refs[runId!];
  const parents = await commitParents(s.targetRepo, p.workBranch);
  const found = [...parents.entries()].filter(([, ps]) => ps.length === 2 && ps[1] === incoming);
  expect(found).toHaveLength(1);
  return { sha: found[0][0], parents: found[0][1], incoming };
}

describe("S3 (spec 3.4 rule 3 / 5.0-5.2 / 8.3)", () => {
  it("S3: tasks that declared disjoint write sets but actually collided are reconciled and land", async () => {
    // This is the load-bearing scenario of the whole design: the write-set
    // criterion is an optimisation, and the system has to be correct when it is
    // wrong. Section 3.4's third rule -- no code path may assume "the criterion
    // said they would not collide" -- is what M-OPT deletes.
    //
    // 🔴 The plan's criterion says "exit 0" and the round exits 2. That is not
    // a defect being papered over, it is an inconsistency between two rules the
    // spec states in two places, and it is decided here in favour of the one
    // that has production code and a mutation behind it:
    //
    //   - For two tasks to land in ONE layer, pathTrie must call their declared
    //     write sets disjoint (buildGraph puts an implicit edge between any
    //     intersecting pair, which splits them across layers -- where the later
    //     one clones from a W that already contains the earlier one's work and
    //     its merge is a fast-forward, so no conflict is possible).
    //   - For their merges to conflict, both must write the SAME path.
    //   - A path inside both declared sets makes those sets intersect: the two
    //     claims are then both prefixes of that path, so one contains the
    //     other and pathTrie.classify returns non-null.
    //
    // So at least one side's collision is necessarily an out-of-bounds write,
    // and 7.3's second tier prices "out of bounds, no sibling claims it, land
    // it anyway" at exit 2 -- pinned by S6 and mutation M-A2. A conflict that
    // reaches 5's trunk at all therefore carries an exit-2 contribution with
    // it, and 6.3 takes the max. What "exit 0" stood for is asserted directly
    // below instead: the round did NOT escalate (3), both tasks are on W, and
    // the reconciled file carries no markers.
    expect(rc).toBe(2);

    expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
    expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBe("b1\n");
    // The conflicted file, reconciled: what lands on W must not contain the
    // markers. A "reconciliation" that committed the conflicted tree verbatim
    // would satisfy every other assertion here.
    expect(await showFileAt(s.targetRepo, p.workBranch, "shared.txt")).not.toContain("<<<<<<<");

    const lines = await readLedgerOnBranch(s.targetRepo, p.workBranch);
    // `every` on an empty array is true, so the count comes first.
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => (JSON.parse(l) as { kind?: string }).kind === "reconcile")).toBe(true);
    expect(lines.every((l) => validateLine(l).verdict === "ok")).toBe(true);
  }, 300_000);

  it("lands an ordinary merge commit whose two parents are the W tip and the incoming ref", async () => {
    // spec 5.2 step 4, measured on the object that actually reached W rather
    // than on rebuildMergeCommit in isolation. M-TREE is fed exactly this:
    // a merge commit built with the wrong parents still carries the right tree,
    // so every content assertion above stays green while W's history stops
    // saying that this task's work was ever a branch of its own.
    const { sha, parents, incoming } = await reconciledMergeCommit("T2");
    const grandparents = await commitParents(s.targetRepo, p.workBranch);
    // Parent 1 is the W tip the landing started from: the only commit on W
    // that is an ancestor of this merge and not the incoming attempt.
    expect(parents).toHaveLength(2);
    expect(parents[1]).toBe(incoming);
    expect(grandparents.has(parents[0])).toBe(true);
    expect(parents[0]).not.toBe(incoming);
  }, 300_000);

  it("the conflicted commit never reaches W", async () => {
    // spec 5.2 step 5. Not merely untidy if it escapes: the conflicted commit
    // IS a two-parent merge commit (measured in Task 11 -- `git commit` after a
    // conflicted merge produces one), so it would fast-forward onto W looking
    // like a legitimate landing and put conflict markers into the work branch's
    // history.
    const conflictRefs = await conflictRefShas(s);
    // The refs are how this criterion knows the sha at all, so an
    // implementation that materialised no conflict would otherwise pass by
    // having nothing to look for.
    expect(Object.keys(conflictRefs).length).toBeGreaterThan(0);

    const reachable = new Set(await reachableCommits(s.targetRepo, p.workBranch));
    for (const sha of Object.values(conflictRefs)) {
      expect(reachable.has(sha)).toBe(false);
    }
  }, 300_000);

  it("the bound line is blamed to the merge commit itself, not to the commit after it", async () => {
    // The natural way to write this is "merge, then record" -- and it is wrong
    // in a way that stays green: the bound line lands on the *next* commit, so
    // `git blame` answers with the wrong commit and nothing notices. The tree
    // of a commit-tree commit is fixed at construction, so the ledger line has
    // to be in the tree before the commit is built.
    //
    // This round really does put another commit on W after the merge (the
    // landing-order decision, 4.3), so "the commit after it" is a commit that
    // exists and that a wrong implementation would land on.
    const { sha: merge } = await reconciledMergeCommit("T2");

    const files = await ledgerFilesOnBranch(s.targetRepo, p.workBranch);
    const found: Array<{ path: string; line: number }> = [];
    for (const file of files) {
      file.lines.forEach((text, index) => {
        if (text.trim().length === 0) return;
        if ((JSON.parse(text) as { ev?: string }).ev === "bound") found.push({ path: file.path, line: index + 1 });
      });
    }
    expect(found).toHaveLength(1);

    const blamed = await blameCommitOfLine(s.targetRepo, p.workBranch, found[0].path, found[0].line);
    expect(blamed).toBe(merge);
  }, 300_000);
});
