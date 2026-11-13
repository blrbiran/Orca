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
      workItems: [{ taskId: "t1", status: "active", currentRunId: "run-1" }], runs: [{ runId: "run-1", taskId: runTaskId, phase: "work", state: "accepted" }],
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
