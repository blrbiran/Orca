// Tester #272: an agent polling a group paid for every run's whole entry (`group show --json`, ~150 KB of runs on 8 tasks
// / 29 runs). `--runs summary` keeps one compact entry per run; the default keeps the full view byte for byte.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

/** A run entry shaped like the panel's (runViewSchema), with the bulky parts a real one carries (skills lock, settlement). */
function fullRun(n: number, taskId: string | null): Record<string, unknown> {
  const amount = { tokens: 1_000_000 + n, activeMs: 600_000, attempts: 1, sessions: 1 };
  return {
    runId: `run-${String(n).padStart(2, "0")}`, taskId, estimateId: null, generation: 1, state: n % 3 === 0 ? "blocked" : "landed", phase: "work",
    claimOrdinal: n, providerAttemptOrdinal: 1, profile: { profileId: "work-1", profileHash: "f".repeat(64) },
    agent: { installation: "codex-main", model: "gpt-5" }, used: amount, overGrant: [], grant: amount, tokenRemainingStatus: "known", remaining: amount,
    failureCode: null, blockedReason: n % 3 === 0 ? "empty-result" : null, stopReason: null, outcome: n % 3 === 0 ? "failed" : "succeeded", failureCause: null,
    continuable: false, evidenceIds: Array.from({ length: 8 }, (_, i) => `ev-${n}-${i}`),
    git: { workspaceMode: "worktree", base: "a".repeat(40), landedCommit: "b".repeat(40) },
    skills: { profile: "default", lock: Array.from({ length: 20 }, (_, i) => ({ name: `skill-${i}`, source: { name: "src", type: "git", url: "https://example.invalid/skills.git", branch: "main" }, resolved_commit: "c".repeat(40), content_md5: "d".repeat(32) })) },
    startedAt: 1_700_000_000_000 + n, endedAt: 1_700_000_100_000 + n, lastActivityAt: 1_700_000_100_000 + n, createdOrdinal: n,
  };
}

const RUNS = Array.from({ length: 29 }, (_, i) => fullRun(i + 1, `t${(i % 8) + 1}`));

describe("group show --runs summary (#272)", () => {
  it("replaces each run's whole entry with its compact one and leaves the rest of the view as it was", async () => {
    const w = await world();
    const view = { ...w.state.view, runs: RUNS };
    w.state.view = view as never;
    const full = await cli(["group", "show", "g-alpha", "--json"], w.dir);
    const summary = await cli(["group", "show", "g-alpha", "--runs", "summary", "--json"], w.dir);
    expect([full.code, summary.code], summary.stdout + summary.stderr).toEqual([0, 0]);
    // The default is the panel's body verbatim.
    expect(full.json().body).toEqual(view);
    const body = summary.json().body as Record<string, unknown> & { runs: Array<Record<string, unknown>> };
    expect(body.runs).toEqual(RUNS.map((run) => ({ runId: run.runId, taskId: run.taskId, phase: "work", state: run.state, outcome: run.outcome, blockedReason: run.blockedReason, used: run.used })));
    const { runs: _a, ...rest } = body;
    const { runs: _b, ...viewRest } = view;
    expect(rest).toEqual(viewRest);
    // Mutation "summary returns the whole entry" -> red here and above.
    expect(Buffer.byteLength(summary.stdout)).toBeLessThan(Buffer.byteLength(full.stdout) / 4);
  });

  it("a field the run does not carry stays absent, not null", async () => {
    const w = await world();
    const summary = await cli(["group", "show", "g-alpha", "--runs", "summary", "--json"], w.dir);
    expect(summary.json().body.runs).toEqual([{ runId: "run-1", taskId: "t1", state: "blocked" }]);
  });

  it("--runs full is the default; another value is refused naming the valid ones, before the panel is read", async () => {
    const w = await world();
    expect((await cli(["group", "show", "g-alpha", "--runs", "full", "--json"], w.dir)).json().body).toEqual((await cli(["group", "show", "g-alpha", "--json"], w.dir)).json().body);
    const before = w.requests.length;
    const out = await cli(["group", "show", "g-alpha", "--runs", "none", "--json"], w.dir);
    expect(out.code).toBe(1);
    expect(out.json().body.error).toMatchObject({ code: "control-cli-argument-invalid", message: '--runs wants full or summary, not "none"' });
    expect(w.requests.slice(before).map((r) => r.path)).not.toContain("groups/g-alpha");
  });
});
