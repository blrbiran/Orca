## Task 2: The catalog cache file (ccloop, spec §4.1-§4.2)

**Files:**
- Create: `src/agents/catalogCache.ts`
- Modify: `src/agents/types.ts:37` (`CatalogRowV1` gains `listed?: boolean`)
- Test: `tests/agents/catalogCache.test.ts`

**Interfaces:**
- Produces:
  - `export const CATALOG_LIFETIME_MS = 1_800_000`
  - `export interface CatalogStampV1 { path: string; mtimeMs: number | null; size: number | null }`
  - `export interface CatalogKeyV1 { schema: "ccloop-agent-catalog-key-v1"; kind: string; command: string[]; files: CatalogStampV1[]; profile: string | null; configDir: string | null; inheritedConfigDir: string | null; configFiles: CatalogStampV1[] }`
  - `export interface CatalogEntryV1 { schema: "ccloop-agent-catalog-v1"; key: CatalogKeyV1; observedAt: string; version: string; rows: CatalogRowV1[] | null; codexFeatures: string[] | null }`
  - `export function catalogCacheDir(env: NodeJS.ProcessEnv): string | null`
  - `export async function catalogKey(installation: InstallationV1, env: NodeJS.ProcessEnv): Promise<CatalogKeyV1>`
  - `export function entryFileName(key: CatalogKeyV1): string` (`<canonicalHash(key)>.json`)
  - `export async function readCatalogEntry(dir: string, key: CatalogKeyV1, now: number): Promise<CatalogEntryV1 | null>`
  - `export async function writeCatalogEntry(dir: string, entry: CatalogEntryV1): Promise<void>` (never throws)
  - `CatalogRowV1` = `{ selector; provider; contextWindow; maxTokens; listed?: boolean }`

- [ ] **Step 1: failing tests** `tests/agents/catalogCache.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_LIFETIME_MS, catalogCacheDir, catalogKey, entryFileName, readCatalogEntry, writeCatalogEntry, type CatalogEntryV1 } from "../../src/agents/catalogCache.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §4.1-§4.2, R4): one file per key under a redirectable dir, 0700/0600
// set explicitly, a 30-minute lifetime, and any change of a key field is a miss. Each key-field test is the one the
// mutation "drop that field from catalogKey" turns red.
const T0 = Date.parse("2026-10-15T00:00:00.000Z");
const root = async () => realpath(await mkdtemp(join(tmpdir(), "ccloop-cache-")));
async function world(kind: "omp" | "codex" = "omp") {
  const dir = await root();
  const binary = join(dir, kind); await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  const home = join(dir, "home"); await mkdir(join(home, ".omp", "agent"), { recursive: true }); await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".omp", "agent", "config.yml"), "a: 1\n"); await writeFile(join(home, ".codex", "config.toml"), "model = \"x\"\n");
  const installation: InstallationV1 = kind === "omp"
    ? { kind, command: [binary], version: "18.10.1", configDir: null, timeoutMs: 1000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null }
    : { kind, command: [binary], version: "9.9.9-fake", configDir: null, timeoutMs: 1000, killGraceMs: 50, sandbox: "read-only", budgetMode: "soft" };
  const env = { HOME: home, CCLOOP_CACHE_DIR: join(dir, "cache") } as NodeJS.ProcessEnv;
  return { dir, binary, home, installation, env, cache: join(dir, "cache") };
}
const entry = (key: CatalogEntryV1["key"], at = T0): CatalogEntryV1 => ({ schema: "ccloop-agent-catalog-v1", key, observedAt: new Date(at).toISOString(), version: "18.10.1",
  rows: [{ selector: "gateway/model-a", provider: "gateway", contextWindow: 200000, maxTokens: 8192 }], codexFeatures: null });

describe("cache dir (spec §4.2)", () => {
  it("prefers CCLOOP_CACHE_DIR, then XDG_CACHE_HOME, then HOME, and refuses a relative or absent root", () => {
    expect(catalogCacheDir({ CCLOOP_CACHE_DIR: "/a", XDG_CACHE_HOME: "/b", HOME: "/c" })).toBe("/a");
    expect(catalogCacheDir({ XDG_CACHE_HOME: "/b", HOME: "/c" })).toBe("/b/ccloop/agent-catalog");
    expect(catalogCacheDir({ HOME: "/c" })).toBe("/c/.cache/ccloop/agent-catalog");
    expect(catalogCacheDir({ CCLOOP_CACHE_DIR: "rel", HOME: "/c" })).toBeNull();   // RF3
    expect(catalogCacheDir({})).toBeNull();                                         // RF3
  });
});

describe("entries (spec §4.1)", () => {
  it("round-trips an entry, creating the dir 0700 and the file 0600 whatever the umask", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    const old = process.umask(0o000);
    try { await writeCatalogEntry(w.cache, entry(key)); } finally { process.umask(old); }
    expect(await readCatalogEntry(w.cache, key, T0 + 1)).toEqual(entry(key));
    expect((await stat(w.cache)).mode & 0o777).toBe(0o700);
    expect((await stat(join(w.cache, entryFileName(key)))).mode & 0o777).toBe(0o600);
    expect(await readdir(w.cache)).toEqual([entryFileName(key)]);
  });

  it("leaves an existing dir's mode alone", async () => {
    const w = await world(); await mkdir(w.cache, { mode: 0o755 }); await chmod(w.cache, 0o755);
    await writeCatalogEntry(w.cache, entry(await catalogKey(w.installation, w.env)));
    expect((await stat(w.cache)).mode & 0o777).toBe(0o755);
  });

  it("is a miss at exactly 30 minutes, and for an entry from the future (RF4)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await writeCatalogEntry(w.cache, entry(key));
    expect(await readCatalogEntry(w.cache, key, T0 + CATALOG_LIFETIME_MS - 1)).not.toBeNull();
    expect(await readCatalogEntry(w.cache, key, T0 + 1_800_000)).toBeNull();
    expect(await readCatalogEntry(w.cache, key, T0 - 1)).toBeNull();
  });

  it("treats a corrupt entry and an entry whose stored key differs as a miss (RF4)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await mkdir(w.cache, { recursive: true });
    await writeFile(join(w.cache, entryFileName(key)), "{not json");
    expect(await readCatalogEntry(w.cache, key, T0)).toBeNull();
    await writeFile(join(w.cache, entryFileName(key)), JSON.stringify(entry({ ...key, kind: "codex" })));
    expect(await readCatalogEntry(w.cache, key, T0)).toBeNull();
  });

  it("never throws when the dir cannot be written, and leaves no temp file (RF2)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await writeFile(w.cache, "a file where the dir should be");
    await expect(writeCatalogEntry(w.cache, entry(key))).resolves.toBeUndefined();
    const locked = join(w.dir, "locked"); await mkdir(locked, { mode: 0o500 }); await chmod(locked, 0o500);
    await expect(writeCatalogEntry(locked, entry(key))).resolves.toBeUndefined();
    expect(await readdir(locked)).toEqual([]);
  });

  it("keeps one file when two writers race on a cold key (RF1)", async () => {
    const w = await world(); const key = await catalogKey(w.installation, w.env);
    await Promise.all([writeCatalogEntry(w.cache, entry(key)), writeCatalogEntry(w.cache, entry(key, T0 + 5))]);
    expect(await readdir(w.cache)).toEqual([entryFileName(key)]);
  });
});

describe("key fields (spec §4.1; each is a stale-hit guard)", () => {
  const changed = async (mutate: (w: Awaited<ReturnType<typeof world>>) => Promise<InstallationV1 | void>, kind: "omp" | "codex" = "omp") => {
    const w = await world(kind); const before = await catalogKey(w.installation, w.env);
    const next = (await mutate(w)) ?? w.installation;
    return entryFileName(await catalogKey(next, w.env)) !== entryFileName(before);
  };
  it("the binary's mtime", async () => expect(await changed(async (w) => { await utimes(w.binary, new Date(T0), new Date(T0)); })).toBe(true));
  it("the binary's size", async () => expect(await changed(async (w) => { await writeFile(w.binary, "#!/bin/sh\n# longer\n"); await utimes(w.binary, new Date(T0), new Date(T0)); })).toBe(true));
  it("the binary's realpath", async () => expect(await changed(async (w) => { const other = join(w.dir, "other"); await writeFile(other, "#!/bin/sh\n", { mode: 0o700 }); return { ...w.installation, command: [other] }; })).toBe(true));
  it("an argv file's mtime (a wrapper's version file, spec issue 8)", async () => {
    const w = await world(); const file = join(w.dir, "version.txt"); await writeFile(file, "1.0.0\n");
    const installation: InstallationV1 = { ...w.installation, command: [w.binary, file] };
    const before = entryFileName(await catalogKey(installation, w.env));
    await utimes(file, new Date(T0 + 9_000), new Date(T0 + 9_000));
    expect(entryFileName(await catalogKey(installation, w.env))).not.toBe(before);
  });
  it("the profile", async () => expect(await changed(async (w) => ({ ...w.installation, profile: "work" }))).toBe(true));
  it("the configDir", async () => expect(await changed(async (w) => ({ ...w.installation, configDir: w.dir }))).toBe(true));
  it("the inherited config dir variable", async () => expect(await changed(async (w) => { w.env.PI_CODING_AGENT_DIR = w.dir; })).toBe(true));
  it("omp's config.yml mtime", async () => expect(await changed(async (w) => { await utimes(join(w.home, ".omp", "agent", "config.yml"), new Date(T0), new Date(T0)); })).toBe(true));
  it("codex's config.toml mtime", async () => expect(await changed(async (w) => { await utimes(join(w.home, ".codex", "config.toml"), new Date(T0), new Date(T0)); }, "codex")).toBe(true));
  it("not the cache dir or the clock", async () => expect(await changed(async (w) => { w.env.CCLOOP_CACHE_DIR = join(w.dir, "elsewhere"); })).toBe(false));
});
```

  And extend `src/agents/types.ts:37` in the test's sight: nothing (types only).

- [ ] **Step 2: red.** P-2 `tests/agents/catalogCache.test.ts` → `$LOGS/t2-red.log`; expected: the file fails to import
  (`catalogCache.js` missing). That is a load failure, so additionally record that **each** test is listed as failed after
  Step 3's first stub (`export {}`) -- crash-red is not evidence (Orca handoff §6.2).

- [ ] **Step 3: implement** `src/agents/catalogCache.ts`:

```ts
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalHash } from "../control/protocol.js";
import type { CatalogRowV1, InstallationV1 } from "./types.js";

/**
 * Every-agent requirement chain (Orca spec 2026-10-15 §4.1-§4.2, ruling R4): the agent catalog and `--version` answer,
 * cached in one file per key. Out-of-repo write registered in that spec §4.2: path below, writer = any ccloop process
 * that probes, residue on failure = at most one temp file (removed when possible); a corrupt entry is a miss.
 */
export const CATALOG_LIFETIME_MS = 1_800_000;
export interface CatalogStampV1 { path: string; mtimeMs: number | null; size: number | null }
export interface CatalogKeyV1 {
  schema: "ccloop-agent-catalog-key-v1"; kind: string; command: string[]; files: CatalogStampV1[];
  profile: string | null; configDir: string | null; inheritedConfigDir: string | null; configFiles: CatalogStampV1[];
}
export interface CatalogEntryV1 {
  schema: "ccloop-agent-catalog-v1"; key: CatalogKeyV1; observedAt: string; version: string;
  rows: CatalogRowV1[] | null; codexFeatures: string[] | null;
}

export function catalogCacheDir(env: NodeJS.ProcessEnv): string | null {
  if (env.CCLOOP_CACHE_DIR !== undefined && env.CCLOOP_CACHE_DIR !== "") return isAbsolute(env.CCLOOP_CACHE_DIR) ? env.CCLOOP_CACHE_DIR : null;
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, "ccloop", "agent-catalog");
  if (env.HOME && isAbsolute(env.HOME)) return join(env.HOME, ".cache", "ccloop", "agent-catalog");
  return null;
}

async function stamp(path: string): Promise<CatalogStampV1> {
  try {
    const real = await realpath(path);
    const info = await stat(real);
    return { path: real, mtimeMs: info.mtimeMs, size: info.size };
  } catch { return { path, mtimeMs: null, size: null }; }
}

const ENV_OF_KIND: Record<string, string> = { omp: "PI_CODING_AGENT_DIR", codex: "CODEX_HOME" };

/** Spec issue 7(d): omp 18.10.1 `pi-utils/src/dirs.ts:119-133`; codex: `$CODEX_HOME/config.toml` (default `~/.codex`). */
function configFilesOf(installation: InstallationV1, env: NodeJS.ProcessEnv): string[] {
  const inherited = ENV_OF_KIND[installation.kind] === undefined ? undefined : env[ENV_OF_KIND[installation.kind]!];
  const home = env.HOME && isAbsolute(env.HOME) ? env.HOME : null;
  if (installation.kind === "omp") {
    const profile = installation.profile as string | null;
    const agentDir = installation.configDir ?? inherited ?? (home === null ? null : profile ? join(home, ".omp", "profiles", profile, "agent") : join(home, ".omp", "agent"));
    return agentDir === null ? [] : [join(agentDir, "config.yml"), join(agentDir, "models.yaml")];
  }
  if (installation.kind === "codex") {
    const codexHome = installation.configDir ?? inherited ?? (home === null ? null : join(home, ".codex"));
    return codexHome === null ? [] : [join(codexHome, "config.toml")];
  }
  return [];
}

export async function catalogKey(installation: InstallationV1, env: NodeJS.ProcessEnv): Promise<CatalogKeyV1> {
  const argvFiles: CatalogStampV1[] = [];
  for (const [index, part] of installation.command.entries()) {
    const s = await stamp(part);
    if (index === 0 || s.mtimeMs !== null) argvFiles.push(s);
  }
  const variable = ENV_OF_KIND[installation.kind];
  return {
    schema: "ccloop-agent-catalog-key-v1", kind: installation.kind, command: [...installation.command], files: argvFiles,
    profile: (installation.profile as string | null | undefined) ?? null, configDir: installation.configDir,
    inheritedConfigDir: installation.configDir === null && variable !== undefined ? env[variable] ?? null : null,
    configFiles: await Promise.all(configFilesOf(installation, env).map(stamp)),
  };
}

export const entryFileName = (key: CatalogKeyV1): string => `${canonicalHash(key)}.json`;

export async function readCatalogEntry(dir: string, key: CatalogKeyV1, now: number): Promise<CatalogEntryV1 | null> {
  try {
    const value = JSON.parse(await readFile(join(dir, entryFileName(key)), "utf8")) as CatalogEntryV1;
    if (value === null || typeof value !== "object" || value.schema !== "ccloop-agent-catalog-v1" || typeof value.version !== "string"
      || canonicalHash(value.key) !== canonicalHash(key) || !(value.rows === null || Array.isArray(value.rows))
      || !(value.codexFeatures === null || Array.isArray(value.codexFeatures))) return null;
    const age = now - Date.parse(value.observedAt);
    return Number.isFinite(age) && age >= 0 && age < CATALOG_LIFETIME_MS ? value : null;
  } catch { return null; }
}

/** Creates each missing directory with 0700 set explicitly (not from umask); an existing one is left alone. */
async function ensureDir(dir: string): Promise<void> {
  const missing: string[] = [];
  for (let at = dir; ; at = dirname(at)) {
    try { if ((await stat(at)).isDirectory()) break; throw new Error("not a directory"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.unshift(at); if (dirname(at) === at) break; }
  }
  for (const path of missing) { await mkdir(path, { mode: 0o700 }); await chmod(path, 0o700); }
}

export async function writeCatalogEntry(dir: string, entry: CatalogEntryV1): Promise<void> {
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  try {
    await ensureDir(dir);
    await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, join(dir, entryFileName(entry.key)));
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
```

  In `src/agents/types.ts:37` add `listed?: boolean` to `CatalogRowV1` with the comment
  `/** codex only (Orca spec 2026-10-15 §3): the catalog row's visibility is "list"; omp rows leave it out. */`.

- [ ] **Step 4: green.** P-2 → `$LOGS/t2-green.log`; RC=0, every test passed (count them: 17).

- [ ] **Step 5: mutations (P-3), each red in the named test only:** M2.1 drop `files: argvFiles,` (→ `files: [],`) ⇒ red
  "the binary's mtime", "size", "realpath", "an argv file's mtime". M2.2 `profile: (installation.profile ...) ?? null,` →
  `profile: null,` ⇒ red "the profile". M2.3 `configDir: installation.configDir,` → `configDir: null,` ⇒ red "the configDir".
  M2.4 `inheritedConfigDir: ...` → `inheritedConfigDir: null,` ⇒ red "the inherited config dir variable". M2.5
  `configFiles: await Promise.all(configFilesOf(installation, env).map(stamp)),` → `configFiles: [],` ⇒ red "omp's config.yml
  mtime" and "codex's config.toml mtime". M2.6 `age < CATALOG_LIFETIME_MS` → `age <= CATALOG_LIFETIME_MS` ⇒ red "is a
  miss at exactly 30 minutes". M2.7 `age >= 0 && ` → `` ⇒ red same test (future entry). M2.8 drop
  `canonicalHash(value.key) !== canonicalHash(key) ||` ⇒ red "treats a corrupt entry...". M2.9 `{ mode: 0o600, flag: "wx" }` →
  `{ flag: "wx" }` and delete `await chmod(temporary, 0o600);` ⇒ red "round-trips...0600". M2.10 delete
  `await chmod(path, 0o700);` ⇒ red "round-trips...0700". M2.11 replace the `catch { await rm(...) }` body with `{ }` ⇒ red
  "never throws when the dir cannot be written" only if the temp file stays (record the observation either way; if green,
  register the guard as redundant -- the `wx` write fails before a temp exists -- do not invent a criterion).
  M2.12 `return isAbsolute(env.CCLOOP_CACHE_DIR) ? env.CCLOOP_CACHE_DIR : null;` → `return env.CCLOOP_CACHE_DIR;` ⇒ red
  "prefers CCLOOP_CACHE_DIR...".

- [ ] **Step 6: commit** `src/agents/catalogCache.ts src/agents/types.ts tests/agents/catalogCache.test.ts`, subject
  `feat(agents): cache file for agent catalogs, keyed by binary and config stamps`.

---

