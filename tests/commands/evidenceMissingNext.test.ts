// Tester #469: a refusal whose detail names evidence gone from disk (artifact-data-missing:<ids>) names the exit that works:
// a closed run cannot be re-checked, so its group is archived; an open run cannot be closed, so its task is retried.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const refused = (route: string, code: string, message: string) => ({
  [`POST groups/g-alpha/${route}`]: { status: 409, body: { error: { code, message, commandRevision: 5, evidenceIds: [], retryable: false } } },
});
async function panel(answer: Record<string, unknown>) {
  return fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: {
      schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [{ runId: "run-1", taskId: "t1", phase: "work", state: "settled-failed" }],
      proposal: { proposalVersion: 3 },
    } },
    ...answer,
  });
}
async function refusal(args: string[], answer: Record<string, unknown>) {
  const p = await panel(answer);
  const json = await cli([...args, "--json"], p.dir);
  expect(json.code).toBe(2);
  const human = await cli(args, p.dir);
  return { next: (json.json().body as { next?: string[] }).next ?? null, stderr: human.stderr };
}
const CLOSE = ["group", "close-run", "g-alpha", "--run", "run-1"];
const RETRY = ["task", "retry", "g-alpha", "t1"];
const ID = "report-run-1-abc";

describe("refusals over evidence gone from disk name the exit (#469)", () => {
  // RED on main: run-closure-invalid named no next and its hint said nothing of missing evidence.
  // Mutation: drop closeRunNext's artifact-data-missing branch -> next null, red.
  it("close-run of a closed run whose evidence is gone: archive the group", async () => {
    const answer = await refusal(CLOSE, refused("close-run", "run-closure-invalid", `run-closure-invalid:artifact-data-missing:${ID}`));
    expect(answer.next).toEqual(["orca group archive g-alpha"]);
    expect(answer.stderr).toContain("missing on disk");
  });

  // Mutation: drop the hint's artifact-data-missing branch -> the "no proved terminal failure" hint, red.
  it("close-run of an open run whose evidence is gone: the hint says so; next is the task's retry", async () => {
    const answer = await refusal(CLOSE, refused("close-run", "run-closure-evidence", `run-closure-evidence:artifact-data-missing:${ID}`));
    expect(answer.next).toEqual(["orca run show run-1", "orca task retry g-alpha t1"]);
    expect(answer.stderr).toContain("missing on disk, so it cannot be closed; retry the task instead");
  });

  // Mutation: drop retryNext's artifact-data-missing branch -> next null, red.
  it("task retry resting on a closed run whose evidence is gone: archive the group", async () => {
    const answer = await refusal(RETRY, refused("retry-task", "recovery-blocked", `recovery-blocked:retry-closure-invalid:artifact-data-missing:${ID}`));
    expect(answer.next).toEqual(["orca group archive g-alpha"]);
  });
});
