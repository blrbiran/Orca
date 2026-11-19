import { describe, expect, it } from "vitest";
import { failureNamesLine, parseFailureSummary } from "../../src/control/failureNames.js";
import { buildReviewPrompt, ORCA_RUNTIME_FILES_NOTE, reviewFacts } from "../../src/control/requirementReview.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester #391 (human ruling: 「统一到验收的『base 也红』口径，再把两侧 not ok 行的摘要交给审阅员作参考，不让它因为名字
 * 对不上就判 cannot-judge」): the review facts name the failing tests on the tip and at the group's base when the
 * full suite is red or flaky, and the prompt says a relative pass alone decides such a criterion -- the names are a
 * reference, never a demand that both runs failed the same tests. Tester #392: an off-plan write is information only.
 */
const TIP = "4".repeat(40), BASE = "b".repeat(40);
const TIP_TAIL = ["not ok 1 - login rejects a bad password", "not ok 2 - signup validates email", "# tests 5", "# pass 3", "# fail 2", "# duration_ms 12.5"].join("\n");
const BASE_TAIL = ["not ok 3 - login rejects a bad password", "# tests 5", "# pass 4", "# fail 1", "# duration_ms 11"].join("\n");
const acceptance = (over: Record<string, unknown> = {}, suite: Record<string, unknown> = {}) => ({
  tip: TIP, result: "passed-relative", at: 1, tail: TIP_TAIL, commands: [],
  fullSuite: { command: "npm test", suggestion: null, exits: ["1", "1"], flaky: false, baseline: { tip: BASE, exits: ["1", "1"], tail: BASE_TAIL }, ...suite },
  ...over,
});

describe("the node:test output reader (#391)", () => {
  it("reads TAP `not ok` lines and the summary counts", () => {
    expect(parseFailureSummary(TIP_TAIL)).toEqual({ failures: ["login rejects a bad password", "signup validates email"], failCount: 2, passCount: 3, tests: 5, durationMs: 12.5 });
  });

  it("reads the spec reporter's ✖ lines and ℹ summary", () => {
    const text = ["✖ failing tests:", "", "✖ login rejects a bad password (1.2ms)", "ℹ tests 5", "ℹ pass 4", "ℹ fail 1", "ℹ duration_ms 10"].join("\n");
    expect(parseFailureSummary(text)).toEqual({ failures: ["login rejects a bad password"], failCount: 1, passCount: 4, tests: 5, durationMs: 10 });
  });

  it("says the identities are unavailable when the tail holds only the summary", () => {
    const line = failureNamesLine("# tests 5\n# fail 2\n# duration_ms 12");
    // mutation: fall back to a count-only sentence that claims names -> red
    expect(line).toBe("the recorded output names no failing test (its summary reports 2 failing; the last 2 KB holds no \"not ok\" line)");
    expect(failureNamesLine(undefined)).toContain("no output was recorded");
  });
});

describe("review facts carry both sides' failing names (#391)", () => {
  it("tip and base, when the full suite is red at both", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const facts = await reviewFacts(t.repo, { acceptance: acceptance() }, TIP, t.h.store, "g");
      expect(facts).toContain("  failing tests on this tip: 2 failing tests: login rejects a bad password; signup validates email");
      expect(facts).toContain("  failing tests at the group's base: 1 failing test: login rejects a bad password");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("the tip's names for a red suite even when no base run is recorded (not only passed-relative)", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const facts = await reviewFacts(t.repo, { acceptance: acceptance({ result: "failed" }, { baseline: undefined }) }, TIP, t.h.store, "g");
      expect(facts).toContain("  failing tests on this tip: 2 failing tests: login rejects a bad password; signup validates email");
      // mutation: emit a base line without a base run -> red
      expect(facts.some((line) => line.startsWith("  failing tests at the group's base:"))).toBe(false);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a flaky suite with no recorded tip tail says the identities are unavailable, not that nothing failed", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const body = { acceptance: { tip: TIP, result: "passed", at: 1, commands: [],
        fullSuite: { command: "npm test", suggestion: null, exits: ["1", "0"], flaky: true } } };
      const facts = await reviewFacts(t.repo, body, TIP, t.h.store, "g");
      expect(facts).toContain("  failing tests on this tip: the recorded output names no failing test (no output was recorded)");
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("a repository group's review leaves out Orca's own runtime files (#382)", () => {
  it("the tip adds .decisions/run-x.jsonl and a doc; the changed files show only the doc", async () => {
    const w = await reviewWorld({ tasks: [{ taskId: "a" }, { taskId: "b" }],
      harness: { files: (id): Record<string, string | null> => (id === "a" ? { "doc.md": "# doc\n", ".decisions/run-x.jsonl": "{}\n", ".orca/requirements/runtime.md": "doc\n" } : { "b.txt": "b\n" }) } });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      // The files are on the group's branch: the exclusion is what keeps them out of the review, so this is not vacuous.
      const branch = git(w.t.repo, "ls-tree", "-r", "--name-only", "refs/heads/orca/g");
      expect(branch).toContain(".decisions/run-x.jsonl");
      expect(branch).toContain(".orca/requirements/runtime.md");
      const prompt = w.calls[0]!.prompt;
      // mutation: pass `[]` (or only the ledger) for a repository group -> these files are listed, red
      expect(prompt).toContain("- A doc.md");
      expect(prompt).toContain("- A b.txt");
      // The facts above still mention an off-plan write by name (information, #392); the change list and diff do not.
      const changes = prompt.slice(prompt.indexOf("Files the group changed"));
      expect(changes).not.toContain(".decisions/run-x.jsonl");
      expect(changes).not.toContain(".orca/requirements/runtime.md");
      // Mutation: drop ORCA_RUNTIME_FILES_NOTE from buildReviewPrompt -> red.
      expect(prompt).toContain(ORCA_RUNTIME_FILES_NOTE);
    } finally { await w.t.h.dispose(); }
  }, 300000);
});

describe("the prompt's rules for relative pass and off-plan writes (#391, #392)", () => {
  const prompt = (over: Record<string, unknown> = {}) => buildReviewPrompt({ idea: "i", statement: "s",
    criteria: [{ id: "AC13", text: "npm test exits 0" }], openBranches: [], changedFiles: [{ path: "src/login.ts", status: "M", bytes: 10, sha256: "e".repeat(64), binary: false }],
    diff: "diff --git a/src/login.ts b/src/login.ts", truncated: false, ...over });

  it("a relative pass alone decides a criterion about the check; the names need not match", () => {
    const text = prompt({ acceptanceBaseline: { command: "npm test", tipExits: ["1", "1"], baseExits: ["1", "1"], tipTail: TIP_TAIL, baseTail: BASE_TAIL } });
    // mutation: drop the relative-pass rule line -> these are absent
    expect(text).toContain("a relative pass alone decides it, without the failing tests' names matching between the tip and the base");
    expect(text).toContain("do not answer cannot-judge for that reason alone when acceptance has decided the check");
    expect(text).toContain("Those failures are the last 2 KB of each output only");
    expect(text).toContain("signup validates email");
  });

  it("a red suite with no base run says so, and still shows the tip's failing names", () => {
    const text = prompt({ acceptanceBaseline: { command: "npm test", tipExits: ["1", "1"], tipTail: TIP_TAIL } });
    expect(text).toContain("No run of it at the group's base is recorded, so the relative-pass rule below does not apply to it");
    expect(text).toContain("login rejects a bad password");
  });

  it("an off-plan write superseded by the final content is information, never a failed criterion (#392)", () => {
    const text = prompt({ facts: ["Off-plan writes by a: docs/old.md"] });
    // mutation: drop the off-plan rule line -> these are absent
    expect(text).toContain("An off-plan write (a line under \"What Orca recorded beyond the diff\") is information, not a failed criterion");
    expect(text).toContain("judge ownership from the final changed files and diff above only");
    expect(text).toContain("A write that the owning task's final content replaced is not part of the delivery");
  });
});
