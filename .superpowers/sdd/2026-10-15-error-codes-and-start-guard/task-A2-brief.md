### Task A2: A peer exit over HTTP is a definite, named failure (spec A §4.2; criterion 1; correction K2)

**Files:**
- Modify: `src/panel/controlErrors.ts:1-3` (imports), `:7` (`ControlHttpStatus`), `:20-21` (panel-only catalog), `:86-94` (the fallback of `sendMappedControlError`)
- Modify: `src/control/webService.ts:1` (import), `:688-711` (`applyAgentUpdate`)
- Modify: `web/src/locales/en.ts` (`enErrors`, after `"agent-selection-rejected"` at `:1060`), `web/src/locales/zh.ts` (`zhErrors`, the same place)
- Modify (named rewrite): `tests/panel/agentSelectionApi.test.ts:258-263`; append two criteria after that test (ends `:265`)
- Test (create): `tests/panel/ccloopFailedMapping.test.ts`, `web/tests/ccloopFailed.test.ts`

**Interfaces:**
- Consumes: Task A1's `peerFailure`, `ccloopFailedMessage`.
- Produces: `type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 424 | 500 | 503`; catalog entry `{ code: "ccloop-failed", status: 424 }` (served by `GET /api/control/config` `errorCatalog`); HTTP body `{ error: { code: "ccloop-failed", message: ccloopFailedMessage(failure), commandRevision, evidenceIds: [], retryable: true } }`; error-table entries `enErrors["ccloop-failed"]`, `zhErrors["ccloop-failed"]`.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/panel/ccloopFailedMapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { WebControlService } from "../../src/control/webService.js";
import { sendMappedControlError } from "../../src/panel/controlErrors.js";
import { webFixture } from "../control/fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.2, criterion 1: a peer exit is a definite failure -- the web files a status under
// 500 as a refusal and stops looking the command up -- so it must carry ccloop's code and detail and stay retryable.
// Plan correction K2: apply-agent-update is the one command whose ccloop call runs after it reserved durable state.
const recorder = () => {
  const r = { statusCode: 0, body: undefined as unknown, status(code: number) { r.statusCode = code; return r; }, json(body: unknown) { r.body = body; return r; } };
  return r;
};
const mapped = (error: unknown) => { const r = recorder(); sendMappedControlError(r as never, error); return { status: r.statusCode, body: r.body }; };

describe("a peer exit over HTTP (spec A §4.2)", () => {
  it("maps a peer exit to 424 ccloop-failed with ccloop's code and detail, and one with no code as unknown", () => {
    expect(mapped(new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:agent-config-invalid: bad table", commandRevision: null, evidenceIds: [], retryable: true } } });
    expect(mapped(new ControlError("control-peer-exit"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:unknown", commandRevision: null, evidenceIds: [], retryable: true } } });
    // Unchanged (spec A §3): a peer timeout and anything that is not a ControlError stay retryable internal errors.
    expect([mapped(new ControlError("control-peer-timeout")).status, mapped(new Error("boom")).status]).toEqual([500, 500]);
  });

  it("keeps an apply-agent-update whose ccloop exited after the outbox reserved it an unknown outcome (500), its operation pending", async () => {
    const h = await webFixture(); try {
      const port = {
        ...(h.deps.port as unknown as Record<string, unknown>),
        previewAgentInstallations: async () => ({ schema: "orca-agent-detection-preview-v1", previewId: "preview-1", baseTableHash: "a".repeat(64),
          observedAt: "2026-10-15T00:00:00.000Z", installed: [], changes: [{ changeId: "change-1" }] }),
        applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); },
      } as unknown as ExecutionPort;
      const service = new WebControlService({ ...h.deps, port });
      await service.previewAgentUpdates();
      const command = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
        target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
      const failure = await service.applyAgentUpdate(command, { client: "web", principal: "user:owner" }).then(() => null, (error: unknown) => error);
      expect(mapped(failure).status).toBe(500);
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
    } finally { await h.dispose(); }
  });
});
```

(b) Create `web/tests/ccloopFailed.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendControlCommand } from "../src/controlApi.js";

afterEach(() => { vi.unstubAllGlobals(); });

// ccloop error codes spec (2026-10-15) §4.2: the server's 424 is only useful if the web files it as a durable refusal --
// a status of 500 or more is "may not have committed" and is looked up instead (controlApi.ts sendControlCommand). This
// pins the web side the server change relies on; it is green before Task A2 (no web change is needed).
describe("a 424 ccloop-failed in the browser", () => {
  it("is an answered refusal, not an uncertain outcome", async () => {
    const body = { error: { code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", commandRevision: 3, evidenceIds: [], retryable: true } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 424, headers: { "content-type": "application/json" } })));
    expect(await sendControlCommand("/api/control/groups/g/confirm", { commandId: "c-1", expectedRevision: 3, payload: {} } as never))
      .toEqual({ kind: "answered", status: 424, body });
  });
});
```

(c) In `tests/panel/agentSelectionApi.test.ts` the named rewrite. Old (`:258-263`):

```ts
    // The confirm is not bound to a partial resolution: the transient failure is rethrown, which the panel serves as
    // a retryable internal error (a transient code has no durable status) -- not as a selection refusal.
    const confirmed = await confirm(panel, "agents-confirm-flaky", "0".repeat(64));
    expect(confirmed.status).toBe(500);
    expect(confirmed.body).toMatchObject({ error: { code: "control-internal-error", retryable: true } });
```
New:

```ts
    // The confirm is not bound to a partial resolution: the transient failure is rethrown, which the panel serves as
    // a retryable internal error (a transient code has no durable status) -- not as a selection refusal.
    // Rewritten for the ccloop error codes spec (2026-10-15; its §5 names this criterion): this now encodes that the
    // rethrown peer exit is answered 424 ccloop-failed, retryable, still not a selection refusal; this stand-in printed no code.
    const confirmed = await confirm(panel, "agents-confirm-flaky", "0".repeat(64));
    expect(confirmed.status).toBe(424);
    expect(confirmed.body).toMatchObject({ error: { code: "ccloop-failed", message: "ccloop-failed:unknown", retryable: true } });
```

(d) Append after that test (after its closing `});` at `:265`):

```ts
  // ccloop error codes spec (2026-10-15) §4.2, criterion 1: ccloop's code and detail reach the browser, and nothing is booked.
  it.each([
    ["names its code", "2:omp-model-catalog-unavailable: spawn ENOENT", "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT"],
    ["prints no code", "1:Error: socket closed", "ccloop-failed:unknown: Error: socket closed"],
  ])("answers a confirm whose ccloop %s as 424 ccloop-failed carrying it, and books no command row", async (_label, stderr, message) => {
    const failing = async (partial: PartialSelection) => {
      if (partial.agent === "codex") throw new ControlError("control-peer-exit", stderr);
      return claudeCodexResolveAgent(partial);
    };
    const panel = await boot(`epoch-ccloop-${message.length}`, { resolveAgent: failing });
    expect((await setPreferences(panel, "prefs-c", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const before = await view(panel);
    expect((await command(panel, `/api/control/groups/${GROUP}/proposal/agent`, {
      commandId: "agent-task-c", expectedRevision: before.summary.commandRevision,
      payload: { baseProposalVersion: before.proposal.proposalVersion, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } },
    })).status).toBe(200);
    const confirmed = await confirm(panel, "agents-confirm-ccloop", "0".repeat(64));
    expect(confirmed.status).toBe(424);
    expect(confirmed.body).toMatchObject({ error: { code: "ccloop-failed", message, retryable: true } });
    expect(panel.store.db.prepare("SELECT id FROM commands WHERE id='agents-confirm-ccloop'").get()).toBeUndefined();
    await panel.close();
  });
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/ccloopFailedMapping.test.ts tests/panel/agentSelectionApi.test.ts > /private/tmp/oec/logs/a2-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-red.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopFailed.test.ts > /private/tmp/oec/logs/a2-red-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-red-web.log
```
Read both whole. Expected red: "maps a peer exit to 424…" (`500` received), the rewritten "previews a slot whose installation fails transiently…" (`500` received), both rows of "answers a confirm whose ccloop…" (`500`). "keeps an apply-agent-update…" is **green** here (it pins today's 500 against the change). The web test is green (pin; see its comment).

- [ ] **Step 3: Implement**

`src/panel/controlErrors.ts`: after line 2 add `import { ccloopFailedMessage, peerFailure } from "../control/ccloopPort.js";`; line 7 becomes `type ControlHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 424 | 500 | 503;`; after `"control-limit-over-cap-headroom": 403,` (line 20) insert:

```ts
  // Spec 2026-10-15 ccloop error codes §4.2: ccloop exited non-zero; the message names its code (or `unknown`) and detail.
  "ccloop-failed": 424,
```
In `sendMappedControlError`, replace lines 87-93 (the final `sendControlError(res, 500, …)` call) with:

```ts
  // Spec 2026-10-15 ccloop error codes §4.2: a peer exit is a definite, named failure. A command's ccloop calls run before
  // its transaction or inside a savepoint that is rolled back, and the code stays transient, so nothing was booked
  // (apply-agent-update, which reserves first, rethrows an unknown outcome as a plain error: webService.ts).
  const failure = peerFailure(error);
  if (failure !== null) {
    sendControlError(res, 424, "ccloop-failed", ccloopFailedMessage(failure), { ...context, retryable: true });
    return;
  }
  sendControlError(
    res,
    500,
    "control-internal-error",
    "The control read could not be completed.",
    { ...context, retryable: true },
  );
```

`src/control/webService.ts`: add `import { peerFailure } from "./ccloopPort.js";` after line 1. In `applyAgentUpdate` replace

```ts
      const result = await applyAgentUpdate({ store: this.store, port: this.deps.port }, command, context);
```
with

```ts
      let result: Awaited<ReturnType<typeof applyAgentUpdate>>;
      try { result = await applyAgentUpdate({ store: this.store, port: this.deps.port }, command, context); }
      catch (error) {
        // Plan correction K2 (2026-10-15): ccloop's apply runs after the outbox row is reserved, and a peer exit leaves the
        // operation pending for same-identity reconciliation -- its outcome is unknown, so it is not a 424 refusal.
        if (peerFailure(error) !== null && hasPendingAgentUpdate(this.store, command.actorId)) throw new Error("agent-installation-update-outcome-unknown", { cause: error });
        throw error;
      }
```

`web/src/locales/en.ts` `enErrors`, after the `"agent-selection-rejected"` line:

```ts
  // ccloop error codes spec (2026-10-15) §4.2: ccloop exited non-zero; the detail is `<code>: <detail>` (web/src/ccloopCodes.ts explains a known code).
  "ccloop-failed": "ccloop failed: {{detail}}",
```
`web/src/locales/zh.ts` `zhErrors`, same place:

```ts
  "ccloop-failed": "ccloop 执行失败：{{detail}}",
```

- [ ] **Step 4: Run green**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/panel/ccloopFailedMapping.test.ts tests/panel/agentSelectionApi.test.ts tests/panel/refusalCoverage.test.ts tests/panel/permissions.test.ts tests/panel/controlChannel.test.ts tests/control/agentUpdates.test.ts tests/control/agentUpdateAdmission.test.ts > /private/tmp/oec/logs/a2-green.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-green.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard/web && ../node_modules/.bin/vitest run tests/ccloopFailed.test.ts tests/refusalText.test.tsx tests/agentPreviewRefresh.test.tsx > /private/tmp/oec/logs/a2-green-web.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-green-web.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && npm run typecheck > /private/tmp/oec/logs/a2-tc.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a2-tc.log
```
Read all whole: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit** — `git add src/panel/controlErrors.ts src/control/webService.ts web/src/locales/en.ts web/src/locales/zh.ts tests/panel/agentSelectionApi.test.ts tests/panel/ccloopFailedMapping.test.ts web/tests/ccloopFailed.test.ts`; diff to `/private/tmp/oec/logs/a2-diff.log`, read; message `feat(panel): answer a ccloop peer exit as 424 ccloop-failed with its code and detail` + trailer (via `-F`).

- [ ] **Step 6 (reviewer, clone `a2`, web build first): mutations**
  - `A2a` drop the branch: file `src/panel/controlErrors.ts`, spec `{"from": "  if (failure !== null) {\n    sendControlError(res, 424, \"ccloop-failed\", ccloopFailedMessage(failure), { ...context, retryable: true });\n    return;\n  }\n", "to": ""}`, test `tests/panel/ccloopFailedMapping.test.ts` (root) — red: "maps a peer exit to 424…" (`500`). Second run `A2a2`, same spec, test `tests/panel/agentSelectionApi.test.ts` — red: the rewritten test and both "answers a confirm…" rows (`500`).
  - `A2b` drop the K2 wrap: file `src/control/webService.ts`, spec `{"from": "        if (peerFailure(error) !== null && hasPendingAgentUpdate(this.store, command.actorId)) throw new Error(\"agent-installation-update-outcome-unknown\", { cause: error });\n", "to": ""}`, test `tests/panel/ccloopFailedMapping.test.ts` — red: "keeps an apply-agent-update…" (`424` received).
  - `A2c` web pin: file `web/src/controlApi.ts`, spec `{"from": "if (res.status >= 500) return { kind: \"uncertain\"", "to": "if (res.status >= 424) return { kind: \"uncertain\""}`, dir `web`, test `tests/ccloopFailed.test.ts` — red (`kind: "uncertain"`).
  - `A2d` catalog coverage: file `web/src/locales/zh.ts`, spec `{"from": "  \"ccloop-failed\": \"ccloop 执行失败：{{detail}}\",\n", "to": ""}`, test `tests/panel/refusalCoverage.test.ts` — red: "has a zh entry for every catalog code…" (`["ccloop-failed"]`) and "keeps the two tables over the same codes".

---

