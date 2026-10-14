### Task 4 (ccloop): The single call's spawn-time check, argv, overlay and system prompt (criteria 3, 4)

**Files:**
- Modify: `src/runtime/omp/phasePrompt.ts` (add `singleCallSystemPrompt`)
- Create: `src/runtime/omp/ompSingleCall.ts` (`OMP_SINGLE_CALL_OVERLAY`, `OmpSingleCallRefused`, `runOmpSingleCall`)
- Modify: `tests/fixtures/fake-omp.mjs` (single-call branch; fixture, not a criterion)
- Test: `tests/runtime/omp/ompSingleCall.test.ts` (new; Task 5 adds to it)

**Interfaces:**
- Consumes: Task 1's `readOmpCatalog`, `ompSingleCallExecution`; Task 3's `runOmpProcess`, `OmpPhaseOutcome`; `SingleCallRequest` (`src/runtime/types.ts:186-196`).
- Produces:
  - `export function singleCallSystemPrompt(responseSchema: Record<string, unknown>): string` (phasePrompt.ts).
  - `export const OMP_SINGLE_CALL_OVERLAY` (the Task 0 confirmed object).
  - `export class OmpSingleCallRefused extends Error { readonly neverStarted = true; readonly code: "omp-single-call-cap-exceeded" | "omp-single-call-unavailable" }`.
  - `export async function runOmpSingleCall(config: MaterializedAgentConfigV1, request: SingleCallRequest): Promise<OmpPhaseOutcome>`.
  - Fake omp: a call whose system prompt contains `one ccloop single call` appends `single-call` to `<marker>.calls`, its argv (one JSON line) to `<marker>.argv`, and prints `<marker>.single.json` (`{ rows?, exitCode?, hang? }`) or one complete `{"answer":"42"}` costing 14 tokens.

- [ ] **Step 1: Extend the fake omp's single call** — in `tests/fixtures/fake-omp.mjs`, after the line `const system = readFileSync(args[args.indexOf("--system-prompt") + 1], "utf8");` insert:

```js
// OMP single call (Orca spec 2026-10-14 §5): ccloop's single-call system prompt says "one ccloop single call". Records the
// call and its argv, then prints `<marker>.single.json` ({rows?, exitCode?, hang?}) or one complete {"answer":"42"}.
if (system.includes("one ccloop single call")) {
  appendFileSync(`${marker}.calls`, "single-call\n");
  appendFileSync(`${marker}.argv`, `${JSON.stringify(args)}\n`);
  const script = existsSync(`${marker}.single.json`) ? JSON.parse(readFileSync(`${marker}.single.json`, "utf8")) : {};
  if (script.hang === true) setInterval(() => {}, 1000);
  else {
    const answer = { role: "assistant", content: [{ type: "text", text: "{\"answer\":\"42\"}" }], provider: "gateway", model: "model-a", stopReason: "stop", usage: { input: 8, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const rows = script.rows ?? [{ type: "agent_start" }, { type: "message_end", message: answer }, { type: "agent_end", isTerminal: true, yielded: true, messages: [answer] }];
    process.stdout.write(rows.map((row) => `${JSON.stringify(row)}\n`).join(""), () => process.exit(script.exitCode ?? 0));
  }
  await new Promise(() => {});
}
```

- [ ] **Step 2: Write the failing criteria 3 and 4** — `tests/runtime/omp/ompSingleCall.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { OMP_SINGLE_CALL_OVERLAY, runOmpSingleCall } from "../../../src/runtime/omp/ompSingleCall.js";
import { observedTokensOf, type SingleCallRequest } from "../../../src/runtime/types.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.3). Orca books the catalog cap as the call's output
// bound; omp cannot take a per-call cap, so a cap that rose above the request's must refuse the call before anything is
// sent (criterion 3), and the call must run with every tool, rule and LSP off, under the overlay that switches omp's own
// retries and model switches off (criterion 4) -- otherwise one booked request could become several, or a tool run.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function ompWorld(options: { catalog?: unknown; single?: unknown; installationTimeoutMs?: number } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-")));
  dirs.push(dir);
  const marker = join(dir, "omp-marker");
  if (options.catalog !== undefined) await writeFile(`${marker}.catalog.json`, JSON.stringify(options.catalog));
  if (options.single !== undefined) await writeFile(`${marker}.single.json`, JSON.stringify(options.single));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const runDir = join(dir, "run");
  const cwd = join(runDir, "cwd");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const config: MaterializedAgentConfigV1 = {
    schema: "ccloop-agent-config-v1", kind: "omp",
    installation: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: options.installationTimeoutMs ?? 10_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" },
  };
  const request = (over: Partial<SingleCallRequest> = {}): SingleCallRequest => ({
    prompt: "Estimate the plan below.", responseSchema: SCHEMA, maxOutputTokens: 8_192, cwd, runDir, timeoutMs: 60_000, ...over,
  });
  return { dir, marker, config, request };
}
const modelA = (numbers: Record<string, unknown>) => ({ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, ...numbers });
const failureOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error);

describe("spawn-time check (§3.3.1, criterion 3)", () => {
  it("C3: refuses before spawning when the catalog cap exceeds the request's maxOutputTokens, booking 0", async () => {
    const w = await ompWorld({ catalog: [modelA({ maxTokens: 8192 })] });
    const failure = await failureOf(runOmpSingleCall(w.config, w.request({ maxOutputTokens: 4_096 })));
    expect(failure).toMatchObject({ code: "omp-single-call-cap-exceeded", neverStarted: true });
    expect(observedTokensOf(failure)).toBe(0);
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });

  it("C3: runs when the catalog cap equals the request's maxOutputTokens", async () => {
    const w = await ompWorld({ catalog: [modelA({ maxTokens: 8192 })] });
    const outcome = await runOmpSingleCall(w.config, w.request({ maxOutputTokens: 8_192 }));
    expect(outcome).toMatchObject({ reason: "completed", neverStarted: false });
    expect(await readFile(`${w.marker}.calls`, "utf8")).toBe("single-call\n");
  });

  it("refuses as unavailable, never started, when the row lost its cap, the model left the catalog, or the catalog cannot be read", async () => {
    for (const catalog of [[modelA({})], [{ ...modelA({ maxTokens: 8192 }), id: "other", selector: "gateway/other" }], "not rows"]) {
      const w = await ompWorld({ catalog });
      const failure = await failureOf(runOmpSingleCall(w.config, w.request()));
      expect([catalog, failure]).toEqual([catalog, expect.objectContaining({ code: "omp-single-call-unavailable", neverStarted: true })]);
      expect(observedTokensOf(failure)).toBe(0);
      expect(existsSync(`${w.marker}.calls`)).toBe(false);
    }
  });
});

describe("argv (§3.3.2-§3.3.4, criterion 4)", () => {
  it("C4: passes exactly the single-call argv: tools, rules and LSP off, no --tools list, the overlay, the request's cwd", async () => {
    const w = await ompWorld();
    const request = w.request();
    await runOmpSingleCall(w.config, request);
    const [argv] = (await readFile(`${w.marker}.argv`, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(argv).toEqual([
      "--profile", "default", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-tools",
      "--no-session", "--no-title", "--no-prewalk", "--model", "gateway/model-a", "--mode", "json", "-p",
      "--system-prompt", expect.stringMatching(/\/run\/omp\/1\/single-call\/call-[^/]+\/system-prompt\.md$/),
      "--cwd", request.cwd,
      "--config", expect.stringMatching(/\/run\/omp\/1\/single-call\/call-[^/]+\/config-overlay\.yml$/),
    ]);
    expect(argv).not.toContain("--tools");
    expect(JSON.parse(await readFile(argv![argv!.indexOf("--config") + 1]!, "utf8"))).toEqual(OMP_SINGLE_CALL_OVERLAY);
    const system = await readFile(argv![argv!.indexOf("--system-prompt") + 1]!, "utf8");
    expect(system).toContain("one ccloop single call");
    expect(system).toContain(JSON.stringify(SCHEMA));
  });
});
```

- [ ] **Step 3: Run red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp/ompSingleCall.test.ts > /private/tmp/osc/logs/t4-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-red.log
```
Read it whole. Expected: FAIL — `../../../src/runtime/omp/ompSingleCall.js` does not exist (module load). That load failure is the red for a new module; the criteria's own reds are Task 6's mutations.

- [ ] **Step 4: Implement**

`src/runtime/omp/phasePrompt.ts` — append:

```ts
/**
 * OMP single call (Orca spec 2026-10-14 §3.3.4): the whole answer is one JSON object satisfying the request's schema.
 * Task 0 measured this prompt's request-body overhead against the operator's framingTokenOverhead (spec §7).
 */
export function singleCallSystemPrompt(responseSchema: Record<string, unknown>): string {
  return [
    "This invocation is one ccloop single call: answer the user prompt once, with no tools and no follow-up.",
    "Reply with exactly one JSON object that satisfies the JSON Schema below, and nothing else: no prose before or after it.",
    JSON.stringify(responseSchema),
  ].join("\n");
}
```

Create `src/runtime/omp/ompSingleCall.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ompSingleCallExecution, readOmpCatalog } from "../../agents/ompModels.js";
import type { CatalogRowV1, MaterializedAgentConfigV1 } from "../../agents/types.js";
import type { SingleCallRequest } from "../types.js";
import { singleCallSystemPrompt } from "./phasePrompt.js";
import { runOmpProcess, type OmpPhaseOutcome } from "./runOmpPhase.js";

/**
 * OMP single call (Orca spec 2026-10-14 §3.3.3): switches off session auto-retry, model fallback, the loop guard, the
 * advisor and auto-compaction. Keys confirmed against omp 18.10.1 in plan Task 0 (spec §7), applied on top of the
 * operator's config.yml: omp deep-merges a --config file (YAML; JSON is YAML) after its own configuration.
 */
export const OMP_SINGLE_CALL_OVERLAY = {
  retry: { enabled: false, modelFallback: false },
  model: { loopGuard: { enabled: false } },
  advisor: { enabled: false },
  compaction: { enabled: false },
} as const;

/** §3.3.1: refused before anything was spawned, so nothing was sent; observedTokensOf books 0 for it. */
export class OmpSingleCallRefused extends Error {
  readonly neverStarted = true;
  constructor(readonly code: "omp-single-call-cap-exceeded" | "omp-single-call-unavailable", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "OmpSingleCallRefused";
  }
}

/**
 * §3.3.1-§3.3.4: re-reads the selected catalog row immediately before spawning and runs only when it still answers "v1"
 * and its cap is at most the request's maxOutputTokens; then one `omp -p` with tools, rules and LSP off under the overlay.
 */
export async function runOmpSingleCall(config: MaterializedAgentConfigV1, request: SingleCallRequest): Promise<OmpPhaseOutcome> {
  let rows: CatalogRowV1[];
  try { rows = await readOmpCatalog(config.installation); }
  catch (error) { throw new OmpSingleCallRefused("omp-single-call-unavailable", `catalog ${error instanceof Error ? error.message : String(error)}`); }
  const row = rows.find((candidate) => candidate.selector === config.selection.model);
  if (row === undefined || row.maxTokens === null || ompSingleCallExecution(row) !== "v1") throw new OmpSingleCallRefused("omp-single-call-unavailable", config.selection.model);
  if (row.maxTokens > request.maxOutputTokens) throw new OmpSingleCallRefused("omp-single-call-cap-exceeded", `catalog maxTokens ${row.maxTokens} > maxOutputTokens ${request.maxOutputTokens}`);
  const root = join(request.runDir, "omp", "1", "single-call");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const evidenceDir = await mkdtemp(join(root, "call-"));
  const systemPath = join(evidenceDir, "system-prompt.md");
  const overlayPath = join(evidenceDir, "config-overlay.yml");
  await Promise.all([
    writeFile(systemPath, singleCallSystemPrompt(request.responseSchema), { mode: 0o600 }),
    writeFile(overlayPath, `${JSON.stringify(OMP_SINGLE_CALL_OVERLAY)}\n`, { mode: 0o600 }),
  ]);
  const profile = config.installation.profile as string | null;
  const args = ["--profile", profile ?? "default", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-tools",
    "--no-session", "--no-title", "--no-prewalk", "--model", config.selection.model, "--mode", "json", "-p",
    "--system-prompt", systemPath, "--cwd", request.cwd, "--config", overlayPath];
  return runOmpProcess(config, {
    args, prompt: request.prompt, cwd: request.cwd, evidenceDir, phase: "single-call",
    timeoutMs: Math.min(request.timeoutMs, config.installation.timeoutMs),
    abortSignal: request.signal, onProcessRegistered: request.onProcessRegistered,
  });
}
```

If Task 0 confirmed a different overlay object, `OMP_SINGLE_CALL_OVERLAY` is that object, byte for byte.

- [ ] **Step 5: Run green**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t4-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t4-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t4-tc.log
```
Read both whole. Expected: all pass, 0 skipped (the phase criteria prove the fake's phase branch is unchanged); typecheck `rc=0`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/runtime/omp/phasePrompt.ts src/runtime/omp/ompSingleCall.ts tests/fixtures/fake-omp.mjs tests/runtime/omp/ompSingleCall.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t4-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): check the catalog cap at spawn and run one call with tools and retries off

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

