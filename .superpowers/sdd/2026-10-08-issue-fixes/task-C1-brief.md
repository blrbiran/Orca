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

