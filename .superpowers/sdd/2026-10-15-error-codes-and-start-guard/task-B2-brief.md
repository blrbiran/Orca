### Task B2: The `group-execution-pending` guard (spec B §3.2; criteria 1-6; correction K7)

**Files:**
- Modify: `src/control/errors.ts:95` (after `"start-state-conflict": 409,`)
- Modify: `src/control/webDispatch.ts:125-171` (`scheduleStart`), imports
- Modify: `skills/orca-control/SKILL.md:32`
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (error tables)
- Test (create): `tests/control/startGuard.test.ts`, `tests/panel/startGuardSocket.test.ts`; append one test to `tests/entry/skill.test.ts`

**Interfaces:**
- Consumes: B1's `groupExecutionPendingInStore`; `applyWebCommand`, `preflightWebCommand` (`src/control/commandLedger.ts:160, 302`).
- Produces: durable `"group-execution-pending": 409`; `scheduleStart` refuses before the probe (ledgered via `applyWebCommand` with a throwing `expand`/`apply`, the `applyRequirementOpen` pattern at `requirementCommands.ts:74-76`) and again inside the transaction after the clarifying check. Precedence: preflight (`revision-conflict`, `group-archived`) → `requirement-not-split` → `group-execution-pending` → the rest unchanged.

- [ ] **Step 0: Census baseline** (before any B2 edit; long, run in the background and wait; record `uptime`)

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && uptime > /private/tmp/oec/logs/b2-census-before.uptime && ORCA_CCLOOP_BIN=/private/tmp/orp-gate/ccl/dist/cli.js ORCA_AGENTS_TABLE=/private/tmp/oec/gate/table.json ./node_modules/.bin/vitest run tests/control tests/panel tests/entry --reporter=json --outputFile=/private/tmp/oec/logs/b2-census-before.json > /private/tmp/oec/logs/b2-census-before.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/b2-census-before.log
```
(The table is written in Task G Step 1; write it now if Task G has not run — the same command.) Read the log whole; keep the JSON.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/control/startGuard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { recordUsage } from "../../src/control/usage.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.2, criteria 1-6 (feedback #53): a second start while the group's execution is pending
// used to be accepted -- a revision bump, an activity row and a redundant wake -- over HTTP, the socket, the CLI and MCP.
// It is refused by name before the agent is asked, ledgered, and checked again inside the transaction.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function confirmed(tasks = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}
const fingerprint = (h: Fixture): string => JSON.stringify({
  groups: h.store.db.prepare("SELECT id,revision,projection_seq,body FROM groups ORDER BY id").all(),
  activity: h.store.db.prepare("SELECT * FROM activity ORDER BY seq").all(),
  wakes: h.store.db.prepare("SELECT id,kind,body,delivered FROM scheduler_wakes ORDER BY rowid").all(),
  allowances: h.store.db.prepare("SELECT * FROM funded_allowances ORDER BY rowid").all(),
  work: h.store.db.prepare("SELECT id,body FROM work_items ORDER BY id").all(),
});
const setWork = (h: Fixture, patch: Record<string, unknown>) => {
  const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, ...patch }));
};

describe("a second start is refused while execution is pending (spec B §3.2)", () => {
  it("C1: refuses before asking the agent, changes nothing, and replays the same refusal from the ledger", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const before = fingerprint(h), asked = h.asked.length;
      const second = h.command("start", {}, "second-start");
      const refused = await service.start(second);
      expect(refused).toEqual({ error: { code: "group-execution-pending", message: "group-execution-pending", commandRevision: expect.any(Number), evidenceIds: [], retryable: false } });
      expect([h.asked.length - asked, fingerprint(h) === before]).toEqual([0, true]);
      expect(lookupCommandResult(h.store, "g", "second-start")).toMatchObject({ originalStatus: 409, body: refused });
      expect(await service.start(second)).toEqual(refused);
      expect(h.asked.length - asked).toBe(0);
    } finally { await h.dispose(); }
  });

  it.each(["no-start", "resume"])("C2: refuses on an undelivered %s wake alone", async (kind) => {
    const { h, service } = await confirmed(); try {
      h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,?,?,0)").run(`injected-${kind}`, "g", kind, "{}");
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it.each(["running", "active", "starting", "start-unknown", "held", "continuing"])("C2: refuses on a %s task alone", async (status) => {
    const { h, service } = await confirmed(); try {
      setWork(h, { status });
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on an active work run alone", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      setWork(h, { status: "ready" });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n).toBe(0);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C2: refuses on a held task left by a settled handoff and a resume with no selection (a real state)", async () => {
    const { h, service } = await confirmed([{ taskId: "a" }, { taskId: "b" }]); try {
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const claimed = await deliverScheduledStart(h.deps, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      recordUsage(h.store, { runId: claimed.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 10, activeMs: 10, attempts: 1, sessions: 1 }, source: { artifactId: `usage-${claimed.runId}`, hash: "e".repeat(64) } });
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(claimed.runId)!.id);
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-recoverable" });
      expect(await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }))).toMatchObject({ result: { kind: "resumed-from-handoff" } });
      // The premise (production state, not written by this test): the held task is the only pending fact.
      expect([h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get()!.n,
        h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1 AND json_extract(body,'$.phase')='work'").get()!.n]).toEqual([0, 0]);
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "group-execution-pending" } });
    } finally { await h.dispose(); }
  });

  it("C3: an active estimate run alone is not execution: start answers estimate-in-flight", async () => {
    const { h, service } = await confirmed(); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(await service.start(h.command("start", {}))).toMatchObject({ error: { code: "estimate-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("C3: a clarifying group with a call in flight still answers requirement-not-split", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      await x.deliver();
      expect(x.runs()).toEqual([expect.objectContaining({ state: "starting", phase: "single-call", active: 1 })]);
      expect(await x.service.start(x.command("start", {}))).toMatchObject({ error: { code: "requirement-not-split" } });
    } finally { await x.dispose(); }
  });

  it("C4: catches a start wake that arrives while the frozen profiles are probed", async () => {
    const { h, service } = await confirmed(); try {
      const original = h.resolveAgent.getMockImplementation()!;
      let injected = false;
      h.resolveAgent.mockImplementation(async (partial) => {
        if (!injected) { injected = true; h.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('raced-start','g','start','{}',0)").run(); }
        return original(partial);
      });
      expect(await service.start(h.command("start", {}, "raced"))).toMatchObject({ error: { code: "group-execution-pending" } });
      expect([injected, h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()!.n]).toEqual([true, 1]);
    } finally { await h.dispose(); }
  });

  it("C6: after retry-task returns the only task to ready, and before any driver round re-arms a wake, start is accepted", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried", taskId: "a" } });
      expect(await t.service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
```

(b) Create `tests/panel/startGuardSocket.test.ts`:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";
import { bindControlSocket, buildControlSocketApp, socketPathTooLong } from "../../src/panel/controlSocket.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { command, createHarness, GROUP, revision } from "./fixtures/controlPanel.js";
import { overSocket } from "./fixtures/socketPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm } = createOverviewFixtures(h);

// Start guard spec (2026-10-15) §5 criterion 5: the refusal is the same over the control socket (agents) and through
// `orca control send` (status 409 in the envelope, exit 2), because both reach scheduleStart through the same routes.
describe("a second start over the control socket and the CLI (spec B criterion 5)", () => {
  it("answers 409 group-execution-pending on the socket, and the CLI prints that envelope and exits 2", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    expect((await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "start-1", expectedRevision: await revision(panel), payload: {} })).status).toBe(202);
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), "s")));
    const path = join(stateDir, "control.sock");
    expect(socketPathTooLong(path)).toBe(false);
    const bound = await bindControlSocket(buildControlSocketApp({ store: panel.store, epoch: panel.epoch, config: undefined as never, service: panel.service }), path);
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
    try {
      const rev = await revision(panel);
      const socket = await overSocket(path, "POST", `/api/control/groups/${GROUP}/start`, { "x-orca-client": "cli" }, { commandId: "start-socket", expectedRevision: rev, payload: {} });
      expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([409, "group-execution-pending"]);
      const printed: string[] = [];
      const exit = await runControlCommand(["send", `groups/${GROUP}/start`, "--expected-revision", String(rev), "--payload", "{}", "--command-id", "start-cli", "--control-state-dir", stateDir], {},
        { write: (line) => { printed.push(line); }, readFile: () => "" });
      expect([exit, JSON.parse(printed.join("")).status, JSON.parse(printed.join("")).body.error.code]).toEqual([2, 409, "group-execution-pending"]);
    } finally { await bound.close(); }
  }, 30_000);
});
```

(c) Append inside the `describe` of `tests/entry/skill.test.ts`:

```ts
  // Start guard spec (2026-10-15) §3.2: an agent is told the server refuses a second start, by name.
  it("names group-execution-pending as the refusal of a second start, and no longer says the server accepts one", () => {
    expect(skill).toContain("`group-execution-pending`");
    expect(skill).not.toContain("the server still accepts a second start");
  });
```

- [ ] **Step 2: Run red** — `tests/control/startGuard.test.ts tests/panel/startGuardSocket.test.ts tests/entry/skill.test.ts` to `b2-red.log` (web build exists from U2). Expected red: C1, every C2 row, C4, the socket test, the skill test. **C3 (both) and C6 are green** at RED: they pin what the guard must not refuse.

- [ ] **Step 3: Implement**
  - `errors.ts` after `"start-state-conflict": 409,`: `  // Start guard spec (2026-10-15) §3.2: a start while the group's execution is pending or running (feedback #53).\n  "group-execution-pending": 409,`.
  - `webDispatch.ts`: `import { groupExecutionPendingInStore } from "./executionPending.js";`; before `export async function scheduleStart` add
    ```ts
    /** Start guard spec (2026-10-15) §3.2: a group with a plan whose execution is pending; a clarifying group is left to requirement-not-split. */
    function startRefusedAsPending(store: ControlStore, groupId: string): boolean {
      const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (row === undefined || (JSON.parse(String(row.body)) as { status?: unknown }).status === "clarifying") return false;
      return groupExecutionPendingInStore(store, groupId);
    }
    function refuseStart(store: ControlStore, command: StartCommand): CommandResult {
      const refusal = new ControlError("group-execution-pending");
      return applyWebCommand<CommandResult>(store, { rawCommand: command, expand: () => { throw refusal; }, apply: () => { throw refusal; } }).body;
    }
    ```
    In `scheduleStart`, as the first statement inside `try {` (before `let degraded = false;`): `    // Start guard spec §3.2: refused, ledgered, before the frozen profiles are probed -- a refused start asks no agent.\n    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);`; inside `apply`, after `if ((group as { status: string }).status === "clarifying") throw new ControlError("requirement-not-split");`: `        // And again here: a wake inserted while the probe ran is still caught.\n        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError("group-execution-pending");`.
  - `SKILL.md:32` becomes: `   A group's \`state\` stays \`ready\` while a Web-started first run is pending or executing; read \`executionPending\` on the group summary: while it is true the server refuses \`start\` with \`group-execution-pending\` (409) and dispatches the group's next task itself.`
  - `en.ts` `enErrors` (next to `"group-state-invalid"`): `  "group-execution-pending": "This group is already starting or running; its next task is dispatched automatically.",`; `zh.ts`: `  "group-execution-pending": "这个组已在启动或运行中；它的下一个任务会自动派发。",`.

- [ ] **Step 4: Run green** — the three test files plus `tests/control/webDispatch.test.ts tests/control/requirementGuards.test.ts tests/panel/refusalCoverage.test.ts tests/panel/controlOverviewApi.test.ts` to `b2-green.log`; typecheck.

- [ ] **Step 5: Census after** — the Step 0 command with `-after` names. Then compare with a script (`/private/tmp/oec/census.py`, run with `python3 -I`): read both JSON files, list every `fullName` whose status is `failed` after and `passed` before, write to `/private/tmp/oec/logs/b2-census-new-reds.txt`; read it whole. Each listed file is rerun alone once (`./node_modules/.bin/vitest run <file>`, redirected) to separate load timeouts (handoff §6.7, `known-load-flakes.md`) from assertion reds.

- [ ] **Step 6: Human stop (correction K7)** — if any existing criterion outside spec B §5's list is red for `start refused: {"code":"group-execution-pending"…}` (expected: the driverHarness double-claim criteria), **do not edit them**. Commit B2 (Step 7) so the branch is describable, and put in the checkpoint's `awaitingHuman`: the exact list from `b2-census-new-reds.txt`, and the two options —
  - **Option A (one fixture change, listed per handoff §6.9):** `tests/control/fixtures/driverHarness.ts` `claim()` arms a later claim the way the driver does:
    ```ts
      /** Start guard spec (2026-10-15) §3.2: while the group's execution is pending a second start is refused, so a later
       * claim is armed as the driver arms it (replenishStartWakes), then delivered. Claims keep the first start's revision. */
      const claim = async (): Promise<string> => {
        if (groupExecutionPendingInStore(h.store, "g")) {
          if (replenishStartWakes({ store: h.store, admissionGate: h.deps.admissionGate }).length === 0) throw new Error("claim: the driver would arm no start wake");
        } else {
          const started = await service.start(h.command("start", {}));
          if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
        }
        const delivered = await deliverScheduledStart(dispatch, "g");
        if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
        return delivered.runId;
      };
    ```
    (claim identity and run `commandId` then carry the first start's revision for later claims — any criterion that pins those strings will show up in a census after the change and is reported again).
  - **Option B:** the human names each listed criterion for a rewrite.
  Task G cannot pass until the ruling is applied and a new census shows no unexplained red. Continue with B3, S1-S3 meanwhile (they do not depend on it).

- [ ] **Step 7: Commit** — `src/control/errors.ts src/control/webDispatch.ts skills/orca-control/SKILL.md web/src/locales/en.ts web/src/locales/zh.ts tests/control/startGuard.test.ts tests/panel/startGuardSocket.test.ts tests/entry/skill.test.ts`; message `feat(control): refuse a second start while the group's execution is pending (#53)`. If Step 6 found reds, the commit body adds one line: `Known red pending the human's ruling (plan correction K7): <n> criteria, list in the checkpoint.`

- [ ] **Step 8 (reviewer, clone `b2`, web build first): mutations** (test `tests/control/startGuard.test.ts` unless named)
  - `B2a` drop the pre-probe check: `src/control/webDispatch.ts` `{"from": "    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n", "to": ""}` — red: C1 at the probe count only (still 409 from the transaction).
  - `B2b` move it after the probe: `[{"from": "    if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n", "to": ""}, {"from": "      observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));\n", "to": "      observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));\n      if (startRefusedAsPending(store, groupTarget(command))) return refuseStart(store, command);\n"}]` — red: C1 at the probe count.
  - `B2c` drop the in-transaction check: `{"from": "        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n", "to": ""}` — red: C4 only.
  - `B2d` per wake kind (2 runs): `src/control/executionPending.ts` `{"from": "new Set([\"start\", \"no-start\", \"resume\"])", "to": "new Set([\"start\", \"resume\"])"}` — red: C2 `no-start` only; `…"to": "new Set([\"start\", \"no-start\"])"` — red: C2 `resume` only.
  - `B2e` per busy status (6 runs): remove each of `"running"`, `"active"`, `"starting"`, `"start-unknown"`, `"held"`, `"continuing"` from `BUSY_WORK` in turn (e.g. `{"from": "\"running\", \"active\",", "to": "\"active\","}`) — red: that status's C2 row (and, for `held`, the real-state held criterion) only.
  - `B2f` drop the work-run disjunct: `{"from": "    || facts.activeRunPhases.some((phase) => phase === \"work\")\n", "to": ""}` — red: "C2: refuses on an active work run alone" only.
  - `B2g` count every active run: `{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}` — red: C3 estimate row (`group-execution-pending` received).
  - `B2h` clarifying precedence: `[{"from": "facts.activeRunPhases.some((phase) => phase === \"work\")", "to": "facts.activeRunPhases.some(() => true)"}]` on `src/control/executionPending.ts` **and**, as a second file in the same run (apply both with two mutate calls in one manual run, recorded like `mut.sh`), `src/control/webDispatch.ts` `[{"from": "        if ((group as { status: string }).status === \"clarifying\") throw new ControlError(\"requirement-not-split\");\n        // And again here: a wake inserted while the probe ran is still caught.\n        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n", "to": "        if (groupExecutionPendingInStore(store, groupId)) throw new ControlError(\"group-execution-pending\");\n        if ((group as { status: string }).status === \"clarifying\") throw new ControlError(\"requirement-not-split\");\n"}]` — red: C3 clarifying row. (Either edit alone leaves it green: the store entry reads no task work items for a clarifying group and its call is not a work run — record that as the reason this criterion needs a two-edit mutation.)
  - `B2i` count inactive runs: `{"from": "SELECT body FROM runs WHERE group_id=? AND active=1", "to": "SELECT body FROM runs WHERE group_id=?"}` on `executionPending.ts` — red: C6.
  - `B2j` socket parity: drop both checks (B2a's spec plus B2c's spec in one array on `webDispatch.ts`), test `tests/panel/startGuardSocket.test.ts` — red (202).
  - `B2k` skill text: `skills/orca-control/SKILL.md` restore the old sentence `(the server still accepts a second start while one is pending)`, test `tests/entry/skill.test.ts` — red.

---

