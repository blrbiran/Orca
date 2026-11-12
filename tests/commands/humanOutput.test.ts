// Session 3cfc2e73, issue #140: the human formatter printed `key: undefined` and hid why a run failed inside one
// 160-character line. The shortening itself stays (orca-control skill Rule 7); absent fields are left out and run show
// gives the failure cause its own whole lines.
import { describe, expect, it } from "vitest";
import { text } from "../../src/commands/domains/format.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const DETAIL = `codex-result-invalid: /runs/run-1/attempt-1/execute-result.json ${"x".repeat(240)} END`;
const RUN = {
  runId: "run-1", taskId: "t1", state: "settled-failed", stopReason: "Error: codex-result-invalid",
  failureCause: { cause: "codex-result-invalid", phase: "execute", retries: 2, detail: DETAIL },
  grant: { work: { tokens: 1_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 }, handoff: { tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 } },
};
const GROUP = {
  schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
  workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [RUN],
};
const ENTRY = "pl-0123456789abcdef";
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };

describe("human output (#140)", () => {
  it("names active execution beside a stored ready group in list and show (dogfood D9)", async () => {
    const summary = { groupId: "g-alpha", repoId: "repo-1", state: "ready", commandRevision: 5, goal: "Ship", counts: { running: 1 } };
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [summary] } },
      "GET groups/g-alpha": { status: 200, body: { ...GROUP, summary, runs: [{ ...RUN, state: "running" }] } },
    });
    const listed = await cli(["group", "list"], p.dir);
    const shown = await cli(["group", "show", "g-alpha"], p.dir);
    expect(listed.stdout).toContain("ready · running 1 task");
    expect(shown.stdout).toContain("execution: 1 task run in progress");
  });

  it("text() leaves out an undefined field and keeps null ones", () => {
    expect(text({ a: 1, gone: undefined, empty: null })).toBe("a: 1\nempty: null");
  });

  it("run show prints state, stopReason, the failure cause with its phase, and the whole detail on their own lines", async () => {
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: GROUP },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines).toContain("state: settled-failed");
    expect(lines).toContain("stopReason: Error: codex-result-invalid");
    expect(lines).toContain("failureCause: codex-result-invalid (phase execute), 2 retries");
    expect(lines).toContain(`detail: ${DETAIL}`);
    // The one-line run summary keeps its deliberate shortening.
    expect(lines.find((line) => line.startsWith("run "))!.endsWith("…")).toBe(true);
  });

  it("run show of a run with no failure cause prints no failureCause or detail line", async () => {
    const { failureCause: _gone, stopReason: _none, ...plain } = RUN;
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs: [{ ...plain, state: "running" }] } },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.stdout).toContain("state: running");
    expect(out.stdout).not.toMatch(/failureCause|detail:|stopReason|undefined/);
  });

  it("run show lists each observed missed path and names the explicit retry flag", async () => {
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs: [{ ...RUN, state: "blocked", outcome: "blocked_waiting_human", pathPolicyMisses: [{ repoKey: null, path: "tests/regression.test.ts" }, { repoKey: "docs", path: "notes/fix.md" }] }] } },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("observed path misses:\n  tests/regression.test.ts\n  docs:notes/fix.md");
    expect(out.stdout).toContain("task retry g-alpha t1 --allow-observed-paths");
  });

  // Tester #183 + D17: `run results` printed a truncated dump, so a rejected verification was invisible, and `availability:
  // available` said nothing about whether the saved result could still be recovered.
  const OUTPUT = (status: string) => ({ outputId: `o-${status}`, path: `out/${status}.md`, label: status, origin: "reported", status, byteLength: 10 });
  const RESULTS = {
    schema: "orca-run-results-v1", runId: "run-1", groupId: "g-alpha", taskId: "t1", availability: "available", currentAttempt: 2,
    source: { status: "available", reason: null },
    attempts: [
      { attempt: 1, current: false, execution: "partial", verification: "not-run", outputs: [] },
      { attempt: 2, current: true, execution: "complete", verification: "failed", outputs: [OUTPUT("available"), OUTPUT("deleted")] },
    ],
  };
  const resultsPanel = (eligibility: { status: number; body: unknown }) => fakePanel({
    "GET runs/run-1/results": { status: 200, body: RESULTS }, "GET runs/run-1/saved-result-eligibility": eligibility,
  });

  it("run results prints one line per attempt with its verification, and why the saved result is not recoverable", async () => {
    const p = await resultsPanel({ status: 200, body: { status: "unavailable", reason: "saved-result-verification-failed" } });
    const out = await cli(["run", "results", "run-1"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines).toContain("attempt 1: execution partial, verification not-run, outputs 0");
    expect(lines).toContain("attempt 2 (current): execution complete, verification failed, outputs 2 (1 available, 1 deleted)");
    expect(lines).toContain("recoverable: no (saved-result-verification-failed)");
    expect(out.stdout).not.toContain("next:");
  });

  it("run results names the command that recovers an eligible saved result", async () => {
    const p = await resultsPanel({ status: 200, body: { status: "eligible", authorityKind: "execution-without-final-v1", verificationOnly: true } });
    const out = await cli(["run", "results", "run-1"], p.dir);
    const lines = out.stdout.split("\n");
    expect(lines).toContain("recoverable: yes");
    expect(lines).toContain("next: orca task verify-saved-result g-alpha t1");
  });

  it("run results says recoverability is unknown when the eligibility read is refused, and still prints the attempts", async () => {
    const p = await resultsPanel({ status: 404, body: { error: { code: "run-not-found", message: "No control run was found.", retryable: false } } });
    const out = await cli(["run", "results", "run-1"], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout.split("\n")).toContain("recoverable: unknown (run-not-found)");
    expect(out.stdout).toContain("verification failed");
  });

  // Ruling (2026-11-12, tester follow-up F): #183 asks --json for the recoverability too, so it now reads the eligibility
  // and adds `recoverability` after the results body's own fields (only-add); the body's bytes before it are unchanged.
  it("run results --json prints the results body byte for byte, with recoverability added after it", async () => {
    const p = await resultsPanel({ status: 200, body: { status: "unavailable", reason: "saved-result-source-stale" } });
    const out = await cli(["run", "results", "run-1", "--json"], p.dir);
    const recoverability = { recoverable: "no", reason: "saved-result-source-stale", next: null };
    expect(out.stdout).toBe(`${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: { ...RESULTS, recoverability } })}\n`);
    expect(p.requests.map((r) => r.path)).toEqual(["runs/run-1/results", "runs/run-1/saved-result-eligibility"]);
  });

  // Tester follow-up F §4 (#183): a run with no capsule had `results: available` printed above `recoverable: no
  // (saved-result-source-stale)`. The availability is the task's explanation and outputs, and the line says so.
  it("run results names the task's explanation and outputs as what is available, apart from recoverability", async () => {
    const p = await resultsPanel({ status: 200, body: { status: "unavailable", reason: "saved-result-source-stale" } });
    const out = await cli(["run", "results", "run-1"], p.dir);
    const lines = out.stdout.split("\n");
    expect(lines[1]).toBe("task explanation and outputs: available");
    expect(lines.filter((line) => line.startsWith("results:"))).toEqual([]);
    expect(lines).toContain("recoverable: no (saved-result-source-stale)");
  });

  it("run results --json says how a recoverable saved result is recovered, and an unreadable eligibility is unknown", async () => {
    const yes = await resultsPanel({ status: 200, body: { status: "eligible", authorityKind: "execution-without-final-v1", verificationOnly: true } });
    expect((await cli(["run", "results", "run-1", "--json"], yes.dir)).json()).toMatchObject({ body: { recoverability: { recoverable: "yes", reason: null, next: "orca task verify-saved-result g-alpha t1" } } });
    const unknown = await resultsPanel({ status: 404, body: { error: { code: "run-not-found", message: "No control run was found.", retryable: false } } });
    const out = await cli(["run", "results", "run-1", "--json"], unknown.dir);
    expect(out.code).toBe(0);
    expect(out.json()).toMatchObject({ body: { recoverability: { recoverable: "unknown", reason: "run-not-found", next: null } } });
  });

  // Tester D19: nothing said which agent and model a run actually ran on; `agent list` shows only defaults.
  it("run show names the agent and model the run ran on", async () => {
    const p = await fakePanel({
      "GET summary": SUMMARY,
      "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs: [{ ...RUN, agent: { installation: "codex", model: "gpt-5.1-codex" } }] } },
      "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
      "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
    });
    const out = await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir);
    expect(out.stdout.split("\n")).toContain("agent: codex, model gpt-5.1-codex");
  });

  // #122: a third-party provider behind codex answers --output-schema with a 400 about the response format; the way out is
  // ccloop's opt-in prompt mode on that installation, which ccloop never picks by itself. Mutation (seen red, Rule 9): the
  // shared predicate always false -> the hint line is gone.
  it("run show hints at structuredOutput prompt when the provider refused the output schema, and only then", async () => {
    const refused = "codex-exit-error: unexpected status 400 Bad Request: {\"error\":{\"message\":\"Invalid parameter: 'text.format' is not supported\"}}";
    const show = async (detail: string) => {
      const p = await fakePanel({
        "GET summary": SUMMARY,
        "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs: [{ ...RUN, agent: { installation: "codex-proxy", model: "m" }, failureCause: { ...RUN.failureCause, detail } }] } },
        "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
        "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
      });
      return (await cli(["run", "show", "run-1", "--group", "g-alpha"], p.dir)).stdout.split("\n");
    };
    expect(await show(refused)).toContain("hint: the provider refused the structured-output request (--output-schema). Set \"structuredOutput\": \"prompt\" on the codex installation codex-proxy in the agents table; ccloop never chooses it on its own.");
    expect((await show(DETAIL)).filter((line) => line.startsWith("hint:"))).toEqual([]);
  });

  it("agent list labels each installation's model as its default", async () => {
    const p = await fakePanel({ "GET agents": { status: 200, body: { schema: "orca-agents-view-v1", installations: [
      { id: "claude", kind: "claude", defaults: { model: "opus", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "2.1.0" },
      { id: "codex", kind: "codex", defaults: { model: "gpt-5.1-codex", contextWindow: 200000 }, contextOptions: [200000], version: "0.60.0" },
    ] } } });
    const out = await cli(["agent", "list"], p.dir);
    expect(out.stdout.split("\n")).toEqual(["claude  claude  2.1.0  default model opus", "codex  codex  0.60.0  default model gpt-5.1-codex", ""]);
  });

  // Tester #189: `decision list` printed a truncated dump, so the pendingId an approve or reject needs could not be read off it.
  const DECISIONS = {
    schema: "orca-group-decisions-v1", groupId: "g-alpha", projectKey: "proj", pendingCount: 1, flaggedCount: 0, groupFlags: [],
    tasks: [{ taskId: "t1", runs: [{ runId: "run-1", settled: true, reported: "array",
      decisions: [{ id: "run-1/agent-0", where: { kind: "landed" }, question: "Which parser?", chose: "the strict one", kind: "design", scope: "local", importance: "major", flag: null }],
      pending: [
        { pendingId: "p-1", reason: "undo-missing", question: "Drop the cache?", chose: "yes", undoHow: null, state: "pending", importance: "major" },
        { pendingId: "p-2", reason: "undo-missing", question: "Rename the flag?", chose: "no", undoHow: null, state: "approved", importance: "minor" },
      ],
      unlanded: [] }, { runId: "run-2", settled: true, reported: "array", decisions: [], pending: [],
      unlanded: [{ entryIndex: 0, question: "Keep the old route?", chose: "yes", importance: "major" }] }] }],
  };

  it("decision list prints each pending decision's id and the exact approve and reject commands", async () => {
    const p = await fakePanel({ "GET summary": SUMMARY, "GET groups/g-alpha/decisions": { status: 200, body: DECISIONS } });
    const out = await cli(["decision", "list", "g-alpha"], p.dir);
    expect(out.code).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines).toContain("pending p-1 (run-1, major, undo-missing): Drop the cache? -> yes");
    expect(lines).toContain("  approve: orca decision approve g-alpha p-1 --undo-how '<an executable undo>'");
    expect(lines).toContain("  reject:  orca decision reject g-alpha p-1 [--because '<why>']");
    // An entry a person already answered names its state and offers no command.
    expect(lines).toContain("pending p-2 (run-1, minor, undo-missing): Rename the flag? -> no [approved]");
    expect(out.stdout).not.toContain("approve g-alpha p-2");
    expect(lines).toContain("unlanded run-2 #0 (major): Keep the old route? -> yes (never landed; no pending id to approve)");
    expect(lines).toContain("landed run-1/agent-0 (major): Which parser? -> the strict one");
  });

  it("plan show without --version prints no `document: undefined`", async () => {
    const p = await fakePanel({ [`GET plan-library/${ENTRY}`]: { status: 200, body: { entryId: ENTRY, projectId: "repo-1", head: null, versions: [] } } });
    const out = await cli(["plan", "show", ENTRY], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`entryId: ${ENTRY}`);
    expect(out.stdout).not.toContain("undefined");
  });
});

// Tester follow-up F §4: a task blocked because its attempt changed nothing printed only `empty-result` deep in a dump.
describe("empty-result in words (tester follow-up F §4)", () => {
  const EMPTY_RUN = { runId: "run-1", taskId: "t1", state: "settled-recoverable", outcome: "succeeded", blockedReason: "empty-result" };
  const HEAD = "task t1: empty-result: run run-1 finished without changing any file, so there was nothing to land and the task stays blocked";
  const emptyPanel = (runs: unknown[]) => fakePanel({
    "GET summary": SUMMARY,
    "GET groups/g-alpha": { status: 200, body: { ...GROUP, runs } },
    "GET runs/run-1/activity": { status: 200, body: { schema: "orca-run-activity-v1", runId: "run-1", entries: [] } },
    "GET runs/run-1/evidence": { status: 200, body: { schema: "orca-run-evidence-v1", runId: "run-1", entries: [] } },
  });

  it("group show, task show and run show say what happened and what can be done", async () => {
    const p = await emptyPanel([EMPTY_RUN]);
    for (const argv of [["group", "show", "g-alpha"], ["task", "show", "g-alpha", "t1"], ["run", "show", "run-1", "--group", "g-alpha"]]) {
      const out = await cli(argv, p.dir);
      expect(out.code, argv.join(" ")).toBe(0);
      const lines = out.stdout.split("\n");
      // mutation: drop emptyResultLines from that formatter -> red for that command
      expect(lines, argv.join(" ")).toContain(HEAD);
      // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — §1: the empty-result advice no longer points at
      // commandChecksDecideGoal; a provable no change completes or is judged, so empty-result is what is not one.
      expect(lines).toContain("  this attempt is not a provable no change (its tree differs from its base, or it is a criteria-review verdict), so it cannot complete in this group and orca task reopen does not apply");
      expect(out.stdout).not.toContain("commandChecksDecideGoal");
    }
  });

  it("names nothing for another blocked reason, or for an empty-result run that is no longer the task's current run", async () => {
    const other = await emptyPanel([{ ...EMPTY_RUN, blockedReason: "settle-incomplete" }]);
    expect((await cli(["group", "show", "g-alpha"], other.dir)).stdout).not.toContain("finished without changing any file");
    const old = await emptyPanel([{ ...EMPTY_RUN, runId: "run-0" }]);
    expect((await cli(["group", "show", "g-alpha"], old.dir)).stdout).not.toContain("finished without changing any file");
    expect((await cli(["task", "show", "g-alpha", "t1"], old.dir)).stdout).not.toContain("finished without changing any file");
  });

  it("--json is unchanged: no added field", async () => {
    const p = await emptyPanel([EMPTY_RUN]);
    expect((await cli(["group", "show", "g-alpha", "--json"], p.dir)).stdout).not.toContain("finished without changing");
  });
});
