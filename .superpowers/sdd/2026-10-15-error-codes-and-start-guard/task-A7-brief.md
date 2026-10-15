### Task A7: The web explains ccloop codes everywhere they are shown (spec A §4.6, §4.7; criterion 8)

**Files:**
- Create: `web/src/ccloopCodes.ts`
- Modify: `web/src/refusalExplain.ts:7` (import), `:31-43` (`explainRefusal`, `explainRunReason`)
- Modify: `web/src/AgentSelectionEditor.tsx:15` (import), `:73` (`FailedCell` text)
- Modify: `web/src/AgentSettings.tsx:10` (import), `:118`
- Modify: `web/src/ControlGroupView.tsx:22` area (import), `:488`
- Modify: `web/src/TaskDetail.tsx:20` (import), `:307`
- Modify: `web/src/RequirementsPanel.tsx:12` area (import), `:260`, `:299-302`
- Modify: `web/src/locales/en.ts` (`en` before `enums:` at `:1034`; `enErrors`; new `enCcloopErrors` after `enErrors`), `web/src/locales/zh.ts` (same three places)
- Modify: `tests/panel/refusalCoverage.test.ts:3-4` (imports), `:44-55` (`VIEW_REASONS` + `"control-peer-exit"`), new `CCLOOP_CODES` test
- Test (create): `web/tests/ccloopCodes.test.tsx`; append tests to `web/tests/agentSelectionEditor.test.tsx` and `web/tests/agentSettings.test.tsx`

**Interfaces:**
- Consumes: A2's `ccloop-failed` message form; A3's stored codes; A4's run-reason form; A5's `estimate-call-failed:<code>`, `<usageUnknownReason>:<code>`, call `reason`.
- Produces (`web/src/ccloopCodes.ts`): `export function explainCcloopCode(code: string, detail: string): string`; `export function codeAndDetail(text: string): { code: string; detail: string }`; `export function peerExitReason(rest: string): { code: string; detail: string }`; `export function explainEstimateReason(reasonCode: string): string | null`. Locale: `export const enCcloopErrors: Record<string, string>`, `export const zhCcloopErrors: Record<string, string>`; error entries `control-peer-exit`; translation keys `ccloop.generic`, `ccloop.genericNoDetail`.

Texts (the criteria below repeat them as literals):

| key | en | zh |
|---|---|---|
| `enErrors/zhErrors["control-peer-exit"]` | `ccloop exited with an error: {{detail}}` | `ccloop 出错退出：{{detail}}` |
| `ccloop.generic` | `{{code}}: {{detail}}` | `{{code}}：{{detail}}` |
| `ccloop.genericNoDetail` | `{{code}}` | `{{code}}` |
| `omp-model-catalog-unavailable` | `omp could not list its model catalog ({{detail}}). Check that omp is installed and starts, then retry.` | `omp 无法列出它的模型目录（{{detail}}）。请确认 omp 已安装且能启动，然后重试。` |
| `omp-model-catalog-invalid` | `omp's model catalog could not be read ({{detail}}).` | `omp 的模型目录无法读取（{{detail}}）。` |
| `omp-single-call-cap-exceeded` | `omp's catalog now caps this model's output above the bound this requirement was opened with, so the call was refused before it started. Retry: a retry recomputes the bound from the current catalog.` | `omp 目录里这个模型的输出上限已高于这个需求开启时定下的上限，调用在开始前被拒绝。请重试：重试会按当前目录重新计算上限。` |
| `omp-single-call-unavailable` | `omp cannot make this single call with the selected model ({{detail}}).` | `omp 无法用所选模型完成这次单次调用（{{detail}}）。` |
| `agent-config-invalid` | `The agent's configuration is not valid ({{detail}}).` | `这个 agent 的配置无效（{{detail}}）。` |
| `single-call-unsupported` | `This agent cannot make single calls (estimate, clarify, split); choose another agent.` | `这个 agent 不能做单次调用（估算、澄清、拆分），请换一个 agent。` |
| `single-call-output-invalid` | `The model's answer was not the JSON this call asked for.` | `模型的回答不是这次调用要求的 JSON。` |

`fillEntry` drops ` ({{detail}})` / `（{{detail}}）` with an empty detail (`web/src/i18n.ts:111-121`).

- [ ] **Step 1: Write the failing tests**

(a) Create `web/tests/ccloopCodes.test.tsx`:

```tsx
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
      "A slot has no agent selected. Choose an agent for every slot, then confirm.", "ccloop failed with omp-new-thing: x", "ccloop failed with omp-new-thing."]);
  });

  it("in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect([explainCcloopCode("omp-model-catalog-unavailable", "spawn ENOENT"), explainCcloopCode("omp-new-thing", "x"), explainCcloopCode("omp-new-thing", "")])
      .toEqual([ZH_CATALOG, "ccloop 失败（omp-new-thing）：x", "ccloop 失败（omp-new-thing）。"]);
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
    expect(explainRefusal({ ...refusal, message: "ccloop-failed:omp-new-thing: x" }).text).toBe("ccloop failed with omp-new-thing: x");
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
      "ccloop exited with an error: ccloop failed with omp-new-thing: x",
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
      .toEqual(["omp could not list its model catalog. Check that omp is installed and starts, then retry.", EN_CAP, "ccloop failed with omp-new-thing.", null]);
    await i18n.changeLanguage("zh");
    expect(explainEstimateReason("estimate-call-failed:omp-single-call-cap-exceeded")).toBe(ZH_CAP);
  });

  it("a saved-result reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", reason: "omp-new-thing" }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={1} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-new-thing")).parentElement!.textContent).toContain("ccloop failed with omp-new-thing.");
    cleanup();
    await i18n.changeLanguage("zh");
    render(<SavedResultAction runId="run-1" groupId="g" taskId="a" revision={3} changeSeq={2} onCommand={vi.fn()} />);
    expect((await screen.findByText("omp-new-thing")).parentElement!.textContent).toContain("ccloop 失败（omp-new-thing）。");
  });

  it("a failed requirement: the latest failed call's code, and a blocked call's reason", async () => {
    const view = requirementView("failed");
    const failed: RequirementViewV1 = { ...view, rounds: [{ ...view.rounds[0]!, calls: [{ runId: "run-1", overviewHash: null, commit: null, usage: null, outcome: "failed", reason: "omp-single-call-cap-exceeded" }] }],
      summary: { ...view.summary, requirement: { ...view.summary.requirement!, blockedRun: { runId: "run-2", reason: "requirement-usage-unknown:omp-new-thing" } } } };
    const shown = (language: "en" | "zh") => render(<RequirementsPanel config={config} summary={summaryWith(failed)} views={{ r: failed }} selected="r" agents={null} language={language} onSelect={() => {}} onCommand={vi.fn()} />).container.textContent ?? "";
    const en = shown("en");
    expect(en).toContain(`omp-single-call-cap-exceeded · ${EN_CAP}`);
    expect(en).toContain("requirement-usage-unknown:omp-new-thing · This requirement call's usage is unknown, so its budget cannot be settled. ccloop failed with omp-new-thing.");
    cleanup();
    await i18n.changeLanguage("zh");
    expect(shown("zh")).toContain(`omp-single-call-cap-exceeded · ${ZH_CAP}`);
  });
});
```
(`"A slot has no agent selected. Choose an agent for every slot, then confirm."` is `enErrors["agent-unselected"]` measured at `web/src/locales/en.ts:1061`; re-read it with `grep -n '"agent-unselected"' web/src/locales/en.ts` redirected, and write the literal you read — the row pins "Orca's table after ccloop's".)

(b) Append to `web/tests/agentSelectionEditor.test.tsx` (inside its `describe`, reusing `renderView`, `row`, `resolvedPreview`, `view`):

```tsx
  // ccloop error codes spec (2026-10-15) §4.6: a slot's ccloop code is explained beside it, and an estimate's reason too.
  it("explains a slot's ccloop code and an estimate's ccloop reason in words beside the code", () => {
    const base = resolvedPreview();
    const preview = { ...base, slots: [base.slots[0]!, base.slots[1]!, { key: "task:b", slot: "worker" as const, taskId: "b", outcome: { kind: "unavailable" as const, code: "omp-model-catalog-unavailable" } }], selectionsHash: null };
    const estimate: GroupViewV1["estimates"][number] = { estimateId: "estimate-1", estimateVersion: 1, state: "failed", profile: { profileId: "all", profileHash: "b".repeat(64) },
      mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: "estimate-call-failed:omp-new-thing" };
    const { container } = renderView({ preview, view: view({ estimates: [estimate] }) });
    expect(row(container, "task:b").querySelector('[role="alert"]')!.textContent).toContain("omp-model-catalog-unavailable · omp could not list its model catalog. Check that omp is installed and starts, then retry.");
    expect(container.textContent).toContain("estimate-call-failed:omp-new-thing · ccloop failed with omp-new-thing.");
  });
```

(c) Append to `web/tests/agentSettings.test.tsx` (inside its `describe`, reusing `agents`, `preferences`):

```tsx
  // ccloop error codes spec (2026-10-15) §4.6: the installation panel explains ccloop's code beside it.
  it("explains a failed detection's ccloop code", () => {
    const state: AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1", revision: 0, pending: false, pendingCommand: null, failureCode: "agent-config-invalid", observation: null, preview: null };
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} installationState={state} />);
    expect(container.textContent).toContain("Detection unavailable · agent-config-invalid The agent's configuration is not valid.");
  });
```

(d) `tests/panel/refusalCoverage.test.ts`: change the imports to `import { enCcloopErrors, enErrors } from "../../web/src/locales/en.js";` and `import { zhCcloopErrors, zhErrors } from "../../web/src/locales/zh.js";`; in `VIEW_REASONS` after `"single-call-record-invalid", "single-call-prompt-mismatch", "settle-incomplete",` add a line `  // ccloop error codes spec (2026-10-15) §4.4, §4.7: a peer exit's stored run reason.\n  "control-peer-exit",`; append inside the `describe`:

```ts
  // ccloop error codes spec (2026-10-15) §4.7: the ccloop codes an operator can act on, held to both languages as VIEW_REASONS is.
  const CCLOOP_CODES = ["omp-model-catalog-unavailable", "omp-model-catalog-invalid", "omp-single-call-cap-exceeded", "omp-single-call-unavailable",
    "agent-config-invalid", "single-call-unsupported", "single-call-output-invalid"];
  it("has an en and a zh ccloop entry for every CCLOOP_CODES code, the same codes in both, each interpolating only {{detail}}", () => {
    for (const table of [enCcloopErrors, zhCcloopErrors]) expect(CCLOOP_CODES.filter((code) => !has(table, code))).toEqual([]);
    expect(Object.keys(enCcloopErrors).sort()).toEqual(Object.keys(zhCcloopErrors).sort());
    for (const [lang, table] of [["en", enCcloopErrors], ["zh", zhCcloopErrors]] as const) {
      for (const [code, text] of Object.entries(table)) {
        expect(text.trim(), `${lang} ${code}`).not.toBe("");
        expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).filter((name) => name !== "detail"), `${lang} ${code}`).toEqual([]);
      }
    }
  });
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopCodes.test.tsx tests/agentSelectionEditor.test.tsx tests/agentSettings.test.tsx > /private/tmp/oec/logs/a7-red-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a7-red-web.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > /private/tmp/oec/logs/a7-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a7-red.log
```
Expected red: `ccloopCodes.test.tsx` fails to load (`../src/ccloopCodes.js` missing — a load error is acceptable **only** at RED; every mutation below must red on an assertion); the two appended tests at their `toContain`; `refusalCoverage` at `CCLOOP_CODES` (import undefined) and at `control-peer-exit` in both languages.

- [ ] **Step 3: Implement**

Create `web/src/ccloopCodes.ts`:

```ts
/**
 * ccloop error codes spec (2026-10-15) §4.6: ccloop's own code and detail, explained in the reader's language wherever the
 * panel shows one. ccloop's table first, then the Orca error table (a named refusal both share keeps its Orca text), else
 * the generic sentence, which still names the code and the detail.
 */
import i18n, { currentLanguage, errorEntry, fillEntry } from "./i18n.js";
import { enCcloopErrors } from "./locales/en.js";
import { zhCcloopErrors } from "./locales/zh.js";

/** A code as the server writes one before `: <detail>` (src/control/ccloopPort.ts PEER_CODE). */
const CODE_THEN_DETAIL = /^([a-z][a-z0-9-]{0,63})(?:$|: ([\s\S]*)$)/;

function ccloopEntry(code: string): string | undefined {
  const table = currentLanguage() === "zh" ? zhCcloopErrors : enCcloopErrors;
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

export function explainCcloopCode(code: string, detail: string): string {
  const entry = ccloopEntry(code) ?? errorEntry(code);
  if (entry !== undefined) return fillEntry(entry, { message: "", status: "", detail });
  return detail === "" ? i18n.t("ccloop.genericNoDetail", { code }) : i18n.t("ccloop.generic", { code, detail });
}

/** `<code>[: <detail>]`, as the server writes it after `ccloop-failed:` and after a peer exit's `<exit>:`; `unknown` when no code leads. */
export function codeAndDetail(text: string): { code: string; detail: string } {
  const match = CODE_THEN_DETAIL.exec(text);
  return match ? { code: match[1]!, detail: match[2] ?? "" } : { code: "unknown", detail: text };
}

/** A stored peer-exit reason after its prefix: `<exit>[:<code>][: <detail>]` (the server's peerExitText). */
export function peerExitReason(rest: string): { code: string; detail: string } {
  const cut = rest.indexOf(":");
  return codeAndDetail(cut === -1 ? "" : rest.slice(cut + 1));
}

const ESTIMATOR_REJECTED = "agent-selection-rejected:estimator:";
const CALL_FAILED = "estimate-call-failed:";
/** An estimate's reason that carries a ccloop code (§4.3 estimator slot, §4.5 failed call); null for any other. */
export function explainEstimateReason(reasonCode: string): string | null {
  if (reasonCode.startsWith(ESTIMATOR_REJECTED)) return explainCcloopCode(reasonCode.slice(ESTIMATOR_REJECTED.length), "");
  if (reasonCode.startsWith(CALL_FAILED)) return explainCcloopCode(reasonCode.slice(CALL_FAILED.length), "");
  return null;
}
```

`web/src/refusalExplain.ts`: line 7 becomes `import i18n, { errorEntry, fillEntry, refusalDetail, refusalText } from "./i18n.js";` plus `import { codeAndDetail, explainCcloopCode, peerExitReason } from "./ccloopCodes.js";`; `explainRefusal` (lines 32-36) becomes

```ts
export function explainRefusal(refusal: ControlRefusal): { text: string; items: string[] } {
  // ccloop error codes spec (2026-10-15) §4.6: a ccloop failure is explained by ccloop's own code.
  if (refusal.code === "ccloop-failed") { const { code, detail } = codeAndDetail(refusalDetail(refusal)); return { text: explainCcloopCode(code, detail), items: [] }; }
  const detail = refusal.code === PLAN_REJECTED ? refusalDetail(refusal) : "";
  if (detail === "") return { text: refusalText(refusal), items: [] };
  return { text: i18n.t("refusal.planRejected"), items: detail.split("\n").map(planItemText) };
}
```
and `explainRunReason` (lines 39-43) becomes

```ts
/** ccloop error codes spec (2026-10-15) §4.6: prefixes whose detail is a peer exit, and the usage-unknown blocks that may carry a code. */
const PEER_PREFIXES = new Set(["control-peer-exit", "accept-refused"]);
const USAGE_UNKNOWN = new Set(["estimate-usage-unknown", "requirement-usage-unknown"]);
/** A blocked run's reason explained by its prefix up to the first ':' (the rest is its detail); null when there are no words for it. */
export function explainRunReason(reason: string): string | null {
  const cut = reason.indexOf(":");
  const prefix = cut === -1 ? reason : reason.slice(0, cut), rest = cut === -1 ? "" : reason.slice(cut + 1);
  const entry = errorEntry(prefix);
  if (entry === undefined) return null;
  if (PEER_PREFIXES.has(prefix)) { const { code, detail } = peerExitReason(rest); return fillEntry(entry, { message: reason, status: "", detail: explainCcloopCode(code, detail) }); }
  if (USAGE_UNKNOWN.has(prefix) && rest !== "") return `${fillEntry(entry, { message: reason, status: "", detail: "" })} ${explainCcloopCode(rest, "")}`;
  return fillEntry(entry, { message: reason, status: "", detail: rest });
}
```

Surfaces (each imports `explainCcloopCode` / `explainEstimateReason` from `./ccloopCodes.js`, or `explainRunReason` from `./refusalExplain.js`):
- `AgentSelectionEditor.tsx:73`: `{outcome.kind === "rejected" ? t("agents.rejected") : t("agents.unavailable")} · {outcome.code} · {explainCcloopCode(outcome.code, "")}`.
- `AgentSettings.tsx:118`: `{installation.failureCode && <p role="status">{t("agents.updates.unavailable", { code: installation.failureCode })} {explainCcloopCode(installation.failureCode, "")}</p>}`.
- `ControlGroupView.tsx:488`: after `{estimate.reasonCode !== null ? \` · ${estimate.reasonCode}\` : ""}` add `{estimate.reasonCode !== null && explainEstimateReason(estimate.reasonCode) !== null ? \` · ${explainEstimateReason(estimate.reasonCode)}\` : ""}`.
- `TaskDetail.tsx:307`: `<p className="detail-note">{t("control.savedResult.unavailable")} <code>{answer.reason}</code> {explainCcloopCode(answer.reason, "")}</p>`.
- `RequirementsPanel.tsx`: in `Detail`, after `const step = …;` (line 260) add `  // ccloop error codes spec (2026-10-15) §4.5-§4.6: a failed step names its latest failed call's ccloop code.\n  const failedCall = step?.state === "failed" ? [...step.calls].reverse().find((call) => call.outcome === "failed") ?? null : null;`; after the `reason` alert's closing `)}` (line 300) add `      {!archived && failedCall?.reason != null && <p role="status">{failedCall.reason} · {explainCcloopCode(failedCall.reason, "")}</p>}`; line 302's `{blockedRun.reason !== null && <>{blockedRun.reason} · </>}` becomes `{blockedRun.reason !== null && <>{blockedRun.reason}{explainRunReason(blockedRun.reason) !== null ? \` · ${explainRunReason(blockedRun.reason)}\` : ""} · </>}`.

Locales:
- `en.ts`, before `  enums: {` (line 1034): `  // ccloop error codes spec (2026-10-15) §4.6: a ccloop code with no entry in either table.\n  ccloop: { generic: "{{code}}: {{detail}}", genericNoDetail: "{{code}}" },`; `zh.ts` the same place inside `zh`: `  ccloop: { generic: "{{code}}：{{detail}}", genericNoDetail: "{{code}}" },`.
- `enErrors`: after the A2 `"ccloop-failed"` line add `  // ccloop error codes spec §4.4: a peer exit's stored run reason; the detail is ccloop's code explained (web/src/refusalExplain.ts).\n  "control-peer-exit": "ccloop exited with an error: {{detail}}",`; `zhErrors`: `  "control-peer-exit": "ccloop 出错退出：{{detail}}",`.
- After `enErrors` (`};` at the end of `en.ts`) add `/** ccloop error codes spec (2026-10-15) §4.7: ccloop's own codes an operator can act on; each may interpolate only {{detail}}. */\nexport const enCcloopErrors: Record<string, string> = { … };` with the seven en texts of the table above; in `zh.ts` `export const zhCcloopErrors: Record<string, string> = { … };` with the seven zh texts.

- [ ] **Step 4: Run green** — web: `tests/ccloopCodes.test.tsx tests/agentSelectionEditor.test.tsx tests/agentSettings.test.tsx tests/refusalExplain.test.ts tests/refusalText.test.tsx tests/codexRateLimited.test.tsx tests/requirements.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/runReasonDiagnosis.test.tsx` to `a7-green-web.log`; web tsc `cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > /private/tmp/oec/logs/a7-webtsc.log 2>&1`; root: `tests/panel/refusalCoverage.test.ts tests/panel/scanPanelText.test.ts tests/metrics` to `a7-green.log` (handoff §6.7: these two cross-package criteria see web text that `--ws check` does not); `npm run build --workspace web` to `a7-webbuild.log`. All pass, 0 skipped, every RC 0.

- [ ] **Step 5: Commit** — the created and modified web files, `tests/panel/refusalCoverage.test.ts`, the three web test files; message `feat(web): explain ccloop's codes in English and Chinese wherever the panel shows one`.

- [ ] **Step 6 (reviewer, clone `a7`): mutations** (dir `web`, test `tests/ccloopCodes.test.tsx` unless named)
  - `A7a` no ccloop table: `web/src/ccloopCodes.ts` `{"from": "const entry = ccloopEntry(code) ?? errorEntry(code);", "to": "const entry = errorEntry(code);"}` — red: "reads ccloop's table…" row 1, "a refusal…", "a run reason…", "an estimate's reason code", "a failed requirement…".
  - `A7b` no Orca fallback: same file `{"from": "const entry = ccloopEntry(code) ?? errorEntry(code);", "to": "const entry = ccloopEntry(code);"}` — red: "reads ccloop's table…" (the `agent-unselected` row), "a run reason…" (accept-refused row).
  - `A7c` drop an unknown code: same file `{"from": "  return detail === \"\" ? i18n.t(\"ccloop.genericNoDetail\", { code }) : i18n.t(\"ccloop.generic\", { code, detail });\n", "to": "  return detail;\n"}` — red: every generic row.
  - `A7d` refusal not special-cased: `web/src/refusalExplain.ts` `{"from": "  if (refusal.code === \"ccloop-failed\") {", "to": "  if (false) {"}` — red: "a refusal…".
  - `A7e` run reason not parsed: same file `{"from": "  if (PEER_PREFIXES.has(prefix)) {", "to": "  if (false) {"}` — red: "a run reason…".
  - `A7f` usage-unknown code dropped: same file `{"from": "  if (USAGE_UNKNOWN.has(prefix) && rest !== \"\") return", "to": "  if (false) return"}` — red: "a run reason…" row 4 and "a failed requirement…".
  - `A7g` each component: `web/src/AgentSelectionEditor.tsx` `{"from": " · {explainCcloopCode(outcome.code, \"\")}", "to": ""}`, test `tests/agentSelectionEditor.test.tsx` — red: the appended test (slot line). `web/src/ControlGroupView.tsx` (remove the `explainEstimateReason` expression) — same test, estimate line. `web/src/AgentSettings.tsx` (` {explainCcloopCode(installation.failureCode, "")}` → ``), test `tests/agentSettings.test.tsx`. `web/src/TaskDetail.tsx` (` {explainCcloopCode(answer.reason, "")}` → ``) — "a saved-result reason". `web/src/RequirementsPanel.tsx` (remove the `failedCall` paragraph) — "a failed requirement…".
  - `A7h` English back in zh: `web/src/locales/zh.ts` `{"from": "  \"omp-model-catalog-unavailable\": \"omp 无法列出它的模型目录（{{detail}}）。请确认 omp 已安装且能启动，然后重试。\",", "to": "  \"omp-model-catalog-unavailable\": \"omp could not list its model catalog ({{detail}}). Check that omp is installed and starts, then retry.\","}` — red: the zh assertions of "in Chinese", "a refusal…", "a run reason…".
  - `A7i` coverage: `web/src/locales/zh.ts` delete the `zhCcloopErrors` `"omp-single-call-cap-exceeded"` line, dir `root`, test `tests/panel/refusalCoverage.test.ts` — red: the `CCLOOP_CODES` test. `A7j`: delete `enErrors["control-peer-exit"]` — red: "has a en entry for every …" (`["control-peer-exit"]`).

---

