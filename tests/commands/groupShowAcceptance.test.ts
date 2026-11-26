// Tester follow-up E §5 (#241): `orca group show` names the group's acceptance on its final tip. A failed one is a problem,
// `group-acceptance-failed:<command>`, with its output tail and the two commands that answer it (recheck, waive).
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const TIP = "c".repeat(40);
const SUMMARY = { groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 5 };

async function show(acceptance: unknown): Promise<string[]> {
  const summary = { ...SUMMARY, ...(acceptance === undefined ? {} : { acceptance }) };
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [summary] } },
    "GET groups/g-alpha": { status: 200, body: { schema: "orca-control-group-v1", summary, workItems: [], runs: [] } },
  });
  const out = await cli(["group", "show", "g-alpha"], p.dir);
  expect(out.code).toBe(0);
  return out.stdout.split("\n");
}

describe("group show names the group acceptance (tester follow-up E §5)", () => {
  it("a failed acceptance: the problem, the tip, the output tail, and the two ways out", async () => {
    const lines = await show({ tip: TIP, result: "failed", commands: [{ command: "npm ci", exit: "0", ms: 1 }, { command: "npm test", exit: "1", ms: 1 }],
      tail: "FAIL a.test.ts\n2 failed", at: 1, problem: "group-acceptance-failed:npm test" });
    const at = lines.indexOf("problem: group-acceptance-failed:npm test (exited 1 on orca/g-alpha at cccccccccccc)");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 5)).toEqual([
      "  FAIL a.test.ts", "  2 failed",
      "next: orca group recheck g-alpha  (a flaky check: run it again on this tip)",
      "  or: orca group waive-acceptance g-alpha --note '<why>'  (a person accepts this tip anyway)",
    ]);
  });

  it("a pending test change shows the paths and the tip-bound person command", async () => {
    const lines = await show({ tip: TIP, result: "test-change-pending", commands: [], at: 1,
      testChanges: { base: "b".repeat(40), paths: ["tests/a.test.ts"], weakeningSignals: [], digest: "d".repeat(64), pendingResult: "passed" },
      problem: "test-change-pending" });
    expect(lines).toContain(`problem: test-change-pending on orca/g-alpha at ${TIP.slice(0, 12)}`);
    expect(lines).toContain("  changed test paths: tests/a.test.ts");
    expect(lines).toContain("next: orca group accept-test-changes g-alpha --note '<why>' --tip <tip> --digest <digest>  (a person approves these exact test paths and tip)");
    expect(lines).toContain("  or restore the paths from base bbbbbbbbbbbb on orca/g-alpha, commit the restored tip, and Orca checks it again");
  });

  it("names a relative required-check failure instead of claiming the configured full suite was red", async () => {
    const command = "npm run typecheck", base = "b".repeat(40);
    const identity = { key: "k".repeat(64), file: "tests/check.test.ts", testPath: ["same failure"], diagnosticHash: "d".repeat(64) };
    const lines = await show({ tip: TIP, result: "passed-relative", commands: [{ command, exit: "1", ms: 2_400 }], at: 1,
      fullSuite: { command: "npm test", suggestion: null, exits: ["0"], flaky: false },
      identityComparisons: [{ command, base, setupDigest: "s".repeat(64), reporter: "node-test-tap-v1", baselineSource: "collected",
        tipAttempts: [{ exit: "1", failureIdentityStatus: "complete", failureIdentities: [identity] }], baseIdentities: [identity], tipIdentities: [identity] }] });
    expect(lines).toContain(`acceptance: passed relative to the base ${base.slice(0, 12)} on ${TIP.slice(0, 12)} (1 command, 2 s): required check \`${command}\` matched a known failure identity in the collected baseline ${base.slice(0, 12)}`);
    expect(lines[0]).not.toContain("npm test was already red there");
  });

  it("a passed, not-needed or waived acceptance: one line", async () => {
    expect(await show({ tip: TIP, result: "passed", commands: [{ command: "npm test", exit: "0", ms: 2_400 }], at: 1 }))
      .toContain("acceptance: passed on cccccccccccc (1 command, 2 s)");
    // Spec 2026-11-16: the full suite was already red at the base, so the record names both tips.
    expect(await show({ tip: TIP, result: "passed-relative", commands: [{ command: "npm test", exit: "1", ms: 2_400 }], at: 1,
      fullSuite: { command: "npm test", suggestion: null, exits: ["1", "0"], flaky: true, baseline: { tip: "b".repeat(40), exits: ["1"] } } }))
      .toContain("acceptance: passed relative to the base bbbbbbbbbbbb on cccccccccccc (1 command, 2 s): npm test was already red there");
    expect(await show({ tip: TIP, result: "not-needed", why: "single-landing", commands: [], at: 1 })).toContain("acceptance: not needed (single-landing)");
    expect(await show({ tip: null, result: "not-run", why: "multi-repo", commands: [], at: 1 })).toContain("acceptance: not run (multi-repo)");
    // Tester #278: a work branch that no longer exists is named, with what checks it again.
    expect(await show({ tip: null, result: "not-run", why: "work-branch-missing", landings: 2, commands: [], at: 1 }))
      .toContain("acceptance: not run (work-branch-missing: orca/g-alpha does not exist; checked again after a new landing)");
    expect(await show({ tip: TIP, result: "waived", commands: [{ command: "npm test", exit: "1", ms: 1 }], at: 1, waived: { by: "user:ana", note: "known flake", at: 2 } }))
      .toContain("acceptance: waived on cccccccccccc by user:ana: known flake");
  });

  it("a group with no record prints no acceptance line", async () => {
    expect((await show(undefined)).some((line) => line.startsWith("acceptance:") || line.startsWith("problem: group-acceptance"))).toBe(false);
  });
});
