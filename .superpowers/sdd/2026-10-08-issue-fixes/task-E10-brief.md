### Task E10: Group detail order, archived banner and the archive buttons (spec §6.3, §6.5)

**Files:**
- Modify: `web/src/ControlGroupView.tsx` — move blocks by anchor (measured lines: BudgetEditor 133-134,
  AgentSelectionEditor 135-143, workItems heading 145, graph 146, `<GitScheme` 228, dispatch section 276-331)
- Modify: `web/src/controlApi.ts` — `ControlAction` (lines 241-261), `controlCommandPath` (lines 264-311)
- Modify: locales `control.group` (en lines 228-259, zh corresponding block)
- Test: `web/tests/archiveGroup.test.tsx` (new)

**Interfaces:**
- Consumes: `GroupSummaryV1.archived` (E2); verbs (E3).
- Produces: `ControlAction` `{ verb: "archive-group" | "unarchive-group"; groupId; expectedRevision; payload: Record<string, never> }`
  with paths `/api/control/groups/<g>/archive` and `/unarchive`.

- [ ] **Step 1: Write the failing test** — `web/tests/archiveGroup.test.tsx`:

```tsx
// @vitest-environment jsdom
/** Issue-fixes spec §6.3, §6.5: the archived banner and its Unarchive, the Archive action, and the detail's order. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath } from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const archived = (base: GroupViewV1): GroupViewV1 => ({ ...base, summary: { ...base.summary, state: "ready", archived: true } });

describe("archiving from the group view (spec §6.3)", () => {
  it("shows an archived group's banner with Unarchive, and offers no dispatch action", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={archived(view([workItem({ taskId: "a" })]))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("status", { name: "Archived" }).textContent).toContain("This group is archived");
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "unarchive-group", groupId: "g", expectedRevision: 6, payload: {} });
    for (const name of ["Start", "Pause dispatch", "Handoff stop", "Archive group"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("offers Archive group on a group that is not archived, and sends it under the view's revision", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("status", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "archive-group", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("serves both verbs on the group's own routes", () => {
    expect(controlCommandPath({ verb: "archive-group", groupId: "g 1", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g%201/archive");
    expect(controlCommandPath({ verb: "unarchive-group", groupId: "g", expectedRevision: 1, payload: {} })).toBe("/api/control/groups/g/unarchive");
  });
});

describe("the group detail's order (spec §6.5)", () => {
  it("puts the graph before the work-items table, the table before runs, and runs before the budget editor", () => {
    render(<ControlGroupView view={view([workItem({ taskId: "a" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const graph = screen.getByRole("figure", { name: "Dependency graph" });
    const items = screen.getByRole("heading", { name: "Work items" });
    const runs = screen.getByRole("heading", { name: "Runs" });
    const budget = screen.getByRole("region", { name: "Budget proposal" });
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(graph, items)).toBe(true);
    expect(follows(items, runs)).toBe(true);
    expect(follows(runs, budget)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/archiveGroup.test.tsx > <S>/e10.txt 2>&1; echo rc=$?` → `rc=1` (no banner; no Archive button; graph after the budget editor).

- [ ] **Step 3: Implement.**

  `web/src/controlApi.ts`: in `ControlAction`, after the `retry-integration | resolve-integration-conflict` member add

```ts
  // Issue-fixes spec §6.3: archive and unarchive a group (empty payload).
  | { verb: "archive-group" | "unarchive-group"; groupId: string; expectedRevision: number; payload: Record<string, never> }
```

  and in `controlCommandPath` after `case "resolve-integration-conflict":\n      return \`${group}/integration/resolve\`;` add

```ts
    case "archive-group":
      return `${group}/archive`;
    case "unarchive-group":
      return `${group}/unarchive`;
```

  `web/src/ControlGroupView.tsx`:
  1. Add `const archived = view.summary.archived === true;` after `const handoffActive = …;`.
  2. Cut the `<BudgetEditor … />` element and the whole `{props.agents !== undefined && ( <AgentSelectionEditor … /> )}`
     block (today directly after the stop line) and paste them, unchanged, directly before `<GitScheme view={view} …`.
  3. Move the `<DependencyGraph … />` line (E9's form) from below `<h3>{t("control.group.workItems")}</h3>` to directly
     above that heading, and directly above the graph insert the archived banner:

```tsx
      {archived && (
        <p role="status" aria-label={t("control.group.archivedRegion")}>
          {t("control.group.archivedBanner")}{" "}
          <button type="button" onClick={() => onCommand({ verb: "unarchive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.unarchive")}
          </button>
        </p>
      )}
```

     (Everything above it -- heading, claim-blocked, Part A's refusal, the spend-cap line, the plan line, Part C's stop
     banner -- is the alerts area of spec §6.5 and stays in place.)
  4. In the dispatch section: everything between `<h3>{t("control.group.dispatch")}</h3>` and
     `<p>{t("control.group.recent", …)}</p>` (the Start/Pause/Handoff/Resume/continue/recovery buttons as Parts C and D
     left them) is wrapped in `{!archived && (<>` … `</>)}`, and inside that fragment, as its last child, add

```tsx
          <button type="button" onClick={() => onCommand({ verb: "archive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.archive")}
          </button>
```

  Locales, `control.group` (after `recent: …`): en

```ts
      archivedRegion: "Archived",
      archivedBanner: "This group is archived: it keeps every record and takes no new work.",
      unarchive: "Unarchive",
      archive: "Archive group",
```

  zh

```ts
      archivedRegion: "已归档",
      archivedBanner: "这个组已归档：记录都保留，不再接新工作。",
      unarchive: "取消归档",
      archive: "归档这个组",
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`; `npm run check --workspace web > <S>/e10-web.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 5: Mutation** (clone, web built): move the BudgetEditor back above the graph → the order test red; delete
  the `{!archived && (` wrapper (keep its content) → "offers no dispatch action" red; delete the banner block → the
  first test red; delete `case "archive-group"` → typecheck fails and the path test red.
- [ ] **Step 6: Commit** — `git -C <wt> add web/src/ControlGroupView.tsx web/src/controlApi.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/archiveGroup.test.tsx`,
  message `feat(web): put the graph first, and archive or unarchive a group from its view` (+ Co-Authored-By).

