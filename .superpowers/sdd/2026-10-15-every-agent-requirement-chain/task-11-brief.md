## Task 11: Orca reads `"v1-soft"`; soft mode accepts it, strict refuses it (spec §6.2; criterion 4)

**Files:**
- Modify: `src/control/ccloopPort.ts:47`, `src/control/agentSelection.ts:36`, `src/control/estimatorCompatibility.ts:16`
- Modify (fixture, listed for the human): `tests/control/fixtures/ccloopWorld.ts:82,162` (`WorldOptions.estimateMode?: "strict" | "soft"`, default `"soft"`)
- Test: `tests/control/estimatorSoftExecution.test.ts`, `tests/control/codexRequirementOpen.test.ts`

- [ ] **Step 1: failing tests.** `tests/control/estimatorSoftExecution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft accepts "v1" or "v1-soft". The fixture profile is strict-capable
// (bounded, with a request-bound proof), so single-call-unavailable is the only reason either way.
const profile = resolveProfile(profileSnapshot());
const at = (execution: "v1" | "v1-soft" | null, mode: "strict" | "soft") => estimatorCompatibility({ profile, observed: profile.snapshot.profile.capabilities, probeFailureCode: null,
  resolution: { ...fixtureResolutionFor(profile.snapshot.profile.capabilities), singleCallExecution: execution } }, mode).reasonCodes;

describe("strict and soft single-call execution (spec §6.2)", () => {
  it.each([
    ["v1", "strict", []], ["v1-soft", "strict", ["single-call-unavailable"]], [null, "strict", ["single-call-unavailable"]],
    ["v1", "soft", []], ["v1-soft", "soft", []], [null, "soft", ["single-call-unavailable"]],
  ] as const)("%s in %s mode", (execution, mode, reasons) => {
    expect(at(execution, mode)).toEqual(reasons);
  });

  it("parses v1-soft from ccloop and refuses any other new value", () => {
    const answer = { protocol: 3, selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, configHash: "a".repeat(64), timeoutMs: 1000, killGraceMs: 0,
      capabilities: profile.snapshot.profile.capabilities, singleCallExecution: "v1-soft", singleCallOutputCap: null };
    expect([ccloopResolutionSchema.safeParse(answer).success, ccloopResolutionSchema.safeParse({ ...answer, singleCallExecution: "v2" }).success]).toEqual([true, false]);
  });
});
```

  `tests/control/codexRequirementOpen.test.ts` (real ccloop; must not be skipped in the gate -- see Task 16):

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ccloopWorlds, raw, realBinary } from "./fixtures/ccloopWorld.js";

// Spec 2026-10-15 criterion 4 (R1, R2, R7) against the real ccloop build and its fake codex: a codex estimator opens a
// requirement in soft mode under a profile that declares no window; strict mode still refuses it by name.
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-codex-req-", epochPrefix: "epoch-codex-req-" });
afterAll(removeRoots);

describe("requirement-open with a codex estimator (spec 2026-10-15 criterion 4)", { timeout: 120_000 }, () => {
  relocateHome("orca-codex-req-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });
  const open = async (estimateMode: "strict" | "soft") => {
    const w = await world([], {}, { estimateMode });
    const runtime = await w.boot();
    try {
      const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
        { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "codex" } } }, { kind: "operator", operatorId: "human" }));
      expect("error" in prefs ? prefs.error : "set").toBe("set");
      return await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: w.repoId, idea: "Let people export notes.", contentLanguage: "en" } } as never);
    } finally { await w.teardown(); }
  };
  it("opens in soft mode", async () => {
    expect(await open("soft")).toMatchObject({ result: { kind: "requirement-opened" } });
  });
  it("refuses in strict mode with single-call-unavailable among the reasons", async () => {
    expect(await open("strict")).toMatchObject({ error: { code: "agent-selection-rejected", message: expect.stringContaining("single-call-unavailable") } });
  });
});
```

- [ ] **Step 2: red.** P-2 both files with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"` and `--reporter=json --outputFile="$LOGS/t11-red.json"`;
  read the JSON's `numPendingTests` for `codexRequirementOpen` (must be 0: a skip is not red).

- [ ] **Step 3: implement.** `ccloopPort.ts:47` `singleCallExecution:z.enum(["v1","v1-soft"]).nullable()` and append to
  the comment block at 43-46 a line `// Spec 2026-10-15 §6.2: "v1-soft" (codex) -- a single call whose output bound is checked after the fact.`;
  `agentSelection.ts:36` `singleCallExecution: "v1" | "v1-soft" | null`; `estimatorCompatibility.ts:16`:

```ts
  // Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft also accepts "v1-soft", whose output bound is checked after the fact.
  const execution = resolution.resolution?.singleCallExecution;
  if (!(execution === "v1" || (mode === "soft" && execution === "v1-soft"))) reasons.push("single-call-unavailable");
```

  `ccloopWorld.ts`: `WorldOptions` gains `/** Spec 2026-10-15 criterion 4: the panel's estimate mode (soft when absent). */ estimateMode?: "strict" | "soft";`
  and line 162 uses `worldOptions.estimateMode ?? "soft"` in place of the literal `"soft"`.

- [ ] **Step 4: green** (same command → `$LOGS/t11-green.json`/`.log`; 8 passed, 0 pending).

- [ ] **Step 5: mutations.** M11.1 `(mode === "soft" && execution === "v1-soft")` → `execution === "v1-soft"` ⇒ red
  `v1-soft in strict mode` and `codexRequirementOpen` strict. M11.2 the same → `false` ⇒ red `v1-soft in soft mode` and
  `opens in soft mode`. M11.3 the port enum back to `["v1"]` ⇒ red the schema test and `opens in soft mode` (the probe fails
  ⇒ `selection-unavailable`). Run the real-ccloop mutations with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"` from the clone.

- [ ] **Step 6: commit**, subject `feat(control): accept codex's soft single call in soft estimate mode only`.

---

