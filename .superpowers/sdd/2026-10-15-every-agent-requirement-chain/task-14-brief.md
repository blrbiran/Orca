## Task 14: The model drop-down, refresh, and the unavailable reason (Orca web, part C, spec §5)

**Files:**
- Modify: `web/src/controlApi.ts:151` (+ `fetchAgentModels`), `web/src/controlTypes.ts:558` (+ `AgentModelsViewV1`, `ModelListState`),
  `web/src/AgentFields.tsx:134-154,214-218`, `web/src/AgentSelectionEditor.tsx:80-90,183,212`, `web/src/AgentSettings.tsx:162-176`,
  `web/src/App.tsx:261,543-549` (state + load), `web/src/ccloopCodes.ts` (unchanged API), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `web/tests/agentModelsDatalist.test.tsx`, `tests/panel/refusalCoverage.test.ts` (**only-add**: a new `it`)

**Interfaces:**
- Produces:
  - `export type ModelListState = { state: "loading" } | { state: "ready"; view: AgentModelsViewV1 } | { state: "unavailable"; code: string; detail: string }`
  - `SelectionFieldsProps.models?: (installationId: string) => ModelListState | undefined`; `SelectionFieldsProps.onRefreshModels?: (installationId: string) => void` (absent ⇒ no button; App passes it only when `account?.user.roles` includes `"owner"`).
  - i18n keys: `agents.models.refresh`, `agents.models.loading`, `agents.models.window` (`{{tokens}}`), `agents.models.unavailable` (`{{reason}}`).

- [ ] **Step 1: failing tests.** `web/tests/agentModelsDatalist.test.tsx` (`// @vitest-environment jsdom`), rendering
  `<SelectionFields>` directly with the two-installation `agents` of `web/tests/agentSelectionEditor.test.tsx:28-34` plus an
  omp row `{ id: "omp", kind: "omp", defaults: { model: "gateway/model-a", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "18.10.1" }`:
  1. codex selected, `models` answers `ready` with `gpt-6-luna` and `gpt-6-sol` (272000) ⇒ the model `<input>` has a `list`
     attribute naming a `<datalist>` whose options' values are `["gpt-6-luna", "gpt-6-sol"]` and whose labels contain
     `"272000"`; typing `my-custom-model` into the input calls `onDraft("<prefix>:model", "my-custom-model")` (free text kept).
  2. claude selected ⇒ no `list` attribute, no datalist (claude keeps free text).
  3. omp selected, `models` answers `{ state: "unavailable", code: "omp-model-catalog-unavailable", detail: "timeout 30000ms · stage timeout · elapsedMs 30001" }`
     ⇒ a `role="note"` element whose text equals `explainCcloopCode("omp-model-catalog-unavailable", "timeout 30000ms · stage timeout · elapsedMs 30001")`
     -- assert the literal English sentence from `en.ts:1358` with the detail filled in -- and the input still accepts text (RF5:
     the same with `code: "agent-installation-missing"`).
  4. `onRefreshModels` given ⇒ a button named `"Refresh models"`; clicking calls it with `"codex"`; not given ⇒ no button.
  5. zh: the refresh button's full Chinese label (handoff §6.7).
  The new `it` in `tests/panel/refusalCoverage.test.ts` (only-add, beside line 96):
  `it("has en and zh entries for the every-agent chain codes", () => { for (const table of [enCcloopErrors, zhCcloopErrors]) expect(["agent-catalog-unavailable", "codex-single-call-not-single", "codex-single-call-unavailable"].filter((code) => !has(table, code))).toEqual([]); });`

- [ ] **Step 2: red** (`npm --workspace web exec vitest run tests/agentModelsDatalist.test.tsx` and the root refusalCoverage file).

- [ ] **Step 3: implement.**
  `web/src/controlApi.ts`: `export const fetchAgentModels = (installation: string, refresh = false): Promise<AgentModelsViewV1> => controlGet<AgentModelsViewV1>(\`/api/control/agents/${segment(installation)}/models${refresh ? "?refresh=1" : ""}\`);`
  `web/src/AgentFields.tsx` -- in `SelectionFields`, after `effective` is computed:

```tsx
  // Spec 2026-10-15 §5 (R3): omp and codex offer their installation's models as a datalist; the box stays free text, and an
  // unreadable list shows ccloop's reason beside it. Claude keeps free text only.
  const listed = effective !== undefined && (effective.kind === "omp" || effective.kind === "codex") ? props.models?.(effective.id) : undefined;
  const listId = `${prefix}:models`;
```

  the model `<input>` gains `list={listed?.state === "ready" ? listId : undefined}` and, after it:

```tsx
        {listed?.state === "ready" && (
          <datalist id={listId}>
            {listed.view.models.map((row) => <option key={row.model} value={row.model} label={row.contextWindowTokens === null ? row.model : t("agents.models.window", { tokens: row.contextWindowTokens })} />)}
          </datalist>
        )}
        {listed?.state === "loading" && <small>{t("agents.models.loading")}</small>}
        {listed?.state === "unavailable" && <small role="note">{t("agents.models.unavailable", { reason: explainCcloopCode(listed.code, listed.detail) })}</small>}
        {effective !== undefined && listed !== undefined && props.onRefreshModels !== undefined && (
          <button type="button" onClick={() => props.onRefreshModels!(effective.id)}>{t("agents.models.refresh")}</button>
        )}
```

  (import `explainCcloopCode` from `./ccloopCodes.js`.) `AgentSelectionEditor.tsx` and `AgentSettings.tsx`: accept
  `models?` / `onRefreshModels?` props and pass them to every `<SelectionFields>`. `App.tsx`:

```tsx
  const [agentModels, setAgentModels] = useState<Record<string, ModelListState>>({});
  const loadModels = async (id: string, refresh: boolean): Promise<void> => {
    setAgentModels((all) => ({ ...all, [id]: { state: "loading" } }));
    try { const view = await fetchAgentModels(id, refresh); setAgentModels((all) => ({ ...all, [id]: { state: "ready", view } })); }
    catch (err) {
      const refusal = controlFailureFrom(err);
      const parsed = refusal.code === "ccloop-failed" ? codeAndDetail(refusal.message.slice("ccloop-failed:".length)) : { code: refusal.code, detail: "" };
      setAgentModels((all) => ({ ...all, [id]: { state: "unavailable", ...parsed } }));
    }
  };
```

  and in `loadAgents` after `setAgents(table)`: `for (const row of table.installations) if (row.kind === "omp" || row.kind === "codex") void loadModels(row.id, false);`.
  Pass `models={(id) => agentModels[id]}` and, only when `(account?.user.roles ?? []).includes("owner")`,
  `onRefreshModels={(id) => void loadModels(id, true)}` where `AgentSelectionEditor`/`AgentSettings` are rendered
  (`App.tsx:1328`, `:1432` regions -- re-read them).
  Locales: en `models: { refresh: "Refresh models", loading: "Reading the model list…", window: "{{tokens}} tokens of context", unavailable: "The model list is unavailable: {{reason}}" }`
  under `agents`; zh `models: { refresh: "刷新模型列表", loading: "正在读取模型列表…", window: "上下文 {{tokens}} token", unavailable: "读不到模型列表：{{reason}}" }`.
  `enCcloopErrors` / `zhCcloopErrors` additions:
  - `"agent-catalog-unavailable": "The agent could not list its models ({{detail}}). Check that it is installed and starts, then retry."` /
    `"agent 列不出它的模型（{{detail}}）。请确认它已安装且能启动，然后重试。"`
  - `"codex-single-call-not-single": "Codex did more than one model call, or used a tool, in a call that must be a single answer; the usage it spent is booked."` /
    `"Codex 在本应只答一次的调用里多次调用了模型或用了工具；已花的用量照记。"`
  - `"codex-single-call-unavailable": "Codex's feature list could not be read, so its tools could not be turned off; the call was refused before it started ({{detail}})."` /
    `"读不到 Codex 的功能列表，无法关闭它的工具，调用在开始前被拒绝（{{detail}}）。"`
  (None says "bounded" or "capped" -- §6.2 wording rule.)

- [ ] **Step 4: green** (the two files + `npm --workspace web exec vitest run` whole web suite + root `tests/panel/scanPanelText.test.ts tests/metrics` + `npm run --ws check`).

- [ ] **Step 5: mutations.** M14.1 `list={listed?.state === "ready" ? listId : undefined}` → `list={undefined}` ⇒ red test 1.
  M14.2 `(effective.kind === "omp" || effective.kind === "codex")` → `effective.kind !== "claude-never"` ⇒ red test 2.
  M14.3 the `unavailable` line removed ⇒ red test 3. M14.4 `props.onRefreshModels !== undefined &&` removed ⇒ red test 4
  (no-button half). M14.5 zh `refresh` replaced by the English text ⇒ red test 5.

- [ ] **Step 6: commit**, subject `feat(web): offer omp and codex models as a datalist with refresh and the unavailable reason`.

---

