### Task E8: The group list as cards with filter chips (spec §6.4)

**Files:**
- Create: `web/src/GroupList.tsx`, `web/src/clock.ts`
- Modify: `web/src/ControlPanel.tsx` — imports (lines 11-30), props (add `now?`), the `<nav aria-label={t("control.groupsNav")}>…</nav>`
  block (lines 250-267) replaced by `<GroupList …/>`; the now-unused `listed`/`label` locals (lines 213-215) move into GroupList
- Modify: `web/src/styles.css` — after line 196 (`nav[aria-label="Control groups"] button[aria-current="true"] {…}`)
- Modify: `web/src/locales/en.ts` (after `groupBlockers`, line 211), `web/src/locales/zh.ts` (after line 118)
- Test: `web/tests/groupList.test.tsx` (new), `web/tests/styles.test.ts` (one `it`)

**Interfaces:**
- Consumes: E7; `GroupScope`, `inScope` (`web/src/projectScope.ts`); `hashFor` (`web/src/sections.ts`).
- Produces: `GroupList(props: { groups: GroupSummaryV1[]; selected: string | null; scope?: GroupScope; repoLabel?: (repoId: string) => string; onSelect: (groupId: string) => void; now?: number })`;
  `useClock(periodMs: number): number`; `ControlPanelProps.now?: number`.

- [ ] **Step 1: Write the failing test** — `web/tests/groupList.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Issue-fixes spec §6.4: each group is one card (the whole card is the button), the list hides archived groups unless the
 * Archived chip is chosen, and the chosen chip is remembered per viewer when storage works.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUP_FILTER_KEY } from "../src/groupCategory.js";
import { GroupList } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const GROUPS = [
  g("n1"), g("r1", { state: "running", counts: { ...zero, running: 1 } }), g("a1", { counts: { ...zero, blocked: 1 } }),
  g("d1", { completion: { done: 1, total: 1 }, counts: { ...zero, done: 1 } }), g("x1", { archived: true }),
];
const nav = () => screen.getByRole("navigation", { name: "Control groups" });
const ids = () => [...nav().querySelectorAll(":scope > button")].map((card) => (card.textContent ?? "").split(" · ")[0]);
const chip = (name: string) => within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name });

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("the group list (spec §6.4)", () => {
  it("hides an archived group unless the Archived chip is chosen", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Archived"));
    expect(ids()).toEqual(["x1"]);
    fireEvent.click(chip("All"));
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
  });

  it("files each group under its own chip", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    for (const [name, id] of [["Not started", "n1"], ["Running", "r1"], ["Needs attention", "a1"], ["Done", "d1"]] as const) {
      fireEvent.click(chip(name));
      expect(ids(), name).toEqual([id]);
      expect(chip(name).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("remembers the chosen chip in this browser, and still filters when storage throws", () => {
    const first = render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(window.localStorage.getItem(GROUP_FILTER_KEY)).toBe("done");
    first.unmount();
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["d1"]);
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Running"));
    expect(ids()).toEqual(["r1"]);
  });

  it("draws one card per group: id and state as its name, goal, progress, status chip, attention badge, branch and when it changed", () => {
    const onSelect = vi.fn();
    render(<GroupList groups={[g("g", { goal: "Ship the export", completion: { done: 1, total: 3 }, counts: { ...zero, blocked: 1, done: 1, idle: 1 }, branch: "orca/g", updatedAt: NOW - 5 * 60_000 })]}
      selected={null} onSelect={onSelect} now={NOW} />);
    const card = screen.getByRole("button", { name: "g · ready · 1/3 done" });
    expect(card.textContent).toContain("Ship the export");
    expect(card.querySelector("progress")?.getAttribute("value")).toBe("1");
    expect(card.querySelector("progress")?.getAttribute("max")).toBe("3");
    expect(card.querySelector(".group-chip")?.textContent).toBe("Needs attention");
    expect(card.querySelector(".group-badge")?.textContent).toBe("needs you");
    expect(card.textContent).toContain("orca/g");
    expect(card.textContent).toContain("updated 5 min ago");
    fireEvent.click(within(card).getByText("Ship the export"));
    expect(onSelect).toHaveBeenCalledWith("g");
  });

  it("says when no group matches the chosen chip", () => {
    render(<GroupList groups={[g("n1")]} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(within(nav()).getByText("No group matches this filter.")).toBeTruthy();
  });
});
```

  Append to `web/tests/styles.test.ts`, inside its `describe`:

```ts
  // Issue-fixes spec §6.4: the whole card is the button, with a border, a hover and a focus style of its own.
  it("gives a group card a border, a hover and a visible focus", () => {
    expect(rule(".group-card")).toContain("border: 1px solid var(--border)");
    expect(rule(".group-card:hover")).toContain("background: var(--bg-hover)");
    expect(rule(".group-card:focus-visible")).toContain("outline: 2px solid var(--accent)");
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `cd <wt>/web && ../node_modules/.bin/vitest run tests/groupList.test.tsx tests/styles.test.ts > <S>/e8.txt 2>&1; echo rc=$?` → `rc=1` (module missing; no `.group-card` rule).

- [ ] **Step 3: Implement.**

  `web/src/clock.ts`:

```ts
import { useEffect, useState } from "react";

/** The wall clock, re-read every `periodMs`, so "N minutes ago" and "no progress for N min" move while nothing else does. */
export function useClock(periodMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
```

  `web/src/GroupList.tsx`:

```tsx
/**
 * Issue-fixes spec §6.4: the Task control group list. Each group is one card and the whole card is the button; its
 * accessible name is the row text the list always had (id, state, done/total, stop, blockers and, in All projects, the
 * repository), and the rest of the card describes it. The chips filter by groupCategory; the choice is kept per viewer.
 */
import { useId, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import {
  GROUP_FILTERS, groupCategory, groupFilterStorage, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter, type GroupFilter,
} from "./groupCategory.js";
import { enumText } from "./i18n.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { hashFor } from "./sections.js";

export interface GroupListProps {
  groups: GroupSummaryV1[];
  selected: string | null;
  scope?: GroupScope;
  repoLabel?: (repoId: string) => string;
  onSelect: (groupId: string) => void;
  /** Tests pin the clock; the page reads it every 30 s. */
  now?: number;
}

function GroupCard(props: { group: GroupSummaryV1; selected: boolean; repoText: string; now: number; onSelect: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { group } = props;
  const base = useId();
  const category = groupCategory(group);
  const updated = group.updatedAt === undefined || group.updatedAt === null ? null : Math.max(0, Math.floor((props.now - group.updatedAt) / 60_000));
  return (
    <button
      type="button"
      className="group-card"
      data-category={category}
      aria-current={props.selected}
      aria-labelledby={props.repoText === "" ? `${base}-name` : `${base}-name ${base}-repo`}
      aria-describedby={`${base}-detail`}
      onClick={props.onSelect}
    >
      <span id={`${base}-name`} className="group-card-name">
        {group.groupId} · {enumText("groupState", group.state)}
        {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
        {group.stopState !== null ? ` · ${enumText("stopState", group.stopState)}` : ""}
        {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
      </span>
      <span id={`${base}-detail`} className="group-card-detail">
        {group.goal !== undefined && <span className="group-card-goal">{group.goal}</span>}
        {group.completion !== undefined && group.completion.total > 0 && (
          <progress value={group.completion.done} max={group.completion.total}
            aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
        )}
        <span className="group-chip" data-category={category}>{t(`control.groupCategory.${category}` as const)}</span>
        {needsAttention(group) && <span className="group-badge">{t("control.groupCard.attention")}</span>}
        {group.branch !== undefined && <code>{group.branch}</code>}
        {updated !== null && <span>{updated === 0 ? t("control.groupCard.updatedNow") : t("control.groupCard.updated", { minutes: updated })}</span>}
      </span>
      {props.repoText !== "" && <span id={`${base}-repo`}>{props.repoText}</span>}
    </button>
  );
}

export function GroupList(props: GroupListProps): JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupFilter>(() => readGroupFilter(groupFilterStorage()));
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  const scope = props.scope;
  const listed = scope === undefined ? props.groups : props.groups.filter((group) => inScope(scope, group.repoId));
  const shown = listed.filter((group) => matchesGroupFilter(group, filter));
  // In All projects a row names its repository, after today's text (project filtering spec §5).
  const label = (repoId: string): string => (scope?.kind === "all" ? ` · ${props.repoLabel?.(repoId) ?? repoId}` : "");
  const choose = (next: GroupFilter): void => { setFilter(next); writeGroupFilter(groupFilterStorage(), next); };
  return (
    <>
      <div role="group" aria-label={t("control.groupFilter.region")} className="group-filter">
        {GROUP_FILTERS.map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => choose(option)}>
            {option === "all" ? t("control.groupFilter.all") : t(`control.groupCategory.${option}` as const)}
          </button>
        ))}
      </div>
      <nav aria-label={t("control.groupsNav")} className="group-list">
        {scope?.kind === "unresolved" ? (
          // Plan decision P1: with no project list a row could belong to any project, so none is shown.
          <p role="note">{t("project.listUnavailable")}</p>
        ) : listed.length === 0 ? <p>{t("control.noGroups")}</p> : shown.length === 0 && <p>{t("control.groupFilter.empty")}</p>}
        {shown.map((group) => group.state === "clarifying" ? (
          // N1 spec §11.2: a clarifying group has no group view (DR25); it is operated in Requirements until accept.
          <a key={group.groupId} className="group-card" href={hashFor("requirements")}>{group.groupId} · {enumText("groupState", group.state)} · {t("control.requirementBadge")}{label(group.repoId)}</a>
        ) : (
          <GroupCard key={group.groupId} group={group} selected={group.groupId === props.selected} repoText={label(group.repoId)} now={now} onSelect={() => props.onSelect(group.groupId)} />
        ))}
      </nav>
    </>
  );
}
```

  `web/src/ControlPanel.tsx`: add `import { GroupList } from "./GroupList.js";`; drop the now-unused imports
  (`hashFor`, `inScope`, and `enumText` only if nothing else uses it -- `ImportForm` still uses `enumText`); add to
  `ControlPanelProps`

```ts
  /** Issue-fixes spec §6.4: the clock "updated N minutes ago" is read against; the list reads it itself when absent. */
  now?: number;
```

  delete the `listed` and `label` locals (lines 213-215 -- `ownerLabel` stays), and replace the whole
  `<nav aria-label={t("control.groupsNav")}> … </nav>` element (lines 250-267) with

```tsx
      <GroupList groups={summary.groups} selected={selected} scope={scope} repoLabel={props.repoLabel} onSelect={props.onSelect} now={props.now} />
```

  `web/src/styles.css`, after the `nav[aria-label="Control groups"] button[aria-current="true"]` line (kept as is):

```css
/* Issue-fixes spec §6.4: the group list as cards; the whole card is the button. */
.group-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.group-filter button[aria-pressed="true"] { background: var(--accent-subtle); border-color: var(--accent); color: var(--text-strong); }
.group-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 8px 0 16px; }
.group-list > p { grid-column: 1 / -1; }
.group-card {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left; text-decoration: none;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--text); cursor: pointer;
}
.group-card:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.group-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.group-card[aria-current="true"] { background: var(--accent-subtle); border-color: var(--accent); }
.group-card-name { color: var(--text-strong); font-weight: 600; overflow-wrap: anywhere; }
.group-card-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--text-xs); color: var(--muted); }
.group-card-goal { flex-basis: 100%; color: var(--text); font-size: var(--text-sm); overflow-wrap: anywhere; }
.group-card progress { flex-basis: 100%; height: 6px; accent-color: var(--ok); }
.group-chip { padding: 0 8px; border-radius: 999px; background: var(--bg-hover); color: var(--text-strong); }
.group-chip[data-category="attention"] { background: var(--danger-subtle); color: var(--danger); }
.group-chip[data-category="running"] { background: var(--ok-subtle); color: var(--ok); }
.group-chip[data-category="done"] { background: var(--info-subtle); color: var(--info); }
.group-badge { padding: 0 6px; border-radius: 999px; background: var(--danger); color: var(--on-accent); font-weight: 600; }
```

  `web/src/locales/en.ts`, after `groupBlockers: " · {{n}} blocker(s)",`:

```ts
    groupCategory: { "not-started": "Not started", running: "Running", attention: "Needs attention", done: "Done", archived: "Archived" },
    groupFilter: { region: "Show groups", all: "All", empty: "No group matches this filter." },
    groupCard: {
      progress: "{{done}} of {{total}} tasks done",
      attention: "needs you",
      updated: "updated {{minutes}} min ago",
      updatedNow: "updated just now",
    },
```

  `web/src/locales/zh.ts`, after `groupBlockers: " · {{n}} 个阻塞项",`:

```ts
    groupCategory: { "not-started": "未开始", running: "进行中", attention: "需要处理", done: "已完成", archived: "已归档" },
    groupFilter: { region: "筛选组", all: "全部", empty: "没有符合这个筛选的组。" },
    groupCard: {
      progress: "已完成 {{done}}/{{total}} 个任务",
      attention: "需要你处理",
      updated: "{{minutes}} 分钟前更新",
      updatedNow: "刚刚更新",
    },
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`. Then the whole web suite (cards replace the rows every
  list test reads): `npm run check --workspace web > <S>/e8-web.txt 2>&1; echo rc=$?` → `rc=0`, and
  `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > <S>/e8-scan.txt 2>&1; echo rc=$?` → `rc=0`. If a
  list test outside the rewritten list goes red, stop and report it (the card is designed to keep their text and names).

- [ ] **Step 5: Mutation** (clone, `npm run build --workspace web` first): replace
  `listed.filter((group) => matchesGroupFilter(group, filter))` with `listed` → "hides an archived group" red; delete the
  `writeGroupFilter(...)` call in `choose` → "remembers the chosen chip" red; delete the badge line → the card test red;
  delete the `.group-card:focus-visible` rule → the styles test red.

- [ ] **Step 6: Commit** — `git -C <wt> add web/src/GroupList.tsx web/src/clock.ts web/src/ControlPanel.tsx web/src/styles.css web/src/locales/en.ts web/src/locales/zh.ts web/tests/groupList.test.tsx web/tests/styles.test.ts`,
  message `feat(web): list control groups as cards with category filters` (+ Co-Authored-By).

