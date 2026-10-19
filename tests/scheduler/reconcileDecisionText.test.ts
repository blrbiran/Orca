import { describe, expect, it } from "vitest";
import { reconcileDecision } from "../../src/scheduler/ledgerWiring.js";

const AT = "2026-10-18T00:00:00.000Z";
const fixture = {
  conflictedPaths: ["shared.txt"],
  blocks: [{ path: "shared.txt", startLine: 1, endLine: 5, ours: [], theirs: [] }],
  conflictCommit: "c".repeat(40),
  copyPath: "/tmp/copy",
  wTip: "d".repeat(40),
  incomingRef: "refs/x",
};

// Captured with `npx tsx` against the base commit 38b9658d, where the
// parameter was still a single `otherTaskId: string` ("b"), before the edit.
// Rewritten under the session grant (human, session 3831d12f, 2026-10-20: 「这次批准改写所有必要的判据」):
// reported-decisions spec 2026-10-20 §6 has Orca's code-authored rows write `importance: "major"`, so the
// captured text gains that one trailing member; every byte before it is the capture above, unchanged.
const GOLDEN = "{\"ev\":\"decision\",\"id\":\"r/1\",\"at\":\"2026-10-18T00:00:00.000Z\",\"run\":\"r\",\"question\":\"landing a on orca/g conflicted with b in shared.txt (1 block(s): shared.txt:1-5), even though the two tasks declared write sets that do not intersect\",\"chose\":\"reconcile it automatically: run one ccloop task against the conflict commit cccccccccccccccccccccccccccccccccccccccc in /tmp/copy, verified by the union of both tasks' required checks, then rebuild the merge commit from the reconciled tree\",\"alternatives\":[{\"option\":\"stop at this merge point and escalate to a human (spec §5.4, exit 3)\",\"why_not\":\"both sides contributed a goal, a success condition and required checks, so the reconciliation can be given both intents and verified against both tasks' checks; a mis-classified block fails that verification rather than passing silently (§5.1), so escalating here would stop the round on something a human does not yet have to decide\"}],\"because\":\"spec §3.4 rule 1: the write-set criterion is an optimisation, so two tasks it judged disjoint can still collide at merge time, and §5.0 makes reconciliation the trunk rather than an exception path. §5.2 keeps the conflicting task from being the reconciler by construction — the synthesized contract carries both sides' intent, which neither task's own contract does\",\"undo\":{\"how\":\"git branch -f orca/g dddddddddddddddddddddddddddddddddddddddd\",\"cost\":\"discard the reconciled merge commit and re-decide the conflict by hand in /tmp/copy\",\"blast_radius\":\"the single merge commit this reconciliation puts on orca/g\"},\"scope\":\"repo\",\"kind\":\"reconcile\",\"importance\":\"major\"}";

describe("reconcileDecision text (otherTaskIds: string[])", () => {
  it("is byte-identical to the old scheduler's text with one other task", () => {
    expect(JSON.stringify(reconcileDecision("r", 1, "a", ["b"], fixture, "orca/g", AT))).toBe(GOLDEN);
  });

  it("names every other task, comma-separated", () => {
    expect(reconcileDecision("r", 1, "a", ["b", "c"], fixture, "orca/g", AT).question).toContain(
      "conflicted with b, c in shared.txt",
    );
  });
});
