## Task 8: The codex single call (ccloop, part D adapter, spec §6.1, R2, R9)

**Files:**
- Create: `src/runtime/codex/codexSingleCall.ts`
- Modify: `src/runtime/codex/runCodexPhase.ts:11,28-30,42-44,48`; `src/runtime/codex/codexAdapter.ts:12,36-39` (+ method);
  `src/agents/codex.ts:61-64`; `src/runtime/types.ts:230-234` (append ERRATUM); `tests/fixtures/fake-codex.mjs` (single-call branch)
- Test: `tests/runtime/codex/codexSingleCall.test.ts`, `tests/control/codexSingleCallWorker.test.ts`

**Interfaces:**
- Consumes: `readAgentCatalog` (Task 4), `CODEX_SINGLE_CALL_FEATURES` (Task 3), Task 0's final `ISO` list.
- Produces:
  - `PhaseRequest = { phase: CodexPhase | "single-call"; prompt; context; spawn?: { args: (paths: { schemaPath: string; finalPath: string }) => string[]; env: NodeJS.ProcessEnv; schema: Record<string, unknown> } }`
  - `export const CODEX_SINGLE_CALL_CONFIG: readonly string[]` (Task 0's `-c` values, without `features.*`)
  - `export function codexSingleCallArgs(input: { model: string; cwd: string; schemaPath: string; finalPath: string; features: readonly string[] }): string[]`
  - `export async function codexSingleCallHome(runDir: string, sourceCodexHome: string): Promise<{ home: string; codexHome: string }>`
  - `export function decodeCodexSingleCall(events: string, final: string | null, model: string, evidenceDir: string): SingleCallResult`
  - `CodexAdapterOptions` gains `installation?: InstallationV1`; `CodexAdapter.singleCall(request)`.
  - Error codes: `codex-single-call-not-single:tool|messages|turns` (observed usage booked), `codex-single-call-unavailable` (`neverStarted`, books 0).

- [ ] **Step 1: fake codex single-call branch.** In `tests/fixtures/fake-codex.mjs`'s stdin `end` handler, first lines:

```js
  // Every-agent requirement chain (Orca spec 2026-10-15 §6.1, §9): a single call is the only codex call with
  // --skip-git-repo-check. It records HOME, CODEX_HOME and whether auth.json there is a symlink in <marker>.single-env.json,
  // appends `single-call` to <marker>.calls, then plays <marker>.single.json ({rows?, final?, exitCode?, hang?}) or one
  // complete {"answer":"42"} with usage input 20 (5 cached) and output 4.
  if(args.includes("--skip-git-repo-check")) {
    appendFileSync(marker+".calls","single-call\n");
    let authIsLink=null; try{authIsLink=lstatSync(`${process.env.CODEX_HOME}/auth.json`).isSymbolicLink();}catch{}
    writeFileSync(marker+".single-env.json",JSON.stringify({HOME:process.env.HOME,CODEX_HOME:process.env.CODEX_HOME,authIsLink}));
    const script=existsSync(marker+".single.json")?JSON.parse(readFileSync(marker+".single.json","utf8")):{};
    if(script.hang===true){setInterval(()=>{},1000);return;}
    const rows=script.rows??[{type:"thread.started",thread_id:"t"},{type:"turn.started"},{type:"item.completed",item:{id:"item_0",type:"agent_message",text:"{\"answer\":\"42\"}"}},{type:"turn.completed",usage:{input_tokens:20,cached_input_tokens:5,output_tokens:4}}];
    writeFileSync(value("-o"),script.final??"{\"answer\":\"42\"}");
    process.stdout.write(rows.map(row=>JSON.stringify(row)).join("\n")+"\n",()=>{process.exitCode=script.exitCode??0;});
    return;
  }
```

  (add `lstatSync` to the line-1 import).

- [ ] **Step 2: failing tests** `tests/runtime/codex/codexSingleCall.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codexDescriptor } from "../../../src/agents/codex.js";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { observedTokensOf, SingleCallOutputInvalid } from "../../../src/runtime/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2, R9): one structured codex call with tools off, in a
// private HOME and CODEX_HOME whose auth.json and config.toml are symlinks; decoding fails closed and books what it saw.
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
async function world(single?: unknown) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-codex-single-")));
  const marker = join(dir, "codex-marker"), codexHome = join(dir, "codex-home");
  await mkdir(codexHome); await writeFile(join(codexHome, "auth.json"), "{}"); await writeFile(join(codexHome, "config.toml"), "");
  if (single !== undefined) await writeFile(`${marker}.single.json`, JSON.stringify(single));
  const config: MaterializedAgentConfigV1 = { schema: "ccloop-agent-config-v1", kind: "codex",
    installation: { kind: "codex", command: [process.execPath, FAKE_CODEX, "integration", marker], version: "9.9.9-fake", configDir: codexHome, timeoutMs: 60_000, killGraceMs: 100, sandbox: "read-only", budgetMode: "soft" },
    selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" } };
  const runDir = join(dir, "run"), cwd = join(runDir, "cwd"); await mkdir(cwd, { recursive: true, mode: 0o700 });
  const adapter = codexDescriptor.createAdapter(config);
  const request = { prompt: "Estimate.", responseSchema: SCHEMA, maxOutputTokens: 4096, cwd, runDir, timeoutMs: 30_000 };
  return { dir, marker, codexHome, adapter, request };
}
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a rejection"); }, (error: unknown) => error);
const lastArgv = (marker: string): string[] => JSON.parse(readFileSync(`${marker}.argv`, "utf8").trim().split("\n").at(-1)!);

describe("codex single call (spec §6.1)", { timeout: 30_000 }, () => {
  it("C8.1: answers the object with the observed usage per model", async () => {
    const w = await world();
    expect(await w.adapter.singleCall!(w.request)).toEqual({ output: { answer: "42" }, tokenUsage: 24, usageEvidence: expect.objectContaining({ normalizedTotal: 24 }),
      modelUsage: [{ model: "gpt-6-sol", input: 15, output: 4, cacheRead: 5, cacheWrite: 0 }] });
    expect(readFileSync(`${w.marker}.calls`, "utf8")).toBe("single-call\n");
  });

  it("C8.2: runs read-only in the empty cwd with every isolation key and the installed tool flags off", async () => {
    const w = await world();
    await w.adapter.singleCall!(w.request);
    const argv = lastArgv(w.marker);
    expect(argv.slice(0, 7)).toEqual(["exec", "--json", "--ephemeral", "--color", "never", "--skip-git-repo-check", "--model"]);
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(argv[argv.indexOf("-C") + 1]).toBe(w.request.cwd);
    const c = argv.flatMap((arg, i) => (arg === "-c" ? [argv[i + 1]!] : []));
    expect(c).toEqual([
      "include_permissions_instructions=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
      "include_environment_context=false", "project_doc_max_bytes=0",
      "features.apps=false", "features.image_generation=false", "features.multi_agent=false", "features.plugins=false",
      "features.shell_tool=false", "features.skip_host_skill_discovery=true", "features.unified_exec=false", "features.view_image=false",
    ]);
    expect(argv.at(-1)).toBe("-");
  });

  it("C8.3: runs in a private HOME and CODEX_HOME whose auth.json and config.toml are symlinks, never copies (R9)", async () => {
    const w = await world();
    await w.adapter.singleCall!(w.request);
    const env = JSON.parse(readFileSync(`${w.marker}.single-env.json`, "utf8")) as { HOME: string; CODEX_HOME: string; authIsLink: boolean };
    expect(env.HOME.startsWith(join(w.request.runDir, "codex", "1", "single-call"))).toBe(true);
    expect(env.CODEX_HOME.startsWith(join(w.request.runDir, "codex", "1", "single-call"))).toBe(true);
    expect(env.authIsLink).toBe(true);
    expect(await readlink(join(env.CODEX_HOME, "config.toml"))).toBe(join(w.codexHome, "config.toml"));
    expect([(await lstat(env.HOME)).mode & 0o777, (await lstat(env.CODEX_HOME)).mode & 0o777]).toEqual([0o700, 0o700]);
  });

  it("C8.4: refuses before spawning, booking 0, when the feature list cannot be read", async () => {
    const w = await world();
    await writeFile(`${w.marker}.catalog.json`, JSON.stringify({ exitCode: 9 }));
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toMatchObject({ code: "codex-single-call-unavailable", neverStarted: true });
    expect(observedTokensOf(error)).toBe(0);
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });

  it.each([
    ["tool", [{ type: "item.started", item: { id: "i", type: "command_execution", command: "ls" } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
    ["messages", [{ type: "item.completed", item: { type: "agent_message", text: "{}" } }, { type: "item.completed", item: { type: "agent_message", text: "{\"answer\":\"42\"}" } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
    ["turns", [{ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 1 } }, { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } }], 36],
  ] as const)("C8.5: refuses a call that was not single (%s) and books the usage it saw", async (what, rows, booked) => {
    const w = await world({ rows });
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toMatchObject({ code: `codex-single-call-not-single:${what}` });
    expect(observedTokensOf(error)).toBe(booked);
  });

  it("C8.6: an answer that is not one object is single-call-output-invalid with its usage", async () => {
    const w = await world({ final: "not json" });
    const error = await failure(w.adapter.singleCall!(w.request));
    expect(error).toBeInstanceOf(SingleCallOutputInvalid);
    expect((error as SingleCallOutputInvalid).tokenUsage).toBe(24);
  });

  it("C8.7: an answer over the request's maxOutputTokens is still the answer (R2: the bound is checked after the fact by Orca)", async () => {
    const w = await world({ rows: [{ type: "item.completed", item: { type: "agent_message", text: "{\"answer\":\"42\"}" } }, { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 9000 } }] });
    expect(await w.adapter.singleCall!(w.request)).toMatchObject({ output: { answer: "42" }, tokenUsage: 9020, modelUsage: [{ output: 9000 }] });
  });
});
```

  and `tests/control/codexSingleCallWorker.test.ts`, copying `tests/control/ompSingleCallWorker.test.ts:31-70`'s `world()`
  shape with a codex installation (`[process.execPath, FAKE_CODEX, "integration", marker]`, `configDir` a temp codex home)
  and asserting: complete call ⇒ `booked(events)` = `[["work", 24], ["handoff", 0]]`, record
  `{ outcome: "complete", errorCode: null }`, output `{ answer: "42" }`; a `tool` call ⇒ `[["work", 36], ["handoff", 0]]`,
  record `{ outcome: "failed", errorCode: "codex-single-call-not-single:tool" }`.

- [ ] **Step 3: red.** P-2 both files → `$LOGS/t8-red.log` (`adapter.singleCall` is undefined).

- [ ] **Step 4: implement.** `src/runtime/codex/codexSingleCall.ts`:

```ts
import { chmod, lstat, mkdir, mkdtemp, symlink } from "node:fs/promises";
import { join } from "node:path";
import { parseSingleCallObject } from "../omp/ompSingleCall.js";
import { SingleCallOutputInvalid, type SingleCallResult } from "../types.js";
import { codexModelUsage, decodeCodexUsage, observedTurnUsage } from "./protocol.js";

/** Every-agent requirement chain (Orca spec 2026-10-15 §2.5 last row, §6.1; values from plan Task 0 on codex <version>). */
export const CODEX_SINGLE_CALL_CONFIG: readonly string[] = [
  "include_permissions_instructions=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
  "include_environment_context=false", "project_doc_max_bytes=0",
];
const TURNED_ON = new Set(["skip_host_skill_discovery"]);

export function codexSingleCallArgs(input: { model: string; cwd: string; schemaPath: string; finalPath: string; features: readonly string[] }): string[] {
  return ["exec", "--json", "--ephemeral", "--color", "never", "--skip-git-repo-check", "--model", input.model, "--sandbox", "read-only",
    "-C", input.cwd, "--output-schema", input.schemaPath, "-o", input.finalPath,
    ...CODEX_SINGLE_CALL_CONFIG.flatMap((value) => ["-c", value]),
    ...input.features.flatMap((name) => ["-c", `features.${name}=${TURNED_ON.has(name) ? "true" : "false"}`]),
    "-"];
}

/** R9: a private HOME and CODEX_HOME under the run directory; auth.json and config.toml are symlinked, never copied. */
export async function codexSingleCallHome(runDir: string, sourceCodexHome: string): Promise<{ home: string; codexHome: string }> {
  const root = join(runDir, "codex", "1", "single-call");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const base = await mkdtemp(join(root, "home-"));
  const home = join(base, "home"), codexHome = join(base, "codex-home");
  for (const dir of [home, codexHome]) { await mkdir(dir, { mode: 0o700 }); await chmod(dir, 0o700); }
  for (const name of ["auth.json", "config.toml"]) {
    const source = join(sourceCodexHome, name);
    if (await lstat(source).then(() => true, () => false)) await symlink(source, join(codexHome, name));
  }
  return { home, codexHome };
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const notSingle = (what: string, events: string) => Object.assign(new Error(`codex-single-call-not-single:${what}`), { code: `codex-single-call-not-single:${what}`, observedTokens: observedTurnUsage(events) });

/** §6.1, fail closed: no tool or command item, at most one completed agent message, exactly one completed turn, one object. */
export function decodeCodexSingleCall(events: string, final: string | null, model: string, evidenceDir: string): SingleCallResult {
  let messages = 0, turns = 0, tool = false;
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { throw Object.assign(new Error("codex-events-invalid"), { observedTokens: observedTurnUsage(events) }); }
    if (!record(row) || typeof row.type !== "string") throw Object.assign(new Error("codex-events-invalid"), { observedTokens: observedTurnUsage(events) });
    if (row.type.startsWith("item.") && record(row.item) && row.item.type !== "agent_message" && row.item.type !== "reasoning") tool = true;
    if (row.type === "item.completed" && record(row.item) && row.item.type === "agent_message") messages += 1;
    if (row.type === "turn.completed") turns += 1;
  }
  if (tool) throw notSingle("tool", events);
  if (messages > 1) throw notSingle("messages", events);
  if (turns > 1) throw notSingle("turns", events);
  const usage = decodeCodexUsage(events, true);
  const modelUsage = codexModelUsage(events, model);
  const output = final === null ? undefined : parseSingleCallObject(final);
  if (output === undefined) throw new SingleCallOutputInvalid(evidenceDir, usage.tokenUsage, usage.usageEvidence);
  return { output, tokenUsage: usage.tokenUsage, usageEvidence: usage.usageEvidence, ...(modelUsage === null ? {} : { modelUsage }) };
}
```

  `src/runtime/codex/runCodexPhase.ts`: widen `PhaseRequest` (line 11) to the interface above; line 28-30 →
  `const args = request.spawn !== undefined ? [...config.command.slice(1), ...request.spawn.args({ schemaPath, finalPath })] : [<existing array>];`;
  line 42 → `const wireBusinessSchema = request.spawn?.schema ?? (phase === "execute" ? executeWireJsonSchema() : phaseJsonSchema(phase as CodexPhase));`
  (line 43 unchanged: `phase === "execute"` is false for `"single-call"`); line 48 env →
  `env: request.spawn?.env ?? { ...process.env, ...extraEnv }`. Nothing else in the function changes.

  `src/runtime/codex/codexAdapter.ts`: `CodexAdapterOptions` gains `installation?: InstallationV1`; store
  `private readonly installation` in the constructor; add:

```ts
  /**
   * Every-agent requirement chain (Orca spec 2026-10-15 §6.1, R2, R9): one structured call, tools off, in a private HOME and
   * CODEX_HOME. Codex cannot cap the output; the bound is checked by Orca after the fact. Refused before spawning when the
   * installed feature list is unknown, since the tool flags could not be turned off (plan spec issue 9).
   */
  async singleCall(request: SingleCallRequest): Promise<SingleCallResult> {
    if (this.installation === undefined) throw new Error("single-call-unsupported");
    const catalog = await readAgentCatalog(this.installation, { deadline: Date.now() + Math.min(request.timeoutMs, this.config.timeoutMs), signal: request.signal });
    if (catalog.codexFeatures === null) {
      throw Object.assign(new Error(`codex-single-call-unavailable: ${catalog.catalogError ?? "no feature list"}`), { code: "codex-single-call-unavailable", neverStarted: true });
    }
    const features = catalog.codexFeatures;
    const isolated = await codexSingleCallHome(request.runDir, this.extraEnv?.CODEX_HOME ?? join(process.env.HOME ?? "/nonexistent", ".codex"));
    const context = { runDir: request.runDir, attempt: 1, worktreePath: request.cwd, abortSignal: request.signal, onProcessRegistered: request.onProcessRegistered,
      state: { budgetSnapshot: { timeRemainingMs: request.timeoutMs } } } as unknown as AttemptContext;
    const outcome = await runCodexPhase(this.config, { phase: "single-call", prompt: request.prompt, context, spawn: {
      schema: request.responseSchema, env: { ...process.env, HOME: isolated.home, CODEX_HOME: isolated.codexHome },
      args: ({ schemaPath, finalPath }) => codexSingleCallArgs({ model: this.config.model, cwd: request.cwd, schemaPath, finalPath, features }),
    } });
    if (outcome.reason === "aborted") throw new CodexPhaseAborted(outcome.evidenceDir, outcome.observedTokens);
    if (outcome.reason !== "completed") throw Object.assign(new Error(`codex-${outcome.reason}: ${outcome.evidenceDir}`), { observedTokens: outcome.observedTokens });
    return decodeCodexSingleCall(outcome.events, outcome.final, this.config.model, outcome.evidenceDir);
  }
```

  `src/agents/codex.ts:63`: `return new CodexAdapter(toCodexConfig(config), configDir === null ? undefined : { CODEX_HOME: configDir }, options?.codexSkillsDir, { installation: config.installation });`
  `src/runtime/types.ts:230-233`: append to the doc comment `*** ERRATUM (Orca spec 2026-10-15 §6.1) -- codex has it too: its descriptor answers "v1-soft" per catalog row; the adapter refuses again at spawn when the feature list is unknown. ***`

  **Fallback branch (Task 0 said isolation is not workable):** `codexSingleCallHome` is not called; env is
  `{ ...process.env, ...this.extraEnv }`; C8.3 is replaced by a criterion that asserts the env equals the user's
  (`HOME === process.env.HOME`) with the comment "R9 fallback: codex single calls are not reproducible and carry the
  user's skills (Task 0, <date>)"; record it in the ledger and in ccloop's handoff.

- [ ] **Step 5: green.** P-2 the two new files + `tests/runtime/codex tests/control/singleCall.test.ts tests/control/handoffDeadlineUsage.test.ts` → `$LOGS/t8-green.log`; RC=0.

- [ ] **Step 6: mutations.** M8.1 `env: request.spawn?.env ?? {...}` → `env: { ...process.env, ...extraEnv }` ⇒ red C8.3.
  M8.2 `await symlink(source, ...)` → `await copyFile(source, ...)` (import it) ⇒ red C8.3 (`authIsLink`). M8.3
  `if (catalog.codexFeatures === null) {...}` removed (use `features = catalog.codexFeatures ?? []`) ⇒ red C8.4 (and re-run
  M3.6 here: `[...CODEX_SINGLE_CALL_FEATURES]` instead of the filter -- C8.2 stays green with the full fake list; record it
  as covered only by the real codex's "Unknown feature flag" refusal, paid check P1). M8.4 `if (tool) throw ...` deleted ⇒
  red C8.5[tool]. M8.5 `messages > 1` → `messages > 2` ⇒ red C8.5[messages]. M8.6 `turns > 1` → `turns > 2` ⇒ red
  C8.5[turns] (or `decodeCodexUsage(..., true)` catches it first as `codex-conflicting-completion` -- then the guard is
  shadowed; register, do not invent; Orca handoff §6.1 item 8). M8.7 `TURNED_ON.has(name) ? "true" : "false"` → `"false"`
  ⇒ red C8.2. M8.8 `"--sandbox", "read-only"` → `"--sandbox", "workspace-write"` ⇒ red C8.2.

- [ ] **Step 7: commit**, subject `feat(runtime): codex single call, tools off in a private home, bound checked after the fact`.

---

