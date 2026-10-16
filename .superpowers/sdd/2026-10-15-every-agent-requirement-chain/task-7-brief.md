## Task 7: Claude's default window is 200000 (ccloop, part E, spec §7; criterion 3 claude half)

**Files:**
- Modify: `src/agents/claude.ts:60-70`
- Test: `tests/agents/claudeDefaultWindow.test.ts`
- Rewrite (human-named): E1 claude half (`tests/control/singleCallCapability.test.ts:53`), E4
  (`tests/agents/registry.test.ts:81,83`), E5 (`tests/control/agentsControl.test.ts:110`)

- [ ] **Step 1: failing test** `tests/agents/claudeDefaultWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claudeDescriptor } from "../../src/agents/claude.js";
import type { MaterializedAgentConfigV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §2.3, §7, R5): every model in claude-code 2.1.300's built-in table
// has a window of at least 200000, so agent-default reports that lower bound; the verified 1M mapping is unchanged.
const config = (contextWindow: "agent-default" | 1_000_000): MaterializedAgentConfigV1 => ({ schema: "ccloop-agent-config-v1", kind: "claude",
  installation: { kind: "claude", command: ["/opt/claude"], version: "2.1.300", configDir: null, timeoutMs: 1, killGraceMs: 1 },
  selection: { agent: "claude", model: "claude-opus-5-5", contextWindow } });

describe("claude windows (spec §7)", () => {
  it("reports 200000 for agent-default and 1000000 for the 1M selection", () => {
    expect([claudeDescriptor.capabilities(config("agent-default")).contextWindowTokens, claudeDescriptor.capabilities(config(1_000_000)).contextWindowTokens]).toEqual([200000, 1000000]);
  });
});
```

- [ ] **Step 2: red** (P-2 → `$LOGS/t7-red.log`: `null` ≠ `200000`).

- [ ] **Step 3: implement** `src/agents/claude.ts:67-68`:

```ts
      // Spec §12 I6: only a mapping Task 0 verified is reported; "agent-default" stays unknown (null).
      // *** ERRATUM (Orca spec 2026-10-15 §2.3, §7, ruling R5) -- "agent-default" is now reported as 200000: every model in
      // claude-code 2.1.300's built-in model table has a window of at least 200000 (read from the binary, no model called);
      // a native-1M model is under-reported, which only makes input-too-large trip earlier. ***
      contextWindowTokens: config.selection.contextWindow === ONE_MILLION ? ONE_MILLION : 200_000,
```

  Before editing, run the publication check (ccloop Rule 16):
  `/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main` and
  `/usr/bin/git -C "$CL" merge-base --is-ancestor <commit that added line 67> <remote main sha>; echo $?`; record both.
  Also full-tree scan for prose saying agent-default is unknown/null (Rule 16, list derived from the corrected sentence):
  `/usr/bin/grep -rn 'agent-default.*\(null\|unknown\)' src tests docs README.md > "$LOGS/t7-scan.txt"`; read it; each hit in
  published text gets an ERRATUM, each hit in a test is listed for the human.

- [ ] **Step 4: green + named reds.** P-2 `tests/agents tests/control` → `$LOGS/t7-green.log`; expected red exactly E1
  (claude half), E4, E5. **[HUMAN] name each**; rewrite: E4 title `"reports claude's contextWindowTokens as 200000 for agent-default and 1M for its verified mapping, and codex's as null without a catalog row (omp reads its own from its catalog row)"`,
  line 83 `.toBe(200_000)`; E5 line 110 `capabilities: { contextWindowTokens: 200_000 },`; E1 claude half line 53
  `expect(claudeResolution.capabilities).toEqual({ ...SEVEN, contextWindowTokens: 200000 });` -- each with the
  "Rewritten for ... human named ..." comment.

- [ ] **Step 5: mutation.** M7.1 `: 200_000,` → `: null,` ⇒ red `claudeDefaultWindow` and the three rewritten criteria.

- [ ] **Step 6: commit**, subject `feat(agents): report claude's 200000 default window (ERRATUM on the unknown-window note)`.

---

