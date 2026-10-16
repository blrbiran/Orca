## Task 3: A bounded probe with stage and elapsed time (ccloop, spec §4.3, R6; criterion 2)

**Files:**
- Create: `src/agents/catalogProbe.ts`, `src/agents/codexCatalog.ts`
- Modify: `src/agents/ompModels.ts:4-77,85-86` (`runOmpJson` → `runProbe`; `readOmpCatalog` options)
- Modify: `src/agents/materialize.ts:25,47` (`probeVersion` accepts `signal`)
- Test: `tests/agents/catalogProbe.test.ts`

**Interfaces:**
- Consumes: Task 1 fakes (`<marker>.models.json {hang|sleepMs}`, `<marker>.models.pid`, `<marker>.catalog.json`).
- Produces:
  - `export const PROBE_CAP_MS = 30_000`
  - `export type ProbeStage = "spawn" | "timeout" | "abort" | "exit" | "decode"`
  - `export class CatalogProbeError extends Error { readonly stage: ProbeStage; readonly elapsedMs: number }`
  - `export function probeTimeoutMs(deadline: number | undefined, now?: number): number` (`max(0, min(deadline-now, 30_000))`; no deadline ⇒ 30_000)
  - `export async function runProbe(code: string, command: string, args: string[], env: NodeJS.ProcessEnv, options: { timeoutMs: number; signal?: AbortSignal }): Promise<string>`
  - `export function stderrTail(kept: Buffer): string` (moved verbatim from `ompModels.ts:13-22`)
  - `readOmpCatalog(installation, options?: { timeoutMs?: number; deadline?: number; signal?: AbortSignal })`
  - `export async function readCodexCatalog(installation: InstallationV1, options: { deadline?: number; signal?: AbortSignal }): Promise<{ rows: CatalogRowV1[]; features: string[] }>`
  - `export const CODEX_SINGLE_CALL_FEATURES = ["apps","image_generation","multi_agent","plugins","shell_tool","skip_host_skill_discovery","unified_exec","view_image"] as const`
  - Message shape: `<code>: <reason> · stage <stage> · elapsedMs <n>[ · stderr: <tail>]`; reasons `exit <n>`, `signal <s>`, `timeout <ms>ms`, `aborted`, `spawn <errno>`, `output-limit`.

- [ ] **Step 1: failing tests** `tests/agents/catalogProbe.test.ts`:

```ts
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexCatalog } from "../../src/agents/codexCatalog.js";
import { probeTimeoutMs } from "../../src/agents/catalogProbe.js";
import { readOmpCatalog } from "../../src/agents/ompModels.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.3, R6; criterion 2): a probe that outlives the caller's deadline
// or abort is killed (its process is gone) and the refusal names the elapsed time and the stage. The old fixed limit was
// 10 s; every deadline here is far below it.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function omp(models?: Record<string, unknown>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-probe-")));
  const marker = join(dir, "omp-marker");
  if (models) await writeFile(`${marker}.models.json`, JSON.stringify(models));
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const installation: InstallationV1 = { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null };
  return { marker, installation };
}
async function codex(catalog?: Record<string, unknown>, toml?: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-probe-codex-")));
  const marker = join(dir, "codex-marker");
  if (catalog) await writeFile(`${marker}.catalog.json`, JSON.stringify(catalog));
  if (toml !== undefined) await writeFile(join(dir, "config.toml"), toml);
  const installation: InstallationV1 = { kind: "codex", command: [process.execPath, FAKE_CODEX, "integration", marker], version: "9.9.9-fake", configDir: dir, timeoutMs: 60_000, killGraceMs: 50, sandbox: "read-only", budgetMode: "soft" };
  return { marker, installation };
}
const gone = async (pid: number) => { for (const until = Date.now() + 3_000; Date.now() < until; await new Promise((r) => setTimeout(r, 25))) { try { process.kill(pid, 0); } catch { return true; } } return false; };
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a rejection"); }, (error: Error) => error);

describe("criterion 2: deadline and abort (spec §4.3)", () => {
  it("kills a hanging omp catalog probe at the caller's deadline and names stage and elapsed time", async () => {
    const w = await omp({ hang: true });
    const started = Date.now();
    const error = await failure(readOmpCatalog(w.installation, { deadline: started + 600 }));
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: timeout \d+ms · stage timeout · elapsedMs \d+$/);
    expect(Number(/elapsedMs (\d+)/.exec(error.message)![1])).toBeGreaterThanOrEqual(500);
    expect(await gone(Number(await readFile(`${w.marker}.models.pid`, "utf8")))).toBe(true);
  });

  it("kills it when the caller aborts, as stage abort", async () => {
    const w = await omp({ hang: true });
    const controller = new AbortController(); setTimeout(() => controller.abort(), 300);
    const error = await failure(readOmpCatalog(w.installation, { signal: controller.signal }));
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: aborted · stage abort · elapsedMs \d+$/);
    expect(await gone(Number(await readFile(`${w.marker}.models.pid`, "utf8")))).toBe(true);
  });

  it("refuses without spawning when the deadline has already passed", async () => {
    const w = await omp();
    const error = await failure(readOmpCatalog(w.installation, { deadline: Date.now() - 1 }));
    expect(error.message).toMatch(/^omp-model-catalog-unavailable: timeout 0ms · stage timeout · elapsedMs \d+$/);
    await expect(readFile(`${w.marker}.catalog-calls`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("caps the timeout at 30 s and follows a nearer deadline", () => {
    expect(probeTimeoutMs(undefined, 1_000)).toBe(30_000);
    expect(probeTimeoutMs(1_000 + 90_000, 1_000)).toBe(30_000);
    expect(probeTimeoutMs(1_000 + 1_234, 1_000)).toBe(1_234);
    expect(probeTimeoutMs(500, 1_000)).toBe(0);
  });

  it("names exit, stage and the stderr tail last for codex (agent-catalog-unavailable)", async () => {
    const w = await codex({ exitCode: 4, stderr: "no catalog\n" });
    const error = await failure(readCodexCatalog(w.installation, {}));
    expect(error.message).toMatch(/^agent-catalog-unavailable: exit 4 · stage exit · elapsedMs \d+ · stderr: no catalog$/);
  });

  it("names a codex probe past its deadline as stage timeout", async () => {
    const w = await codex({ sleepMs: 5_000 });
    const error = await failure(readCodexCatalog(w.installation, { deadline: Date.now() + 400 }));
    expect(error.message).toMatch(/^agent-catalog-unavailable: timeout \d+ms · stage timeout · elapsedMs \d+$/);
  });
});

describe("codex catalog decode (spec §3, §6.1)", () => {
  it("reads every row with its window and visibility, and the installed tool flags in order", async () => {
    const w = await codex();
    expect(await readCodexCatalog(w.installation, {})).toEqual({
      rows: [
        { selector: "gpt-6-sol", provider: "codex", contextWindow: 272000, maxTokens: null, listed: true },
        { selector: "gpt-6-luna", provider: "codex", contextWindow: 272000, maxTokens: null, listed: true },
        { selector: "gpt-reserve", provider: "codex", contextWindow: 272000, maxTokens: null, listed: false },
      ],
      features: ["apps", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"],
    });
  });

  it("lets config.toml's top-level model_context_window win over the catalog, and ignores one inside a table", async () => {
    expect((await readCodexCatalog((await codex(undefined, "model = \"x\"\nmodel_context_window = 100000\n[profiles.a]\n")).installation, {})).rows[0]!.contextWindow).toBe(100000);
    expect((await readCodexCatalog((await codex(undefined, "[profiles.a]\nmodel_context_window = 100000\n")).installation, {})).rows[0]!.contextWindow).toBe(272000);
  });

  it("refuses malformed rows as stage decode", async () => {
    const w = await codex({ rows: [{ slug: 3 }] });
    expect((await failure(readCodexCatalog(w.installation, {}))).message).toMatch(/^agent-catalog-unavailable: decode · stage decode · elapsedMs \d+$/);
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t3-red.log` (load failure: `codexCatalog.js` missing; then after an empty stub, each test
  listed failed).

- [ ] **Step 3: implement.**
  `src/agents/catalogProbe.ts`: move `STDERR_KEEP`, `STDERR_TAIL_BYTES`, `OUTPUT_LIMIT` and `stderrTail` from
  `ompModels.ts:4-22` verbatim (keep the #58 comment), then:

```ts
import { spawn } from "node:child_process";

/** Every-agent requirement chain (Orca spec 2026-10-15 §4.3, R6): the old fixed 10 s became min(caller deadline, 30 s). */
export const PROBE_CAP_MS = 30_000;
export type ProbeStage = "spawn" | "timeout" | "abort" | "exit" | "decode";
export class CatalogProbeError extends Error {
  constructor(readonly stage: ProbeStage, readonly elapsedMs: number, message: string) { super(message); this.name = "CatalogProbeError"; }
}
export function probeTimeoutMs(deadline: number | undefined, now = Date.now()): number {
  return deadline === undefined ? PROBE_CAP_MS : Math.max(0, Math.min(deadline - now, PROBE_CAP_MS));
}
export function probeFailure(code: string, reason: string, stage: ProbeStage, startedAt: number, tail = ""): CatalogProbeError {
  const elapsedMs = Date.now() - startedAt;
  return new CatalogProbeError(stage, elapsedMs, `${code}: ${reason} · stage ${stage} · elapsedMs ${elapsedMs}${tail === "" ? "" : ` · stderr: ${tail}`}`);
}

/** One catalog/feature probe in a private process group; resolves with stdout, or rejects naming why, the stage and the time. */
export function runProbe(code: string, command: string, args: string[], env: NodeJS.ProcessEnv, options: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
  const startedAt = Date.now();
  if (options.timeoutMs <= 0) return Promise.reject(probeFailure(code, "timeout 0ms", "timeout", startedAt));
  if (options.signal?.aborted) return Promise.reject(probeFailure(code, "aborted", "abort", startedAt));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let bytes = 0; let stderr: Buffer = Buffer.alloc(0);
    let stopped: { reason: string; stage: ProbeStage } | null = null; let spawnError: NodeJS.ErrnoException | null = null;
    const kill = (reason: string, stage: ProbeStage): void => {
      if (stopped !== null) return; stopped = { reason, stage };
      if (child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const timer = setTimeout(() => kill(`timeout ${options.timeoutMs}ms`, "timeout"), options.timeoutMs);
    const onAbort = (): void => kill("aborted", "abort");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > OUTPUT_LIMIT) { kill("output-limit", "decode"); return; } chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => {
      if (chunk.length > OUTPUT_LIMIT) kill("output-limit", "decode");
      stderr = Buffer.concat([stderr, chunk.subarray(Math.max(0, chunk.length - STDERR_KEEP))]);
      if (stderr.length > STDERR_KEEP) stderr = stderr.subarray(stderr.length - STDERR_KEEP);
    });
    child.on("error", (error: NodeJS.ErrnoException) => { spawnError = error; });
    child.on("close", (exit, signal) => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      // Feedback #58: the code stays the message's prefix; the reason comes first, the stderr tail last.
      const failed = stopped ?? (spawnError !== null ? { reason: `spawn ${spawnError.code ?? spawnError.message}`, stage: "spawn" as const }
        : exit === null ? { reason: `signal ${signal ?? "unknown"}`, stage: "exit" as const } : exit !== 0 ? { reason: `exit ${exit}`, stage: "exit" as const } : null);
      if (failed !== null) { reject(probeFailure(code, failed.reason, failed.stage, startedAt, stderrTail(stderr))); return; }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
```

  `src/agents/ompModels.ts`: delete the moved constants/`stderrTail`; replace `runOmpJson` (lines 30-77) with:

```ts
async function runOmpJson(installation: InstallationV1, args: string[], options: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
  const profile = installation.profile as string | null;
  const env: NodeJS.ProcessEnv = { ...process.env, OMP_PROFILE: profile ?? "default" };
  if (installation.configDir !== null) env.PI_CODING_AGENT_DIR = installation.configDir;
  const stdout = await runProbe("omp-model-catalog-unavailable", installation.command[0], ["--no-extensions", "--profile", profile ?? "default", ...args], env, options);
  try { return JSON.parse(stdout) as unknown; } catch { throw new Error("omp-model-catalog-invalid"); }
}
```

  `readOmpCatalog(installation, options: { timeoutMs?: number; deadline?: number; signal?: AbortSignal } = {})` calls
  `runOmpJson(installation, ["models", "--json"], { timeoutMs: options.timeoutMs ?? probeTimeoutMs(options.deadline), signal: options.signal })`;
  `readOmpConfiguredDefault` calls `runOmpJson(installation, [...], { timeoutMs: PROBE_CAP_MS })`. (C58b passes
  `{ timeoutMs: 300 }` and keeps reading `timeout 300ms` first.)

  `src/agents/codexCatalog.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { probeFailure, probeTimeoutMs, runProbe } from "./catalogProbe.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/** Spec 2026-10-15 §2.4/§6.1: the tool flags a codex single call turns off, plus skip_host_skill_discovery (turned on). */
export const CODEX_SINGLE_CALL_FEATURES = ["apps", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"] as const;
const CODE = "agent-catalog-unavailable";
const positiveSafe = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

/** §6.1 "Window": a top-level `model_context_window = <n>` before the first `[table]` wins over the catalog. */
function configuredWindow(toml: string): number | null {
  const head = toml.split(/^\s*\[/m, 1)[0]!;
  const match = /^\s*model_context_window\s*=\s*(\d+)\s*(?:#.*)?$/m.exec(head);
  return match === null ? null : positiveSafe(Number(match[1]));
}

export async function readCodexCatalog(installation: InstallationV1, options: { deadline?: number; signal?: AbortSignal }): Promise<{ rows: CatalogRowV1[]; features: string[] }> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(installation.configDir === null ? {} : { CODEX_HOME: installation.configDir }) };
  const deadline = options.deadline ?? Date.now() + 30_000;
  const startedAt = Date.now();
  const models = await runProbe(CODE, installation.command[0], [...installation.command.slice(1), "debug", "models"], env, { timeoutMs: probeTimeoutMs(deadline), signal: options.signal });
  let rows: CatalogRowV1[];
  try {
    const parsed = JSON.parse(models) as { models?: unknown };
    if (!Array.isArray(parsed.models)) throw new Error();
    rows = parsed.models.map((row) => {
      const value = row as Record<string, unknown>;
      if (typeof value.slug !== "string" || value.slug.length === 0 || value.slug.length > 200 || (value.visibility !== "list" && value.visibility !== "hide")) throw new Error();
      return { selector: value.slug, provider: "codex", contextWindow: positiveSafe(value.context_window), maxTokens: null, listed: value.visibility === "list" };
    });
    if (new Set(rows.map((row) => row.selector)).size !== rows.length) throw new Error();
  } catch { throw probeFailure(CODE, "decode", "decode", startedAt); }
  const codexHome = installation.configDir ?? env.CODEX_HOME ?? (env.HOME ? join(env.HOME, ".codex") : null);
  const window = codexHome === null ? null : await readFile(join(codexHome, "config.toml"), "utf8").then(configuredWindow, () => null);
  if (window !== null) rows = rows.map((row) => ({ ...row, contextWindow: window }));
  const listed = await runProbe(CODE, installation.command[0], [...installation.command.slice(1), "features", "list"], env, { timeoutMs: probeTimeoutMs(deadline), signal: options.signal });
  const names = new Set(listed.split("\n").map((line) => /^([a-z0-9_.]+)\s/.exec(line)?.[1]).filter((name): name is string => name !== undefined));
  return { rows, features: CODEX_SINGLE_CALL_FEATURES.filter((name) => names.has(name)) };
}
```

  `src/agents/materialize.ts:25`: `probeVersion(command, options: { timeoutMs?: number; signal?: AbortSignal } = {})`;
  inside, `options.signal?.addEventListener("abort", abortTree, { once: true })` and remove it in `finish`.

- [ ] **Step 4: green.** P-2 `tests/agents/catalogProbe.test.ts tests/agents/ompCatalogDiagnostics.test.ts tests/agents/ompCatalog.test.ts tests/runtime/omp tests/agents/materialize.test.ts`
  → `$LOGS/t3-green.log`; RC=0; C58a-c pass **unchanged** (`git diff --stat -- tests/agents/ompCatalogDiagnostics.test.ts` empty).

- [ ] **Step 5: mutations.** M3.1 `const onAbort = (): void => kill("aborted", "abort");` → `const onAbort = (): void => undefined;`
  ⇒ red "kills it when the caller aborts". M3.2 `try { process.kill(-child.pid, "SIGKILL"); }` → `try { child.kill("SIGTERM"); }`
  ⇒ red on `gone(pid)` in the deadline test (the shell wrapper dies, the node child keeps the pid) -- record if green
  (then the wrapper `exec`s and the guard is redundant for this fixture; register, do not invent). M3.3 in
  `probeTimeoutMs` `Math.min(deadline - now, PROBE_CAP_MS)` → `PROBE_CAP_MS` ⇒ red "caps the timeout..." and the deadline
  test (elapsed < 3000). M3.4 `if (options.timeoutMs <= 0) return Promise.reject(...)` deleted ⇒ red "refuses without
  spawning". M3.5 `if (window !== null) rows = ...` → `if (false) rows = ...` ⇒ red "lets config.toml's...". M3.6
  `CODEX_SINGLE_CALL_FEATURES.filter((name) => names.has(name))` → `[...CODEX_SINGLE_CALL_FEATURES]` ⇒ survives with the
  default fake (all listed); add the observation and **add** a test whose fake lists only `apps` (write it as
  `<marker>.catalog.json` cannot do this -- the fake's flag list is fixed, so record M3.6 as needing Task 8's
  unknown-flag criterion C8.4 and re-run it there).

- [ ] **Step 6: commit** `src/agents/catalogProbe.ts src/agents/codexCatalog.ts src/agents/ompModels.ts src/agents/materialize.ts tests/agents/catalogProbe.test.ts`,
  subject `feat(agents): catalog probes honour the caller's deadline and abort and name their stage`.

---

