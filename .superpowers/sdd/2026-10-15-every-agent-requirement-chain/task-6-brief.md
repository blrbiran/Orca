## Task 6: Codex resolves `"v1-soft"` with its catalog window (ccloop, part D resolution, spec §6.1; criterion 3 codex half)

**Files:**
- Modify: `src/agents/codex.ts:41-60`, `src/agents/registry.ts:46`, `src/agents/types.ts:51`, `src/control/command.ts:97`
- Test: `tests/agents/codexResolution.test.ts`
- Rewrite (only after the human names each): E1 (codex half), E2, E3 in `tests/control/singleCallCapability.test.ts`

**Interfaces:**
- Produces: `AgentResolutionV1.singleCallExecution: "v1" | "v1-soft" | null`; `AgentDescriptor.singleCallExecution(...): "v1" | "v1-soft" | null`.

- [ ] **Step 1: failing tests** `tests/agents/codexResolution.test.ts`:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { runControlCommand } from "../../src/control/command.js";
import { codexInstallation, writeAgentsTable } from "../control/agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2; criterion 3): codex answers the soft single call and its
// catalog row's window; a model the catalog does not have, or a catalog that cannot be read, answers neither (issue 5).
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function table() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-codex-resolution-")));
  const marker = join(dir, "codex-marker");
  return { dir, marker, ...(await writeAgentsTable({ codex: await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", marker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 }) }, dir)) };
}

describe("codex resolution (spec §6.1)", { timeout: 30_000 }, () => {
  it("answers v1-soft, no output cap, and the catalog window for a listed model", async () => {
    const t = await table();
    const { resolution } = await resolveAgent(t.table, { agent: "codex" });
    expect([resolution.selection.model, resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual(["gpt-6-sol", 272000, "v1-soft", null]);
  });
  it("answers the same for a hidden row", async () => {
    const t = await table();
    expect((await resolveAgent(t.table, { agent: "codex", model: "gpt-reserve" })).resolution.singleCallExecution).toBe("v1-soft");
  });
  it("answers null and null for a model with no row, and for an unreadable catalog", async () => {
    const t = await table();
    const absent = (await resolveAgent(t.table, { agent: "codex", model: "not-in-catalog" })).resolution;
    expect([absent.capabilities.contextWindowTokens, absent.singleCallExecution]).toEqual([null, null]);
    await writeFile(`${t.marker}.catalog.json`, JSON.stringify({ exitCode: 3 }));
    const broken = (await resolveAgent(t.table, { agent: "codex", model: "gpt-6-luna" })).resolution;
    expect([broken.capabilities.contextWindowTokens, broken.singleCallExecution]).toEqual([null, null]);
  });
  it("prints v1-soft through control capabilities (the wire enum accepts it)", async () => {
    const t = await table();
    const answer = await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent: "codex" } }));
    expect(answer.code, answer.stderr).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ singleCallExecution: "v1-soft", singleCallOutputCap: null, capabilities: { contextWindowTokens: 272000 } });
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t6-red.log`.

- [ ] **Step 3: implement.** `src/agents/codex.ts`:

```ts
  capabilities(_config, row) {
    return {
      usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      // Every-agent requirement chain (Orca spec 2026-10-15 §6.1): the catalog row's context_window (config.toml's
      // model_context_window wins), not scaled by effective_context_window_percent; no row ⇒ unknown.
      contextWindowTokens: row?.contextWindow ?? null,
      requestBoundProof: null,
    };
  },
  // Orca single-call estimate (2026-09-27), Task 0 item 1 (codex-cli 0.155.1): no config caps the model's output, so a
  // single call cannot be bounded the way spec §4.4 asks.
  // *** ERRATUM (Orca spec 2026-10-15 §6.1, ruling R2) -- the bound is now checked after the fact: codex answers "v1-soft"
  // (one structured call, tools off, output bound not enforced by the CLI) when its catalog row is found. ***
  singleCallExecution(_config, row) {
    return row !== undefined ? "v1-soft" : null;
  },
  // OMP single call (Orca spec 2026-10-14 §3.2): codex runs no single call; nothing to bound.
  // *** ERRATUM (Orca spec 2026-10-15 §6.1) -- codex runs a soft single call; it still has no cap, so this stays null. ***
  singleCallOutputCap() {
    return null;
  },
```

  (The two original comment lines are kept verbatim; the ERRATUM lines are appended -- ccloop Rule 16; check publication
  with `git ls-remote` + `git merge-base --is-ancestor` first and record it.)
  `src/agents/materialize.ts`, after the omp block of `resolveAgent`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §6.1, plan issue 5): a codex row (any visibility) decides the
  // window and the soft single call; a catalog that could not be read leaves both unknown rather than refusing.
  if (installation.kind === "codex" && catalog !== null && catalog.rows !== null) row = catalog.rows.find((candidate) => candidate.selector === selection.model);
```

  `tests/agents/agentCatalog.test.ts` (only-add, a new `it` beside Task 4's omp accept test): "accept for codex probes
  nothing on a warm key" -- the same body with `agent = "codex"` and `t.codexMarker`.
  `src/agents/registry.ts:46` type → `"v1" | "v1-soft" | null`, and append to the doc comment above it:
  `*** ERRATUM (Orca spec 2026-10-15 §6.1, R2) -- a third answer, "v1-soft": one structured call with tools off whose output bound the CLI cannot enforce (codex); Orca accepts it only in soft estimate mode. ***`
  `src/agents/types.ts:51` type → `"v1" | "v1-soft" | null`. `src/control/command.ts:97` →
  `singleCallExecution: z.enum(["v1", "v1-soft"]).nullable(),`.

- [ ] **Step 4: green + named reds.** P-2 `tests/agents/codexResolution.test.ts tests/control tests/agents` → `$LOGS/t6-green.log`.
  Expected red: exactly E1 (`singleCallCapability.test.ts` C1, codex half), E2, E3. **[HUMAN] Stop and ask the human to
  name E1, E2, E3** (show each assertion and the proposed replacement below). After the yes, rewrite each whole, with the
  comment `Rewritten for the every-agent requirement chain (Orca spec 2026-10-15 §6.1, ruling R2; human named <E#> on <date>): <what it encodes now>.`:
  - E2 (`:48,60`): title `"C1: answers singleCallExecution beside the seven-key view: v1 for claude, v1-soft for codex"`; line 60 →
    `expect(JSON.parse(codex.stdout)).toEqual({ protocol: 3, ...codexResolution, singleCallExecution: "v1-soft" });`
  - E1 codex half (`:59`): `expect(codexResolution.capabilities).toEqual({ ...SEVEN, contextWindowTokens: 272000 });`
    (the claude half is Task 7).
  - E3 (`:70-78`): keep the refusal for a selection without a catalog row:
    `const { resolution } = await resolveAgent(table, { agent: "codex", model: "fixture" });` and title
    `"C3: accept refuses single-call work for an agent that answers null (a codex model the catalog does not list), by name and before anything is persisted"`.
    Add (only-add) `"C3b: accept admits codex single-call work for a catalog model (v1-soft)"` mirroring C4 with
    `{ agent: "codex" }`.

- [ ] **Step 5: mutations.** M6.1 `return row !== undefined ? "v1-soft" : null;` → `return null;` ⇒ red in
  `codexResolution` tests 1, 2, 4 and C3b. M6.2 `contextWindowTokens: row?.contextWindow ?? null,` → `contextWindowTokens: null,`
  ⇒ red test 1 and test 4. M6.3 `z.enum(["v1", "v1-soft"])` → `z.enum(["v1"])` in `command.ts` ⇒ red test 4
  (`control-response-invalid`). M6.4 in `materialize.ts` delete the codex `row = ...` line ⇒ red tests 1, 2.

- [ ] **Step 6: commit** source + `tests/agents/codexResolution.test.ts` + the rewritten `tests/control/singleCallCapability.test.ts`,
  subject `feat(agents): codex resolves a soft single call and its catalog window`; body lists E1-E3 and the human's words.

---

