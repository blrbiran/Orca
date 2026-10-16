## Task 1: ccloop worktree and fake catalog answers (fixtures)

**Files:**
- Modify: `tests/fixtures/fake-codex.mjs:10-11` (insert before the argv append), stdin `end` handler (single-call branch, Task 8)
- Modify: `tests/fixtures/fake-omp.mjs:14-33`
- Create: `tests/agents/fakeCatalogFixtures.test.ts`

**Interfaces:**
- Produces (fixture contract used by Tasks 3-8 and Orca's real-ccloop worlds):
  - fake codex: `debug models` prints `{"models":[...]}` (default rows below, or `<marker>.catalog.json` `{rows?, sleepMs?, exitCode?, stderr?}`), `features list` prints one `name stage enabled` line per flag; each of those calls appends `debug-models` / `features-list` to `<marker>.catalog-calls`; `--version` appends `version` to `<marker>.version-calls`. None of them touches `<marker>.argv` or `<marker>.calls`.
  - fake omp: `models` appends `models` to `<marker>.catalog-calls` and writes its pid to `<marker>.models.pid`; `--version` appends `version` to `<marker>.version-calls`; `<marker>.models.json` gains `sleepMs`.

- [ ] **Step 1: create the worktree (not one of the four human-only actions).**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop ls-remote origin refs/heads/main > "$LOGS/cl-remote.txt"   # read: note the sha
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop worktree add -b codex/every-agent-chain "$CL" main > "$LOGS/cl-wt.txt" 2>&1
ln -s /Users/biran/code/skills/orca/ccloop/node_modules "$CL/node_modules"
( cd "$CL" && npm run build ) > "$LOGS/cl-build0.txt" 2>&1; echo "RC=$?" >> "$LOGS/cl-build0.txt"
```

- [ ] **Step 2: write the failing fixture test** `tests/agents/fakeCatalogFixtures.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every-agent requirement chain (Orca spec 2026-10-15 §9): the fakes answer the catalog commands, count every catalog and
// version spawn in files of their own (criterion 1 reads the count), and never log a catalog call as a phase call.
const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "ccloop-fake-catalog-")));
const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : []);

describe("fake catalog answers (spec 2026-10-15 §9)", () => {
  it("fake codex answers debug models and features list, counts them, and leaves argv and calls alone", () => {
    const marker = join(dir(), "codex-marker");
    const models = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect(models.status).toBe(0);
    expect(JSON.parse(models.stdout).models.map((row: { slug: string; context_window: number; visibility: string }) => [row.slug, row.context_window, row.visibility]))
      .toEqual([["gpt-6-sol", 272000, "list"], ["gpt-6-luna", 272000, "list"], ["gpt-reserve", 272000, "hide"]]);
    const features = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "features", "list"], { encoding: "utf8" });
    expect(features.status).toBe(0);
    expect(features.stdout.split("\n").filter(Boolean).map((line) => line.split(/\s+/)[0]))
      .toEqual(["apps", "browser_use", "image_generation", "multi_agent", "plugins", "shell_tool", "skip_host_skill_discovery", "unified_exec", "view_image"]);
    spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "--version"], { encoding: "utf8" });
    expect(lines(`${marker}.catalog-calls`)).toEqual(["debug-models", "features-list"]);
    expect(lines(`${marker}.version-calls`)).toEqual(["version"]);
    expect(existsSync(`${marker}.argv`)).toBe(false);
    expect(existsSync(`${marker}.calls`)).toBe(false);
  });

  it("fake codex obeys <marker>.catalog.json: rows, exit code with stderr, and a sleep", () => {
    const marker = join(dir(), "codex-marker");
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ rows: [{ slug: "only", context_window: 1000, visibility: "list" }] }));
    expect(JSON.parse(spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" }).stdout).models)
      .toEqual([{ slug: "only", context_window: 1000, visibility: "list" }]);
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ exitCode: 4, stderr: "no catalog\n" }));
    const failed = spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect([failed.status, failed.stderr]).toEqual([4, "no catalog\n"]);
    writeFileSync(`${marker}.catalog.json`, JSON.stringify({ sleepMs: 400 }));
    const started = Date.now();
    spawnSync(process.execPath, [FAKE_CODEX, "integration", marker, "debug", "models"], { encoding: "utf8" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it("fake omp counts models and version calls, records the models pid, and sleeps on request", () => {
    const marker = join(dir(), "omp-marker");
    spawnSync(process.execPath, [FAKE_OMP, marker, "--no-extensions", "--profile", "default", "models", "--json"], { encoding: "utf8" });
    spawnSync(process.execPath, [FAKE_OMP, marker, "--version"], { encoding: "utf8" });
    expect(lines(`${marker}.catalog-calls`)).toEqual(["models"]);
    expect(lines(`${marker}.version-calls`)).toEqual(["version"]);
    expect(Number(readFileSync(`${marker}.models.pid`, "utf8"))).toBeGreaterThan(0);
    writeFileSync(`${marker}.models.json`, JSON.stringify({ sleepMs: 400 }));
    const started = Date.now();
    const slow = spawnSync(process.execPath, [FAKE_OMP, marker, "models", "--json"], { encoding: "utf8" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(slow.stdout).models[0].selector).toBe("gateway/model-a");
  });
});
```

- [ ] **Step 3: red.** P-2 with `tests/agents/fakeCatalogFixtures.test.ts` into `$LOGS/t1-red.log`. Expected: RC≠0, all three
  tests fail (the fake codex treats `debug models` as an `exec` call; the fake omp writes no count files).

- [ ] **Step 4: implement.** In `tests/fixtures/fake-codex.mjs`, insert after line 10 (the `--version` line) and change that
  line so it also counts:

```js
// Every-agent requirement chain (Orca spec 2026-10-15 §9): `--version` appends `version` to `<marker>.version-calls`;
// `debug models` and `features list` answer the catalog and the feature list and append `debug-models` / `features-list`
// to `<marker>.catalog-calls`, before anything below runs, so `<marker>.argv` and `<marker>.calls` never see them.
// `<marker>.catalog.json` ({rows?, sleepMs?, exitCode?, stderr?}) overrides the rows, sleeps first, or fails.
if(process.argv.at(-1)==="--version"&&!process.argv.includes("exec")) {appendFileSync(marker+".version-calls","version\n");await new Promise(resolve=>process.stdout.write("9.9.9-fake\n",resolve));process.exit(0);}
const catalogCall=process.argv.includes("debug")&&process.argv.includes("models")?"debug-models":process.argv.includes("features")&&process.argv.includes("list")?"features-list":null;
if(catalogCall!==null&&!process.argv.includes("exec")) {
  appendFileSync(marker+".catalog-calls",catalogCall+"\n");
  const script=existsSync(marker+".catalog.json")?JSON.parse(readFileSync(marker+".catalog.json","utf8")):{};
  if(script.sleepMs!==undefined) await new Promise(resolve=>setTimeout(resolve,script.sleepMs));
  if(script.stderr!==undefined) await new Promise(resolve=>process.stderr.write(script.stderr,resolve));
  if(script.exitCode!==undefined) process.exit(script.exitCode);
  if(catalogCall==="debug-models") {
    const rows=script.rows??[{slug:"gpt-6-sol",context_window:272000,visibility:"list"},{slug:"gpt-6-luna",context_window:272000,visibility:"list"},{slug:"gpt-reserve",context_window:272000,visibility:"hide"}];
    await new Promise(resolve=>process.stdout.write(JSON.stringify({models:rows})+"\n",resolve));
  } else {
    const flags=["apps","browser_use","image_generation","multi_agent","plugins","shell_tool","skip_host_skill_discovery","unified_exec","view_image"];
    await new Promise(resolve=>process.stdout.write(flags.map(flag=>`${flag.padEnd(40)} stable             true`).join("\n")+"\n",resolve));
  }
  process.exit(0);
}
```

  and add `existsSync` to the line-1 import. In `tests/fixtures/fake-omp.mjs`: in the `--version` branch (line 14) add
  `appendFileSync(\`${marker}.version-calls\`, "version\n");` before writing; at the top of the `models` branch (line 20)
  add `appendFileSync(\`${marker}.catalog-calls\`, "models\n"); writeFileSync(\`${marker}.models.pid\`, String(process.pid));`;
  inside the `models.json` block add `if (script.sleepMs !== undefined) await new Promise((done) => setTimeout(done, script.sleepMs));`
  before the `stderr` line; extend the header comment with one sentence naming the new files.

- [ ] **Step 5: green.** P-2 into `$LOGS/t1-green.log`; RC=0, 3 passed. Then the files that use these fakes most, to show
  nothing else moved: `tests/control/singleCallCapability.test.ts tests/runtime/omp tests/agents/ompCatalogDiagnostics.test.ts tests/control/ompSingleCallWorker.test.ts tests/control/handoffDeadlineUsage.test.ts`
  into `$LOGS/t1-neighbours.log`; RC=0.

- [ ] **Step 6: mutations (P-3).** M1.1: in fake-codex delete `appendFileSync(marker+".catalog-calls",catalogCall+"\n");`
  ⇒ red in "fake codex answers debug models...". M1.2: in fake-omp remove the `catalog-calls` append ⇒ red in "fake omp
  counts...". M1.3: insert a copy of the line `appendFileSync(marker+".argv",JSON.stringify(process.argv.slice(process.argv.indexOf("exec")))+"\n");`
  directly above `const catalogCall=` (so catalog calls are logged as argv) ⇒ red on `existsSync(\`${marker}.argv\`)`.

- [ ] **Step 7: commit** (P-4) `tests/fixtures/fake-codex.mjs tests/fixtures/fake-omp.mjs tests/agents/fakeCatalogFixtures.test.ts`,
  subject `test(fixtures): fake codex and omp answer and count catalog probes`.

---

