// @vitest-environment jsdom
/**
 * Tester #349 (human's ruling, session 4389b15f, 2026-11-18): a Codex session ccloop could not delete keeps the call's prompt
 * in a private rollout. The run settles on its real result; the panel shows a standing notice with the command a person runs
 * to delete it -- on the run (Runs region) and as a Problems row that is listed, not counted (as #321 C's cost notice).
 * ccloop's `cleanup-failed` cause (a cleanup step that still failed the call) has its own words. Named mutations at each assertion.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RunReason } from "../src/RunReason.js";
import { sessionCleanupCommand } from "../src/SessionCleanupNotice.js";
import type { RunViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

beforeEach(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const ID = "01a1e8f9-d197-7e41-83ee-d32888151bda", HOME = "/Users/p/.cache/ccloop/agent-catalog/codex-home/abc/codex-home";
const ARGV = ["/opt/codex bin/codex", "-c", "model_catalog_json=\"/c/catalog.json\"", "delete", "--force", ID], USER_HOME = "/Users/p/.cache/ccloop/agent-catalog/codex-home/abc/home";
const MANUAL = `CODEX_HOME=${HOME} HOME=${USER_HOME} '/opt/codex bin/codex' -c 'model_catalog_json="/c/catalog.json"' delete --force ${ID}`;
const entry = (state: "failed" | "retry-failed") => ({ threadId: ID, home: HOME, state, detail: "exit 1: Error: failed to delete session", command: ARGV, userHome: USER_HOME });
const landed = (over: Partial<RunViewV1> = {}) => run({ runId: "run-a", taskId: "a", state: "landed", ...over });
const mount = (runs: RunViewV1[]) => render(<ControlGroupView view={view([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a" })], runs)}
  config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
const problemsTab = (): HTMLElement => screen.getByRole("tab", { name: "Problems" });
const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"");

describe("a Codex session that could not be deleted (#349)", () => {
  // Ruling: human approved necessary criteria changes this round (session 4389b15f, 2026-11-18); the controller's review
  // named this test: it pinned the bare `CODEX_HOME=<home> codex delete --force <id>`, which omits the HOME, binary and
  // `-c model_catalog_json` pair ccloop's own delete needed, so it could fail the same way.
  it("the manual command is ccloop's recorded delete, with its CODEX_HOME and HOME, every word shell-quoted", () => {
    // mutation: argv ignored (plain form) -> red; mutation: HOME left out -> red; mutation: no quoting -> red
    expect(sessionCleanupCommand(entry("failed"))).toBe(MANUAL);
    // A ccloop that sent no argv: the plain form, still in its private home.
    expect(sessionCleanupCommand({ threadId: ID, home: "/a b/codex-home" })).toBe(`CODEX_HOME='/a b/codex-home' codex delete --force ${ID}`);
  });

  it("is a Problems row of a settled run, listed but not counted, with the manual command", async () => {
    mount([landed({ sessionCleanup: [entry("retry-failed")] })]);
    // mutation: count runs with sessionCleanup in problemCount -> "1 to look at" -> red
    expect(problemsTab().textContent).not.toContain("to look at");
    await act(async () => { fireEvent.click(problemsTab()); });
    const panel = screen.getByRole("tabpanel", { name: "Problems" });
    // mutation: drop the SessionCleanupRows from the Problems region -> no row -> red
    const row = panel.querySelector('[data-session-cleanup-run-id="run-a"]');
    expect(row?.textContent).toContain(`Codex session ${ID} of run run-a could not be deleted, and the automatic retry failed too`);
    expect(row?.textContent).toContain(MANUAL);
    // Review: a retry-failed deletion is never retried again, so its notice must not promise one.
    expect(row?.textContent).toContain("it will not be retried again");
    expect(row?.textContent).not.toContain("tries once more");
    // mutation: the run itself made a problem run (isProblemRun) -> its ordinary problem row appears too -> red
    expect(panel.querySelector('[data-problem-run-id="run-a"]')).toBeNull();
  });

  it("is no row for a run without one", async () => {
    mount([landed()]);
    await act(async () => { fireEvent.click(problemsTab()); });
    expect(screen.getByRole("tabpanel", { name: "Problems" }).querySelector("[data-session-cleanup-run-id]")).toBeNull();
  });

  it("is said on the run in the Runs region, in English and Chinese", async () => {
    mount([landed({ sessionCleanup: [entry("failed")] })]);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Runs and evidence" })); });
    // mutation: drop the notice from the Runs row -> red
    const notice = screen.getByRole("tabpanel", { name: "Runs and evidence" }).querySelector('[data-session-cleanup-run-id="run-a"]');
    expect(notice?.textContent).toContain("could not be deleted; the next cleanup tries once more");
    cleanup();
    await i18n.changeLanguage("zh");
    mount([landed({ sessionCleanup: [entry("failed")] })]);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "运行与证据" })); });
    expect(screen.getByRole("tabpanel", { name: "运行与证据" }).querySelector('[data-session-cleanup-run-id="run-a"]')?.textContent).toContain("下一次清理会再试一次");
  });

  it("a retry-failed notice says it will not be retried, in Chinese too", async () => {
    await i18n.changeLanguage("zh");
    mount([landed({ sessionCleanup: [entry("retry-failed")] })]);
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "运行与证据" })); });
    const text = screen.getByRole("tabpanel", { name: "运行与证据" }).querySelector('[data-session-cleanup-run-id="run-a"]')?.textContent ?? "";
    expect(text).toContain("不会再自动重试");
    expect(text).not.toContain("再试一次");
    expect(text).toContain(MANUAL);
  });

  it("words ccloop's cleanup-failed cause, in English and Chinese", async () => {
    const failed = run({ runId: "run-c", state: "blocked", outcome: "failed", stopReason: "Error: EACCES: permission denied",
      failureCause: { cause: "cleanup-failed", phase: "plan", retries: 0, detail: "EACCES: permission denied" } });
    // mutation: cleanup-failed missing from KNOWN_FAILURE_CAUSES -> "the cause is unknown" -> red
    expect(text(renderToStaticMarkup(<RunReason run={failed} />))).toContain("Why it stopped: a cleanup step after the agent's call failed.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={failed} />))).toContain("agent 调用之后的清理步骤失败了");
  });
});
