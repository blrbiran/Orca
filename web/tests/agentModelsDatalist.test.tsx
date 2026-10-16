// @vitest-environment jsdom
/**
 * Spec 2026-10-15 §5 (part C, R3): the selection editor offers an omp or codex installation's models as a datalist
 * under a box that stays free text -- a model the list does not hold can still be typed -- and an unreadable list
 * shows ccloop's reason, in words, beside that box. Claude keeps free text with no list. An owner may refresh the list
 * (the panel passes onRefreshModels only to an owner); without it there is no button. RF5: an installation removed
 * from the table while the editor is open answers agent-installation-missing, shown the same way.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionFields } from "../src/AgentFields.js";
import type { AgentsViewV1, ModelListState } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
    { id: "omp", kind: "omp", defaults: { model: "gateway/model-a", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "18.10.1" },
  ],
};
const PREFIX = "agents:per:x";
const codexReady: ModelListState = { state: "ready", view: { schema: "orca-agent-models-v1", installation: "codex", kind: "codex", source: "probe", observedAt: "2026-10-16T00:00:00.000Z", models: [
  { model: "gpt-6-luna", contextWindowTokens: null, maxOutputTokens: null, singleCallExecution: "v1-soft" },
  { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
] } };

const modelBox = (): HTMLInputElement => document.querySelector(`input[name="${PREFIX}:model"]`) as HTMLInputElement;

describe("the model box offers omp and codex models (spec 2026-10-15 §5)", () => {
  it("lists a codex installation's models with their windows and keeps the box free text", () => {
    const onDraft = vi.fn();
    const models = vi.fn((id: string) => (id === "codex" ? codexReady : undefined));
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="codex" fixedAgent="codex" drafts={{}} onDraft={onDraft} models={models} />);
    expect(models).toHaveBeenCalledWith("codex");
    const listId = modelBox().getAttribute("list");
    expect(listId).not.toBe(null);
    const list = document.getElementById(listId!);
    expect(list?.tagName).toBe("DATALIST");
    const options = [...list!.querySelectorAll("option")];
    expect(options.map((option) => option.value)).toEqual(["gpt-6-luna", "gpt-6-sol"]);
    expect(options[1]!.getAttribute("label")).toContain("272000");
    fireEvent.change(modelBox(), { target: { value: "my-custom-model" } });
    expect(onDraft).toHaveBeenCalledWith(`${PREFIX}:model`, "my-custom-model");
  });

  it("keeps claude's box free text with no list, even when a list is offered", () => {
    const models = vi.fn(() => codexReady);
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="claude" fixedAgent="claude" drafts={{}} onDraft={vi.fn()} models={models} onRefreshModels={vi.fn()} />);
    expect(modelBox().hasAttribute("list")).toBe(false);
    expect(document.querySelector("datalist")).toBe(null);
    expect(screen.queryByRole("button", { name: "Refresh models" })).toBe(null);
  });

  it("shows ccloop's reason in words beside a box that still takes text (and RF5's missing installation)", () => {
    const detail = "timeout 30000ms · stage timeout · elapsedMs 30001";
    const onDraft = vi.fn();
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="omp" fixedAgent="omp" drafts={{}} onDraft={onDraft}
      models={() => ({ state: "unavailable", code: "omp-model-catalog-unavailable", detail })} />);
    expect(screen.getByRole("note").textContent).toBe(`The model list is unavailable: omp could not list its model catalog (${detail}). Check that omp is installed and starts, then retry.`);
    expect(modelBox().hasAttribute("list")).toBe(false);
    fireEvent.change(modelBox(), { target: { value: "gateway/model-z" } });
    expect(onDraft).toHaveBeenCalledWith(`${PREFIX}:model`, "gateway/model-z");
    cleanup();
    const onDraftGone = vi.fn();
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="codex" fixedAgent="codex" drafts={{}} onDraft={onDraftGone}
      models={() => ({ state: "unavailable", code: "agent-installation-missing", detail: "" })} />);
    expect(screen.getByRole("note").textContent).toBe("The model list is unavailable: The agents table has no installation of this agent.");
    fireEvent.change(modelBox(), { target: { value: "gpt-6-terra" } });
    expect(onDraftGone).toHaveBeenCalledWith(`${PREFIX}:model`, "gpt-6-terra");
  });

  it("offers Refresh models only when the panel passes onRefreshModels, and asks for the shown installation", () => {
    const onRefreshModels = vi.fn();
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="codex" fixedAgent="codex" drafts={{}} onDraft={vi.fn()} models={() => codexReady} onRefreshModels={onRefreshModels} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
    expect(onRefreshModels).toHaveBeenCalledWith("codex");
    cleanup();
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="codex" fixedAgent="codex" drafts={{}} onDraft={vi.fn()} models={() => codexReady} />);
    expect(modelBox().getAttribute("list")).not.toBe(null);
    expect(screen.queryByRole("button", { name: "Refresh models" })).toBe(null);
  });

  it("names the refresh button in Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<SelectionFields agents={agents} prefix={PREFIX} label="slot" current={undefined} inheritedAgent="codex" fixedAgent="codex" drafts={{}} onDraft={vi.fn()} models={() => codexReady} onRefreshModels={vi.fn()} />);
    expect(screen.getByRole("button", { name: "刷新模型列表" })).not.toBe(null);
  });
});
