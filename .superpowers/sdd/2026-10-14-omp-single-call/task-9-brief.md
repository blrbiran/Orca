### Task 9 (Orca): Clarify and split send the same bound

**Files:**
- Modify: `src/control/requirementCommands.ts:6-12` (import), `:97`
- Modify: `src/control/requirementRecords.ts:24` (append-only note)
- Test: `tests/control/requirementOutputBound.test.ts` (new)

**Interfaces:**
- Consumes: Task 8's `singleCallOutputBound`; `PreparedEstimatorSlot.observation.resolution` (`src/control/planImport.ts:42`).
- Produces: `group.requirement.maxOutputTokens` = the bound at `requirement-open`; every clarify/split call sends it (`src/control/requirementCalls.ts:246`).

- [ ] **Step 1: Write the failing test** — `tests/control/requirementOutputBound.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// OMP single call (spec 2026-10-14 §4): clarify and split are single calls too, so they send the same bound as the estimate --
// the larger of the preflight's cap and the agent's own -- or ccloop's spawn check refuses every omp call whose catalog
// cap is above the preflight's. The bound is frozen at requirement-open with the rest of the requirement (DR8).
const open = (groupId: string) => ({
  schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId },
  payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", contentLanguage: "zh" },
}) as never;

describe("clarify and split send the estimate's output bound", () => {
  it("freezes the agent's cap as the requirement's maxOutputTokens when it is above the preflight value, and the preflight value otherwise", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      for (const [groupId, cap, expected] of [["cap-high", 100_000, 100_000], ["cap-low", 1_000, 64_000], ["cap-null", null, 64_000]] as const) {
        const port = { ...x.fake.port, resolveAgent: async (partial: Parameters<typeof x.fake.port.resolveAgent>[0]) => ({ ...await x.fake.port.resolveAgent(partial), singleCallOutputCap: cap }) };
        const profile = resolveProfile(profileSnapshot(), port);
        const service = new WebControlService({ ...x.service.deps, profileRouter: createExecutionProfileRouter([profile]),
          defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: profile.profileHash, estimateMode: "strict" as const }) });
        expect(await service.openRequirement(open(groupId))).toMatchObject({ result: { kind: "requirement-opened", groupId } });
        expect([groupId, readRequirementGroup(x.store, groupId).requirement.maxOutputTokens]).toEqual([groupId, expected]);
      }
    } finally { await x.dispose(); }
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/requirementOutputBound.test.ts > /private/tmp/osc/logs/t9-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-red.log
```
Read it whole. Expected red: `["cap-high", 64000]` received.

- [ ] **Step 3: Implement** — `src/control/requirementCommands.ts`: after line 8 (`import { estimatorCompatibility } …`) add `import { singleCallOutputBound } from "./estimator.js";`; line 97's `maxOutputTokens: preflight.maxOutputTokens,` becomes:

```ts
          agentSlot: slot.outcome.slot, agentOverrides: payload.agent === null ? {} : { estimator: payload.agent }, maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),
```

`src/control/requirementRecords.ts:24` — keep the sentence, append:

```ts
  /** DR8: the profile's estimatorPreflight.maxOutputTokens, frozen at open; every call of this requirement asks for it.
   * OMP single call (spec 2026-10-14 §4, session 7ea088aa): since then the larger of that and the agent's singleCallOutputCap. */
```

- [ ] **Step 4: Run green, with the requirement criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/requirementOutputBound.test.ts tests/control/requirementCommands.test.ts tests/control/driverRequirementClarify.test.ts tests/control/driverRequirementSplit.test.ts > /private/tmp/osc/logs/t9-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t9-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t9-tc.log
```
Read both whole. Expected: all pass, 0 skipped (the registered `driverRequirementSplit` / `requirementCommands` load timeouts: rerun the file alone per `known-load-flakes.md` before judging); typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/requirementCommands.ts src/control/requirementRecords.ts tests/control/requirementOutputBound.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t9-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): send clarify and split with the same single-call output bound

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

