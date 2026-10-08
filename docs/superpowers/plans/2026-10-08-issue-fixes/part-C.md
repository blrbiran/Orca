## Part C — Shutdown stop-intent lifecycle (spec §3)

> **Controller amendment (2026-10-08, binding).** (1) Review Focus 1 (plan index): C2 adds a criterion that writes a
> **v8** store (the pre-Part-B schema, built the way `tests/control/schema8.test.ts` builds older stores) holding an
> empty-frozen-set shutdown intent and a run without `startedAt`, opens it through the normal store open (migrating to 9),
> runs `recoverControl`, reads the group view (the run's `startedAt` is null and the view renders), and then `start`
> succeeds. (2) C3: per-task "Continue task" buttons render only when the group has **no** stop intent (the server refuses
> `continue-task` under any stop intent); rewrite the affected web tests (`handoffResume`, `controlI18n`, `controlPanel`)
> accordingly and list them in the report.

Spec: `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3 (invariant S1), §5.2 (`stop-cleared` row), §6.5 (banner
position), §8, §9 step 4. Part B (activity table, `recordActivity`, `readGroupActivity`, schema v9) has landed before
this part; C2 consumes its interface exactly as fixed in the controller's brief.

Every line number below was measured on the worktree at the commit whose subject is
`docs(spec): revise the issue-fixes design after independent review` (before Parts A and B). Parts A and B touch some
of the same files (`web/src/ControlGroupView.tsx`, `web/src/locales/*.ts`, `src/control/recovery.ts` is not expected to
be touched by them); the executor re-measures each anchor with `grep -n -F '<anchor text>' <file>` before editing, and
every anchor below must hit exactly one line — anything else is a stop-and-report.

How this part was checked while it was written (evidence, not an instruction): every code block and rewritten criterion
below was applied in a `git clone --local` copy under the planning session's scratchpad, with a stub `activity.ts` in
place of Part B's module, and run: the three rewritten server test files plus the new ones pass (34 tests), `npm run
typecheck` is clean, the full web suite passes (80 files, 625 tests), and each mutation named in a Step 5 below was seen
red. The full root suite in that clone showed no other shutdown-related failure (its other failures were environment
only: no `web/dist`, no ccloop build at the sibling path, load timeouts).

### Existing criteria rewritten by this part (spec §3.4; human-approved rewrite of criteria the spec requires)

The spec names five; running the suite against the C1 change found four more criteria that pin the old idle-group
behaviour (marked **not named in §3.4**). Each rewrite keeps the criterion's intent and is commented with the spec section.

| File | Test name (current) | What changes | Named in §3.4? |
|---|---|---|---|
| `tests/panel/controlLifecycle.test.ts` | "gives a ready group an empty frozen set that completes, so restart can resume and start" | replaced by "lists an idle ready group as unchanged-idle: no stop intent, not stopped, revision and projection unchanged" (+ new "lists an all-done group as unchanged-idle") | yes |
| `tests/panel/controlLifecycle.test.ts` | "commits one global command and leaves unchanged groups out of the command ledger and projection" | harness claims `g`, so `g` is still `created` (the idle half moves to the test above) | yes |
| `tests/panel/controlLifecycle.test.ts` | "waits for a writer admitted before the gate and then commits every group at once" | harness claims `g` and `h`, so both stop rows still prove the single commit | **no** |
| `tests/panel/controlLifecycle.test.ts` | "records an inconsistent frozen set as a blocker while still committing the other groups" | harness claims `g` and `h`, so `h` is still `created` | **no** |
| `tests/panel/controlLifecycle.test.ts` | "leaves nothing behind when the commit is lost and replays the closed result once it succeeds" | harness claims `g` and `h`, so the lost commit has intents to lose and both revisions still advance | **no** |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a started group exactly as before when no driver exists, idle or running" | idle half: `unchanged-idle`, no intent, not stopped | yes (idle half) |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a group that was never started even when a driver exists: it is not the driver's yet" | renamed "lists a group that was never started as unchanged-idle even when a driver exists: it is not the driver's yet" | yes |
| `tests/panel/shutdownDriverGroup.test.ts` | "freezes a started group whose body carries no planHash: the planHash is part of the definition" | renamed "does not skip a started group whose body carries no planHash as driver-owned: the planHash is part of the definition"; expects `unchanged-idle` (still not `skipped-driver-owned`) | **no** |
| `tests/control/webFaults.test.ts` | "applies a cross-group shutdown to every group or to none, and an epoch replays it once" | verified: `g` holds a claimed run, `g2` is imported but never confirmed/started ⇒ idle. Decision: rewrite — stop rows `["g"]`, count 1, `g2` listed as `unchanged-idle`; the two-frozen-groups atomicity is carried by the rewritten controlLifecycle "leaves nothing behind…" (both groups active) | yes (spec said "if its groups are idle"; they are) |

Unchanged and still green after C1 (checked): every other test in the three files, `tests/control/handoffE2E.test.ts`,
`tests/control/requirementGuards.test.ts`, `tests/control/driverRequirementClarify.test.ts` (they pin
`skipped-driver-owned`, which keeps precedence over `unchanged-idle`), and `web/tests/handoffResume.test.tsx`,
`web/tests/controlI18n.test.tsx`, `web/tests/controlPanel.test.tsx` after C3.

---

### Task C1: Shutdown writes no stop intent for an idle group (`unchanged-idle`)

**Files:**
- Modify `src/panel/controlLifecycle.ts`: line 52 (`type Disposition`), insert after lines 158-160 (the `skipped-driver-owned` branch).
- Modify `src/control/webProtocol.ts`: lines 1500-1508 (the shutdown `disposition: z.enum([...])`).
- Modify `web/src/controlTypes.ts`: line 478 (the `kind: "shutdown"` result member).
- Test (rewrite): `tests/panel/controlLifecycle.test.ts` (lines 13, 92-93, 120-121, 145-153, 204-205, 222-223),
  `tests/panel/shutdownDriverGroup.test.ts` (lines 73-111), `tests/control/webFaults.test.ts` (lines 248, 262, 266).

**Interfaces:**
- Produces: shutdown disposition value `"unchanged-idle"` in `Disposition` (server), in `commandSuccessSchema`'s strict
  enum, and in the web mirror `CommandSuccessV1["result"]` (`kind: "shutdown"`). An `unchanged-idle` entry is
  `{ groupId, disposition: "unchanged-idle", changed: false, commandRevision: <unchanged>, projectionSeq: <unchanged>, frozenRunIds: [], requestIds: [], blockerCode: null }`.
- Consumes: nothing new. Parity is the existing compile-time check in `tests/panel/webParity.test.ts`
  (`commandLookupServerToWeb` / `commandLookupWebToServer`, lines 171-172), run by `npm run typecheck`.
- Order of dispositions in `shutdownGroup` after this task (spec §3.2 (1)): `blocked-inconsistent` → existing
  handoff/shutdown intent ⇒ `preserved-*` → pause with no active run ⇒ `preserved-pause` → driver-owned ⇒
  `skipped-driver-owned` → **no active run ⇒ `unchanged-idle`** → otherwise `created` / `strengthened-pause`.

- [ ] **Step 1: Write the failing tests (rewrites)**

`tests/panel/controlLifecycle.test.ts`

(a) line 13, current:
```ts
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
```
replacement:
```ts
import { commandSuccessSchema, type CommandSuccessV1, type RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
```

(b) lines 92-93, current:
```ts
  it("waits for a writer admitted before the gate and then commits every group at once", async () => {
    const ctx = await shutdownHarness(); const { h, gate, shutdown } = ctx; try {
```
current assertions it pins (unchanged lines 104-105): `expect(stopRow(h.store, "g")).toBeDefined(); expect(stopRow(h.store, "h")).toBeDefined();` — both groups were idle, so under S1 neither would get a row. Replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1, human-approved criteria rewrite 2026-10-08): an idle group no longer
  // gets a stop intent, so both groups hold an active run here and the stop rows still prove the single commit.
  it("waits for a writer admitted before the gate and then commits every group at once", async () => {
    const ctx = await shutdownHarness(["g", "h"]); const { h, gate, shutdown } = ctx; try {
```

(c) lines 120-121, current (pins `expect(entries.g).toMatchObject({ disposition: "created", changed: true });` and
`expect(revisionOf(h.store, "g")).toBe(before.g.revision + 1);` for an idle `g`):
```ts
  it("commits one global command and leaves unchanged groups out of the command ledger and projection", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
```
replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1): `g` holds an active run so it is still frozen ("created"); an idle
  // group is pinned by "lists an idle ready group as unchanged-idle ..." below.
  it("commits one global command and leaves unchanged groups out of the command ledger and projection", async () => {
    const ctx = await shutdownHarness(["g"]); const { h, shutdown } = ctx; try {
```

(d) lines 145-153, current (whole test):
```ts
  it("gives a ready group an empty frozen set that completes, so restart can resume and start", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      await shutdown();
      const intent = readStopIntent(h.store, "g")!;
      expect(intent).toMatchObject({ mode: "shutdown", state: "handoff-complete", frozenRunIds: [], acceptedAt: ACCEPTED_AT });
      expect(groupStopState(h.store, "g")).toBe("handoff-complete");
      expect(intent.deadlineAt).toBe(new Date(Date.parse(ACCEPTED_AT) + GRACE_MS).toISOString());
    } finally { await h.dispose(); }
  });
```
replacement (two tests):
```ts
  // Rewritten for issue-fixes spec §3.2 (1) and §3.4 (invariant S1): replaces "gives a ready group an empty frozen set that
  // completes, so restart can resume and start". A ready group with no active run gets no intent at all, so after a restart
  // it starts like any ready group, with no resume step first.
  it("lists an idle ready group as unchanged-idle: no stop intent, not stopped, revision and projection unchanged", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      const before = { revision: revisionOf(h.store, "g"), projection: projectionOf(h.store, "g") };
      const result = await shutdown();
      const entry = result.result.groups.find((group) => group.groupId === "g")!;
      expect(entry).toEqual({ groupId: "g", disposition: "unchanged-idle", changed: false, commandRevision: before.revision,
        projectionSeq: before.projection, frozenRunIds: [], requestIds: [], blockerCode: null });
      expect(stopRow(h.store, "g")).toBeUndefined();
      expect(groupStopState(h.store, "g")).toBe("none");
      expect((JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped).toBe(false);
      expect(revisionOf(h.store, "g")).toBe(before.revision);
      expect(projectionOf(h.store, "g")).toBe(before.projection);
      expect(commandRows(h.store, "g")).not.toContain(shutdownCommandId(EPOCH));
      // The strict result enum (webProtocol.ts) accepts the new disposition, so the ledger replay validates.
      expect(commandSuccessSchema.safeParse(result).success).toBe(true);
    } finally { await h.dispose(); }
  });

  it("lists an all-done group as unchanged-idle", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      // Every work item of `g` completed: no active run is left, so shutdown has nothing to freeze.
      for (const row of h.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g'").all()) {
        h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "completed" }), String(row.id));
      }
      const before = revisionOf(h.store, "g");
      const result = await shutdown();
      expect(result.result.groups.find((group) => group.groupId === "g")).toMatchObject({ disposition: "unchanged-idle", changed: false, commandRevision: before });
      expect(stopRow(h.store, "g")).toBeUndefined();
    } finally { await h.dispose(); }
  });
```

(e) lines 204-205, current (pins `expect(result.result.groups.find((group) => group.groupId === "h")).toMatchObject({ disposition: "created", changed: true });` for an idle `h`):
```ts
  it("records an inconsistent frozen set as a blocker while still committing the other groups", async () => {
    const ctx = await shutdownHarness(["g"]); const { h, shutdown } = ctx; try {
```
replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1): `h` holds an active run so "the other groups" are still committed.
  it("records an inconsistent frozen set as a blocker while still committing the other groups", async () => {
    const ctx = await shutdownHarness(["g", "h"]); const { h, shutdown } = ctx; try {
```

(f) lines 222-223, current (pins `expect(revisionOf(h.store, "g")).toBe(before.g + 1); expect(revisionOf(h.store, "h")).toBe(before.h + 1);` for two idle groups):
```ts
  it("leaves nothing behind when the commit is lost and replays the closed result once it succeeds", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown, deps } = ctx; try {
```
replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1): both groups hold an active run, so the lost commit has intents to lose.
  it("leaves nothing behind when the commit is lost and replays the closed result once it succeeds", async () => {
    const ctx = await shutdownHarness(["g", "h"]); const { h, shutdown, deps } = ctx; try {
```

`tests/panel/shutdownDriverGroup.test.ts`

(g) line 73: insert directly above `  it("freezes a started group exactly as before when no driver exists, idle or running", async () => {`:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1, human-approved criteria rewrite 2026-10-08): the running half is
  // unchanged; the idle half now gets `unchanged-idle` (no intent, not stopped) -- with no driver it is still not
  // `skipped-driver-owned`, which is what tells the two apart.
```
and lines 86-89, current:
```ts
      const entry = shutdownGroup(idle.h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(idle.h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(idle.h.store)).toBe(true);
```
replacement:
```ts
      const before = revisionOf(idle.h.store);
      const entry = shutdownGroup(idle.h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "unchanged-idle", changed: false, commandRevision: before, frozenRunIds: [], requestIds: [] });
      expect(readStopIntent(idle.h.store, "g")).toBeNull();
      expect(stopped(idle.h.store)).toBe(false);
      expect(revisionOf(idle.h.store)).toBe(before);
```

(h) lines 93-98, current:
```ts
  it("freezes a group that was never started even when a driver exists: it is not the driver's yet", async () => {
    const { h } = await group({ start: false, claim: false }); try {
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(h.store)).toBe(true);
```
replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1): the never-started group is still not the driver's (not
  // `skipped-driver-owned`), and being idle it now gets `unchanged-idle` instead of an empty-frozen-set intent.
  it("lists a group that was never started as unchanged-idle even when a driver exists: it is not the driver's yet", async () => {
    const { h } = await group({ start: false, claim: false }); try {
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toEqual({ groupId: "g", disposition: "unchanged-idle", changed: false, commandRevision: before.revision,
        projectionSeq: before.projection, frozenRunIds: [], requestIds: [], blockerCode: null });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(stopped(h.store)).toBe(false);
```

(i) line 102, current:
```ts
  it("freezes a started group whose body carries no planHash: the planHash is part of the definition", async () => {
```
replacement:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1): without a planHash the idle group is not the driver's, so it is
  // `unchanged-idle` rather than `skipped-driver-owned`; deleting the planHash test in driverOwnedGroup turns this red.
  it("does not skip a started group whose body carries no planHash as driver-owned: the planHash is part of the definition", async () => {
```
and lines 107-109, current:
```ts
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true });
      expect(stopped(h.store)).toBe(true);
```
replacement:
```ts
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "unchanged-idle", changed: false });
      expect(stopped(h.store)).toBe(false);
```

`tests/control/webFaults.test.ts`

(j) line 248: insert directly above `  it("applies a cross-group shutdown to every group or to none, and an epoch replays it once", async () => {`:
```ts
  // Rewritten for issue-fixes spec §3.4 (invariant S1, human-approved criteria rewrite 2026-10-08): `g2` is imported but
  // never started, so it is idle and gets no intent (`unchanged-idle`); only `g`, which holds the claimed run, is frozen.
  // The two-frozen-groups half of "every group or none" is pinned by tests/panel/controlLifecycle.test.ts "leaves nothing
  // behind when the commit is lost and replays the closed result once it succeeds".
```
line 262, current:
```ts
      expect(h.store.db.prepare("SELECT group_id FROM stop_intents ORDER BY group_id").all().map((row) => String(row.group_id))).toEqual(["g", "g2"]);
```
replacement:
```ts
      expect(h.store.db.prepare("SELECT group_id FROM stop_intents ORDER BY group_id").all().map((row) => String(row.group_id))).toEqual(["g"]);
      expect((applied.result as { groups: Array<{ groupId: string; disposition: string }> }).groups.map((entry) => [entry.groupId, entry.disposition]))
        .toEqual([["g", "created"], ["g2", "unchanged-idle"]]);
```
line 266, current: `      expect(count(h.store, "stop_intents")).toBe(2);` replacement: `      expect(count(h.store, "stop_intents")).toBe(1);`

- [ ] **Step 2: Run, expect FAIL**

```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts tests/control/webFaults.test.ts > $SCRATCH/c1-red.txt 2>&1; echo rc=$?
```
Read the whole file. Expected: rc=1; the new/rewritten idle criteria fail with `disposition: "created"` / `changed: true`
received where `"unchanged-idle"` / `false` is expected (e.g. "lists an idle ready group as unchanged-idle…",
"lists an all-done group…", the three rewritten shutdownDriverGroup tests, webFaults `expected [ 'g', 'g2' ] to deeply equal [ 'g' ]`).
The claim-both rewrites (b), (e), (f) and (c) already pass — they only strengthen the fixture.

- [ ] **Step 3: Implement**

`src/panel/controlLifecycle.ts` line 52, current:
```ts
type Disposition = "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned";
```
replacement:
```ts
type Disposition = "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned" | "unchanged-idle";
```
After the driver-owned branch (lines 158-160), anchor:
```ts
  if (exemptDriverRuns && intent === null && active.length === 0 && driverOwnedGroup(store, groupId)) {
    return { groupId, disposition: "skipped-driver-owned", changed: false, ...versions(store, groupId), frozenRunIds: [], requestIds: [], blockerCode: null };
  }
```
insert:
```ts
  // Issue-fixes spec §3.2 (1), invariant S1: a shutdown intent exists only when the shutdown froze at least one active run.
  // An idle group (ready, never started, or all done) gets no intent, no `stopped`, no revision and no projection change.
  // The branches above have already answered every existing intent except a pause with an active run.
  if (active.length === 0) {
    return { groupId, disposition: "unchanged-idle", changed: false, ...versions(store, groupId), frozenRunIds: [], requestIds: [], blockerCode: null };
  }
```

`src/control/webProtocol.ts` lines 1507-1508, current:
```ts
              "skipped-driver-owned",
            ]),
```
replacement:
```ts
              "skipped-driver-owned",
              "unchanged-idle",
            ]),
```

`web/src/controlTypes.ts` line 478: in the `kind: "shutdown"` member replace
`"blocked-inconsistent" | "skipped-driver-owned"; changed` with `"blocked-inconsistent" | "skipped-driver-owned" | "unchanged-idle"; changed`.

- [ ] **Step 4: Run, expect PASS**

```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts tests/control/webFaults.test.ts tests/control/handoffE2E.test.ts tests/control/requirementGuards.test.ts tests/control/driverRequirementClarify.test.ts > $SCRATCH/c1-green.txt 2>&1; echo rc=$?
npm run typecheck > $SCRATCH/c1-tc.txt 2>&1; echo rc=$?
```
Both rc=0 (read both files whole; `handoffE2E` may report skips that it already reports on the base — compare with a base run, Rule 12).

- [ ] **Step 5: Mutation** (in a `git clone --local` copy under `$SCRATCH`, never the worktree)
  1. Delete the inserted `if (active.length === 0) { … unchanged-idle … }` block ⇒ "lists an idle ready group as
     unchanged-idle…", "lists an all-done group…", the three rewritten shutdownDriverGroup tests and webFaults go red.
  2. Delete the line `"unchanged-idle",` from `webProtocol.ts`'s enum ⇒ the ledger's success-schema validation refuses
     the shutdown result: "lists an idle ready group as unchanged-idle…" red (observed: 5 tests in controlLifecycle red).
  3. Revert only `web/src/controlTypes.ts` line 478 ⇒ `npm run typecheck` rc≠0 at `tests/panel/webParity.test.ts`
     (`commandLookupWebToServer` / `ServerToWeb` assignability) — the parity criterion.
  4. In `driverOwnedGroup`, replace `return group.planHash !== undefined\n    && store…` with `return store…` (drop the
     planHash test) ⇒ "does not skip a started group whose body carries no planHash as driver-owned…" red
     (`skipped-driver-owned` received).

- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add src/panel/controlLifecycle.ts src/control/webProtocol.ts web/src/controlTypes.ts tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts tests/control/webFaults.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "fix(control): shutdown writes no stop intent for an idle group

Issue-fixes spec §3.2 (1), invariant S1: a group with no active run gets the new
disposition unchanged-idle (no stop intent, not stopped, revision and projection
unchanged). Rewrites the criteria spec §3.4 names, plus four more that pinned the
old idle-group intent (listed in the plan, Part C).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Startup recovery heals empty-frozen-set shutdown intents

**Files:**
- Modify `src/control/recovery.ts`: imports after line 11; new function before line 13 (`/** Recovery never creates…`);
  call inserted after line 54 (`store.dispatchBlocked=blocked.size>0;`), i.e. before `deliverSchedulerWakes` (line 58).
- Create test `tests/control/shutdownHealing.test.ts`.

**Interfaces:**
- Consumes (Part B, fixed): `recordActivity(store: ControlStore, row: ActivityRow): void` and
  `readGroupActivity(store: ControlStore, groupId: string, limit: number): ActivityEntry[]` from `src/control/activity.ts`;
  `ActivityKind` includes `"stop-cleared"`. Existing: `readGroupBody`, `saveGroupBody` (`src/control/stopIntent.ts`),
  `recordProjectionChange` (`src/control/projectionJournal.ts`), `store.transaction`.
- Produces: non-exported `healEmptyShutdownIntents(store: ControlStore): void`, called once per `recoverControl`.
  Effect per healed group: `stop_intents` row deleted, group `stopped = false`, one projection change, one activity row
  `{ kind: "stop-cleared", body: { reason: "empty-shutdown-intent" } }`, command revision untouched. Rows of mode
  `shutdown` with a non-empty `frozenRunIds`, and every `pause`/`handoff` row, are untouched.

- [ ] **Step 1: Write the failing test** — create `tests/control/shutdownHealing.test.ts`:
```ts
/**
 * Issue-fixes spec §3.2 (2) and §3.4, invariant S1: a persisted `shutdown` stop intent exists only when a shutdown froze
 * at least one active run. Stores written by an older Orca hold empty-frozen-set shutdown intents on idle groups, which
 * refuse `start` with `stop-mode-conflict` and offer no way out; startup recovery deletes them. The seed below writes the
 * row exactly as the older `shutdownGroup` did (state `handoff-complete`, frozen set empty, group `stopped`).
 */
import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-10-07T10:00:00.000Z";
const DEADLINE_AT = "2026-10-07T10:02:00.000Z";

const revisionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
const projectionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
const stopped = (store: ControlStore): boolean => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped;
const stopRow = (store: ControlStore): { mode: string; revision: number; body: string } | undefined => {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id='g'").get();
  return row ? { mode: String(row.mode), revision: Number(row.revision), body: String(row.body) } : undefined;
};
const cleared = (store: ControlStore) => readGroupActivity(store, "g", 50).filter((entry) => entry.kind === "stop-cleared");

/** The row an older Orca's shutdown left on an idle group: a shutdown intent at the current revision, group stopped. */
function seedShutdownIntent(store: ControlStore, frozenRunIds: string[]): void {
  const state = frozenRunIds.length === 0 ? "handoff-complete" : "handoff-pending";
  const body = canonicalBytes({ mode: "shutdown", state, frozenRunIds, acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT }).toString("utf8");
  store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('g','shutdown',?,?)").run(revisionOf(store), body);
  const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.stopped = true;
  store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
}

async function confirmedGroup() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  return { h, service };
}

describe("startup recovery heals empty-frozen-set shutdown intents (issue-fixes spec §3.2 (2))", () => {
  it("deletes the intent, clears stopped, keeps the revision, advances the projection once, records stop-cleared, and start then succeeds", async () => {
    const { h, service } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, []);
      // The dead end the healing removes: start is refused while the stale intent exists.
      const refused = await service.start(h.command("start", {}));
      expect("error" in refused ? refused.error.code : "accepted").toBe("stop-mode-conflict");
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toBeUndefined();
      expect(stopped(h.store)).toBe(false);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      expect(cleared(h.store).map((entry) => entry.body)).toEqual([{ reason: "empty-shutdown-intent" }]);
      // A second start of the same store finds nothing to heal: no second row, no second projection change.
      await recoverControl(h.store, h.deps.port);
      expect(cleared(h.store)).toHaveLength(1);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      const started = await service.start(h.command("start", {}));
      expect("error" in started ? started.error.code : started.result.kind).toBe("scheduled");
    } finally { await h.dispose(); }
  });

  it("leaves a shutdown intent that froze a run untouched", async () => {
    const { h } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, ["run-frozen"]);
      const before = { intent: stopRow(h.store), revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toEqual(before.intent);
      expect(stopped(h.store)).toBe(true);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection);
      expect(cleared(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });
});
```
(If Part B's fixture injects a clock into the store, nothing here depends on `at`.)

- [ ] **Step 2: Run, expect FAIL**
```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/control/shutdownHealing.test.ts > $SCRATCH/c2-red.txt 2>&1; echo rc=$?
```
Expected rc=1: the first test fails at `expect(stopRow(h.store)).toBeUndefined()` (a row is still there); the second passes.

- [ ] **Step 3: Implement** — `src/control/recovery.ts`. After line 11 (`import { acquireRepoLock } from "../scheduler/repoLock.js";`) add:
```ts
import { readGroupBody, saveGroupBody } from "./stopIntent.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { recordActivity } from "./activity.js";

/**
 * Issue-fixes spec §3.2 (2), invariant S1: a `shutdown` stop intent whose frozen set is empty froze nothing; it is the dead
 * end an older Orca left on idle groups. Each is deleted and its group un-stopped, in one transaction of its own. The
 * command revision is not advanced (recovery changes projection state, not command revision); the projection advances
 * once per healed group and one `stop-cleared` activity row records why. An empty frozen set has no requests or
 * outboxes, so crash-after-commit redelivery of a real shutdown is unaffected.
 */
function healEmptyShutdownIntents(store:ControlStore):void {
 store.transaction(()=>{
  for(const row of store.db.prepare("SELECT group_id,body FROM stop_intents WHERE mode='shutdown' ORDER BY group_id").all()) {
   const frozen=(JSON.parse(String(row.body)) as {frozenRunIds?:unknown[]}).frozenRunIds;
   if(!Array.isArray(frozen)||frozen.length!==0)continue;
   const groupId=String(row.group_id);
   store.db.prepare("DELETE FROM stop_intents WHERE group_id=?").run(groupId);
   const group=readGroupBody(store,groupId);group.stopped=false;saveGroupBody(store,group);
   recordProjectionChange(store,[groupId]);
   recordActivity(store,{groupId,kind:"stop-cleared",body:{reason:"empty-shutdown-intent"}});
  }
 });
}
```
(The file's compact style is kept, Rule 11.) Then, anchor line 54:
```ts
 store.dispatchBlocked=blocked.size>0;
```
becomes:
```ts
 store.dispatchBlocked=blocked.size>0;
 // Healed before any wake is delivered, so a pending start wake never meets a stale shutdown intent.
 healEmptyShutdownIntents(store);
```

- [ ] **Step 4: Run, expect PASS**
```
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/control/shutdownHealing.test.ts tests/control/recovery.test.ts tests/control/driverRecovery.test.ts tests/control/webFaults.test.ts tests/panel/controlStartup.test.ts tests/panel/controlRecoveryApi.test.ts > $SCRATCH/c2-green.txt 2>&1; echo rc=$?
npm run typecheck > $SCRATCH/c2-tc.txt 2>&1; echo rc=$?
```
Both rc=0.

- [ ] **Step 5: Mutation** (clone copy only; each seen red, observed while planning)
  1. `if(!Array.isArray(frozen)||frozen.length!==0)continue;` → `if(!Array.isArray(frozen))continue;` ⇒ "leaves a shutdown intent that froze a run untouched" red.
  2. Delete the `DELETE FROM stop_intents` line ⇒ first test red.
  3. Delete the `recordActivity(...)` line ⇒ first test red (`cleared` empty).
  4. Delete the `healEmptyShutdownIntents(store);` call ⇒ first test red.
  Known equivalent mutant (stated, not hidden): deleting only `recordProjectionChange(store,[groupId]);` stays green,
  because Part B's `recordActivity` records the group's projection change when the transaction has not. The explicit call
  is kept because spec §3.2 (2) requires the projection change independently of the activity mechanism.

- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/recovery.ts tests/control/shutdownHealing.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "fix(control): recovery heals empty-frozen-set shutdown intents

Issue-fixes spec §3.2 (2): before scheduler wakes are delivered, startup recovery
deletes every shutdown intent that froze no run, un-stops its group, advances the
projection once, keeps the command revision and records a stop-cleared activity row.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Web — resume dialog for a completed panel shutdown, stop banner, refused buttons hidden

**Files:**
- Modify `web/src/ControlGroupView.tsx`: line 79 (`handoffActive`), line 105 (insert banner after the claim-blocked
  alert), lines 121-132 (remove the old stop line; its text moves into the banner), lines 277, 280, 286.
- Modify `web/src/locales/en.ts`: after line 52 (end of `stopState`), and after line 235 (`stop:` in `control.group`).
- Modify `web/src/locales/zh.ts`: after line 142 (`stop:` in `control.group`).
- Create test `web/tests/stopBanner.test.tsx`.

**Interfaces:**
- Consumes: `GroupViewV1.stop`, `summary.stopMode`, `summary.stopState` (existing). `unchanged-idle` is not shown
  anywhere in the web (no view renders shutdown dispositions; checked with `grep -rn disposition web/src`), so it gets
  no en/zh string.
- Produces: i18n keys `control.group.stopBanner.how.<pause|handoff|shutdown>` and
  `control.group.stopBanner.exit.<paused|handoff-pending|handoff-partial|handoff-unresolved|handoff-complete>` (en
  typed as `Record` over the `GroupSummaryV1` unions, so a new mode/state is a compile error); DOM
  `<div role="status" data-testid="stop-banner">` directly after the `h2` (or after the claim-blocked alert / Part A's
  group refusal when those render — spec §6.5 order).
- Buttons after this task: Start only when `state === "ready"` and **no** stop intent (start refuses any intent with
  `stop-mode-conflict`, `src/control/webDispatch.ts:132`); Pause/Handoff-stop not under handoff, shutdown or pause;
  resume dialog (`Continue selected tasks` / `Resume (no continuation)`) under handoff **or shutdown** at
  `handoff-complete`.

- [ ] **Step 1: Write the failing test** — create `web/tests/stopBanner.test.tsx`:
```tsx
// @vitest-environment jsdom
/**
 * Issue-fixes spec §3.2 (3), (4) and §3.4: a group stopped by a panel shutdown is left through the same resume dialog as a
 * human handoff-stop, every stopped group shows one banner (how it stopped, its state, the one way out), and the buttons
 * the stop mode refuses -- Start, Pause dispatch, Handoff stop -- are not rendered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-08T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const settled: RunViewV1 = {
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "settled-restartable", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], continuable: false,
};
type Stop = NonNullable<GroupViewV1["stop"]>;
const view = (state: GroupViewV1["summary"]["state"], stop: Stop | null): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state, commandRevision: 6, projectionSeq: 4, stopMode: stop?.mode ?? null, stopState: stop?.state ?? null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000), used: amount(10), committedRemaining: amount(0), explicitUnallocatedReserve: amount(8_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs: [settled], checkpoints: [], handoffRequests: [], stop, recoveryBlockers: [], recentCommandIds: [],
});
const shutdownStop = (state: Stop["state"]): Stop =>
  ({ mode: "shutdown", state, frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:02:00.000Z" });
const mount = (shown: GroupViewV1, onCommand = vi.fn()) => {
  render(<ControlGroupView view={shown} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
  return onCommand;
};
const refusedButtons = ["Start", "Pause dispatch", "Handoff stop"];

afterEach(cleanup);

describe("leaving a panel shutdown (issue-fixes spec §3.2 (3))", () => {
  it("renders the resume dialog for a shutdown/handoff-complete group and no Start, Pause or Handoff-stop button", () => {
    const onCommand = mount(view("ready", shutdownStop("handoff-complete")));
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume and none of the refused buttons while the shutdown's frozen runs are still settling", () => {
    mount(view("running", shutdownStop("handoff-pending")));
    expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
  });
});

describe("the stop banner (issue-fixes spec §3.2 (4))", () => {
  it("says how the group stopped, its state, and the one way out, at the top of the group view", () => {
    const { container } = render(<ControlGroupView view={view("ready", shutdownStop("handoff-complete"))} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const banner = screen.getByTestId("stop-banner");
    expect(banner.textContent).toContain("Stopped: the panel shut down while runs were active.");
    expect(banner.textContent).toContain("Ready to resume: use the resume button under Dispatch.");
    expect(banner.textContent).toContain("stop shutdown handoff-complete");
    // Above the plan line and everything after it: the first thing under the heading.
    const heading = container.querySelector("h2")!;
    expect(heading.nextElementSibling).toBe(banner);
  });

  it("names the settling state while a handoff-stop is still pending", () => {
    mount(view("running", { mode: "handoff", state: "handoff-pending", frozenRunIds: ["run-a"], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: "2026-10-08T00:30:00.000Z" }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Stopping: the frozen runs are still settling.");
  });

  it("does not offer Start on a paused ready group, because start refuses any stop intent; Resume dispatch is its way out", () => {
    const onCommand = mount(view("ready", { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null }));
    expect(screen.getByTestId("stop-banner").textContent).toContain("Way out: press Resume dispatch under Dispatch.");
    for (const name of refusedButtons) expect(screen.queryByRole("button", { name }), name).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume dispatch" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-dispatch", groupId: "g", expectedRevision: 6, payload: {} });
  });

  it("renders no banner, and the Start button, for a ready group with no stop intent", () => {
    mount(view("ready", null));
    expect(screen.queryByTestId("stop-banner")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("shows the banner in Chinese", async () => {
    await i18n.changeLanguage("zh");
    mount(view("ready", shutdownStop("handoff-complete")));
    const text = screen.getByTestId("stop-banner").textContent ?? "";
    expect(text).toContain("已停止：面板关闭时有运行在跑。");
    expect(text).toContain("可以恢复了：用「派发」下的恢复按钮。");
    expect(screen.getByRole("button", { name: "恢复（不续跑）" })).toBeTruthy();
  });
});
```
(`web/tests/setup.ts` already switches the language back to English after each test.) If Part A has added a group
refusal block between the `h2` and the claim-blocked line, the `heading.nextElementSibling` assertion still holds
because these fixtures carry no refusal; if Part A's block always renders a wrapper element, change that one assertion to
`expect(banner.compareDocumentPosition(container.querySelector("table")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()`.

- [ ] **Step 2: Run, expect FAIL**
```
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/vitest run tests/stopBanner.test.tsx > $SCRATCH/c3-red.txt 2>&1; echo rc=$?
```
Expected rc=1: no `stop-banner` test id; the shutdown test finds no `Resume (no continuation)` button and finds
`Pause dispatch`; the paused test finds `Start`. Only "renders no banner, and the Start button…" passes.

- [ ] **Step 3: Implement**

`web/src/ControlGroupView.tsx` line 79, current:
```tsx
  const handoffActive = view.summary.stopMode === "handoff";
```
replacement:
```tsx
  const stopMode = view.summary.stopMode;
  // Issue-fixes spec §3.2 (3): a panel shutdown that froze runs is left the same way as a human handoff-stop, through the
  // resume dialog once its stop state is handoff-complete.
  const handoffActive = stopMode === "handoff" || stopMode === "shutdown";
```
Line 105, anchor `      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}` — insert directly after it
(after Part A's group refusal block, if Part A placed one right after this line):
```tsx
      {/* Issue-fixes spec §3.2 (4): one banner for any stop intent -- how it stopped, its state, and the one way out. */}
      {view.stop !== null && (
        <div role="status" data-testid="stop-banner">
          <p>{t(`control.group.stopBanner.how.${view.stop.mode}` as const)}</p>
          <p>{t(`control.group.stopBanner.exit.${view.stop.state}` as const)}</p>
          <p>
            {t("control.group.stop", {
              mode: enumText("stopMode", view.stop.mode),
              state: enumText("stopState", view.stop.state),
              accepted: view.stop.acceptedAt ?? t("common.na"),
              deadline: view.stop.deadlineAt ?? t("common.none"),
              n: view.stop.frozenRunIds.length,
              runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
            })}
          </p>
        </div>
      )}
```
Delete lines 121-132 (the old block, which the banner now carries verbatim):
```tsx
      {view.stop !== null && (
        <p role="status">
          {t("control.group.stop", {
            mode: enumText("stopMode", view.stop.mode),
            state: enumText("stopState", view.stop.state),
            accepted: view.stop.acceptedAt ?? t("common.na"),
            deadline: view.stop.deadlineAt ?? t("common.none"),
            n: view.stop.frozenRunIds.length,
            runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
          })}
        </p>
      )}
```
Line 277, current `      {view.summary.state === "ready" && !handoffActive && (` → replacement:
```tsx
      {/* Issue-fixes spec §3.2 (4): start refuses every stop intent (stop-mode-conflict), so it is not offered under one. */}
      {view.summary.state === "ready" && stopMode === null && (
```
Line 280, current `      {!handoffActive && view.summary.stopMode !== "pause" && (` → `      {!handoffActive && stopMode !== "pause" && (`.
Line 286, current `      {view.summary.stopMode === "pause" && (` → `      {stopMode === "pause" && (`.

`web/src/locales/en.ts` — after line 52 (`} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;`, end of `stopState`) insert:
```ts
// Issue-fixes spec §3.2 (4): the stop banner says how the group stopped and the one way out of each stop state.
const stopBannerHow = {
  pause: "Stopped: a person paused dispatch. No new run is claimed.",
  handoff: "Stopped: a person asked for a handoff-stop. The runs that were active are frozen and hand off their work.",
  shutdown: "Stopped: the panel shut down while runs were active. Those runs were frozen and hand off their work.",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopMode"]>, string>;
const stopBannerExit = {
  paused: "Way out: press Resume dispatch under Dispatch.",
  "handoff-pending": "Stopping: the frozen runs are still settling. Nothing to press yet; the way out appears here when they finish.",
  "handoff-partial": "A frozen run could not hand off. The group stays stopped; press Retry recovery under Dispatch when it is offered.",
  "handoff-unresolved": "A frozen run's outcome is not known yet. The group stays stopped; press Retry recovery under Dispatch when it is offered.",
  "handoff-complete": "Ready to resume: use the resume button under Dispatch.",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;
```
and after line 235 (`      stop: "stop {{mode}} {{state}} · accepted {{accepted}} · deadline {{deadline}} · {{n}} frozen run(s): {{runs}}",`) insert:
```ts
      stopBanner: { how: stopBannerHow, exit: stopBannerExit },
```

`web/src/locales/zh.ts` — after line 142 (`      stop: "停止 {{mode}} {{state}} · 受理于 {{accepted}} · 截止 {{deadline}} · {{n}} 个冻结的运行：{{runs}}",`) insert:
```ts
      stopBanner: {
        how: {
          pause: "已停止：有人暂停了派发，不会再认领新的运行。",
          handoff: "已停止：有人发起了交接停止。当时在跑的运行已冻结，正在交接各自的工作。",
          shutdown: "已停止：面板关闭时有运行在跑。这些运行已冻结，正在交接各自的工作。",
        },
        exit: {
          paused: "出路：点「派发」下的「恢复派发」。",
          "handoff-pending": "正在停止：冻结的运行还在收尾。现在不用操作，收尾完成后出路会显示在这里。",
          "handoff-partial": "有冻结的运行没能完成交接。组保持停止；「派发」下出现「重试恢复」时点它。",
          "handoff-unresolved": "有冻结的运行结果还不清楚。组保持停止；「派发」下出现「重试恢复」时点它。",
          "handoff-complete": "可以恢复了：用「派发」下的恢复按钮。",
        },
      },
```

- [ ] **Step 4: Run, expect PASS**
```
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > $SCRATCH/c3-wtc.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/vitest run > $SCRATCH/c3-web.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts tests/panel/scanPanelText.test.ts tests/panel/webParity.test.ts > $SCRATCH/c3-root.txt 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca-issues && npm run build --workspace web > $SCRATCH/c3-build.txt 2>&1; echo rc=$?
```
All rc=0 (the whole web suite, so `handoffResume`, `controlI18n` — which still finds `停止 暂停 已暂停 · 受理于 不适用 · 截止 无 · 0 个冻结的运行：无` inside the banner — and `controlPanel` stay green).

- [ ] **Step 5: Mutation** (clone copy, after `npm run build --workspace web`; each observed red while planning)
  1. `const handoffActive = stopMode === "handoff" || stopMode === "shutdown";` → `const handoffActive = stopMode === "handoff";` ⇒ "renders the resume dialog for a shutdown/handoff-complete group…", "offers no resume and none of the refused buttons…", "shows the banner in Chinese" red.
  2. `view.summary.state === "ready" && stopMode === null` → `view.summary.state === "ready" && !handoffActive` ⇒ "does not offer Start on a paused ready group…" red.
  3. Delete the whole `{view.stop !== null && ( <div … data-testid="stop-banner"> … )}` block ⇒ the four banner tests red.

- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add web/src/ControlGroupView.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/stopBanner.test.tsx
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(web): stop banner and the resume dialog for a completed panel shutdown

Issue-fixes spec §3.2 (3)(4): a shutdown/handoff-complete group gets the same resume
dialog as a human handoff-stop; every stopped group shows one banner (how it stopped,
its state, the way out, en and zh); Start, Pause dispatch and Handoff stop are not
rendered under a stop mode that refuses them.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Append the two ERRATUM sections (spec §3.3)

**Files:**
- Modify (append only, Rule 13 — original text untouched) `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`
  (1735 lines; last section `## ERRATUM (agent selection, 2026-09-26) — what the browser may send (section 3.1)` at line 1717; ends with a newline).
- Modify (append only) `docs/superpowers/plans/2026-09-25-handoff-delivery.md` (5576 lines; ends with a newline; gap row at line 75).

**Interfaces:** none (documents). Consumes the commit subjects of C1-C3.

- [ ] **Step 1: Write the failing check** — a command that is red now and green after the append:
```
cd /Users/biran/code/skills/loop/Orca-issues && grep -c -F '## ERRATUM (issue fixes, 2026-10-08) — idle groups at panel shutdown' docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md > $SCRATCH/c4-a.txt; echo rc=$?; grep -c -F '## ERRATUM (issue fixes, 2026-10-08) — gap D-RESUME-SHUTDOWN is closed' docs/superpowers/plans/2026-09-25-handoff-delivery.md > $SCRATCH/c4-b.txt; echo rc=$?
```
- [ ] **Step 2: Run, expect FAIL** — both rc=1 (count 0). Also re-measure the anchors cited in the web-spec erratum:
`grep -n -F 'for a dispatch-enabled group with no active run, persists a shutdown stop intent' docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` must list line 1274 (and 1677, the earlier erratum quoting it);
`grep -n -F 'A ready group with no active run receives a shutdown intent with an empty frozen set' …` must list line 1282. If the numbers differ, change only the numbers in the text below.

- [ ] **Step 3: Implement** — verify each file still ends with exactly one newline, then append the following text
verbatim (first line blank).

To `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`:
```markdown

## ERRATUM (issue fixes, 2026-10-08) — idle groups at panel shutdown

Appended 2026-10-08 by the implementer of Task C4 of the issue-fixes plan
(`docs/superpowers/plans/2026-10-08-issue-fixes/part-C.md`), under Orca development session `e34dc963`, in the commit
whose subject is `docs: errata for the shutdown stop-intent lifecycle`. The statements below are superseded by
`docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3 (invariant S1 and §3.2). The original text above, and the
earlier `ERRATUM (handoff delivery, 2026-09-25)` that quotes it, are kept verbatim.

1. **Invariant S1.** A persisted `shutdown` stop intent exists only when the shutdown froze at least one active run
   (including strengthening a pause because a run was active). The idle-group clause of §6.4 step 3 (line 1274: "for a
   dispatch-enabled group with no active run, persists a shutdown stop intent so no claim can begin during drain") no
   longer holds. During drain no claim can begin anyway: step 1's in-memory admission gate refuses every mutation and
   every scheduler claim, so the durable row protected nothing and its only lasting effect was a dead end after restart.
2. **The sentence at line 1282** — "A ready group with no active run receives a shutdown intent with an empty frozen set,
   reaches `handoff-complete`, and after restart uses an empty `resume-from-handoff` followed by an explicit `start`." —
   is superseded. A group with no active run (ready, never started, or all done) that has no earlier stop intent and is
   not driver-owned is listed in the shutdown result with the disposition `unchanged-idle` (`changed: false`): no stop
   intent, `stopped` unchanged, command revision and projection unchanged. After a restart it is started like any ready
   group, with no resume step. Driver-owned groups (`skipped-driver-owned`), paused groups with no active run
   (`preserved-pause`) and groups under an existing handoff or shutdown intent are unchanged; `skipped-driver-owned` is
   decided before `unchanged-idle`. Implemented in `src/panel/controlLifecycle.ts` (`shutdownGroup`), the strict result
   enum in `src/control/webProtocol.ts` and its mirror in `web/src/controlTypes.ts`, in the commit whose subject is
   `fix(control): shutdown writes no stop intent for an idle group`.
3. **Stores written before this change are healed at startup.** Panel startup recovery (`recoverControl`,
   `src/control/recovery.ts`), in its own transaction before scheduler wakes are delivered, deletes every `shutdown`
   intent whose `frozenRunIds` is empty, sets that group's `stopped` to `false`, records one projection change per healed
   group without advancing the command revision, and writes one `stop-cleared` activity row with
   `{reason: "empty-shutdown-intent"}`. An empty frozen set has no requests or outboxes, so crash-after-commit
   redelivery of a real shutdown is unaffected. Commit subject: `fix(control): recovery heals empty-frozen-set shutdown intents`.
4. **A real shutdown is left through the resume dialog.** A group whose stop mode is `shutdown` and whose stop state is
   `handoff-complete` is offered the same resume dialog as a human handoff-stop (`resume-from-handoff`, with or without
   selections), and every stopped group shows one banner naming how it stopped, its stop state and the way out. Commit
   subject: `feat(web): stop banner and the resume dialog for a completed panel shutdown`.
```

To `docs/superpowers/plans/2026-09-25-handoff-delivery.md`:
```markdown

## ERRATUM (issue fixes, 2026-10-08) — gap D-RESUME-SHUTDOWN is closed

Appended 2026-10-08 by the implementer of Task C4 of the issue-fixes plan
(`docs/superpowers/plans/2026-10-08-issue-fixes/part-C.md`), under Orca development session `e34dc963`, in the commit
whose subject is `docs: errata for the shutdown stop-intent lifecycle`. The text above is kept verbatim.

§0.1 row `D-RESUME-SHUTDOWN` recorded as a known gap that the panel renders no continuation or resume button for a group
with `stopMode === "shutdown"`, so a non-driver group frozen by a panel shutdown had no exit in the panel. The gap is
closed by `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §3.2 (3): `ControlGroupView`'s `handoffActive` now
covers both `handoff` and `shutdown`, so a `shutdown` group in stop state `handoff-complete` gets the same resume dialog
(`Continue selected tasks (n)` or `Resume (no continuation)`) as a human handoff-stop. The idle groups that most often hit
the gap no longer get a shutdown intent at all (same spec, §3.2 (1), disposition `unchanged-idle`), and stores written
before that change are healed at startup (§3.2 (2)). Implemented in the commits whose subjects are
`fix(control): shutdown writes no stop intent for an idle group`,
`fix(control): recovery heals empty-frozen-set shutdown intents` and
`feat(web): stop banner and the resume dialog for a completed panel shutdown`; pinned by
`web/tests/stopBanner.test.tsx`, `tests/control/shutdownHealing.test.ts` and the rewritten criteria in
`tests/panel/controlLifecycle.test.ts`, `tests/panel/shutdownDriverGroup.test.ts` and `tests/control/webFaults.test.ts`.
```

- [ ] **Step 4: Run, expect PASS** — rerun the Step 1 command: both rc=0 with count `1`. Then prove the originals are
untouched: `git -C /Users/biran/code/skills/loop/Orca-issues diff -U0 -- docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md docs/superpowers/plans/2026-09-25-handoff-delivery.md > $SCRATCH/c4-diff.txt` and read it whole: every hunk header starts at the old file's end (`@@ -1735,0 …` and `@@ -5576,0 …`), and there is no `-` line.
- [ ] **Step 5: Mutation** — not applicable (documents; the Step 4 diff check is the criterion: an edit inside the
original text shows as a `-` line and a hunk not at the end).
- [ ] **Step 6: Commit**
```
git -C /Users/biran/code/skills/loop/Orca-issues add docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md docs/superpowers/plans/2026-09-25-handoff-delivery.md
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "docs: errata for the shutdown stop-intent lifecycle

Issue-fixes spec §3.3: the web control spec's idle-group shutdown clause and its
empty resume-from-handoff sentence are superseded by invariant S1; the handoff
delivery plan's gap D-RESUME-SHUTDOWN is closed. Appended; original text untouched.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Points for the controller (flagged, design not changed)

1. **§3.4's rewrite list is incomplete.** Four more existing criteria pin the old idle-group intent and go red under C1
   (table above, marked "not named in §3.4"). The plan rewrites them under the same approval; the human should see them
   listed in the ledger.
2. **`continue-task` buttons are refused buttons that stay rendered.** `applyContinueTask` refuses any group with a stop
   intent (`group-stopped`, `src/control/continuation.ts`), yet the per-task `Continue task <id>` buttons are rendered
   only at `handoff-complete`, i.e. always under a stop intent. Spec §3.2 (4) ("buttons the current stop mode refuses are
   not rendered") read strictly would remove them, which rewrites `web/tests/handoffResume.test.tsx` ("offers only the
   handed-off task…", `getByRole("button", { name: "Continue task b" })`) and `web/tests/controlI18n.test.tsx` /
   `controlPanel.test.tsx` lines asserting them — not named in §3.4. C3 keeps them (scope read as Start / Pause /
   Handoff-stop, the buttons §3.4's web criterion names). Decide whether they should go.
3. **Banner "one action" for `handoff-partial` / `handoff-unresolved`.** The spec names only `stopping` and
   `handoff-complete`. Web spec §6.4 says partial/unresolved groups "remain stopped" with no resume; the banner text
   points to Retry recovery "when it is offered". Whether a `handoff-partial` group (a frozen run `settled-unrecoverable`)
   has any exit at all is not defined by either spec.
4. **The banner names the way out in words; the buttons stay in the Dispatch section.** Moving them into the banner was
   not needed for any criterion and would split the resume dialog from `Continue task` buttons. Reversible.
5. **`stop` activity rows for shutdown-created intents.** Spec §5.2's table writes `stop` when "a group stop intent is
   created", while §1 lists shutdown among commands with no activity rows. C1 writes none from `shutdownGroup`; Part B owns
   the per-kind writing sites and should state which reading it took.
6. **Equivalent mutant in C2** (explicit `recordProjectionChange` masked by `recordActivity`), stated in C2 Step 5.
