// @vitest-environment jsdom
/**
 * Tester #297 (follow-up K, item 3; human: 「codex 提示就好」): the run view carries a run's live ceiling and the stop at it,
 * but only `orca run show` said so. The Web run detail now shows both, and for a codex run a note that is true of how
 * Codex observes usage after each completed response, so an in-flight request can pass the ceiling and group limit
 * before the run stops. A note, never a block; other agents get none.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { AgentsViewV1, GroupViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [
  { id: "my-coder", kind: "codex", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
  { id: "my-claude", kind: "claude", defaults: { model: "local", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "1" },
] };
beforeEach(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const ceilinged = (installation: string): GroupViewV1 => view(
  [workItem({ taskId: "a", status: "blocked", category: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
  [run({ runId: "run-a", taskId: "a", state: "blocked", agent: { installation, model: null },
    liveCeiling: { revision: 2, tokens: 10_000_000, cause: "pause-line", deliveredRevision: 2 },
    liveCeilingStop: { revision: 2, tokens: 10_000_000, cause: "pause-line", observedTokens: 63_000_000, phase: "execute", at: "boundary" } })],
);
function openRun(value: GroupViewV1, runsTab = "Runs and evidence"): HTMLElement {
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} agents={agents} />);
  fireEvent.click(screen.getByRole("tab", { name: runsTab }));
  fireEvent.click(screen.getByRole("button", { name: /^(Open run|展开运行) a$/ }));
  return screen.getByTestId("run-live-ceiling");
}

describe("the run detail's live ceiling and the codex note (#297)", () => {
  it("shows the ceiling, the stop at it, and for codex that a request can pass the response boundary", () => {
    const box = openRun(ceilinged("my-coder"));
    expect(box.textContent).toContain("Live ceiling: 10,000,000 tokens (pause-line, revision 2)");
    expect(box.textContent).toContain("Stopped at the live ceiling: 63,000,000 tokens used against 10,000,000 (pause-line, execute, boundary)");
    expect(box.querySelector("[data-testid=codex-ceiling-note]")?.textContent)
      .toBe("This ceiling is checked after each observed response: the request already in flight can pass the ceiling, and the group limit, before the run stops.");
  });

  // #478 §5.2: where a resumable stop's next run resumes; a stop with no continuation says so.
  // mutation: drop the run-ceiling-continuation line in RunLiveCeiling -> red here
  it("says where a resumable stop continues, and that another has no continuation", () => {
    const resumable = ceilinged("my-claude");
    resumable.runs[0] = { ...resumable.runs[0]!, ceilingContinuation: { nextPhase: "verify", resumesAttempt: true } };
    expect(openRun(resumable).querySelector("[data-testid=run-ceiling-continuation]")?.textContent).toBe("Continues at verify with the paid plan and execution, in the same attempt");
    cleanup();
    expect(openRun(ceilinged("my-claude")).querySelector("[data-testid=run-ceiling-continuation]")?.textContent).toBe("No continuation: the stop carried none, so the next run starts the task at plan");
  });

  it("gives no note for an agent that is not codex", () => {
    const box = openRun(ceilinged("my-claude"));
    expect(box.textContent).toContain("Live ceiling: 10,000,000 tokens");
    expect(box.querySelector("[data-testid=codex-ceiling-note]")).toBeNull();
  });

  it("says it in Chinese, without English role words", async () => {
    await i18n.changeLanguage("zh");
    const box = openRun(ceilinged("my-coder"), "运行与证据");
    expect(box.querySelector("[data-testid=codex-ceiling-note]")?.textContent)
      .toBe("每一次响应被观测到之后才检查这个上限：已经在途的请求可能超过这个上限、也可能超过组上限，之后运行才停下。");
  });
});
