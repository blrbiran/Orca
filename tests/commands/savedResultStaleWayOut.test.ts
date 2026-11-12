// Tester #206: `task verify-saved-result` refused `saved-result-source-stale` and named no way on, although a person can
// land the attempt with `task accept-attempt` (#227). The refusal now names that verb -- only when the view says it could
// take the run (acceptAttempt.ts preconditions), and with `group close-run` first while the run is still blocked.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

type Run = Record<string, unknown>;
const RUN: Run = { runId: "run-1", taskId: "t1", phase: "work", state: "settled-failed", outcome: "failed" };
const ACCEPT = "orca task accept-attempt g-alpha t1 --run run-1 --note <why>";
const CLOSE = "orca group close-run g-alpha --run run-1";

async function refusal(run: Run, summary: Record<string, unknown> = {}, reason = "saved-result-source-stale"): Promise<string> {
  const p = await fakePanel({
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: {
      schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5, ...summary },
      workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }], runs: [run],
    } },
    "GET runs/run-1/saved-result-eligibility": { status: 200, body: { status: "unavailable", reason } },
  });
  const out = await cli(["task", "verify-saved-result", "g-alpha", "t1"], p.dir);
  expect(out.code).not.toBe(0);
  expect(out.stderr).toContain(`the saved result is not eligible: ${reason}`);
  // Nothing was sent: the refusal is the CLI's own, before any POST.
  expect(p.requests.some((r) => r.method === "POST")).toBe(false);
  return out.stderr;
}

describe("a stale saved-result source names accept-attempt as the person's way on (#206)", () => {
  it("a settled failed run: accept-attempt, with no close-run", async () => {
    const err = await refusal(RUN);
    expect(err).toContain(`a person may land its last attempt instead: ${ACCEPT}`);
    expect(err).not.toContain("close-run");
  });

  it("a run still blocked: close-run first, then accept-attempt", async () => {
    const err = await refusal({ ...RUN, state: "blocked" });
    expect(err).toContain(`close its accounting first (${CLOSE}), then ${ACCEPT}`);
  });

  it("says nothing where accept-attempt would refuse the run", async () => {
    for (const [run, summary] of [
      [{ ...RUN, outcome: "succeeded" }, {}],
      [{ ...RUN, outcome: null }, {}],
      [{ ...RUN, recoveryOf: { sourceRunId: "run-0", sourceAttempt: 1, capsuleHash: "c".repeat(64) } }, {}],
      [{ ...RUN, operatorAcceptance: { state: "pending" } }, {}],
      [{ ...RUN, state: "settled-recoverable" }, {}],
      [RUN, { stopState: "handoff-requested" }],
      [RUN, { archived: true }],
      [RUN, { placement: { workspaceKind: "dir" } }],
      [RUN, { multiDir: { project: "p" } }],
    ] as Array<[Run, Record<string, unknown>]>) expect(await refusal(run, summary)).not.toContain("accept-attempt");
  });

  it("another reason names nothing more", async () => {
    expect(await refusal(RUN, {}, "saved-result-verification-failed")).not.toContain("accept-attempt");
  });
});
