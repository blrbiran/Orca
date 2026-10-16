## Task 4: One reader for every catalog and version read (ccloop, spec §4.1, R4/R6/R8; criterion 1)

**Files:**
- Create: `src/agents/agentCatalog.ts`, `tests/setup/relocateCatalogCache.ts`
- Modify: `vitest.config.ts:7` (setupFiles), `src/agents/materialize.ts:88-143`, `src/agents/updates.ts:139-144`,
  `src/runtime/omp/ompSingleCall.ts:36-42`
- Test: `tests/agents/agentCatalog.test.ts`

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces:
  - `export interface AgentCatalogV1 { source: "cache" | "probe"; observedAt: string; version: string | null; rows: CatalogRowV1[] | null; codexFeatures: string[] | null; catalogError: string | null }`
  - `export async function readAgentCatalog(installation: InstallationV1, options?: { deadline?: number; signal?: AbortSignal; refresh?: boolean; env?: NodeJS.ProcessEnv; log?: (line: string) => void; now?: () => number }): Promise<AgentCatalogV1>`
  - `resolveAgent(table, partial, deps: { probeVersion?; probeModels?; probeCatalog?; deadline?: number; signal?: AbortSignal })`

- [ ] **Step 1: setup file** `tests/setup/relocateCatalogCache.ts` (listed **after** `scopeTmpdir.ts` in `vitest.config.ts`):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.2): every test file, and every process it spawns, caches agent
 * catalogs under this file's scoped TMPDIR (scopeTmpdir.ts removes it), never in the person's ~/.cache.
 */
process.env.CCLOOP_CACHE_DIR = mkdtempSync(join(tmpdir(), "ccache-"));
```

- [ ] **Step 2: failing tests** `tests/agents/agentCatalog.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentCatalog } from "../../src/agents/agentCatalog.js";
import { runControlCommand } from "../../src/control/command.js";
import { acceptStart } from "../../src/control/accept.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import { codexInstallation, singleCallEnvelope, writeAgentsTable } from "../control/agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.1, R4; criterion 1): with a warm cache, capabilities and accept
// for an omp or codex selection spawn no catalog and no version process -- read from the fakes' own counts.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const count = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").length : 0);
async function table() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agent-catalog-")));
  const ompMarker = join(dir, "omp-marker"), codexMarker = join(dir, "codex-marker");
  const omp = join(dir, "omp");
  await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${ompMarker}' "$@"\n`, { mode: 0o700 });
  const codex = await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", codexMarker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 });
  const written = await writeAgentsTable({
    omp: { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    codex,
  }, dir);
  return { dir, ...written, ompMarker, codexMarker };
}
const spawns = (marker: string) => count(`${marker}.catalog-calls`) + count(`${marker}.version-calls`);

describe("criterion 1: a warm cache spawns nothing (spec §4.1)", { timeout: 30_000 }, () => {
  it("capabilities for omp and codex probe once, then never again", async () => {
    const t = await table();
    for (const agent of ["omp", "codex"]) {
      expect((await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent } }))).code).toBe(0);
    }
    const warm = [spawns(t.ompMarker), spawns(t.codexMarker)];
    // omp 2 = 1 version + 1 models; codex 4 = 1 version by codexInstallation (agentsFixture.ts:28-41) + 1 version + debug-models + features-list.
    expect(warm).toEqual([2, 4]);
    for (const agent of ["omp", "codex", "omp", "codex"]) {
      expect((await runControlCommand(["capabilities", "--agents", t.path], JSON.stringify({ agent: { agent } }))).code).toBe(0);
    }
    expect([spawns(t.ompMarker), spawns(t.codexMarker)]).toEqual(warm);
  });

  // codex joins this loop in Task 6 (only-add), once codex answers v1-soft and accept admits its single-call work.
  it("accept for omp probes nothing on a warm key", async () => {
    const t = await table();
    for (const agent of ["omp"] as const) {
      const { resolution } = await resolveAgent(t.table, { agent });
      const before = spawns(agent === "omp" ? t.ompMarker : t.codexMarker);
      const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agent-catalog-accept-")));
      const status = await acceptStart(singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash }), {
        agentsTablePath: t.path, workerCommand: [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")], receiptTimeoutMs: 2_000,
      });
      expect(status.kind).toBe("accepted");
      expect(spawns(agent === "omp" ? t.ompMarker : t.codexMarker)).toBe(before);
    }
  });

  it("refresh skips the read, probes, and rewrites", async () => {
    const t = await table();
    const installation = t.table.installations.omp!;
    expect((await readAgentCatalog(installation)).source).toBe("probe");
    expect((await readAgentCatalog(installation)).source).toBe("cache");
    expect((await readAgentCatalog(installation, { refresh: true })).source).toBe("probe");
    expect(count(`${t.ompMarker}.catalog-calls`)).toBe(2);
  });

  it("does not write an entry when a probe failed, and reports the omp failure as catalogError", async () => {
    const t = await table();
    await writeFile(`${t.ompMarker}.models.json`, JSON.stringify({ exitCode: 3, stderr: "boom\n" }));
    const answer = await readAgentCatalog(t.table.installations.omp!, { env: { ...process.env, CCLOOP_CACHE_DIR: join(t.dir, "cache") } });
    expect(answer.catalogError).toMatch(/^omp-model-catalog-unavailable: exit 3 · stage exit · elapsedMs \d+ · stderr: boom$/);
    expect(existsSync(join(t.dir, "cache"))).toBe(false);
  });

  it("writes under a relocated HOME's default path only when CCLOOP_CACHE_DIR and XDG_CACHE_HOME are unset (§4.2)", async () => {
    const t = await table();
    const home = join(t.dir, "home");
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR };
    const run = spawnSync(process.execPath, [resolve("dist/cli.js"), "control", "capabilities", "--agents", t.path], { input: JSON.stringify({ agent: { agent: "omp" } }), env, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect((await readdir(join(home, ".cache", "ccloop", "agent-catalog"))).length).toBe(1);
    const redirected = join(t.dir, "redirected");
    const again = spawnSync(process.execPath, [resolve("dist/cli.js"), "control", "capabilities", "--agents", t.path], { input: JSON.stringify({ agent: { agent: "codex" } }), env: { ...env, CCLOOP_CACHE_DIR: redirected }, encoding: "utf8" });
    expect(again.status, again.stderr).toBe(0);
    expect((await readdir(join(home, ".cache", "ccloop", "agent-catalog"))).length).toBe(1);
    expect((await readdir(redirected)).length).toBe(1);
  });

  it("reads the omp spawn-time re-check through the cache (R8)", async () => {
    const t = await table();
    await readAgentCatalog(t.table.installations.omp!);
    const before = count(`${t.ompMarker}.catalog-calls`);
    const { runOmpSingleCall } = await import("../../src/runtime/omp/ompSingleCall.js");
    const runDir = join(t.dir, "run"), cwd = join(runDir, "cwd");
    await (await import("node:fs/promises")).mkdir(cwd, { recursive: true, mode: 0o700 });
    const config = { schema: "ccloop-agent-config-v1" as const, kind: "omp", installation: t.table.installations.omp!, selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" as const } };
    await runOmpSingleCall(config, { prompt: "p", responseSchema: { type: "object" }, maxOutputTokens: 8192, cwd, runDir, timeoutMs: 30_000 });
    expect(count(`${t.ompMarker}.catalog-calls`)).toBe(before);
  });
});
```

  Note for the implementer: `[2, 4]` is arithmetic from reading the code, not a measurement; if the green run shows other
  counts, find out why before changing the literal (an extra spawn is exactly what this criterion exists to catch). The
  criterion proper is the second `toEqual(warm)`.

- [ ] **Step 3: red.** `( cd "$CL" && npm run build )` then P-2 `tests/agents/agentCatalog.test.ts` → `$LOGS/t4-red.log`.

- [ ] **Step 4: implement** `src/agents/agentCatalog.ts`:

```ts
import { catalogCacheDir, catalogKey, entryFileName, readCatalogEntry, writeCatalogEntry } from "./catalogCache.js";
import { PROBE_CAP_MS, probeTimeoutMs } from "./catalogProbe.js";
import { readCodexCatalog } from "./codexCatalog.js";
import { probeVersion } from "./materialize.js";
import { readOmpCatalog } from "./ompModels.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.1, R4/R6/R8): every catalog and version read goes through here.
 * A hit within 30 minutes answers without spawning; a miss probes `--version` and, for omp and codex, the catalog, under
 * one deadline (the caller's, else 30 s from now), and writes an entry only when every probe answered.
 */
export interface AgentCatalogV1 {
  source: "cache" | "probe"; observedAt: string; version: string | null;
  rows: CatalogRowV1[] | null; codexFeatures: string[] | null; catalogError: string | null;
}
export interface ReadAgentCatalogOptions {
  deadline?: number; signal?: AbortSignal; refresh?: boolean; env?: NodeJS.ProcessEnv; log?: (line: string) => void; now?: () => number;
}

export async function readAgentCatalog(installation: InstallationV1, options: ReadAgentCatalogOptions = {}): Promise<AgentCatalogV1> {
  const env = options.env ?? process.env, now = options.now ?? Date.now, log = options.log ?? (() => undefined);
  const deadline = options.deadline ?? now() + PROBE_CAP_MS;
  const dir = catalogCacheDir(env);
  const key = await catalogKey(installation, env);
  if (dir !== null && options.refresh !== true) {
    const hit = await readCatalogEntry(dir, key, now());
    if (hit !== null) return { source: "cache", observedAt: hit.observedAt, version: hit.version, rows: hit.rows, codexFeatures: hit.codexFeatures, catalogError: null };
    log(`ccloop-agent-catalog: miss ${installation.kind} ${entryFileName(key).slice(0, 12)}`);
  }
  const version = await probeVersion(installation.command, { timeoutMs: Math.min(10_000, probeTimeoutMs(deadline, now())), signal: options.signal });
  let rows: CatalogRowV1[] | null = null, codexFeatures: string[] | null = null, catalogError: string | null = null;
  try {
    if (installation.kind === "omp") rows = await readOmpCatalog(installation, { deadline, signal: options.signal });
    else if (installation.kind === "codex") ({ rows, features: codexFeatures } = await readCodexCatalog(installation, { deadline, signal: options.signal }));
  } catch (error) {
    catalogError = error instanceof Error ? error.message : String(error);
    log(`ccloop-agent-catalog: probe-failed ${installation.kind} ${catalogError}`);
  }
  const observedAt = new Date(now()).toISOString();
  if (dir !== null && version !== null && catalogError === null) {
    await writeCatalogEntry(dir, { schema: "ccloop-agent-catalog-v1", key, observedAt, version, rows, codexFeatures });
  }
  return { source: "probe", observedAt, version, rows, codexFeatures, catalogError };
}
```

  (If the human rejects caching the version -- spec issue 8 -- the hit branch re-probes `version` and only `rows` /
  `codexFeatures` come from the entry.)

  `src/agents/materialize.ts` `resolveAgent` (lines 88-143): add `deadline?: number; signal?: AbortSignal` to `deps`;
  after `descriptor.validateSelection(selection)`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §4.1): without injected probes, the version and the catalog come
  // through the file cache under one deadline (spec issue 4); injected probes keep the uncached path older criteria use.
  const injected = deps.probeVersion !== undefined || deps.probeModels !== undefined || deps.probeCatalog !== undefined;
  const catalog = injected ? null : await readAgentCatalog(installation, { deadline: deps.deadline, signal: deps.signal });
  const observed = catalog !== null ? catalog.version : await (deps.probeVersion ?? probeVersion)(installation.command);
```

  keep lines 110-119 unchanged; in the omp block, when `catalog !== null`, throw `new Error(catalog.catalogError)` if it is
  non-null, else take `catalog.rows!`; otherwise keep the existing injected/uncached expression (write it as an `if`
  chain). (The codex row line is Task 6's.)

  `src/agents/updates.ts:142`: `const answer = await readAgentCatalog(installation); if (answer.catalogError !== null) return "omp-frozen-model-unavailable"; return answer.rows!.some((row) => row.selector === installation.defaultModel) ? undefined : "omp-frozen-model-unavailable";`
  (inside the existing try). Delete the now-unused `readOmpModels` import only if the typechecker says it is unused.

  `src/runtime/omp/ompSingleCall.ts:37-39`:

```ts
  // Every-agent requirement chain (Orca spec 2026-10-15 §4.1, §4.3, R6, R8): the re-check reads through the same cache key
  // and the call's own deadline and signal; a provider-side cap change without a config change is the accepted risk.
  const catalog = await readAgentCatalog(config.installation, { deadline: Date.now() + Math.min(request.timeoutMs, config.installation.timeoutMs), signal: request.signal });
  if (catalog.catalogError !== null || catalog.rows === null) throw new OmpSingleCallRefused("omp-single-call-unavailable", `catalog ${catalog.catalogError ?? "absent"}`);
  const rows: CatalogRowV1[] = catalog.rows;
```

  The published comment block at `ompSingleCall.ts:32-35` ("re-reads the selected catalog row immediately before
  spawning") gets an appended ERRATUM line (ccloop Rule 16): `*** ERRATUM (Orca spec 2026-10-15 §4.1, R8) -- "re-reads"
  now reads through the catalog cache (30-minute lifetime, config-stamped key); a cap raised on the provider side without
  a config change is not seen until the entry expires. ***`

- [ ] **Step 5: green, then the whole agents/control/runtime dirs.** `npm run build`; P-2
  `tests/agents tests/control tests/runtime` → `$LOGS/t4-green.log`; RC must be 0 (no resolution answer changes in this
  task: codex rows reach resolution only in Task 6). Any red: stop and diagnose; do not edit a criterion.

- [ ] **Step 6: mutations.** M4.1 `if (hit !== null) return {...}` → `if (false) return {...}` ⇒ red criterion 1 (both
  tests). M4.2 `options.refresh !== true` → `true` ⇒ red "refresh skips the read". M4.3
  `&& catalogError === null` deleted ⇒ red "does not write an entry when a probe failed". M4.4 in `ompSingleCall.ts`
  replace the new call with the old `readOmpCatalog(config.installation)` ⇒ red "reads the omp spawn-time re-check through
  the cache". M4.5 in `materialize.ts` `injected ? null : await readAgentCatalog(...)` → `null` ⇒ red criterion 1.
  M4.6 delete the setup file line in `vitest.config.ts` and run `tests/agents/agentCatalog.test.ts` with
  `HOME=$M/fakehome` ⇒ the default path appears under `$M/fakehome/.cache` (assert by `ls`, recorded; this mutation
  proves the setup file is what redirects).

- [ ] **Step 7: commit** `src/agents/agentCatalog.ts src/agents/materialize.ts src/agents/updates.ts src/runtime/omp/ompSingleCall.ts tests/setup/relocateCatalogCache.ts vitest.config.ts tests/agents/agentCatalog.test.ts`,
  subject `feat(agents): read every catalog and version through the file cache`.

---

