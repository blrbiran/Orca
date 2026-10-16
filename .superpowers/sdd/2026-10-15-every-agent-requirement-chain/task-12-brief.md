## Task 12: A single call's output overrun, at read time (spec §6.2; criterion 5)

**Files:**
- Modify: `src/control/webProtocol.ts:1243-1316` (`runViewSchema` gains two optional fields), `src/panel/controlViews.ts:902-924`
- Modify (fixture, listed for the human): `tests/control/fixtures/estimateHarness.ts:19-29,52-54` (`byModel?` option)
- Create: `web/src/RunOutputBound.tsx`; modify `web/src/controlTypes.ts` (`RunViewV1`), `web/src/ControlGroupView.tsx:403`,
  `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `tests/control/singleCallOutputBound.test.ts`, `web/tests/runOutputBound.test.tsx`

**Interfaces:**
- Produces: `RunViewV1.outputBound?: number` (positive safe integer), `RunViewV1.outputBoundExceededBy?: number`
  (positive safe integer, present only when observed output > bound). i18n key `control.outputBound.exceeded`
  (`{{tokens}}`).

- [ ] **Step 1: failing tests.** `tests/control/singleCallOutputBound.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";

// Spec 2026-10-15 §6.2, criterion 5 (R2): a single call is booked at its observed usage; its run view carries the bound it
// was sent with (64000 here: the fixture profile's maxOutputTokens, no agent cap) and, when the observed output (sum of
// byModel[].output) is over it, by how much. Computed at read time from the stored usage event: no schema change.
const run = async (output: number) => {
  const x = await estimateHarness({ tokens: 100 + output, byModel: [{ model: "gpt-6-sol", input: 100, output, cacheRead: 0, cacheWrite: 0 }] });
  try {
    await x.rounds(() => x.estimate().state !== "running");
    return readControlGroup(x.h.store, "epoch", "g").runs.find((view) => view.runId === x.runId)!;
  } finally { await x.h.dispose(); }
};

describe("output bound on a single call's run view (spec §6.2)", () => {
  it("over the bound: booked as observed, overrun shown", async () => {
    expect(await run(64_100)).toMatchObject({ outputBound: 64000, outputBoundExceededBy: 100, used: { tokens: 64_200 } });
  });
  it("at the bound and under it: no overrun", async () => {
    const at = await run(64_000), under = await run(10);
    expect([at.outputBound, Object.hasOwn(at, "outputBoundExceededBy"), under.outputBound, Object.hasOwn(under, "outputBoundExceededBy")]).toEqual([64000, false, 64000, false]);
  });
});
```

  (If `ESTIMATE_GRANT.tokens` is below 64_200 the harness's settlement may refuse; read `src/control/estimator.ts`
  `ESTIMATE_GRANT` first and, if needed, lower the bound by giving the harness profile a smaller
  `estimatorPreflight.maxOutputTokens` -- keep the literals consistent and write the arithmetic in the comment.)

  `web/tests/runOutputBound.test.tsx` (`// @vitest-environment jsdom` first line): render `<RunOutputBound run={...} />`
  for a run with `outputBound: 64000, outputBoundExceededBy: 100` and assert the English text
  `"This agent cannot cap a call's output; this call went 100 tokens over its declared bound."`, then switch the language
  to `zh` and assert the full Chinese text from the locale (handoff §6.7: assert the whole string in Chinese and run the
  "put English back" mutation); a run without `outputBoundExceededBy` renders nothing.

- [ ] **Step 2: red** (P-2 both; web via `npm --workspace web exec vitest run tests/runOutputBound.test.tsx`).

- [ ] **Step 3: implement.**
  `estimateHarness.ts`: `SingleCallOptions` gains
  `/** Spec 2026-10-15 §6.2: the event's per-model breakdown (absent: none, as before). */ byModel?: Array<{ model: string; input: number; output: number; cacheRead: number; cacheWrite: number }>;`
  and the event literal at 53-54 spreads `...(options.byModel === undefined ? {} : { byModel: options.byModel })`.
  `webProtocol.ts` `runViewSchema` (before `createdOrdinal`):

```ts
    // Spec 2026-10-15 §6.2 (R2): a single call's (estimate or requirement) output bound and, when the observed output (the sum
    // of its usage event's byModel[].output) went over it, by how much. Optional on the wire; read-time only.
    outputBound: positiveSafeInteger.optional(),
    outputBoundExceededBy: positiveSafeInteger.optional(),
```

  `controlViews.ts`: a helper above `runViews` and its spread in the returned object (after `createdOrdinal`):

```ts
/** Spec 2026-10-15 §6.2 and plan issue 11: every estimate or requirement single call; computed from the stored usage event. */
function outputBoundView(store: ControlStore, groupId: string, run: { runId: string; phase: string; estimateId: string | null }): { outputBound?: number; outputBoundExceededBy?: number } {
  if (run.phase !== "estimate" && run.phase !== "single-call") return {};
  let bound: number;
  try {
    bound = run.phase === "estimate" ? readEstimateContract(store, groupId, run.estimateId!).maxOutputTokens : readRequirementGroup(store, groupId).requirement.maxOutputTokens;
  } catch { return {}; }
  const event = store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq DESC").all(run.runId)
    .map((row) => JSON.parse(String(row.body)) as { bucket: string; byModel?: Array<{ output: number }> | null })
    .find((candidate) => candidate.bucket === "work" && Array.isArray(candidate.byModel));
  const output = event?.byModel?.reduce((sum, entry) => sum + entry.output, 0) ?? 0;
  return output > bound ? { outputBound: bound, outputBoundExceededBy: output - bound } : { outputBound: bound };
}
```

  (import `readEstimateContract` from `../control/estimator.js` if not already imported; `readRequirementGroup` is.)
  `web/src/controlTypes.ts` `RunViewV1`: add `outputBound?: number; outputBoundExceededBy?: number;`.
  `web/src/RunOutputBound.tsx`:

```tsx
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";

/** Spec 2026-10-15 §6.2: the result is used as normal; this only says the call went over its declared bound. */
export function RunOutputBound(props: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.run.outputBoundExceededBy === undefined) return null;
  return <small role="note">{t("control.outputBound.exceeded", { tokens: props.run.outputBoundExceededBy })}</small>;
}
```

  `ControlGroupView.tsx:403`: `<RunReason run={run} /> <RunOutputBound run={run} />`.
  `en.ts` (under `control`): `outputBound: { exceeded: "This agent cannot cap a call's output; this call went {{tokens}} tokens over its declared bound." },`
  `zh.ts`: `outputBound: { exceeded: "该 agent 无法限制单次调用的输出；这次调用比声明的上限多用了 {{tokens}} 个 token。" },`
  Wording rule: the sentence never says the call was bounded or capped.

- [ ] **Step 4: green** (both; plus `tests/metrics` and `tests/panel/scanPanelText.test.ts` per handoff §6.7 -- web text).

- [ ] **Step 5: mutations.** M12.1 `output > bound` → `output >= bound` ⇒ red "at the bound". M12.2 `return output > bound ? {...} : { outputBound: bound };`
  → `return { outputBound: bound };` ⇒ red "over the bound". M12.3 `.find((candidate) => candidate.bucket === "work" && ...)`
  → `.find(() => false)` ⇒ red "over the bound". M12.4 (web) the zh entry replaced by the English sentence ⇒ red the zh
  assertion.

- [ ] **Step 6: commit**, subject `feat(control): show a single call's output overrun beside its booked usage`.

---

