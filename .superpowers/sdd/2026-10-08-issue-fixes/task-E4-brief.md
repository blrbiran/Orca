### Task E4: An archived group refuses every group-targeted command but unarchive-group (spec §6.3)

**Files:**
- Modify: `src/control/commandLedger.ts` — imports (lines 1-14), `applyWebCommand` (lines 308-310, anchor
  `if (rawCommand.expectedRevision !== currentCommandRevision) {` inside `applyWebCommand`, not the one in
  `preflightWebCommand`)
- Test: `tests/control/archiveGroup.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: E2 `isGroupArchived`; E3 verbs; Part D `WebControlService.retryTask`.
- Produces: the durable refusal `group-archived` for every group-scoped verb except `unarchive-group`.

- [ ] **Step 1: Write the failing test** — append to `tests/control/archiveGroup.test.ts` (add
  `import { commandVerbSchema } from "../../src/control/webProtocol.js";` to the imports):

```ts
/** The verbs whose ledger scope is not a group (no group to be archived); everything else targets a group. */
const NOT_GROUP = ["shutdown", "set-workspace-mode", "set-integration-scheme", "set-agent-preferences", "set-spend-cap", "clear-spend-cap", "set-usage-calendar"];
const LOOP_PAYLOAD = { baseLoopVersion: 0, plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 1, activeMs: 1, attempts: 1 } };
const CONFIRM_PAYLOAD = { planHash: "a".repeat(64), proposalVersion: 1, budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: "b".repeat(64), worker: "b".repeat(64), handoff: "b".repeat(64), goalReview: "b".repeat(64) }, contextPolicy: { handoffAtContextTokens: null }, selectionsHash: "c".repeat(64) };
type Call = (s: WebControlService, command: never) => unknown;
/** Every group-targeted verb but unarchive-group: how it is sent, its target kind and a payload its raw schema accepts. */
const CALLS: Record<string, { call: Call; target: "group" | "task"; payload: unknown }> = {
  "import-plan": { call: (s, c) => s.importPlan(c), target: "group", payload: { groupId: "g", repoId: "repo", planId: "plan" } },
  "proposal-edit": { call: (s, c) => s.editProposal(c), target: "group", payload: { baseProposalVersion: 1, operations: [] } },
  "proposal-set-agent": { call: (s, c) => s.proposalSetAgent(c), target: "group", payload: { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: null } },
  estimate: { call: (s, c) => s.createEstimate(c), target: "group", payload: { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" } },
  confirm: { call: (s, c) => s.confirm(c), target: "group", payload: CONFIRM_PAYLOAD },
  start: { call: (s, c) => s.start(c), target: "group", payload: {} },
  "pause-dispatch": { call: (s, c) => s.pauseDispatch(c), target: "group", payload: {} },
  "handoff-stop": { call: (s, c) => s.handoffStop(c), target: "group", payload: {} },
  "resume-dispatch": { call: (s, c) => s.resumeDispatch(c), target: "group", payload: {} },
  "resume-from-handoff": { call: (s, c) => s.resumeFromHandoff(c), target: "group", payload: { selections: [] } },
  "set-limit": { call: (s, c) => s.setLimit(c), target: "group", payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } },
  "continue-task": { call: (s, c) => s.continueTask(c), target: "task", payload: { predecessorRunId: "run-x", checkpointId: "cp-x" } },
  "recovery-retry": { call: (s, c) => s.recoveryRetry(c), target: "group", payload: { scope: "group", groupId: "g" } },
  "set-group-integration": { call: (s, c) => s.setGroupIntegration(c), target: "group", payload: { integration: { delivery: "keep" } } },
  "retry-integration": { call: (s, c) => s.retryIntegration(c), target: "group", payload: {} },
  "resolve-integration-conflict": { call: (s, c) => s.resolveIntegrationConflict(c), target: "group", payload: {} },
  "set-task-labels": { call: (s, c) => s.setTaskLabels(c), target: "task", payload: { labels: null, baseLabelsVersion: 0 } },
  "set-task-loop": { call: (s, c) => s.setTaskLoop(c), target: "task", payload: LOOP_PAYLOAD },
  "requirement-open": { call: (s, c) => s.openRequirement(c), target: "group", payload: { groupId: "g", repoId: "repo", idea: "an idea" } },
  "requirement-answer": { call: (s, c) => s.answerRequirement(c), target: "group", payload: { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] } },
  "requirement-consensus": { call: (s, c) => s.requirementConsensus(c), target: "group", payload: { roundNo: 1 } },
  "requirement-draft-feedback": { call: (s, c) => s.requirementDraftFeedback(c), target: "group", payload: { draftNo: 1, feedback: "more" } },
  "requirement-draft-accept": { call: (s, c) => s.acceptRequirementDraft(c), target: "group", payload: { draftNo: 1, draftHash: "a".repeat(64) } },
  "retry-task": { call: (s, c) => (s as unknown as { retryTask(command: never): unknown }).retryTask(c), target: "group", payload: { taskId: "a" } },
  "archive-group": { call: (s, c) => s.archiveGroup(c), target: "group", payload: {} },
};

describe("an archived group refuses every group-targeted command but unarchive-group (spec §6.3)", () => {
  it("covers every group-targeted verb the protocol knows, so a new verb cannot slip past", () => {
    const expected = commandVerbSchema.options.filter((verb) => !NOT_GROUP.includes(verb) && verb !== "unarchive-group").sort();
    expect(Object.keys(CALLS).sort()).toEqual(expected);
  });

  it.each(Object.keys(CALLS))("refuses %s with group-archived, durably, and changes nothing", async (verb) => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const before = JSON.stringify(body(h));
      const entry = CALLS[verb]!;
      const target = entry.target === "task" ? { kind: "task", groupId: "g", taskId: "a" } : { kind: "group", groupId: "g" };
      const command = h.rawCommand(`c-${verb}`, revisionOf(h), verb as never, target as never, entry.payload) as never;
      expect(await entry.call(service, command)).toMatchObject({ error: { code: "group-archived" } });
      expect(lookupCommandResult(h.store, "g", `c-${verb}`)!.body).toMatchObject({ error: { code: "group-archived" } });
      expect(JSON.stringify(body(h))).toBe(before);
    } finally { await h.dispose(); }
  });

  it("still takes unarchive-group, and after it start is accepted again", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ result: { kind: "unarchived" } });
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/archiveGroup.test.ts > <S>/e4.txt 2>&1; echo rc=$?`
  → `rc=1`: e.g. "refuses start" gets `{ result: { kind: "scheduled" } }`; "refuses archive-group" gets
  `archive-run-active`/success instead of `group-archived`.

- [ ] **Step 3: Implement** — `src/control/commandLedger.ts`: add `import { isGroupArchived } from "./archivedMark.js";`
  after line 3. In `applyWebCommand`, replace

```ts
    if (rawCommand.expectedRevision !== currentCommandRevision) {
      unvalidated = revisionConflict(currentCommandRevision);
    } else {
```

  with

```ts
    if (rawCommand.expectedRevision !== currentCommandRevision) {
      unvalidated = revisionConflict(currentCommandRevision);
    } else if (commandScope.groupId !== null && rawCommand.verb !== "unarchive-group" && isGroupArchived(store, commandScope.groupId)) {
      // Issue-fixes spec §6.3: an archived group refuses every group-targeted command but unarchive-group. Every group
      // command books its outcome here (persistCommandOutcome's only other caller books revision conflicts), so this one
      // gate, ahead of expand and apply, covers every verb -- retry-task included -- and any verb added later.
      unvalidated = domainErrorOutcome(new ControlError("group-archived"), resultCommandRevision)!;
    } else {
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0` (27 refusal cases plus the two others). Then
  `./node_modules/.bin/vitest run tests/control/commandLedger.test.ts tests/control/requirementGuards.test.ts tests/control/webMutations.test.ts > <S>/e4-wide.txt 2>&1; echo rc=$?` → `rc=0`.

- [ ] **Step 5: Mutation** (clone): delete the `else if (...) { ... }` branch → every `refuses <verb>` case except
  `archive-group`'s goes red (that one answers a guard code or success, also red). Change `rawCommand.verb !==
  "unarchive-group"` to `true` → "still takes unarchive-group" red.

- [ ] **Step 6: Commit** — `git -C <wt> add src/control/commandLedger.ts tests/control/archiveGroup.test.ts`, message
  `feat(control): refuse every command but unarchive-group on an archived group at the ledger gate` (+ Co-Authored-By).

