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

  it("a passed, not-needed or waived acceptance: one line", async () => {
    expect(await show({ tip: TIP, result: "passed", commands: [{ command: "npm test", exit: "0", ms: 2_400 }], at: 1 }))
      .toContain("acceptance: passed on cccccccccccc (1 command, 2 s)");
    expect(await show({ tip: TIP, result: "not-needed", why: "single-landing", commands: [], at: 1 })).toContain("acceptance: not needed (single-landing)");
    expect(await show({ tip: null, result: "not-run", why: "multi-repo", commands: [], at: 1 })).toContain("acceptance: not run (multi-repo)");
    expect(await show({ tip: TIP, result: "waived", commands: [{ command: "npm test", exit: "1", ms: 1 }], at: 1, waived: { by: "user:ana", note: "known flake", at: 2 } }))
      .toContain("acceptance: waived on cccccccccccc by user:ana: known flake");
  });

  it("a group with no record prints no acceptance line", async () => {
    expect((await show(undefined)).some((line) => line.startsWith("acceptance:") || line.startsWith("problem: group-acceptance"))).toBe(false);
  });
});
