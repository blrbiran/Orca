// @vitest-environment jsdom
/**
 * ccloop error codes spec (2026-10-15) §4.6, criterion 8: wherever the panel shows a ccloop code it explains it in the
 * reader's language -- ccloop's table first, then Orca's own table, else a generic sentence that still names the code and
 * the detail (an unknown code is never dropped). The texts are written out here, not read from the tables, so a dropped
 * entry and a zh entry left in English both turn this red.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { codeAndDetail, explainCcloopCode, explainEstimateReason, peerExitReason } from "../src/ccloopCodes.js";
import { explainRefusal, explainRunReason } from "../src/refusalExplain.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import { RunReason } from "../src/RunReason.js";
import { SavedResultAction } from "../src/TaskDetail.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { run } from "./fixtures/board.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const EN_CATALOG = "omp could not list its model catalog (spawn ENOENT). Check that omp is installed and starts, then retry.";
const ZH_CATALOG = "omp 无法列出它的模型目录（spawn ENOENT）。请确认 omp 已安装且能启动，然后重试。";
const EN_CAP = "omp's catalog now caps this model's output above the bound this requirement was opened with, so the call was refused before it started. Retry: a retry recomputes the bound from the current catalog.";
const ZH_CAP = "omp 目录里这个模型的输出上限已高于这个需求开启时定下的上限，调用在开始前被拒绝。请重试：重试会按当前目录重新计算上限。";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

describe("explaining a ccloop code", () => {
  it("reads ccloop's table, then Orca's, else the generic sentence, in English", () => {
    expect([explainCcloopCode("omp-model-catalog-unavailable", "spawn ENOENT"), explainCcloopCode("omp-model-catalog-unavailable", ""),
      explainCcloopCode("agent-unselected", ""), explainCcloopCode("omp-new-thing", "x"), explainCcloopCode("omp-new-thing", "")]).toEqual([
      EN_CATALOG, "omp could not list its model catalog. Check that omp is installed and starts, then retry.",
      "A slot has no agent selected. Choose an agent for every slot, then confirm.", "omp-new-thing: x", "omp-new-thing"]);
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect([explainCcloopCode("omp-model-catalog-unavailable", "spawn ENOENT"), explainCcloopCode("omp-new-thing", "x"), explainCcloopCode("omp-new-thing", "")])
      .toEqual([ZH_CATALOG, "omp-new-thing：x", "omp-new-thing"]);
  });

  it("takes the server's forms apart as the server wrote them", () => {
    expect([codeAndDetail("omp-model-catalog-unavailable: spawn ENOENT"), codeAndDetail("agent-version-drift"), codeAndDetail("file:///x"), codeAndDetail("Error: x"), codeAndDetail("")])
      .toEqual([{ code: "omp-model-catalog-unavailable", detail: "spawn ENOENT" }, { code: "agent-version-drift", detail: "" }, { code: "unknown", detail: "file:///x" },
        { code: "unknown", detail: "Error: x" }, { code: "unknown", detail: "" }]);
    expect([peerExitReason("2:agent-config-invalid: bad"), peerExitReason("1"), peerExitReason("1:Error: x")])
      .toEqual([{ code: "agent-config-invalid", detail: "bad" }, { code: "unknown", detail: "" }, { code: "unknown", detail: "Error: x" }]);
  });
});

describe("each surface (spec A §4.6 table)", () => {
  it("a refusal: ccloop-failed is explained by ccloop's code, in both languages", async () => {
    const refusal = { status: 424, code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", commandRevision: 3 };
    expect(explainRefusal(refusal)).toEqual({ text: EN_CATALOG, items: [] });
    expect(explainRefusal({ ...refusal, message: "ccloop-failed:omp-new-thing: x" }).text).toBe("omp-new-thing: x");
    await i18n.changeLanguage("zh");
    expect(explainRefusal(refusal).text).toBe(ZH_CATALOG);
  });

  it("a run reason: peer exits and accept refusals (old uncut ones too) and usage-unknown with a code", async () => {
    expect([
      explainRunReason("control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT"),
      explainRunReason("control-peer-exit:2:omp-new-thing: x"),
      explainRunReason("accept-refused:2:agent-config-invalid"),
      explainRunReason("estimate-usage-unknown:single-call-output-invalid"),
      explainRunReason("estimate-usage-unknown"),
    ]).toEqual([
      `ccloop exited with an error: ${EN_CATALOG}`,
      "ccloop exited with an error: omp-new-thing: x",
      "ccloop refused to accept this run: The agent's configuration is not valid.",
      "This estimate call's usage is unknown, so its budget cannot be settled. The model's answer was not the JSON this call asked for.",
      "This estimate call's usage is unknown, so its budget cannot be settled.",
    ]);
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-x", state: "blocked", blockedReason: "control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT" })} />);
    expect(html).toContain(`ccloop exited with an error: ${EN_CATALOG} <code>control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT</code>`);
    await i18n.changeLanguage("zh");
    expect(explainRunReason("control-peer-exit:2:omp-model-catalog-unavailable: spawn ENOENT")).toBe(`ccloop 出错退出：${ZH_CATALOG}`);
  });

  it("an estimate's reason code", async () => {
    expect([explainEstimateReason("agent-selection-rejected:estimator:omp-model-catalog-unavailable"), explainEstimateReason("estimate-call-failed:omp-single-call-cap-exceeded"),
      explainEstimateReason("estimate-call-failed:omp-new-thing"), explainEstimateReason("estimate-output-invalid")])
      .toEqual(["omp could not list its model catalog. Check that omp is installed and starts, then retry.", EN_CAP, "omp-new-thing", null]);
    await i18n.changeLanguage("zh");
    expect(explainEstimateReason("estimate-call-failed:omp-single-call-cap-exceeded")).toBe(ZH_CAP);
  });

  // Plan R3 made the generic text the bare code, which this surface already shows; a known code pins the explanation here,
  // and web/tests/savedResultRecovery.test.tsx pins that an unknown code is not shown twice.
  it("a saved-result reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", reason: "omp-model-catalog-unavailable" }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={1} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-model-catalog-unavailable")).parentElement!.textContent).toContain("omp-model-catalog-unavailable omp could not list its model catalog. Check that omp is installed and starts, then retry.");
    cleanup();
    await i18n.changeLanguage("zh");
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={2} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-model-catalog-unavailable")).parentElement!.textContent).toContain("omp-model-catalog-unavailable omp 无法列出它的模型目录。请确认 omp 已安装且能启动，然后重试。");
  });

  it("a failed requirement: the latest failed call's code, and a blocked call's reason", async () => {
    const view = requirementView("failed");
    const failed: RequirementViewV1 = { ...view, rounds: [{ ...view.rounds[0]!, calls: [{ runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "omp-single-call-cap-exceeded" }] }],
      summary: { ...view.summary, requirement: { ...view.summary.requirement!, blockedRun: { runId: "run-2", reason: "requirement-usage-unknown:omp-new-thing" } } } };
    const shown = (language: "en" | "zh") => render(<RequirementsPanel config={config} summary={summaryWith(failed)} views={{ r: failed }} selected="r" agents={null} language={language} onSelect={() => {}} onCommand={vi.fn()} />).container.textContent ?? "";
    const en = shown("en");
    expect(en).toContain(`omp-single-call-cap-exceeded · ${EN_CAP}`);
    expect(en).toContain("requirement-usage-unknown:omp-new-thing · This requirement call's usage is unknown, so its budget cannot be settled. omp-new-thing");
    cleanup();
    await i18n.changeLanguage("zh");
    expect(shown("zh")).toContain(`omp-single-call-cap-exceeded · ${ZH_CAP}`);
  });

  // Controller ruling on A7 (plan R3): an unknown code's explanation is the code itself, so these surfaces show it once.
  it("an unknown code is shown once on the failed-call line and the saved-result line", async () => {
    const view = requirementView("failed");
    const failed: RequirementViewV1 = { ...view, rounds: [{ ...view.rounds[0]!, calls: [{ runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "omp-new-thing" }] }] };
    const { container } = render(<RequirementsPanel config={config} summary={summaryWith(failed)} views={{ r: failed }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()} />);
    expect([...container.querySelectorAll('p[role="status"]')].map((p) => p.textContent)).toContain("omp-new-thing");
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", reason: "omp-new-thing" }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={1} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-new-thing")).parentElement!.textContent).toBe("Saved results are unavailable for verification. omp-new-thing");
  });
});
