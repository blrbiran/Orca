// Tester #272 (4): `task retry` and `group close-run` refused a run they could not take (`run-state:*`,
// `run-closure-not-terminal`, ...) and named no way on, so an agent tried command after command. Each such refusal now
// carries `next`: whole command lines, under --json in the error body (only-add) and in human text as `orca: next:` lines.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const refused = (route: string, code: string, message: string) => ({
  [`POST groups/g-alpha/${route}`]: { status: 409, body: { error: { code, message, commandRevision: 5, evidenceIds: [], retryable: false } } },
});
async function panel(answer: Record<string, unknown>, runTaskId: string | null = "t1") {
  return fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: {
      schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "active", currentRunId: "run-1" }], runs: [{ runId: "run-1", taskId: runTaskId, phase: "work", state: "accepted", unknownUsageSettlement: { generation: 1 } }],
      proposal: { proposalVersion: 3 },
    } },
    ...answer,
  });
}
/** Both forms of one refusal: the --json body's `next` and the human `orca: next:` lines. */
async function nextOf(args: string[], answer: Record<string, unknown>, runTaskId?: string | null) {
  const p = await panel(answer, runTaskId);
  const json = await cli([...args, "--json"], p.dir);
  expect(json.code).toBe(2);
  const human = await cli(args, p.dir);
  expect(human.code).toBe(2);
  const body = json.json().body as { error: { code: string }; next?: string[] };
  const lines = human.stderr.split("\n").filter((line) => line.startsWith("orca: next: ")).map((line) => line.slice("orca: next: ".length));
  expect(lines).toEqual(body.next ?? []);
  return { body, next: body.next ?? null };
}

const RETRY = ["task", "retry", "g-alpha", "t1"];
const CLOSE = ["group", "close-run", "g-alpha", "--run", "run-1"];
const retry = (detail: string) => refused("retry-task", "task-not-retryable", `task-not-retryable:${detail}`);
const close = (code: string, detail?: string) => refused("close-run", code, detail === undefined ? code : `${code}:${detail}`);
const SETTLE = "orca task settle-usage g-alpha t1 --acknowledge <charge-remaining-grant|charge-observed-floor|release-known-zero>";

describe("task retry's refusals name the next command (#272)", () => {
  it("a run still in Orca's hands: watch it, and recovery list if it does not move", async () => {
    expect((await nextOf(RETRY, retry("run-state:accepted"))).next).toEqual(["orca run show run-1", "orca recovery list"]);
  });

  it("a settled run that is not retryable: read it", async () => {
    expect((await nextOf(RETRY, retry("run-state:settled-failed"))).next).toEqual(["orca run show run-1"]);
    expect((await nextOf(RETRY, retry("outcome:succeeded"))).next).toEqual(["orca run show run-1"]);
  });

  it("a refusal that names recovery retry gives exactly that command", async () => {
    expect((await nextOf(RETRY, retry("blocked-at:E:orca recovery retry --run run-1"))).next).toEqual(["orca recovery retry --run run-1"]);
    expect((await nextOf(RETRY, retry("outcome:none:orca recovery retry --run run-1"))).next).toEqual(["orca recovery retry --run run-1"]);
  });

  it("unknown usage is settled first; pending usage is retried again", async () => {
    expect((await nextOf(RETRY, retry("usage-unknown"))).next).toEqual([SETTLE]);
    expect((await nextOf(RETRY, retry("usage-pending"))).next).toEqual(["orca task retry g-alpha t1"]);
  });

  it("a refusal with nothing to suggest keeps its body as it was", async () => {
    const { body } = await nextOf(RETRY, refused("retry-task", "work-already-done", "work-already-done:t1"));
    expect(body).toEqual({ error: { code: "work-already-done", message: "work-already-done:t1", commandRevision: 5, evidenceIds: [], retryable: false } });
  });
});

describe("group close-run's refusals name the next command (#272)", () => {
  it("not a proved terminal failure: read the run, and retry its task", async () => {
    expect((await nextOf(CLOSE, close("run-closure-not-terminal"))).next).toEqual(["orca run show run-1", "orca task retry g-alpha t1"]);
    expect((await nextOf(CLOSE, close("run-closure-evidence"))).next).toEqual(["orca run show run-1", "orca task retry g-alpha t1"]);
  });

  it("a run recovery retry resumes gives that command", async () => {
    expect((await nextOf(CLOSE, close("run-closure-not-terminal", "orca recovery retry --run run-1"))).next).toEqual(["orca recovery retry --run run-1"]);
  });

  it("unknown usage is settled first", async () => {
    expect((await nextOf(CLOSE, close("run-closure-evidence", "usage-unknown"))).next).toEqual([SETTLE]);
  });

  it("a run with no task in the view is only read", async () => {
    expect((await nextOf(CLOSE, close("run-closure-not-terminal"), null)).next).toEqual(["orca run show run-1"]);
  });
});

// Tester follow-up K (#272 rest): three more refusals left an agent without a way on -- task decide-usage, proposal
// set-budget and task settle-usage. Each now names the command that answers it, the way task retry and close-run do.
const DECIDE = ["task", "decide-usage", "g-alpha", "t1", "--decision", "continue"];
const BUDGET = ["proposal", "set-budget", "g-alpha", "--task", "t1", "--allocation", "work", "--dimension", "tokens", "--value", "800000"];
const settle = (acknowledge: string) => ["task", "settle-usage", "g-alpha", "t1", "--acknowledge", acknowledge];
const decideRefused = (code: string, message: string) => ({
  "POST groups/g-alpha/tasks/t1/usage-pause": { status: 409, body: { error: { code, message, commandRevision: 5, evidenceIds: [], retryable: false } } },
});
const SET_LIMIT = "orca group set-limit g-alpha --limit '{\"tokens\":<higher>,...}'";

describe("task decide-usage's refusals name the next command (tester follow-up K)", () => {
  it("the group has no room for the next line: the set-limit the refusal names", async () => {
    expect((await nextOf(DECIDE, decideRefused("usage-pause-group-headroom", "usage-pause-group-headroom:900<=1000:orca group set-limit g-alpha --limit <a higher limit>"))).next)
      .toEqual(["orca group set-limit g-alpha --limit <a higher limit>"]);
  });
  it("the task is not waiting: read the group's state; no expectation: stop is the decision left", async () => {
    expect((await nextOf(DECIDE, decideRefused("usage-pause-not-waiting", "usage-pause-not-waiting:t1"))).next).toEqual(["orca group brief g-alpha"]);
    expect((await nextOf(DECIDE, decideRefused("usage-pause-no-headroom", "usage-pause-no-headroom:no-expectation"))).next).toEqual(["orca task decide-usage g-alpha t1 --decision stop"]);
  });
  it("a paused or stopped group: read it, and resume it if it was paused", async () => {
    expect((await nextOf(DECIDE, decideRefused("group-stopped", "group-stopped"))).next).toEqual(["orca group brief g-alpha", "orca group resume g-alpha"]);
  });
});

describe("proposal set-budget's refusals name the next command (tester follow-up K)", () => {
  it("the task already started: raise the group limit, or add work to the task by retrying it", async () => {
    expect((await nextOf(BUDGET, refused("proposal/edit", "grant-amendment-unsupported", "grant-amendment-unsupported"))).next)
      .toEqual([SET_LIMIT, "orca task retry g-alpha t1 --work '{\"tokens\":<n>}'"]);
  });
  it("a stale proposal: read it again", async () => {
    expect((await nextOf(BUDGET, refused("proposal/edit", "proposal-version-conflict", "proposal-version-conflict"))).next).toEqual(["orca proposal show g-alpha"]);
  });
});

describe("task settle-usage's refusals name the next command (tester follow-up K)", () => {
  const settleRefused = (code: string, detail?: string) => refused("settle-unknown-usage", code, detail === undefined ? code : `${code}:${detail}`);
  it("the wrong acknowledgement for this run: the one it takes", async () => {
    expect((await nextOf(settle("charge-observed-floor"), settleRefused("run-usage-not-settleable", "observed-floor-unknown"))).next)
      .toEqual(["orca task settle-usage g-alpha t1 --acknowledge charge-remaining-grant"]);
    expect((await nextOf(settle("release-known-zero"), settleRefused("run-usage-not-settleable", "known-zero-not-proved"))).next)
      .toEqual(["orca task settle-usage g-alpha t1 --acknowledge charge-remaining-grant"]);
    expect((await nextOf(settle("release-unmetered"), settleRefused("run-usage-not-settleable", "finite-remainder"))).next)
      .toEqual(["orca task settle-usage g-alpha t1 --acknowledge charge-remaining-grant"]);
    expect((await nextOf(settle("charge-remaining-grant"), settleRefused("run-usage-not-settleable", "unlimited-remainder"))).next)
      .toEqual(["orca task settle-usage g-alpha t1 --acknowledge release-unmetered --as-person"]);
  });
  it("usage still arriving: the same settle again; a run this cannot settle: read it", async () => {
    expect((await nextOf(settle("charge-remaining-grant"), settleRefused("run-usage-pending"))).next)
      .toEqual(["orca task settle-usage g-alpha t1 --acknowledge charge-remaining-grant"]);
    expect((await nextOf(settle("charge-remaining-grant"), settleRefused("run-usage-not-settleable", "current-failed-task"))).next).toEqual(["orca run show run-1"]);
    expect((await nextOf(settle("charge-remaining-grant"), settleRefused("run-usage-settled"))).next).toEqual(["orca run show run-1"]);
  });
});
