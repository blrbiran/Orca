### Task 2 (ccloop): The resolution decides; capabilities and accept use it (criteria 1, 2)

**Files:**
- Modify: `src/agents/types.ts:39-45` (`AgentResolutionV1`)
- Modify: `src/agents/registry.ts:34-40` (descriptor methods take the row; new `singleCallOutputCap`)
- Modify: `src/agents/omp.ts:1-43`, `src/agents/claude.ts:72-76`, `src/agents/codex.ts:52-56`
- Modify: `src/agents/materialize.ts:1-128` (`resolveAgent`)
- Modify: `src/control/command.ts:89-99` (schema), `:250-256` (handler)
- Modify: `src/control/accept.ts:6`, `:86-90`
- Modify: `tests/fixtures/fake-omp.mjs:10,17-21` (catalog override; fixture, not a criterion; default row unchanged)
- Test: `tests/agents/ompSingleCallResolution.test.ts` (new), `tests/control/ompSingleCallAccept.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `CatalogRowV1`, `readOmpCatalog`, `readOmpModels`, `ompSingleCallExecution`.
- Produces:
  - `AgentResolutionV1` gains `singleCallExecution: "v1" | null` and `singleCallOutputCap: number | null`.
  - `AgentDescriptor.capabilities(config, row?: CatalogRowV1)`, `.singleCallExecution(config, row?: CatalogRowV1)`, new `.singleCallOutputCap(config, row?: CatalogRowV1): number | null`.
  - `resolveAgent(table, partial, deps?: { probeVersion?; probeModels?: typeof readOmpModels; probeCatalog?: typeof readOmpCatalog })`.
  - `control capabilities` prints `{ protocol: 3, ...resolution }`; accept refuses on `resolution.singleCallExecution === null`.
  - Fake omp: `<marker>.catalog.json` (a JSON array of rows), when present, is the catalog.

- [ ] **Step 1: Extend the fake omp's catalog** — `tests/fixtures/fake-omp.mjs`: change line 10 to

```js
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
```

and replace lines 17-21 with:

```js
// OMP single call (Orca spec 2026-10-14 §5): `<marker>.catalog.json`, when present, is the catalog's rows; without it the
// one row below, as before.
if (args.includes("models")) {
  const rows = existsSync(`${marker}.catalog.json`) ? JSON.parse(readFileSync(`${marker}.catalog.json`, "utf8"))
    : [{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 }];
  process.stdout.write(`${JSON.stringify({ models: rows })}\n`);
  process.exit(0);
}
```

- [ ] **Step 2: Write the failing criterion 1** — `tests/agents/ompSingleCallResolution.test.ts`:

```ts
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeDescriptor } from "../../src/agents/claude.js";
import { codexDescriptor } from "../../src/agents/codex.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import type { CatalogRowV1, InstallationV1, MaterializedAgentConfigV1 } from "../../src/agents/types.js";
import { runControlCommand } from "../../src/control/command.js";
import { writeAgentsTable } from "../control/agentsFixture.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.2, criterion 1): the selected catalog row decides the
// resolution's context window, its single-call answer and the cap that call runs under -- Orca sizes the estimate by the
// cap, and refuses the call by the answer -- so a resolution that ignored the row would let omp run unbounded or never.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const installation: InstallationV1 = {
  kind: "omp", command: ["/opt/omp"], version: "18.10.1", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000, defaultModel: "gateway/model-a", profile: null,
};
const table = { schema: "ccloop-agents-table-v1" as const, installations: { work: installation } };
const rows: CatalogRowV1[] = [
  { selector: "gateway/model-a", provider: "gateway", contextWindow: 200_000, maxTokens: 8_192 },
  { selector: "gateway/no-cap", provider: "gateway", contextWindow: 128_000, maxTokens: null },
  { selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 },
];
const deps = { probeVersion: async () => "18.10.1", probeCatalog: async () => rows };

describe("the omp resolution takes its numbers from the selected catalog row (criterion 1)", () => {
  it("C1: a row with a cap answers its window, v1 and its cap", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([200_000, "v1", 8_192]);
  });

  it("C1: a row without maxTokens answers null for both, keeping its window", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work", model: "gateway/no-cap" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([128_000, null, null]);
  });

  it("C1: an openrouter row answers singleCallExecution null although it declares a cap", async () => {
    const { resolution } = await resolveAgent(table, { agent: "work", model: "openrouter/vendor/m" }, deps);
    expect([resolution.capabilities.contextWindowTokens, resolution.singleCallExecution, resolution.singleCallOutputCap]).toEqual([64_000, null, 4_096]);
  });

  it("still refuses a model the catalog does not list, by name", async () => {
    await expect(resolveAgent(table, { agent: "work", model: "gateway/absent" }, deps)).rejects.toMatchObject({ code: "agent-selection-invalid" });
  });

  it("leaves claude's and codex's cap null: their calls honour the request's maxOutputTokens", () => {
    const config = (kind: "claude" | "codex"): MaterializedAgentConfigV1 => ({
      schema: "ccloop-agent-config-v1", kind,
      installation: { kind, command: ["/bin/echo"], version: "1.2.3", configDir: null, timeoutMs: 1000, killGraceMs: 50, ...(kind === "codex" ? { sandbox: "workspace-write", budgetMode: "soft" } : {}) },
      selection: { agent: kind, model: kind === "claude" ? "claude-opus-5-5" : "gpt-6-sol", contextWindow: "agent-default" },
    });
    expect([claudeDescriptor.singleCallOutputCap(config("claude")), codexDescriptor.singleCallOutputCap(config("codex"))]).toEqual([null, null]);
  });

  it("C1 on the wire: control capabilities prints the row's values through ccloop's strict answer schema", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-resolution-wire-")));
    dirs.push(dir);
    const marker = join(dir, "omp-marker");
    await writeFile(`${marker}.catalog.json`, JSON.stringify([{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 }]));
    const binary = join(dir, "omp");
    await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
    const { path } = await writeAgentsTable({ omp: { ...installation, command: [binary], timeoutMs: 10_000, killGraceMs: 50 } }, dir);
    const result = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "omp" } }));
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ protocol: 3, capabilities: { contextWindowTokens: 200_000 }, singleCallExecution: "v1", singleCallOutputCap: 8_192 });
  });
});
```

- [ ] **Step 3: Write the failing criterion 2** — `tests/control/ompSingleCallAccept.test.ts`:

```ts
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { acceptStart } from "../../src/control/accept.js";
import { runControlCommand } from "../../src/control/command.js";
import { singleCallEnvelope, writeAgentsTable } from "./agentsFixture.js";

// OMP single call (Orca spec 2026-10-14 §3.2, criterion 2): accept refuses single-call work by the resolution's answer --
// for omp, the selected catalog row's -- not by the installation's config alone, which cannot tell a row with a cap from
// one without. Both directions are pinned: a config-only answer would refuse the admitted call too.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    let pid: number | undefined;
    try {
      pid = (JSON.parse(await readFile(join(dir, "control", "accepted.json"), "utf8")) as { worker?: { pid?: number } }).worker?.pid;
    } catch {}
    for (const deadline = Date.now() + 10_000; pid !== undefined && Date.now() < deadline; await new Promise((r) => setTimeout(r, 20))) {
      try { process.kill(pid, 0); } catch { break; }
    }
    await rm(dir, { recursive: true, force: true });
  }
});

async function ompTable() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-accept-")));
  dirs.push(dir);
  const marker = join(dir, "omp-marker");
  await writeFile(`${marker}.catalog.json`, JSON.stringify([
    { provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 },
    { provider: "gateway", kind: "chat", id: "no-cap", selector: "gateway/no-cap", contextWindow: 128000 },
  ]));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  return await writeAgentsTable({
    omp: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 10_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
  }, dir);
}
async function sourceDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-accept-source-")));
  dirs.push(dir);
  return dir;
}

describe("accept uses the resolution for omp single calls (criterion 2)", { timeout: 30_000 }, () => {
  it("C2: refuses an omp single call whose resolution answers null, by name and before anything is persisted", async () => {
    const { path, table } = await ompTable();
    const source = await sourceDir();
    const { resolution } = await resolveAgent(table, { agent: "omp", model: "gateway/no-cap" });
    expect(resolution.singleCallExecution).toBeNull();
    const envelope = singleCallEnvelope({ sourceDir: source, agent: resolution.selection, configHash: resolution.configHash });
    expect(await runControlCommand(["accept", "--agents", path], JSON.stringify(envelope))).toEqual({ code: 2, stdout: "", stderr: "single-call-unsupported\n" });
    expect(await readdir(source)).toEqual([]);
  });

  it("C2: admits an omp single call whose resolution answers v1 and seals its envelope", async () => {
    const { path, table } = await ompTable();
    const source = await sourceDir();
    const { resolution } = await resolveAgent(table, { agent: "omp" });
    expect(resolution.singleCallExecution).toBe("v1");
    const envelope = singleCallEnvelope({ sourceDir: source, agent: resolution.selection, configHash: resolution.configHash });
    const status = await acceptStart(envelope, {
      agentsTablePath: path,
      workerCommand: [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")],
      receiptTimeoutMs: 2_000,
    });
    expect(status.kind).toBe("accepted");
    expect(JSON.parse(await readFile(join(source, "control", "envelope.json"), "utf8"))).toEqual(envelope);
  });
});
```

- [ ] **Step 4: Run both red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts > /private/tmp/osc/logs/t2-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-red.log
```
Read it whole. Expected red on: C1 values (`[null, undefined, undefined]` received), the `singleCallOutputCap is not a function` test, the wire test (`singleCallExecution: null`, no cap), C2 admission (`single-call-unsupported` thrown: omp answers null today). C2 refusal and "still refuses a model the catalog does not list" may already be green (they hold today); that is expected — their reds come from the Task 6 mutations.

- [ ] **Step 5: Implement**

`src/agents/types.ts` — replace `AgentResolutionV1` (lines 39-45):

```ts
export interface AgentResolutionV1 {
  selection: AgentSelectionV1;
  configHash: string;
  timeoutMs: number;
  killGraceMs: number;
  capabilities: CapabilityViewV1;
  /** Orca single-call estimate (2026-09-27) §4.4; decided at resolution since OMP single call (Orca spec 2026-10-14 §3.2). */
  singleCallExecution: "v1" | null;
  /** OMP single call (Orca spec 2026-10-14 §3.2): the cap the call actually runs under; null = it honours the request's maxOutputTokens. Never frozen. */
  singleCallOutputCap: number | null;
}
```

`src/agents/registry.ts` — line 9-12 import adds `type CatalogRowV1,`; line 34 becomes

```ts
  /** `row` is the selected catalog row for a kind that has a catalog (omp, OMP single call 2026-10-14 §3.2), else undefined. */
  capabilities(config: MaterializedAgentConfigV1, row?: CatalogRowV1): CapabilityViewV1;
```

line 40 becomes `singleCallExecution(config: MaterializedAgentConfigV1, row?: CatalogRowV1): "v1" | null;` and after it add:

```ts
  /**
   * OMP single call (Orca spec 2026-10-14 §3.2): the output cap the kind's single call actually runs under, from its catalog
   * row; null means the call honours the request's maxOutputTokens. A sibling of singleCallExecution: never in the
   * seven-key view, never frozen.
   */
  singleCallOutputCap(config: MaterializedAgentConfigV1, row?: CatalogRowV1): number | null;
```

`src/agents/claude.ts` — after `singleCallExecution() { return "v1"; },` (line 74-76) add:

```ts
  // OMP single call (Orca spec 2026-10-14 §3.2): CLAUDE_CODE_MAX_OUTPUT_TOKENS takes the request's own cap.
  singleCallOutputCap() {
    return null;
  },
```

`src/agents/codex.ts` — after `singleCallExecution() { return null; },` (line 54-56) add:

```ts
  // OMP single call (Orca spec 2026-10-14 §3.2): codex runs no single call; nothing to bound.
  singleCallOutputCap() {
    return null;
  },
```

`src/agents/omp.ts` — add `import { ompSingleCallExecution } from "./ompModels.js";` after line 4; replace lines 30-41 with:

```ts
  capabilities(_config, row) {
    return {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      // OMP single call (Orca spec 2026-10-14 §1.2, §3.2): the selected catalog row's window, omp's defaults included.
      contextWindowTokens: row?.contextWindow ?? null,
      requestBoundProof: null,
    };
  },
  singleCallExecution(_config, row) { return ompSingleCallExecution(row); },
  singleCallOutputCap(_config, row) { return row?.maxTokens ?? null; },
```

`src/agents/materialize.ts` — line 5 becomes `import { readOmpCatalog, readOmpModels } from "./ompModels.js";`; the type import (lines 7-14) adds `type CatalogRowV1,`; replace lines 87-128 (`resolveAgent`) with:

```ts
export async function resolveAgent(
  table: AgentsTableV1,
  partial: PartialSelectionV1,
  deps: {
    probeVersion?: (command: string[]) => Promise<string | null>;
    probeModels?: typeof readOmpModels;
    probeCatalog?: typeof readOmpCatalog;
  } = {},
): Promise<{ config: MaterializedAgentConfigV1; resolution: AgentResolutionV1 }> {
  if (partial.agent === undefined) throw new AgentError("agent-unselected");
  const installation = Object.hasOwn(table.installations, partial.agent) ? table.installations[partial.agent] : undefined;
  if (installation === undefined) throw new AgentError("agent-installation-missing", partial.agent);
  const descriptor = getDescriptor(installation.kind);
  const defaults = descriptorDefaults(descriptor, installation);
  const selection = {
    agent: partial.agent,
    model: partial.model ?? defaults.model,
    contextWindow: partial.contextWindow ?? defaults.contextWindow,
  };
  descriptor.validateSelection(selection);
  const config: MaterializedAgentConfigV1 = { schema: "ccloop-agent-config-v1", kind: installation.kind, installation, selection };
  const observed = await (deps.probeVersion ?? probeVersion)(installation.command);
  // Orca wave-2 review I-3 (2026-09-26): a probe that observed no version at all (spawn failure, non-zero exit, no
  // x.y.z, oversized output, timeout) may be transient, so it is NOT the named refusal agent-version-drift. It is a
  // plain Error: `control` exits 1 (Orca treats it as unknown and retries) and `run --agents` exits 1 with a message
  // that is not a code (Orca: reconcile-spawn). Only an observed version that differs from the table is a drift.
  if (observed === null) {
    throw new Error(`Could not observe the version of installation ${JSON.stringify(partial.agent)}: \`--version\` answered no x.y.z (table ${installation.version})`);
  }
  if (observed !== installation.version) {
    throw new AgentError("agent-version-drift", `${partial.agent}: table ${installation.version}, observed ${observed}`);
  }
  // OMP single call (Orca spec 2026-10-14 §3.2): the selected catalog row decides the window, the single-call answer and
  // its cap. `probeModels` is the selector-only injection older criteria use; its rows declare no numbers.
  let row: CatalogRowV1 | undefined;
  if (installation.kind === "omp") {
    const rows: CatalogRowV1[] = deps.probeCatalog !== undefined ? await deps.probeCatalog(installation)
      : deps.probeModels !== undefined
        ? (await deps.probeModels(installation)).map((selector) => ({ selector, provider: selector.slice(0, selector.indexOf("/")), contextWindow: null, maxTokens: null }))
        : await readOmpCatalog(installation);
    row = rows.find((candidate) => candidate.selector === selection.model);
    if (row === undefined) throw new AgentError("agent-selection-invalid", `OMP model is not an exact catalog selector: ${selection.model}`);
  }
  return {
    config,
    resolution: {
      selection,
      configHash: agentConfigHash(config),
      timeoutMs: installation.timeoutMs,
      killGraceMs: installation.killGraceMs,
      capabilities: descriptor.capabilities(config, row),
      singleCallExecution: descriptor.singleCallExecution(config, row),
      singleCallOutputCap: descriptor.singleCallOutputCap(config, row),
    },
  };
}
```

`src/control/command.ts` — in `capabilitiesSchema`'s resolution object (line 97), after `singleCallExecution: z.enum(["v1"]).nullable(),` add:

```ts
      // OMP single call (Orca spec 2026-10-14 §3.2). Optional, so an answer without it (a handler stand-in) still parses.
      singleCallOutputCap: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
```

and replace lines 252-255 with:

```ts
    const { resolution } = await resolveAgent(await readAgentsTable(context.agentsTablePath), request.agent);
    // Orca single-call estimate (2026-09-27), spec §4.4: a sibling of `capabilities`, like timeoutMs and killGraceMs,
    // so the seven-key view (frozen into Orca profiles and task records) stays exactly as it is.
    // OMP single call (Orca spec 2026-10-14 §3.2): singleCallExecution and singleCallOutputCap now come with the resolution.
    return { protocol: 3, ...resolution };
```

`src/control/accept.ts` — delete line 6 (`import { getDescriptor } from "../agents/registry.js";`, its only use is below); replace lines 86-90 with:

```ts
  // Orca single-call estimate (2026-09-27), spec §5.1: refused here, before anything is persisted, even when Orca's
  // preflight let it through.
  // OMP single call (Orca spec 2026-10-14 §3.2): the resolution's answer, which for omp comes from the catalog row.
  if (input.work.kind === "single-call" && resolution.singleCallExecution === null) {
    throw new ControlProtocolError("single-call-unsupported");
  }
```

- [ ] **Step 6: Run green, with every criterion near the change**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts tests/agents/ompCatalog.test.ts tests/agents/ompSelection.test.ts tests/agents/registry.test.ts tests/agents/materialize.test.ts tests/control/singleCallCapability.test.ts tests/control/requestBoundDimensions.test.ts tests/control/command.test.ts tests/control/agentsControl.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t2-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t2-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t2-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/agents/types.ts src/agents/registry.ts src/agents/omp.ts src/agents/claude.ts src/agents/codex.ts src/agents/materialize.ts src/control/command.ts src/control/accept.ts tests/fixtures/fake-omp.mjs tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t2-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): decide the window, single-call answer and cap from the catalog row

Capabilities and accept now read singleCallExecution from the resolution instead of recomputing it from the config.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

