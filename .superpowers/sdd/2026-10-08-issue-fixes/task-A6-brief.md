### Task A6: Show a refusal where the person acted

**Files:**
- Create `web/src/RefusalNotice.tsx`.
- Modify `web/src/ControlGroupView.tsx`: imports (lines 10-29), props interface (lines 45-72), after the claim-blocked line (line 105).
- Modify `web/src/ControlPanel.tsx`: imports (lines 11-30), `ImportFormProps` (lines 93-100), `ImportForm` after `<h3>` (line 123), the `ImportForm` element (lines 241-244), the `ControlGroupView` element (after line 286).
- Modify `web/src/styles.css`: one rule after line 67 (`code, .row-id, .row-at { … }`).
- Test (create) `web/tests/groupRefusal.test.tsx`.

**Interfaces:**
- Consumes: A4's `explainRefusal`; A5's props and App wiring.
- Produces: `export function RefusalNotice(props: { refusal: ControlRefusal; testId: string }): JSX.Element` — `role="alert"`, the explanation, the decoded list (`<ul>`, only when there are items), and the raw code in `<code class="refusal-code">`. Test ids `group-refusal`, `import-refusal`. `ControlGroupViewProps.refusal?: ControlRefusal | null`.

- [ ] **Step 1: Write the failing test** — create `web/tests/groupRefusal.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Spec 2026-10-08 §2.2(d), §2.3: a refusal is shown where the person acted. A group command's refusal is at the top of
 * that group's view, above its actions; it stays while another group is used and goes with the next successful command
 * of the same group. An import's refusal is inside the import form, the plan's problems one per line, in English and
 * Chinese. The panel's own line is not used for either. Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } }, status);
const success = (): Response => json({ schema: "orca-command-success-v1", commandRevision: 7 });

beforeEach(() => {
  panel = installFakePanel();
  const g1 = groupSummary("g1", ALPHA), g2 = groupSummary("g2", ALPHA);
  panel.summary = { ...panel.summary, groups: [g1, g2] };
  panel.groupViews = { g1: planGroupView(g1), g2: planGroupView(g2) };
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

/** Open a group from Task control's list and answer its view's region once it is the one shown. */
async function openGroup(groupId: string): Promise<HTMLElement> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  return await screen.findByRole("region", { name: `Control group ${groupId}` });
}
const groupReads = (groupId: string): number => panel.requests.filter((request) => request === `GET /api/control/groups/${groupId}`).length;

describe("a group's refusal stays with its group (spec §2.2(d))", () => {
  it("is shown at the top of its group's view, kept through another group's success, and cleared by its own group's next success", async () => {
    let refuseG1 = true;
    panel.onPost = async (url) => {
      if (url === "/api/control/groups/g1/pause-dispatch" && refuseG1) {
        refuseG1 = false;
        return refused(409, "stop-mode-conflict", "stop-mode-conflict:pause");
      }
      return success();
    };
    render(<App />);
    let g1 = await openGroup("g1");
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    const notice = await within(g1).findByTestId("group-refusal");
    expect(notice.textContent).toContain(enErrors["stop-mode-conflict"]);
    expect(within(notice).getByText("stop-mode-conflict").tagName).toBe("CODE");
    // At the top: before the actions and before the budget editor.
    const pause = within(g1).getByRole("button", { name: "Pause dispatch" });
    expect(notice.compareDocumentPosition(pause) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(within(g1).getByRole("region", { name: "Budget proposal" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only there: the code is on screen once (not also on the panel's own line).
    expect(screen.getAllByText(/stop-mode-conflict/)).toHaveLength(1);

    const g2 = await openGroup("g2");
    expect(within(g2).queryByTestId("group-refusal")).toBeNull();
    const before = groupReads("g2");
    fireEvent.click(within(g2).getByRole("button", { name: "Pause dispatch" }));
    // The success is recorded before the group is read again, so this read means g2's success was handled.
    await waitFor(() => expect(groupReads("g2")).toBeGreaterThan(before));

    g1 = await openGroup("g1");
    expect(within(g1).getByTestId("group-refusal").textContent).toContain(enErrors["stop-mode-conflict"]);
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g1" })).queryByTestId("group-refusal")).toBeNull());
  });
});

describe("an import's refusal stays in the import form (spec §2.2(d))", () => {
  it("lists the plan's problems one per line, in English and in Chinese", async () => {
    panel.onPost = async (url) => (url === "/api/control/groups/import-plan"
      ? refused(422, "control-plan-rejected", "control-plan-rejected:missing-target-version:a\ndangling-dependency:b")
      : success());
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    fireEvent.click(await within(form).findByRole("button", { name: "Import plan" }));
    const notice = await within(form).findByTestId("import-refusal");
    expect(within(notice).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "Task b depends on a task that is not in the plan.",
    ]);
    expect(within(notice).getByText("control-plan-rejected").tagName).toBe("CODE");
    expect(screen.getAllByText(/control-plan-rejected/)).toHaveLength(1);
    await act(async () => { await i18n.changeLanguage("zh"); });
    expect(within(screen.getByTestId("import-refusal")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "任务 a 没有 targetVersion。请填一个正整数，通常是 1。",
      "任务 b 依赖了一个计划里没有的任务。",
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && ../node_modules/.bin/vitest run tests/groupRefusal.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: `findByTestId("group-refusal")` and `findByTestId("import-refusal")` time out (nothing renders them; the refusals reach only the state since A5).

- [ ] **Step 3: Implement.**

  (a) Create `web/src/RefusalNotice.tsx`:

```tsx
/**
 * Spec 2026-10-08 §2.2(d): a refusal where the person acted -- what happened and what to do, a refused plan's problems one
 * per line, and the server's code as sent (small, monospace) so the explanation can always be checked against it.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlRefusal } from "./controlState.js";
import { explainRefusal } from "./refusalExplain.js";

export function RefusalNotice({ refusal, testId }: { refusal: ControlRefusal; testId: string }): JSX.Element {
  useTranslation(); // re-render when the language changes: explainRefusal reads it
  const { text, items } = explainRefusal(refusal);
  return (
    <div className="refusal" role="alert" data-testid={testId} data-status={refusal.status ?? ""}>
      <p>{text}</p>
      {items.length > 0 && (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
      <p><code className="refusal-code">{refusal.code}</code></p>
    </div>
  );
}
```

  (b) `web/src/ControlGroupView.tsx`: add imports `import type { ControlRefusal, UncertainCommand } from "./controlState.js";` (replacing line 25's `import type { UncertainCommand } from "./controlState.js";`) and `import { RefusalNotice } from "./RefusalNotice.js";` after the `GroupIntegrationConfirm` import. In `ControlGroupViewProps`, before the closing `}` (line 72) add:

```ts
  /** Spec 2026-10-08 §2.2(d): this group's last refusal, shown at the top until a later success of this group. */
  refusal?: ControlRefusal | null;
```

  After line 105 (`{view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}`) add:

```tsx
      {/* Spec 2026-10-08 §2.2(d), §6.5: the group's refusal is among the alerts at the top, above every action. */}
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="group-refusal" /> : null}
```

  (c) `web/src/ControlPanel.tsx`: add `import { RefusalNotice } from "./RefusalNotice.js";` after the `RecoveryView` import. In `ImportFormProps` add before its closing `}`:

```ts
  /** Spec 2026-10-08 §2.2(d): the last import's refusal, with the refused plan's problems one per line. */
  refusal?: ControlRefusal | null;
```

  After line 123 (`<h3>{t("control.import.title")}</h3>`) add:

```tsx
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="import-refusal" /> : null}
```

  In the `<ImportForm … />` element (lines 241-244) add the attribute `refusal={props.importRefusal ?? null}`. In the `<ControlGroupView … />` element, after `integrationFor={props.integrationFor}` (line 286) add `refusal={props.groupRefusals?.[view.summary.groupId] ?? null}`.

  (d) `web/src/styles.css`, after line 67:

```css
.refusal-code { font-size: 0.85em; }
```

- [ ] **Step 4: Run, expect PASS** — `cd web && ../node_modules/.bin/vitest run tests/groupRefusal.test.tsx tests/controlPanel.test.tsx tests/refusalText.test.tsx tests/i18nPseudo.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; web tsc ⇒ rc=0; root `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > $S/out2.txt 2>&1; echo rc=$?` ⇒ rc=0; then the whole web suite `npm run --workspace web check > $S/web.txt 2>&1; echo rc=$?` ⇒ rc=0. A red outside the approved rewrites is reported by name, not rewritten (Rule 12).

- [ ] **Step 5: Mutation** — in `$M`:
  1. Delete the `RefusalNotice` line in `ControlGroupView.tsx` ⇒ `groupRefusal.test.tsx` "is shown at the top of its group's view…" red.
  2. In `App.tsx`, delete the `command-succeeded` dispatch ⇒ the same test red at its last `waitFor`.
  3. In `App.tsx`, make `place` always `"group"` ⇒ "lists the plan's problems one per line…" red (no `import-refusal`).
  4. Move the `RefusalNotice` line in `ControlGroupView.tsx` to just before the closing `</section>` ⇒ "is shown at the top…" red at the `compareDocumentPosition` assertion.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/RefusalNotice.tsx web/src/ControlGroupView.tsx web/src/ControlPanel.tsx web/src/styles.css web/tests/groupRefusal.test.tsx` and:

```
feat(web): show a refusal at the top of its group and inside the import form

A refused command used to appear as one line at the bottom of Task control, far from
the button. The group view now shows its group's refusal among the alerts at the top,
explained, with the raw code; the import form shows an import's refusal with the plan's
problems one per line. The panel's own line keeps only refusals of no group or import.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

