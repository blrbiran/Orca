### Task A5: Refusal state per group, per import, per panel; cleared by the next success

**Files:**
- Modify `web/src/controlState.ts`: `ControlClientState` (lines 30-43), `ControlClientEvent` (lines 45-49), `initialControlState` (lines 51-56), the reducer's `refusal` case (lines 152-160).
- Modify `web/src/App.tsx`: every `dispatchControl({ type: "refusal", … })` (lines 320, 329, 338, 356, 360, 381, 395, 438, 505, 506, 514, 515, 525, 526, 717), the success path after line 385, the `controlAlert` input (line 877), the `ControlPanel` props (line 962), the comment at line 269.
- Modify `web/src/ControlPanel.tsx`: props (lines 32-91) only — rendering is A6.
- Modify (rewrite, approved) `web/tests/controlState.test.ts`: "clears the conflicted group cache on a revision conflict without touching drafts" (lines 136-148); add three tests.

**Interfaces:**
- Produces in `web/src/controlState.ts`:
  - `export type RefusalPlace = "group" | "import" | "panel";`
  - state fields `refusals: Record<string, ControlRefusal>`, `importRefusal: ControlRefusal | null`, `panelRefusal: ControlRefusal | null` (the field `refusal` is removed);
  - events `{ type: "refusal"; place: "group"; groupId: string; value: ControlRefusal }`,
    `{ type: "refusal"; place: "import" | "panel"; groupId: string | null; value: ControlRefusal }`,
    `{ type: "command-succeeded"; place: "group" | "import"; groupId: string }`.
- Produces in `ControlPanelProps`: `groupRefusals?: Record<string, ControlRefusal>`, `importRefusal?: ControlRefusal | null`; `refusal` now means the panel refusal (name kept so the existing criteria that pass it keep compiling).

- [ ] **Step 1: Write the failing tests** — in `web/tests/controlState.test.ts` add `ControlRefusal` to the type import from `../src/controlState.js`. Replace lines 136-148:

```ts
  it("clears the conflicted group cache on a revision conflict without touching drafts", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, {
      type: "refusal",
      groupId: "g",
      value: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 },
    });
    expect(next.canonical).toEqual({});
    expect(next.refetchRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.refusal?.code).toBe("revision-conflict");
    expect(next.refusal?.commandRevision).toBe(8);
  });
```

  with (spec §2.2(d): one refusal per group, not one global; rewrite approved per §2.3):

```ts
  // Rewritten for spec 2026-10-08 §2.2(d) (human-approved): the refusal is kept under its group, not in one global slot.
  it("clears the conflicted group cache on a revision conflict without touching drafts", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, {
      type: "refusal",
      place: "group",
      groupId: "g",
      value: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 },
    });
    expect(next.canonical).toEqual({});
    expect(next.refetchRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.refusals.g?.code).toBe("revision-conflict");
    expect(next.refusals.g?.commandRevision).toBe(8);
    expect(next.panelRefusal).toBeNull();
  });

  // Spec 2026-10-08 §2.2(d): a refusal is shown where the person acted, until the next success there.
  const refused = (code: string): ControlRefusal => ({ status: 409, code, message: code, commandRevision: 6 });

  it("keeps one refusal per group, and a success for one group clears only that group's", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "group", groupId: "g1", value: refused("stop-mode-conflict") });
    state = reduceControlState(state, { type: "refusal", place: "group", groupId: "g2", value: refused("group-state-invalid") });
    expect(state.refusals).toEqual({ g1: refused("stop-mode-conflict"), g2: refused("group-state-invalid") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g2" });
    expect(state.refusals).toEqual({ g1: refused("stop-mode-conflict") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g1" });
    expect(state.refusals).toEqual({});
  });

  it("keeps an import refusal apart from every group, cleared only by a successful import", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "import", groupId: "group-c1", value: refused("control-plan-rejected") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "group-c1" });
    expect(state.importRefusal).toEqual(refused("control-plan-rejected"));
    expect(state.refusals).toEqual({});
    state = reduceControlState(state, { type: "command-succeeded", place: "import", groupId: "group-c2" });
    expect(state.importRefusal).toBeNull();
  });

  it("keeps a refusal of no group and no import on the panel, untouched by any success", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "panel", groupId: null, value: refused("http-503") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g" });
    state = reduceControlState(state, { type: "command-succeeded", place: "import", groupId: "group-c1" });
    expect(state.panelRefusal).toEqual(refused("http-503"));
    expect(state.refusals).toEqual({});
    expect(state.importRefusal).toBeNull();
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && ../node_modules/.bin/vitest run tests/controlState.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: the four tests fail (`refusals` undefined, `command-succeeded` unknown).

- [ ] **Step 3: Implement.**

  (a) `web/src/controlState.ts`. In `ControlClientState`, replace `  refusal: ControlRefusal | null;` with:

```ts
  /** Spec 2026-10-08 §2.2(d): each group's last refusal, shown at the top of its view until a later success of that group. */
  refusals: Record<string, ControlRefusal>;
  /** The last import's refusal, shown in the import form until an import succeeds. */
  importRefusal: ControlRefusal | null;
  /** A refusal that belongs to no group and no import (a poll, the agents table, a repository's settings): the panel's own line. */
  panelRefusal: ControlRefusal | null;
```

  Add above `export interface ControlClientState`:

```ts
/** Where a refusal is shown (spec 2026-10-08 §2.2(d)). */
export type RefusalPlace = "group" | "import" | "panel";
```

  Replace the event line `  | { type: "refusal"; groupId: string | null; value: ControlRefusal };` with:

```ts
  // groupId on a panel refusal is the scope a revision conflict voids (e.g. @repository:<id>), never where it is shown.
  | { type: "refusal"; place: "group"; groupId: string; value: ControlRefusal }
  | { type: "refusal"; place: "import" | "panel"; groupId: string | null; value: ControlRefusal }
  | { type: "command-succeeded"; place: "group" | "import"; groupId: string };
```

  In `initialControlState`, replace `uncertainCommandIds: [], refusal: null,` with `uncertainCommandIds: [], refusals: {}, importRefusal: null, panelRefusal: null,`.

  Replace the reducer's `case "refusal": { … }` (lines 152-160) with:

```ts
    case "refusal": {
      const next: ControlClientState = event.place === "group"
        ? { ...state, refusals: { ...state.refusals, [event.groupId]: event.value } }
        : event.place === "import" ? { ...state, importRefusal: event.value } : { ...state, panelRefusal: event.value };
      // Another tab committed first: the cached revision is the server's older self, so
      // the only safe move is to drop it and re-read before offering the command again.
      if (event.value.code !== "revision-conflict" || event.groupId === null) return next;
      const canonical = { ...next.canonical };
      delete canonical[event.groupId];
      return { ...next, canonical, refetchRequired: true };
    }
    case "command-succeeded": {
      if (event.place === "import") return { ...state, importRefusal: null };
      if (!Object.prototype.hasOwnProperty.call(state.refusals, event.groupId)) return state;
      const refusals = { ...state.refusals };
      delete refusals[event.groupId];
      return { ...state, refusals };
    }
```

  (b) `web/src/App.tsx` — each dispatch gains a `place` (the person acted in a group view → `group`; in the import form → `import`; nothing the person pressed in a group → `panel`):

| Line | Site | New event |
|---|---|---|
| 320 | `readControlTick` catch | `{ type: "refusal", place: "panel", groupId: null, value: controlFailureFrom(err) }` |
| 329 | `readControlGroup` catch | `{ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) }` |
| 338 | `readRequirement` catch (a clarifying group has no group view; Requirements has its own line) | `{ type: "refusal", place: "panel", groupId, value: controlFailureFrom(err) }` |
| 356 | `resolveUncertain`, lookup did not conclude (the panel did not answer; the command is still listed as unknown on the panel line) | `{ type: "refusal", place: "panel", groupId: command.groupId, value: result.refusal }` |
| 360 | `resolveUncertain`, `absent` (the command never reached the ledger: its outcome) | `{ type: "refusal", place: "group", groupId: command.groupId, value: result.refusal }` |
| 381 | `sendControl`, uncertain answer | `{ type: "refusal", place, groupId: action.groupId, value: answer.refusal }` |
| 395 | `sendControl`, refusal answer | `{ type: "refusal", place, groupId: action.groupId, value: refusal }` |
| 438 | `loadAgents` catch | `{ type: "refusal", place: "panel", groupId: null, value: refusal }` |
| 505, 506, 514, 515, 525, 526 | workspace mode / integration scheme / agent preferences (`scope` = `@repository:…` / `@operator:…`) | `{ type: "refusal", place: "panel", groupId: scope, value: … }` (value unchanged) |
| 717 | agent preview read failure (the open group's) | `{ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) }` |

  In `sendControl`, after line 373 (`const command = { groupId: action.groupId, commandId };`) add:

```ts
    // Spec 2026-10-08 §2.2(d): an import's refusal is shown in the import form, every other command's in its group.
    const place = action.verb === "import-plan" ? ("import" as const) : ("group" as const);
```

  and after line 385 (`dispatchControl({ type: "command-resolved", value: command });`) add:

```ts
    // A success clears the refusal shown where the person acted; another group's stays (spec 2026-10-08 §2.2(d)).
    if (answer.status < 400) dispatchControl({ type: "command-succeeded", place, groupId: action.groupId });
```

  Line 877 `refusal: control.refusal !== null,` becomes:

```ts
                refusal: control.panelRefusal !== null || control.importRefusal !== null || Object.keys(control.refusals).length > 0,
```

  Line 962 `refusal={control.refusal}` becomes three lines:

```tsx
          refusal={control.panelRefusal}
          groupRefusals={control.refusals}
          importRefusal={control.importRefusal}
```

  Line 269's comment `/** The last refusal of a command sent from Requirements, shown there (Task control keeps showing every refusal). */` becomes `/** The last refusal of a command sent from Requirements, shown there (Task control shows a group's at the top of its view). */`.

  (c) `web/src/ControlPanel.tsx` props: replace line 40 `  refusal: ControlRefusal | null;` with:

```ts
  /** Spec 2026-10-08 §2.2(d): a refusal that belongs to no group and no import, on the panel's own line. */
  refusal: ControlRefusal | null;
  /** Each group's last refusal, shown at the top of that group's view. */
  groupRefusals?: Record<string, ControlRefusal>;
  /** The last import's refusal, shown inside the import form. */
  importRefusal?: ControlRefusal | null;
```

- [ ] **Step 4: Run, expect PASS** — `cd web && ../node_modules/.bin/vitest run tests/controlState.test.ts tests/shell.test.tsx tests/controlCommandRecovery.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; web tsc ⇒ rc=0 (every `type: "refusal"` site now names a place; a missed one is a compile error).

- [ ] **Step 5: Mutation** — in `$M`:
  1. In the `command-succeeded` case, clear every group (`return { ...state, refusals: {} }` for the group place) ⇒ "keeps one refusal per group, and a success for one group clears only that group's" red.
  2. Make `place === "import"` store under `refusals` ⇒ "keeps an import refusal apart from every group…" red.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/controlState.ts web/src/App.tsx web/src/ControlPanel.tsx web/tests/controlState.test.ts` and:

```
feat(web): keep a refusal per group, per import and per panel

The control state kept one global refusal that nothing cleared. A command's refusal is
now kept under its group (an import's in its own slot, anything else on the panel), and
a later successful command of the same group clears it without touching another group's.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

