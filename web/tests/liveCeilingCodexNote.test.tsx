// @vitest-environment jsdom
/**
 * Tester #297 (follow-up K, item 3; human: 「codex 提示就好」): the run view carries a run's live ceiling and the stop at it,
 * but only `orca run show` said so. The Web run detail now shows both, and for a codex run a note that is true of how
 * codex runs: `codex exec` runs each phase as one turn, so the ceiling is checked only when a phase ends, and one execute
 * can go past the ceiling -- and the group limit -- before the run stops. A note, never a block; other agents get none.
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
  it("shows the ceiling, the stop at it, and for codex that the ceiling is checked only when a phase ends", () => {
    const box = openRun(ceilinged("my-coder"));
    expect(box.textContent).toContain("Live ceiling: 10,000,000 tokens (pause-line, revision 2)");
    expect(box.textContent).toContain("Stopped at the live ceiling: 63,000,000 tokens used against 10,000,000 (pause-line, execute, boundary)");
    expect(box.querySelector("[data-testid=codex-ceiling-note]")?.textContent)
      .toBe("codex runs each phase as one turn, so this ceiling is checked only when a phase ends: one execute can go past the ceiling, and past the group limit, before the run stops.");
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
      .toBe("codex 每个阶段只跑一轮，所以只在阶段结束时检查这个上限：一次执行阶段可能超过这个上限、也可能超过组上限，之后运行才停下。");
  });
});
