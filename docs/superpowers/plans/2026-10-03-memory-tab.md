# N5: Memory Tab (read-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel gets a read-only **Memory** section: pick a repository, list the memories it can see (global plus its project's), search them by substring, open one in full. All reads go through a `MemoryAdapter` whose only implementation is ccmem's `export --json`.

**Architecture:** A new `src/memory/` holds the adapter types, a pure ccmem-export parser, a pure search, and the ccmem adapter. The adapter runs `ccmem export --json --scope global` and then `--scope project` one after the other, with `cwd` set to the repository. `src/panel/memoryApi.ts` mounts four GET routes behind the existing token middleware and checks every response against a strict zod schema before it sends it. `web/` gets a sixth section, `memory`, whose view sends nothing until the section is first opened.

**Tech Stack:** TypeScript (Node 22 ESM), zod 3, express 5, vitest 2; React 19 + i18next (`web/`); `node:child_process.execFile`.

**Spec:** `docs/superpowers/specs/2026-09-29-memory-tab-design.md`. Read all of it; §9 holds the human's rulings Q1–Q7, and §10 (added by Task 0 of this plan) holds the plan-time corrections, which take precedence over the text above them. Project rules: `CLAUDE.md` (Rules 9, 12, 14, 15, 17 bind every task).

> Drafted by Orca controller session `184d0372`, 2026-10-03, at Orca `c91d029` / ccmem `ef1667a`. Line numbers are "measured at those commits; re-measure before use" (Rule 14).
> The ccmem files the spec cites (`scripts/lib/cmd/export.mjs`, `scripts/cli.mjs`, `scripts/lib/paths.mjs`, `scripts/lib/db.mjs`, `scripts/migrations/`, `bin/ccmem`, `scripts/lib/cmd/save.mjs`) have no diff between the spec's read point `e4e8309` and `ef1667a` (`/usr/bin/git diff --stat e4e8309 HEAD -- <those paths>` printed nothing).

---

## Drafter findings (the spec against the real code)

Each row is a place where the spec, read literally, does not fit the code or the measured world. Task 0 copies the "Spec correction" column into the spec as §10. The controller may overrule any row.

| # | Finding | Evidence | This plan's choice | Spec correction |
|---|---|---|---|---|
| D1 | The spec says to choose the repository "the way `/api/decision` does". `/api/decision` discovers repositories through `currentMetrics`, which also runs E2's corrections integrity gate. That gate protects the correction rate's denominator, which has nothing to do with reading memory: a broken corrections store would turn every memory read into 409. | `src/panel/api.ts` (`currentMetrics` → `collect` → `discoverRepos` + `enforceIntegrityGate`); `src/metrics/collect.ts:115` | Memory routes call `discoverRepos({ root, repos })` directly on every request. Its own refusals (`repo-path-missing`, `key-matches-multiple-paths`) still answer 409 through the shared error handler. | §5.1: "the panel's discovery (`discoverRepos`), re-run on every request; not the corrections integrity gate". |
| D2 | §6.2 layer 3 says to flag **any removed entry** of the real ccmem data root. That root has entries that its own live writers create and delete: `daemon.wake`, and `global.db-wal`/`global.db-shm`, which SQLite removes on the last clean close. A rule that flags removals would go red with no Orca involvement. | `ls -1A ~/.claude/ccmem` at Orca `c91d029` (2026-10-03) lists `config.json daemon-cost.jsonl daemon.err.log daemon.out.log daemon.wake embed-latency-probe.jsonl global.db global.db-shm global.db-wal global.db-wal.bak.<ts>×2 global.db.bak.<ts>×5 l25-probe.jsonl metrics.jsonl task5-snapshot-20260826.jsonl` | The guard flags exactly: the root appearing from nothing; a new `global.db.bak.*` or `global.db-wal.bak.*`; `global.db` disappearing. Other additions and removals are ignored. Task 8's gate compares names with the same function. | §6.2 layer 3 and §6.4: replace "fewer entries" with the three flagged changes above. |
| D3 | §6.2 layer 3 redirects the guard's own criterion through `ORCA_TEST_CCMEM_REAL_ROOT`. A plain `root` parameter does the same job without an environment variable that a setup file reads once at module load. | — | `ccmemRootNames(root)` and `ccmemRootDiff(before, after)` take explicit arguments; the setup file passes `join(homedir(), ".claude", "ccmem")`; the guard criterion passes a temp directory. | §6.2: drop `ORCA_TEST_CCMEM_REAL_ROOT`. |
| D4 | R1 seeds the real ccmem with `save`. `save` computes an embedding synchronously (`embedSync = true` default, provider `transformers-local`), which may download a local model. `import` inserts with `embedSync: false` and resolves a null `project_key` from the cwd. | ccmem `scripts/lib/cmd/save.mjs:41,98`; `scripts/lib/cmd/import.mjs:33-45`; probe below | R1 seeds with `ccmem import <file>` (cwd = the temp repo). | §6.3 R1: `save` ⇒ `import`. |
| D5 | Spec §3.4 only says the path is absolute. `execFile` with a **relative** `ORCA_CCMEM_BIN` resolves it against `cwd`, and `cwd` is the target repository, so a repository could plant its own `ccmem`. | Node `child_process` semantics | A relative `ORCA_CCMEM_BIN` is `ccmem-missing` and spawns nothing (Review Focus 1). | §3.4: add "a relative path is refused as `ccmem-missing` without starting a process". |
| D6 | §6.1 says the fake is "an executable file with a shebang". Every fake in this repository is committed `100644` and run through a `#!/bin/sh exec node …` wrapper written at test time with mode `0o755`. | `/usr/bin/git ls-files -s` (all `tests/**/fake-*.mjs` are `100644`); `tests/helpers/fakeClaude.ts:84,96` | Same wrapper, written into each criterion's temp directory, with `process.execPath` instead of `node` so the wrapper does not need `PATH`. | §6.1: the wrapper, not an executable bit. |
| D7 | `PanelOptions` is built as an object literal in many existing criteria (`tests/panel/chainsApi.test.ts:40`, …). A required `memory` field would fail `npm run typecheck` in every one of them. | `src/panel/server.ts:19-60` | `memory?: CcmemAdapterOptions`. Absent means not configured. `parsePanelArgs` always sets it. | none (the spec names no optionality) |
| D8 | Every pane is mounted at all times (`Shell.tsx` header comment), and the App criteria pin request sequences. A view that fetched on mount would add requests to every App criterion and would start ccmem (with its migration side effect, §4) on every panel load. | `web/src/Shell.tsx:1-5`; `web/tests/requirementsApp.test.tsx:16-41` | `MemoryView` sends nothing until its section is first active; after that, the list is read once per repository choice and the search only on submit. | §5.2: add "nothing is requested until the section is first opened". |
| D9 | §5.1 says web/server parity follows `tests/panel/webParity.test.ts`. Adding to that file means editing its `__webParityAssignabilityChecks__` array, which is an existing criterion. | `tests/panel/webParity.test.ts:254` | A new file, `tests/memory/memoryWebParity.test.ts`, does the same in both halves (field-set runtime check, assignability compile check). Nothing is added to the existing file. | none |
| D10 | `web/tests/shell.test.tsx:74` asserts `SECTIONS` equals the five current names exactly. A sixth section turns it red, and there is no add-only way around that. | `web/tests/shell.test.tsx:73-83` | **Rewriting this one assertion needs the human's explicit OK at plan review** (Rule 15(a) / ruling 88 form): the whole assertion becomes the six names, `memory` before `metrics`. | none |
| D11 | Spec §3.6 types `created_at`/`updated_at` as `z.number().int()`. `new Date(n).toISOString()` throws `RangeError` beyond ±8.64e15, so one bad row would surface as `500 panel-internal-error`. | ECMAScript time range | Both bounded to `0..8_640_000_000_000_000`; outside ⇒ `ccmem-output-invalid` naming the row (Review Focus 3). | §3.6: add the bounds. |
| D12 | The new web code must pass `tests/panel/scanPanelText.test.ts`, which allows only a fixed list of untranslated literals in `web/src` (`web/src/api.ts`'s `` `GET ${path}` `` is one of them). A second `getJson` in a new file would add a new `` `GET ${path}` `` literal. | `tests/panel/scanPanelText.test.ts:91-115` | `web/src/api.ts` exports its existing `getJson`; `web/src/memoryApi.ts` calls it. Every visible string in `MemoryView.tsx` goes through `t`; class names are single tokens. | none |

**Probe behind D4 (2026-10-03, Orca `c91d029`, ccmem `ef1667a`, node v22.13.1)**: in a throwaway data root under this session's scratchpad, with `env -i PATH=$PATH HOME=<tmp> CCMEM_DATA_ROOT=<tmp>`, cwd a temp git repo whose `origin` is `https://example.invalid/o/r.git`:
`ccmem import in.json` → RC 0, `imported 2, skipped 0`, `real 0.38`; `ccmem export --json --scope global` → RC 0, one row `scope: "global"`, `source: "external"`, `trust_score: 0.3`, `tags: "[\"a\",\"b\"]"`, `real 0.08`; `--scope project` → RC 0, one row `project_key: "example.invalid/o/r"`, `tags: "[]"` (imported from `null`), `real 0.11`. Before/after `pgrep -fl ccmem` identical (no daemon was started); before/after `ls -1A ~/.claude/ccmem` identical; the temp root held only `global.db` afterwards.

---

## Global Constraints

- Read-only (G9): no non-GET route under `/api/memory`; `MemoryCapabilities.recordCorrection` is the literal type `false`; no write control in the web view.
- ccmem is read **only** through `ccmem export --json --scope global` and `ccmem export --json --scope project`. The argv is exactly `["export", "--json", "--scope", "global"]` / `[..., "project"]`. Never `list`, `show`, `save` or any other verb from Orca's runtime code. Never read ccmem's SQLite directly. Never vendor any ccmem code.
- The child's `cwd` is the repository path the panel discovered; its `env` is the env object `parsePanelArgs` received, passed through as is: never `process.env`, nothing added, nothing removed.
- `ORCA_CCMEM_BIN` is read from that env in `parsePanelArgs`. Unset or empty ⇒ not configured, never look on `PATH`. A relative path ⇒ `ccmem-missing`, nothing is spawned.
- `health()` never starts a process.
- The two exports run one after the other (global, then project), never at the same time. If either fails, the whole request fails with that call's code (no half results).
- Defaults: timeout `30_000` ms, max output `64 * 1024 * 1024` bytes. Both can be injected (criteria shorten them).
- Error codes: `ccmem-missing`, `ccmem-failed:<exit code | signal>`, `ccmem-timeout`, `ccmem-output-too-large`, `ccmem-output-invalid`, `memory-repo-unknown`, `memory-not-found`, `memory-query-invalid`. HTTP: `ccmem-missing` → 503; other `ccmem-*` → 502; `memory-repo-unknown`, `memory-not-found` → 404; `memory-query-invalid` → 400.
- Query: trimmed, 0–200 code points, no control character (`\p{Cc}`). `limit`: decimal integer 1–200, default 50. `ref`: `^[1-9][0-9]{0,15}$`. A query parameter given more than once is `memory-query-invalid`.
- Search: NFC then `toLowerCase()`, substring, over `content` and each tag. Sort: pinned first, then `updatedAt` descending, then `ref` numerically descending.
- Rule 17: Orca writes nothing outside the repository. The only writer is ccmem itself, in its own data root, and spec §4 already registers that. Criteria never reach the real `~/.claude/ccmem`: `tests/setup/relocateCcmem.ts` points `CCMEM_DATA_ROOT` at a temp directory for every test file, and every criterion that spawns a ccmem (fake or real) passes a temp `CCMEM_DATA_ROOT` and a temp `HOME` explicitly.
- Language: code, comments, commit messages, the ledger and the spec correction in English. Visible panel text in both `en` and `zh` (key parity is enforced by `web/tests/i18nKeys.test.ts`).
- Verification: every `npm`/`vitest` run whose result is cited is redirected to a file and read back in full (Rule 14). Mutations happen only in a `git clone --local` copy; the main tree is never mutated (Rule 15).

## Review Focus

1. **A relative `ORCA_CCMEM_BIN`** (e.g. `ccmem` or `./bin/ccmem`): a person expects "not configured" and no process. Without the guard, `execFile` would resolve the name against the target repository's directory. *Task 3 pins it.*
2. **A query parameter given twice** (`?q=a&q=b`, `?projectKey=x&projectKey=y`, `?limit=1&limit=2`): express hands over an array. A person expects `400 memory-query-invalid`, not a 500 or a silent pick. *Task 5 pins it.*
3. **A ccmem row whose `created_at`/`updated_at` is out of the Date range**: a person expects `502 ccmem-output-invalid` naming the row, not `500` with a `RangeError`. *Task 1 pins it.*
4. **Memory content with markup, more than 200 characters, or astral characters** (emoji): a person expects it shown as text, cut at 200 code points in the list without splitting a surrogate pair, and shown whole in the detail. *Task 6 pins it.*
5. **A panel that is opened and used without ever visiting Memory**: a person expects ccmem never to be started (it may migrate their data root, §4). *Task 6 pins it: rendering `App` on `#decisions` makes no `/api/memory` request.*

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tests/setup/ccmemRoot.ts` (create) | Pure: list a ccmem data root's entry names; diff two listings by the D2 rule | 1 |
| `tests/setup/relocateCcmem.ts` (create) | Setup file: `CCMEM_DATA_ROOT` → temp dir per test file; compare the real root's names after the file | 1 |
| `vitest.config.ts` (modify) | Add the setup file | 1 |
| `tests/memory/ccmemGuard.test.ts` (create) | G1: the guard's diff function goes red on each flagged change | 1 |
| `src/memory/adapter.ts` (create) | Types only (+ `MemoryError`) | 2 |
| `src/memory/ccmemExport.ts` (create) | Pure: parse and validate one export, map rows to `MemoryRecord` | 2 |
| `tests/memory/ccmemExport.test.ts` (create) | M8 at unit level, D11 | 2 |
| `src/memory/search.ts` (create) | Pure: query/limit/ref parsing, substring search, sort, page | 3 |
| `tests/memory/search.test.ts` (create) | M9 and the parsers | 3 |
| `tests/memory/fixtures/fake-ccmem.mjs` (create) | The fake ccmem | 4 |
| `tests/memory/helpers.ts` (create) | `fakeCcmem()`, `memoryRow()`, `memoryRepo()` | 4 |
| `src/memory/ccmem.ts` (create) | The ccmem adapter: health, the two exports, error mapping | 4 |
| `tests/memory/ccmemAdapter.test.ts` (create) | M1, M2, M3 (adapter), M5–M8, M10, Review Focus 1 | 4 |
| `src/memory/wire.ts` (create) | Strict zod schemas of the three responses; `MEMORY_RECORD_FIELDS` | 5 |
| `src/panel/memoryApi.ts` (create) | The four routes, request parsing, status mapping, `sendChecked` | 5 |
| `src/panel/server.ts` (modify) | `PanelOptions.memory?`, `parsePanelArgs` reads `ORCA_CCMEM_BIN` | 5 |
| `src/panel/api.ts` (modify) | `registerMemoryRoutes(app, deps.opts)` | 5 |
| `src/cli.ts` (modify) | USAGE: one sentence on `ORCA_CCMEM_BIN` | 5 |
| `README.md` (modify) | A short "Memory section" subsection | 5 |
| `tests/memory/memoryApi.test.ts` (create) | M3 (panel), M4, M11, M12, M13, statuses, Review Focus 2, zh coverage of the fixed codes | 5 |
| `web/src/memoryTypes.ts` (create) | Web copies of the response shapes; `WEB_MEMORY_RECORD_FIELDS` | 6 |
| `web/src/memoryApi.ts` (create) | Four fetchers over `getJson` | 6 |
| `web/src/api.ts` (modify) | `export` the existing `getJson` | 6 |
| `web/src/MemoryView.tsx` (create) | The view | 6 |
| `web/src/sections.ts`, `web/src/Shell.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/locales/en.ts`, `web/src/locales/zh.ts` (modify) | Wire the sixth section; text in both languages | 6 |
| `web/tests/memoryView.test.tsx` (create) | W1, Review Focus 4, zh | 6 |
| `web/tests/memoryApp.test.tsx` (create) | Review Focus 5 (lazy), `#memory` mounts the view | 6 |
| `web/tests/shell.test.tsx` (modify, **one assertion, needs the human's OK**) | D10 | 6 |
| `tests/memory/memoryWebParity.test.ts` (create) | D9 | 6 |
| `tests/memory/ccmemReal.test.ts` (create) | R1 against a real ccmem, gated at run time | 7 |
| `docs/superpowers/specs/2026-09-29-memory-tab-design.md` (append §10) | Plan-time corrections D1–D11 | 0 |
| `.superpowers/sdd/2026-10-03-memory-tab/progress.md` (create, `git add -f`) | The round's ledger | 0, every task, 8 |

---

### Task 0: Spec correction and ledger

**Files:**
- Modify (append only): `docs/superpowers/specs/2026-09-29-memory-tab-design.md`
- Create: `.superpowers/sdd/2026-10-03-memory-tab/progress.md`

**Interfaces:** none.

- [ ] **Step 1: Append §10 to the spec.** Text above it stays byte-for-byte (Rule 13). Append exactly:

```markdown

## 10. Plan-time corrections (2026-10-03, session `184d0372`; the text above is kept verbatim)

Source: `docs/superpowers/plans/2026-10-03-memory-tab.md`, "Drafter findings". Where this section and the text above disagree, this section wins.

- **§5.1 (D1)** Repository membership is the panel's discovery, `discoverRepos({ root, repos })`, re-run on every request. It is not `currentMetrics`: the corrections integrity gate guards the correction rate's denominator and has no bearing on reading memory. Discovery's own refusals (`repo-path-missing`, `key-matches-multiple-paths`) still answer 409.
- **§6.2 layer 3 and §6.4 (D2)** The real data root has live writers that create and delete entries of their own (`daemon.wake`; `global.db-wal`/`global.db-shm`, removed by SQLite on the last clean close; listing at Orca `c91d029`). The name comparison flags exactly: the root appearing where there was none; a new `global.db.bak.*` or `global.db-wal.bak.*`; `global.db` disappearing. Other additions and removals are ignored, both in the per-file guard and in the gate.
- **§6.2 layer 3 (D3)** No `ORCA_TEST_CCMEM_REAL_ROOT`. The comparison functions take the root as an argument; the guard's own criterion passes a temp directory.
- **§6.3 R1 (D4)** R1 seeds the temp data root with `ccmem import <file>`, not `save`: `save` embeds synchronously (`transformers-local` by default) and may download a model; `import` inserts with `embedSync: false` and resolves a null `project_key` from the cwd (probe in the plan).
- **§3.4 (D5)** A relative `ORCA_CCMEM_BIN` is refused as `ccmem-missing` without starting a process; `execFile` would otherwise resolve it against the target repository.
- **§6.1 (D6)** The fake is committed as a plain file and run through a `#!/bin/sh` wrapper written at test time with mode `0o755`, as every fake in this repository is.
- **§5.2 (D8)** The view requests nothing until its section is first opened (all panes stay mounted; a fetch on mount would start ccmem on every panel load).
- **§3.6 (D11)** `created_at` and `updated_at` are bounded to `0..8_640_000_000_000_000`; outside that range the export is `ccmem-output-invalid`, naming the row.
```

- [ ] **Step 2: Create the ledger.** `.superpowers/sdd/2026-10-03-memory-tab/progress.md` with this header, then one row per task as it lands (`| Task | commit subject | criteria added | mutations run (each: edit, expected red, seen red?) | notes |`):

```markdown
# Memory tab (N5) — progress ledger

Owner: Orca controller session `184d0372`, 2026-10-03. Plan: `docs/superpowers/plans/2026-10-03-memory-tab.md`. Spec: `docs/superpowers/specs/2026-09-29-memory-tab-design.md` (§9 rulings, §10 corrections).
Every measured value below carries its command and the commit it was observed at (Rule 14).

| Task | Commit subject | Criteria added | Mutations (edit → expected red → seen) | Notes |
|---|---|---|---|---|
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-memory-tab-design.md docs/superpowers/plans/2026-10-03-memory-tab.md
git add -f .superpowers/sdd/2026-10-03-memory-tab/progress.md
git commit -m "docs(plan): memory tab (N5) task by task, with the spec's plan-time corrections"
```

---

### Task 1: The guard on the real ccmem data root

**Files:**
- Create: `tests/setup/ccmemRoot.ts`, `tests/setup/relocateCcmem.ts`, `tests/memory/ccmemGuard.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: `ccmemRootNames(root: string): string[] | null` (sorted names, `null` when the root does not exist); `ccmemRootDiff(before: string[] | null, after: string[] | null): string[]` (one line per flagged change, empty when nothing is flagged).

- [ ] **Step 1: Write the failing test** `tests/memory/ccmemGuard.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ccmemRootDiff, ccmemRootNames } from "../setup/ccmemRoot.js";

/**
 * Spec §6.2 layer 3 as corrected by §10 (D2, D3). The guard sees the changes Orca could cause and a live ccmem
 * would not: a migration backup appearing, the database disappearing, a data root created from nothing. It must stay
 * quiet about what ccmem's own daemon and SQLite do on their own (a wake file, the WAL and SHM files coming and going),
 * or it goes red with no Orca involvement. This criterion never points at the real data root.
 */
let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
const root = (...names: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "orca-ccmem-root-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), "");
  return dir;
};

describe("the ccmem data-root guard (spec §6.2 layer 3, §10 D2/D3)", () => {
  it("lists names sorted, and null for a root that does not exist", () => {
    const dir = root("global.db", "config.json");
    expect(ccmemRootNames(dir)).toEqual(["config.json", "global.db"]);
    expect(ccmemRootNames(join(dir, "absent"))).toBeNull();
  });

  it("flags a new migration backup of the database and of its WAL", () => {
    const before = ["global.db"];
    expect(ccmemRootDiff(before, ["global.db", "global.db.bak.1"])).toEqual(["new migration backup: global.db.bak.1"]);
    expect(ccmemRootDiff(before, ["global.db", "global.db-wal.bak.1"])).toEqual(["new migration backup: global.db-wal.bak.1"]);
  });

  it("flags the database disappearing and a data root created from nothing", () => {
    expect(ccmemRootDiff(["global.db", "metrics.jsonl"], ["metrics.jsonl"])).toEqual(["global.db disappeared"]);
    expect(ccmemRootDiff(null, ["global.db"])).toEqual(["data root created where there was none"]);
  });

  it("ignores what ccmem's own daemon and SQLite add and remove", () => {
    const before = ["daemon.wake", "global.db", "global.db-shm", "global.db-wal", "global.db.bak.1"];
    expect(ccmemRootDiff(before, ["global.db", "global.db.bak.1", "metrics.jsonl"])).toEqual([]);
    expect(ccmemRootDiff(null, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run tests/memory/ccmemGuard.test.ts > "$OUT/t1-red.txt" 2>&1; echo $?` then read the whole file.
Expected: non-zero; `Failed to load url ../setup/ccmemRoot.js` (or "Cannot find module").

- [ ] **Step 3: Implement** `tests/setup/ccmemRoot.ts`:

```ts
import { existsSync, readdirSync } from "node:fs";

/** Entry names of a ccmem data root, sorted; null when there is no such directory. Reads names only, never opens a file. */
export function ccmemRootNames(root: string): string[] | null {
  if (!existsSync(root)) return null;
  return readdirSync(root).sort();
}

const BACKUP = /^global\.db(-wal)?\.bak\./;

/**
 * Spec §10 D2: only the changes Orca could cause and ccmem's live writers would not. A new migration backup means a
 * migration ran; `global.db` vanishing means something deleted the database; a root from nothing means a ccmem was
 * started against it. Everything else (daemon.wake, -wal, -shm, logs) is ccmem's own business and is not compared.
 */
export function ccmemRootDiff(before: string[] | null, after: string[] | null): string[] {
  if (before === null) return after === null ? [] : ["data root created where there was none"];
  if (after === null) return before.includes("global.db") ? ["global.db disappeared"] : [];
  const had = new Set(before);
  const out = after.filter((name) => BACKUP.test(name) && !had.has(name)).map((name) => `new migration backup: ${name}`);
  if (had.has("global.db") && !after.includes("global.db")) out.push("global.db disappeared");
  return out;
}
```

`tests/setup/relocateCcmem.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { ccmemRootDiff, ccmemRootNames } from "./ccmemRoot.js";

/**
 * Spec §6.2 (memory tab), CLAUDE.md Rule 17. Layer 1: every test file runs with CCMEM_DATA_ROOT in a temp directory,
 * so a child that inherits process.env lands there. Layer 3: the real data root's names are compared after the file,
 * flagging only what §10 D2 names. Its blind spot is registered in the spec: opening an existing database without
 * migrating it changes no name. Layer 2 (the adapter has no default path) is what covers that.
 */
const relocated = mkdtempSync(join(tmpdir(), "orca-ccmem-"));
process.env.CCMEM_DATA_ROOT = relocated;

const REAL_ROOT = join(homedir(), ".claude", "ccmem");
const before = ccmemRootNames(REAL_ROOT);

afterAll(() => {
  rmSync(relocated, { recursive: true, force: true });
  expect(ccmemRootDiff(before, ccmemRootNames(REAL_ROOT)), "this test file changed the real ~/.claude/ccmem (Rule 17)").toEqual([]);
});
```

`vitest.config.ts`: change the `setupFiles` line to

```ts
    setupFiles: ["tests/setup/scopeTmpdir.ts", "tests/setup/relocateUserData.ts", "tests/setup/relocateCcmem.ts"],
```

and add one line to the comment above it: `// relocateCcmem.ts does the same for ccmem's data root (memory tab spec §6.2).`

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run tests/memory/ccmemGuard.test.ts > "$OUT/t1-green.txt" 2>&1; echo $?`. Expected: `0`, 4 passed.

- [ ] **Step 5: Mutations (in a `git clone --local` copy of the commit from Step 6, never in the main tree).** Each one must be seen red, then the copy is discarded:
  - M-G1: `ccmemRootDiff` body → `return [];` ⇒ the two "flags" tests red.
  - M-G2: delete the `if (had.has("global.db") …) out.push(…)` line ⇒ "flags the database disappearing" red.
  - M-G3: replace `BACKUP.test(name) && ` with nothing (flag every new name) ⇒ "ignores what ccmem's own daemon…" red.
  - M-G4 (setup is wired): in `relocateCcmem.ts` replace `REAL_ROOT` in the `afterAll` call with a temp dir into which the afterAll first writes `global.db.bak.9`; run `tests/memory/ccmemGuard.test.ts` ⇒ the file fails in the hook. This proves the hook runs and its `expect` fails a file.
  Record each in the ledger (edit, expected red, the red line seen).

- [ ] **Step 6: Commit**

```bash
git add tests/setup/ccmemRoot.ts tests/setup/relocateCcmem.ts tests/memory/ccmemGuard.test.ts vitest.config.ts
git commit -m "test(memory): relocate ccmem's data root for every test file and guard the real one by name"
```

---

### Task 2: Adapter types and the ccmem export parser

**Files:**
- Create: `src/memory/adapter.ts`, `src/memory/ccmemExport.ts`, `tests/memory/ccmemExport.test.ts`

**Interfaces:**
- Produces (`src/memory/adapter.ts`): exactly the spec §2.1 block: `MemoryScope`, `MemoryCapabilities`, `MemoryErrorCode`, `MemoryHealth`, `MemoryRecord`, `MemorySearchOptions`, `MemoryPage`, `MemoryAdapter`, `class MemoryError`.
- Produces (`src/memory/ccmemExport.ts`): `type CcmemScope = "global" | "project"`; `parseCcmemExport(stdout: string, scope: CcmemScope): MemoryRecord[]` (throws `MemoryError("ccmem-output-invalid", …)`).

- [ ] **Step 1: Create `src/memory/adapter.ts`** with the spec §2.1 code block verbatim, plus this header comment:

```ts
/**
 * Memory tab spec §2. Types only, plus the one error class: this file imports no implementation, so a second memory
 * store implements MemoryAdapter without touching anything ccmem-specific. Read-only by construction (G9): there is
 * no write method, and `recordCorrection` is the literal `false` until a write spec changes the type.
 */
```

- [ ] **Step 2: Write the failing test** `tests/memory/ccmemExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryError } from "../../src/memory/adapter.js";
import { parseCcmemExport } from "../../src/memory/ccmemExport.js";

/**
 * Spec §3.6 and §10 D11. The export is checked strictly because a field ccmem adds, or a value it adds to `type` or
 * `source`, must be loud (Rule 12) rather than dropped; and every row must be of the scope that was asked for,
 * because ccmem answers a wrong --scope value with every project's memories (spec §3.1).
 */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7, scope: "global", project_key: null, type: "rule", content: "use pnpm", pinned: 1, source: "user_explicit",
  trust_score: 0.9, tags: "[\"tooling\"]", created_at: 1_790_000_000_000, updated_at: 1_790_000_100_000, ...over,
});
const out = (memories: unknown[], over: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: "0.7", exported_at: 1, memories, ...over }, null, 2);
const invalid = (fn: () => unknown): MemoryError => {
  try { fn(); } catch (err) { if (err instanceof MemoryError) return err; throw err; }
  throw new Error("expected a MemoryError, got a value");
};

describe("parseCcmemExport (spec §3.6)", () => {
  it("maps a row to an adapter-neutral record", () => {
    expect(parseCcmemExport(out([row()]), "global")).toEqual([{
      ref: "7", scope: "global", projectKey: null, kind: "rule", content: "use pnpm", tags: ["tooling"], pinned: true,
      source: "user_explicit", trust: 0.9, createdAt: new Date(1_790_000_000_000).toISOString(), updatedAt: new Date(1_790_000_100_000).toISOString(),
    }]);
  });

  it("reads null tags as no tags, and a project row keeps ccmem's own key", () => {
    const [r] = parseCcmemExport(out([row({ scope: "project", project_key: "example.invalid/o/r", tags: null, pinned: 0 })]), "project");
    expect(r).toMatchObject({ tags: [], pinned: false, projectKey: "example.invalid/o/r", scope: "project" });
  });

  it.each([
    ["stdout that is not JSON", "not json", "global", /not JSON/],
    ["an extra top-level field", out([], { extra: 1 }), "global", /extra/],
    ["an extra row field", out([row({ embedding: "x" })]), "global", /row id 7/],
    ["a type ccmem never had", out([row({ type: "opinion" })]), "global", /memories\.0\.type \(row id 7\)/],
    ["a source ccmem never had", out([row({ source: "orca" })]), "global", /row id 7/],
    ["a version other than 0.7", out([], { version: "0.8" }), "global", /version/],
    ["tags that are not JSON", out([row({ tags: "tooling" })]), "global", /row id 7: tags is not JSON/],
    ["tags that are not an array of strings", out([row({ tags: "[1]" })]), "global", /row id 7: tags is not a JSON array of strings/],
    ["a project row in a global answer", out([row({ scope: "project", project_key: "a/b" })]), "global", /row id 7: asked for --scope global, got scope project/],
    ["a global row in a project answer", out([row()]), "project", /row id 7: asked for --scope project, got scope global/],
    ["a project row without a key", out([row({ scope: "project", project_key: null })]), "project", /row id 7: a project row without project_key/],
    ["a created_at past the Date range (Review Focus 3)", out([row({ created_at: 9e15 })]), "global", /row id 7/],
    ["a negative updated_at", out([row({ updated_at: -1 })]), "global", /row id 7/],
  ])("refuses %s as ccmem-output-invalid, naming where", (_name, stdout, scope, message) => {
    const err = invalid(() => parseCcmemExport(stdout, scope as "global" | "project"));
    expect(err.code).toBe("ccmem-output-invalid");
    expect(err.message).toMatch(message);
    expect(err.message).toContain(`--scope ${scope}`);
  });
});
```

- [ ] **Step 3: Run it to verify it fails.** `./node_modules/.bin/vitest run tests/memory/ccmemExport.test.ts > "$OUT/t2-red.txt" 2>&1; echo $?` → non-zero, module not found.

- [ ] **Step 4: Implement** `src/memory/ccmemExport.ts`:

```ts
import { z } from "zod";
import { MemoryError, type MemoryRecord } from "./adapter.js";

/**
 * Memory tab spec §3.6. Closed sets copied from ccmem `scripts/migrations/001_initial.sql` (read at ccmem `ef1667a`).
 * Strict on purpose: a column or an enum value ccmem adds makes the Memory section fail loudly with
 * ccmem-output-invalid instead of silently dropping data (Rule 12). Cross-repo vocabulary drift is a recorded,
 * recurring root cause between ccmem and Orca.
 */
const MAX_DATE_MS = 8_640_000_000_000_000; // spec §10 D11: the ECMAScript Date range
const epochMs = z.number().int().min(0).max(MAX_DATE_MS);

const rowSchema = z.object({
  id: z.number().int().positive(),
  scope: z.enum(["global", "project"]),
  project_key: z.string().nullable(),
  type: z.enum(["rule", "fact", "episode", "consolidated"]),
  content: z.string(),
  pinned: z.union([z.literal(0), z.literal(1)]),
  source: z.enum(["user_explicit", "tool_output", "auto_inferred", "cron_consolidated", "cerebrum_import", "external"]),
  trust_score: z.number(),
  tags: z.string().nullable(),
  created_at: epochMs,
  updated_at: epochMs,
}).strict();

const exportSchema = z.object({
  version: z.literal("0.7"),
  exported_at: z.number().int(),
  memories: z.array(rowSchema),
}).strict();

type CcmemRow = z.infer<typeof rowSchema>;
export type CcmemScope = "global" | "project";

/** One `ccmem export --json --scope <scope>` stdout, checked and mapped. Throws ccmem-output-invalid naming the first problem. */
export function parseCcmemExport(stdout: string, scope: CcmemScope): MemoryRecord[] {
  const invalid = (what: string): MemoryError => new MemoryError("ccmem-output-invalid", `ccmem export --scope ${scope}: ${what}`);
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch (err) { throw invalid(`stdout is not JSON (${(err as Error).message})`); }
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) throw invalid(describeIssue(raw, parsed.error.issues[0]!));
  return parsed.data.memories.map((row) => toRecord(row, scope, invalid));
}

function describeIssue(raw: unknown, issue: z.ZodIssue): string {
  const where = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  const index = issue.path[0] === "memories" && typeof issue.path[1] === "number" ? issue.path[1] : null;
  const id = index === null ? undefined : (raw as { memories?: Array<{ id?: unknown }> }).memories?.[index]?.id;
  return `${where}${id === undefined ? "" : ` (row id ${String(id)})`}: ${issue.message}`;
}

function toRecord(row: CcmemRow, scope: CcmemScope, invalid: (what: string) => MemoryError): MemoryRecord {
  // ccmem does not validate --scope; a wrong value exports every project's rows (spec §3.1). This is the check that sees it.
  if (row.scope !== scope) throw invalid(`row id ${row.id}: asked for --scope ${scope}, got scope ${row.scope}`);
  if (scope === "project" && (row.project_key === null || row.project_key === "")) throw invalid(`row id ${row.id}: a project row without project_key`);
  return {
    ref: String(row.id),
    scope: row.scope,
    projectKey: row.project_key,
    kind: row.type,
    content: row.content,
    tags: parseTags(row, invalid),
    pinned: row.pinned === 1,
    source: row.source,
    trust: row.trust_score,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** ccmem stores tags as JSON text (`save.mjs`); old rows may be NULL. A bad value is refused, never read as [] (ccmem's import does that silently). */
function parseTags(row: CcmemRow, invalid: (what: string) => MemoryError): string[] {
  if (row.tags === null) return [];
  let value: unknown;
  try { value = JSON.parse(row.tags); } catch { throw invalid(`row id ${row.id}: tags is not JSON`); }
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) throw invalid(`row id ${row.id}: tags is not a JSON array of strings`);
  return value;
}
```

- [ ] **Step 5: Run it to verify it passes.** Same command → `0`. Then `npm run typecheck > "$OUT/t2-tc.txt" 2>&1; echo $?` → `0`.

- [ ] **Step 6: Mutations (clone copy).**
  - M8a: `.strict()` on `rowSchema` → `.passthrough()` ⇒ "an extra row field" red.
  - M8b: `type: z.enum([...])` → `type: z.string()` ⇒ "a type ccmem never had" red.
  - M8c: `parseTags` body → `try { return JSON.parse(row.tags ?? "[]"); } catch { return []; }` ⇒ both tags rows red.
  - M8d: delete the `row.scope !== scope` line ⇒ both "… in a … answer" rows red.
  - M-D11: `epochMs` → `z.number().int()` ⇒ the two Review Focus 3 rows red (one with a `RangeError` instead of a `MemoryError`).

- [ ] **Step 7: Commit**

```bash
git add src/memory/adapter.ts src/memory/ccmemExport.ts tests/memory/ccmemExport.test.ts
git commit -m "feat(memory): adapter types and a strict reader for ccmem's export"
```

---

### Task 3: Search and request parsing

**Files:**
- Create: `src/memory/search.ts`, `tests/memory/search.test.ts`

**Interfaces:**
- Consumes: `MemoryRecord`, `MemoryPage`, `MemorySearchOptions` from Task 2.
- Produces: `MEMORY_QUERY_MAX = 200`, `MEMORY_LIMIT_MAX = 200`, `MEMORY_LIMIT_DEFAULT = 50`; `searchRecords(records: readonly MemoryRecord[], options: MemorySearchOptions): MemoryPage`; `type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }`; `parseQuery(raw: unknown): Parsed<string>`, `parseLimit(raw: unknown): Parsed<number>`, `parseRef(raw: unknown): Parsed<string>`.

- [ ] **Step 1: Write the failing test** `tests/memory/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../../src/memory/adapter.js";
import { parseLimit, parseQuery, parseRef, searchRecords } from "../../src/memory/search.js";

/**
 * Spec §3.5. Search is a substring filter in Orca, not ccmem's hybrid retrieval: ccmem's `list <query>` writes to its
 * database and may call a paid embedding service (spec §3.1). The order is a fixed key, so a person sees the same list
 * twice. NFC matters because the same visible text arrives in either normalisation form (written with escapes here:
 * a file-writing tool may silently normalise a literal).
 */
const rec = (ref: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ref, scope: "global", projectKey: null, kind: "fact", content: `content ${ref}`, tags: [], pinned: false,
  source: "user_explicit", trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
});

describe("searchRecords (spec §3.5)", () => {
  it("matches case-insensitively in content", () => {
    const page = searchRecords([rec("1", { content: "Use PNPM here" }), rec("2")], { query: "pnpm", limit: 50 });
    expect(page.records.map((r) => r.ref)).toEqual(["1"]);
  });

  it("matches across normalisation forms, both ways", () => {
    const composed = "café", decomposed = "café";
    expect(searchRecords([rec("1", { content: composed })], { query: decomposed, limit: 50 }).total).toBe(1);
    expect(searchRecords([rec("1", { content: decomposed })], { query: composed, limit: 50 }).total).toBe(1);
  });

  it("counts a record whose only match is a tag", () => {
    expect(searchRecords([rec("1", { tags: ["Deploy"] })], { query: "deploy", limit: 50 }).records.map((r) => r.ref)).toEqual(["1"]);
  });

  it("lists everything for an empty or blank query", () => {
    expect(searchRecords([rec("1"), rec("2")], { query: "  ", limit: 50 }).total).toBe(2);
  });

  it("orders pinned first, then newest update, then larger ref", () => {
    const page = searchRecords([
      rec("2", { updatedAt: "2026-09-02T00:00:00.000Z" }),
      rec("10", { updatedAt: "2026-09-02T00:00:00.000Z" }),
      rec("3", { updatedAt: "2026-09-03T00:00:00.000Z" }),
      rec("1", { pinned: true }),
    ], { query: "", limit: 50 });
    expect(page.records.map((r) => r.ref)).toEqual(["1", "3", "10", "2"]);
  });

  it("cuts at limit and says how many matched", () => {
    const page = searchRecords([rec("1"), rec("2"), rec("3")], { query: "", limit: 2 });
    expect(page).toMatchObject({ total: 3, truncated: true });
    expect(page.records).toHaveLength(2);
    expect(searchRecords([rec("1")], { query: "", limit: 2 }).truncated).toBe(false);
  });
});

describe("request parsing (spec §3.5, §5.1, Review Focus 2)", () => {
  it("takes a trimmed query of up to 200 code points", () => {
    expect(parseQuery(undefined)).toEqual({ ok: true, value: "" });
    expect(parseQuery("  x  ")).toEqual({ ok: true, value: "x" });
    expect(parseQuery("\u{1F600}".repeat(200)).ok).toBe(true); // 200 code points, 400 UTF-16 units
    expect(parseQuery("a".repeat(201)).ok).toBe(false);
  });

  it("refuses a control character and a repeated parameter", () => {
    expect(parseQuery("a\u0007b").ok).toBe(false);
    expect(parseQuery(["a", "b"]).ok).toBe(false);
  });

  it("takes a limit of 1-200, default 50, decimal digits only", () => {
    expect(parseLimit(undefined)).toEqual({ ok: true, value: 50 });
    expect(parseLimit("200")).toEqual({ ok: true, value: 200 });
    for (const bad of ["0", "201", "1.5", "1e2", "-1", "", ["1", "2"]]) expect(parseLimit(bad).ok, String(bad)).toBe(false);
  });

  it("takes a ref of 1-16 digits without a leading zero", () => {
    expect(parseRef("42")).toEqual({ ok: true, value: "42" });
    for (const bad of [undefined, "0", "042", "4a", "1".repeat(17), ["1"]]) expect(parseRef(bad).ok, String(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (module not found).

- [ ] **Step 3: Implement** `src/memory/search.ts`:

```ts
import type { MemoryPage, MemoryRecord, MemorySearchOptions } from "./adapter.js";

/** Memory tab spec §3.5 and §5.1. Done in Orca: ccmem's own retrieval writes to its database (spec §3.1). */
export const MEMORY_QUERY_MAX = 200;
export const MEMORY_LIMIT_MAX = 200;
export const MEMORY_LIMIT_DEFAULT = 50;

const fold = (text: string): string => text.normalize("NFC").toLowerCase();

export function searchRecords(records: readonly MemoryRecord[], options: MemorySearchOptions): MemoryPage {
  const needle = fold(options.query.trim());
  const hits = needle === "" ? [...records] : records.filter((r) => fold(r.content).includes(needle) || r.tags.some((tag) => fold(tag).includes(needle)));
  hits.sort(compareRecords);
  const shown = hits.slice(0, options.limit);
  return { records: shown, total: hits.length, truncated: hits.length > shown.length };
}

/** A fixed key, not relevance: pinned first, newest update first, then the larger ref (ISO strings of one length compare as dates). */
function compareRecords(a: MemoryRecord, b: MemoryRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return Number(b.ref) - Number(a.ref);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** An express query value is a string, an array (the parameter was repeated) or absent. Only one string, or absent, is accepted. */
const single = (raw: unknown): string | undefined | null => (raw === undefined ? undefined : typeof raw === "string" ? raw : null);

export function parseQuery(raw: unknown): Parsed<string> {
  const text = single(raw);
  if (text === null) return { ok: false, message: "q was given more than once" };
  const query = (text ?? "").trim();
  if ([...query].length > MEMORY_QUERY_MAX) return { ok: false, message: `q is longer than ${MEMORY_QUERY_MAX} characters` };
  if (/\p{Cc}/u.test(query)) return { ok: false, message: "q contains a control character" };
  return { ok: true, value: query };
}

export function parseLimit(raw: unknown): Parsed<number> {
  const text = single(raw);
  if (text === null) return { ok: false, message: "limit was given more than once" };
  if (text === undefined) return { ok: true, value: MEMORY_LIMIT_DEFAULT };
  const limit = /^[0-9]{1,3}$/.test(text) ? Number(text) : NaN;
  if (!(limit >= 1 && limit <= MEMORY_LIMIT_MAX)) return { ok: false, message: `limit wants an integer 1-${MEMORY_LIMIT_MAX}, got ${JSON.stringify(text)}` };
  return { ok: true, value: limit };
}

export function parseRef(raw: unknown): Parsed<string> {
  const text = single(raw);
  if (typeof text !== "string" || !/^[1-9][0-9]{0,15}$/.test(text)) return { ok: false, message: `ref wants a memory id (1-16 digits), got ${JSON.stringify(raw ?? null)}` };
  return { ok: true, value: text };
}
```

- [ ] **Step 4: Run to verify it passes**; then `npm run typecheck` → `0`.

- [ ] **Step 5: Mutations (clone copy).**
  - M9a: delete `|| r.tags.some(...)` ⇒ "only match is a tag" red.
  - M9b: `fold` → `text.toLowerCase()` ⇒ the normalisation test red.
  - M9c: `compareRecords` → `return Number(a.ref) - Number(b.ref);` ⇒ the order test red.
  - M9d: `[...query].length` → `query.length` ⇒ the 200-emoji case red.
  - M-RF2: `single` → `(raw) => (raw === undefined ? undefined : String(raw))` ⇒ the three repeated-parameter cases red.

- [ ] **Step 6: Commit**

```bash
git add src/memory/search.ts tests/memory/search.test.ts
git commit -m "feat(memory): substring search with a fixed order, and strict request parsing"
```

---

### Task 4: The ccmem adapter and its fake

**Files:**
- Create: `tests/memory/fixtures/fake-ccmem.mjs`, `tests/memory/helpers.ts`, `src/memory/ccmem.ts`, `tests/memory/ccmemAdapter.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseCcmemExport`, `MemoryError`, adapter types; Task 3 `searchRecords`.
- Produces (`src/memory/ccmem.ts`): `CCMEM_TIMEOUT_MS = 30_000`; `CCMEM_MAX_BUFFER = 64 * 1024 * 1024`; `interface CcmemAdapterOptions { ccmemBin: string | null; env: NodeJS.ProcessEnv; timeoutMs?: number; maxBufferBytes?: number }`; `createCcmemAdapter(options: CcmemAdapterOptions): MemoryAdapter`.
- Produces (`tests/memory/helpers.ts`): `memoryRow(over?)`, `type FakeData = { global: unknown[]; project: unknown[]; all: unknown[] }`, `DEFAULT_FAKE_DATA`, `memoryRepo(): Promise<string>`, `fakeCcmem(opts?: { mode?: string; data?: FakeData }): Promise<FakeCcmem>` where `FakeCcmem = { bin: string; dir: string; env: NodeJS.ProcessEnv; calls(): FakeCall[]; cleanup(): Promise<void> }` and `FakeCall = { argv: string[]; cwd: string; env: { CCMEM_DATA_ROOT?: string; HOME?: string } }`.

- [ ] **Step 1: Write the fake** `tests/memory/fixtures/fake-ccmem.mjs`:

```js
// Memory tab spec §6.1. A fake `ccmem` for criteria: logs every call, then answers by $FAKE_CCMEM_MODE.
// The global, project and all-projects answers differ, so a criterion can tell which one it got
// (an answer that is the same constant for every input would hide a wrong --scope).
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_CCMEM_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), env: { CCMEM_DATA_ROOT: process.env.CCMEM_DATA_ROOT, HOME: process.env.HOME } })}\n`);

const mode = process.env.FAKE_CCMEM_MODE ?? "ok";
const scopeAt = argv.indexOf("--scope");
const scope = scopeAt === -1 ? undefined : argv[scopeAt + 1];
const data = () => JSON.parse(readFileSync(process.env.FAKE_CCMEM_DATA, "utf8"));
const rowsFor = (d) => (scope === "global" ? d.global : scope === "project" ? d.project : d.all);
const answer = (memories, over = {}) => JSON.stringify({ version: "0.7", exported_at: Date.now(), memories, ...over }, null, 2);
// Wait for the write callback: on macOS a pipe write is asynchronous and exiting right after it loses output.
const say = (text) => process.stdout.write(`${text}\n`);

if (mode.startsWith("exit:")) {
  process.stderr.write(`fake-ccmem: failing on purpose (scope ${scope})\n`);
  process.exitCode = Number(mode.slice(5));
} else if (mode === "sleep") {
  setTimeout(() => {}, 60_000);
} else if (mode === "garbage") {
  say("this is not json");
} else if (mode === "huge") {
  say(answer([], { padding: "x".repeat(1024 * 1024) }));
} else if (mode === "extra-field") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, embedding: "AAAA" }))));
} else if (mode === "bad-enum") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, type: "opinion" }))));
} else if (mode === "bad-tags") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, tags: "not json" }))));
} else if (mode === "wrong-scope") {
  say(answer(data().all));
} else {
  say(answer(rowsFor(data())));
}
```

- [ ] **Step 2: Write the helper** `tests/memory/helpers.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git } from "../../src/scheduler/gitExec.js";
import { tempRepo } from "../helpers/tempRepo.js";

/** Memory tab spec §6.1. Every criterion that spawns a ccmem gets a temp data root and a temp HOME of its own (Rule 17). */
const FAKE = resolve("tests/memory/fixtures/fake-ccmem.mjs");
export const PROJECT_KEY = "example.invalid/o/r";

export const memoryRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 1, scope: "global", project_key: null, type: "rule", content: "global one", pinned: 0, source: "user_explicit",
  trust_score: 0.5, tags: null, created_at: 1_790_000_000_000, updated_at: 1_790_000_000_000, ...over,
});

export interface FakeData { global: unknown[]; project: unknown[]; all: unknown[] }
const project = (id: number, content: string, key = PROJECT_KEY) => memoryRow({ id, scope: "project", project_key: key, type: "fact", content });
export const DEFAULT_FAKE_DATA: FakeData = {
  global: [memoryRow({ id: 1, content: "global one", pinned: 1, tags: "[\"style\"]" }), memoryRow({ id: 2, content: "global two" })],
  project: [project(3, "project three"), project(4, "project four")],
  // What ccmem prints for a --scope value it does not know: every project, including one this repo must never see.
  all: [memoryRow({ id: 1 }), memoryRow({ id: 2 }), project(3, "project three"), project(4, "project four"), project(99, "another project's secret", "other.invalid/x/y")],
};

export interface FakeCall { argv: string[]; cwd: string; env: { CCMEM_DATA_ROOT?: string; HOME?: string } }
export interface FakeCcmem { bin: string; dir: string; env: NodeJS.ProcessEnv; calls(): FakeCall[]; cleanup(): Promise<void> }

export async function fakeCcmem(opts: { mode?: string; data?: FakeData } = {}): Promise<FakeCcmem> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-fake-ccmem-")));
  const bin = join(dir, "ccmem");
  // process.execPath, not `node`: the wrapper must not depend on the PATH a criterion hands the adapter.
  await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const dataFile = join(dir, "data.json");
  await writeFile(dataFile, JSON.stringify(opts.data ?? DEFAULT_FAKE_DATA));
  const log = join(dir, "calls.jsonl");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: join(dir, "home"),
    CCMEM_DATA_ROOT: join(dir, "data-root"),
    FAKE_CCMEM_MODE: opts.mode ?? "ok",
    FAKE_CCMEM_DATA: dataFile,
    FAKE_CCMEM_LOG: log,
  };
  return {
    bin, dir, env,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as FakeCall) : []),
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

/** A temp git repository whose origin makes ccmem compute PROJECT_KEY. */
export async function memoryRepo(): Promise<string> {
  const repo = await tempRepo();
  await git(repo, ["remote", "add", "origin", `https://${PROJECT_KEY}.git`]);
  return repo;
}
```

- [ ] **Step 3: Write the failing test** `tests/memory/ccmemAdapter.test.ts`:

```ts
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryError } from "../../src/memory/adapter.js";
import { createCcmemAdapter } from "../../src/memory/ccmem.js";
import { type FakeCcmem, PROJECT_KEY, fakeCcmem, memoryRepo } from "./helpers.js";

/**
 * Spec §3. The adapter is the only place Orca starts ccmem, so each of its promises is pinned on what the fake was
 * actually called with, not on what the adapter returns: the exact argv (a wrong --scope makes ccmem export every
 * project), the cwd (ccmem computes the project key from it), the env (only the one the panel was given, so a
 * criterion's relocation holds), and that a missing or relative ORCA_CCMEM_BIN starts nothing at all.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });
async function world(mode?: string) {
  const fake = await fakeCcmem({ mode });
  const repo = await memoryRepo();
  cleanups.push(fake.cleanup, () => rm(repo, { recursive: true, force: true }));
  return { fake, scope: { projectKey: "panel-key", repoPath: repo } };
}
const adapterFor = (fake: FakeCcmem, over: { ccmemBin?: string | null; timeoutMs?: number; maxBufferBytes?: number } = {}) =>
  createCcmemAdapter({ ccmemBin: fake.bin, env: fake.env, ...over });
async function refusal(p: Promise<unknown>): Promise<MemoryError> {
  return p.then(
    () => { throw new Error("expected a refusal, got a value"); },
    (err: unknown) => { if (err instanceof MemoryError) return err; throw err; },
  );
}

describe("the ccmem adapter's calls (spec §3.1-§3.3)", () => {
  it("runs export --json --scope global, then --scope project, and nothing else (M1)", async () => {
    const { fake, scope } = await world();
    const page = await adapterFor(fake).search(scope, { query: "", limit: 50 });
    expect(fake.calls().map((c) => c.argv)).toEqual([["export", "--json", "--scope", "global"], ["export", "--json", "--scope", "project"]]);
    expect(page.records.map((r) => r.ref).sort()).toEqual(["1", "2", "3", "4"]);
    expect(page.records.some((r) => r.content.includes("another project"))).toBe(false);
  });

  it("starts ccmem in the repository, so ccmem computes the project key itself (M2)", async () => {
    const { fake, scope } = await world();
    await adapterFor(fake).search(scope, { query: "", limit: 50 });
    expect(fake.calls().map((c) => c.cwd)).toEqual([scope.repoPath, scope.repoPath]);
  });

  it("hands ccmem the env it was given, not this process's (M3)", async () => {
    const { fake, scope } = await world();
    expect(process.env.CCMEM_DATA_ROOT).not.toBe(fake.env.CCMEM_DATA_ROOT); // relocateCcmem.ts set a different one
    await adapterFor(fake).search(scope, { query: "", limit: 50 });
    for (const call of fake.calls()) expect(call.env).toEqual({ CCMEM_DATA_ROOT: fake.env.CCMEM_DATA_ROOT, HOME: fake.env.HOME });
  });

  it("keeps ccmem's own project key on project rows", async () => {
    const { fake, scope } = await world();
    const page = await adapterFor(fake).search(scope, { query: "project three", limit: 50 });
    expect(page.records).toMatchObject([{ ref: "3", scope: "project", projectKey: PROJECT_KEY }]);
  });
});

describe("get (spec §2.2)", () => {
  it("reads a global and a project ref, and not one that only another project can see (M10)", async () => {
    const { fake, scope } = await world();
    const adapter = adapterFor(fake);
    expect((await adapter.get(scope, "1"))?.content).toBe("global one");
    expect((await adapter.get(scope, "4"))?.content).toBe("project four");
    expect(await adapter.get(scope, "99")).toBeNull();
  });
});

describe("failures (spec §3.3)", () => {
  it("names the exit code, the scope and ccmem's stderr (M5)", async () => {
    const { fake, scope } = await world("exit:3");
    const err = await refusal(adapterFor(fake).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-failed:3");
    expect(err.message).toContain("--scope global");
    expect(err.message).toContain("failing on purpose");
    expect(fake.calls()).toHaveLength(1); // the first failure ends the request: no half result
  });

  it("gives up at the timeout, promptly (M6)", async () => {
    const { fake, scope } = await world("sleep");
    const started = Date.now();
    const err = await refusal(adapterFor(fake, { timeoutMs: 200 }).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("refuses output past the cap (M7)", async () => {
    const { fake, scope } = await world("huge");
    expect((await refusal(adapterFor(fake, { maxBufferBytes: 64 * 1024 }).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-output-too-large");
  });

  it.each(["garbage", "extra-field", "bad-enum", "bad-tags", "wrong-scope"])("refuses %s output as ccmem-output-invalid (M8)", async (mode) => {
    const { fake, scope } = await world(mode);
    const err = await refusal(adapterFor(fake).search(scope, { query: "", limit: 50 }));
    expect(err.code).toBe("ccmem-output-invalid");
    expect(err.message).toContain("--scope global");
  });
});

describe("finding ccmem (spec §3.4, §10 D5)", () => {
  it("starts nothing when ORCA_CCMEM_BIN is unset", async () => {
    const { fake, scope } = await world();
    const adapter = adapterFor(fake, { ccmemBin: null });
    expect(await adapter.health()).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    expect((await refusal(adapter.search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
    expect(fake.calls()).toEqual([]);
  });

  it("starts nothing for a relative path, even one the repository provides (Review Focus 1)", async () => {
    const { fake, scope } = await world();
    await writeFile(join(scope.repoPath, "ccmem"), `#!/bin/sh\nexec '${fake.bin}' "$@"\n`, { mode: 0o755 });
    for (const bin of ["ccmem", "./ccmem"]) {
      const adapter = adapterFor(fake, { ccmemBin: bin });
      expect(await adapter.health()).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
      expect((await refusal(adapter.search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
    }
    expect(fake.calls()).toEqual([]);
  });

  it("reports a path that is missing, a directory, or not executable, without starting it", async () => {
    const { fake } = await world();
    await chmod(join(fake.dir, "data.json"), 0o644);
    for (const bin of [join(fake.dir, "absent"), fake.dir, join(fake.dir, "data.json")]) {
      expect(await adapterFor(fake, { ccmemBin: bin }).health(), bin).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    }
    expect(await adapterFor(fake).health()).toEqual({ status: "ok" });
    expect(fake.calls()).toEqual([]);
  });

  it("maps a path that vanished after health to ccmem-missing", async () => {
    const { fake, scope } = await world();
    expect((await refusal(adapterFor(fake, { ccmemBin: join(fake.dir, "absent") }).search(scope, { query: "", limit: 50 }))).code).toBe("ccmem-missing");
  });

  it("answers read-only capabilities", async () => {
    const { fake } = await world();
    expect(adapterFor(fake).capabilities()).toEqual({ search: true, get: true, recordCorrection: false });
  });
});
```

- [ ] **Step 4: Run to verify it fails** (module `src/memory/ccmem.js` not found).

- [ ] **Step 5: Implement** `src/memory/ccmem.ts`:

```ts
import { type ExecFileException, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MemoryError, type MemoryAdapter, type MemoryHealth, type MemoryRecord, type MemoryScope } from "./adapter.js";
import { type CcmemScope, parseCcmemExport } from "./ccmemExport.js";
import { searchRecords } from "./search.js";

/**
 * Memory tab spec §3. The only code in Orca that starts ccmem, and it only ever runs `export`: `list` and `show`
 * write to ccmem's database (spec §3.1). Starting ccmem opens its database and may migrate it (spec §4, accepted by
 * ruling Q2), so nothing here runs ccmem unless ORCA_CCMEM_BIN names it, and health() never runs it at all.
 */
export const CCMEM_TIMEOUT_MS = 30_000; // spec §3.3: estimated, never measured on real data (ruling Q6)
export const CCMEM_MAX_BUFFER = 64 * 1024 * 1024;
const STDERR_EXCERPT_BYTES = 2048;

export interface CcmemAdapterOptions {
  /** Absolute path from ORCA_CCMEM_BIN; null when unset. */
  ccmemBin: string | null;
  /** The env the panel was started with, passed to ccmem as is (CCMEM_DATA_ROOT, HOME, PATH, CCMEM_CONFIG_PATH). */
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export function createCcmemAdapter(options: CcmemAdapterOptions): MemoryAdapter {
  const timeout = options.timeoutMs ?? CCMEM_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? CCMEM_MAX_BUFFER;

  /** Spec §10 D5: a relative path would be resolved against the target repository, which could plant its own ccmem. */
  const usableBin = (): string => {
    const bin = options.ccmemBin;
    if (bin === null) throw new MemoryError("ccmem-missing", "ORCA_CCMEM_BIN is not set; the panel never starts ccmem without it");
    if (!isAbsolute(bin)) throw new MemoryError("ccmem-missing", `ORCA_CCMEM_BIN must be an absolute path, got ${JSON.stringify(bin)}`);
    return bin;
  };

  const runExport = (bin: string, scope: CcmemScope, cwd: string): Promise<string> => new Promise((resolve, reject) => {
    const child = execFile(bin, ["export", "--json", "--scope", scope], { cwd, env: options.env, encoding: "utf8", timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(exportFailure(error, { bin, scope, maxBuffer, timeout, stderr: String(stderr) }));
    });
    child.stdin?.end();
  });

  /** One after the other, never together (spec §3.3): the first may migrate, and two would contend for ccmem's write lock. */
  const visible = async (scope: MemoryScope): Promise<MemoryRecord[]> => {
    const bin = usableBin();
    const global = parseCcmemExport(await runExport(bin, "global", scope.repoPath), "global");
    const project = parseCcmemExport(await runExport(bin, "project", scope.repoPath), "project");
    return [...global, ...project];
  };

  return {
    id: "ccmem",
    capabilities: () => ({ search: true, get: true, recordCorrection: false }),
    health: async (): Promise<MemoryHealth> => {
      try {
        const bin = usableBin();
        const info = await stat(bin).catch((err: NodeJS.ErrnoException) => { throw new MemoryError("ccmem-missing", `${bin}: ${err.code ?? err.message}`); });
        if (!info.isFile()) throw new MemoryError("ccmem-missing", `${bin}: not a regular file`);
        await access(bin, constants.X_OK).catch(() => { throw new MemoryError("ccmem-missing", `${bin}: not executable`); });
        return { status: "ok" };
      } catch (err) {
        if (err instanceof MemoryError) return { status: "unavailable", code: err.code, message: err.message };
        throw err;
      }
    },
    search: async (scope, searchOptions) => searchRecords(await visible(scope), searchOptions),
    get: async (scope, ref) => (await visible(scope)).find((record) => record.ref === ref) ?? null,
  };
}

/** Same shape as src/control/ccloopPort.ts's mapping. Order matters: a maxBuffer overrun also sets `killed`. */
function exportFailure(error: ExecFileException, ctx: { bin: string; scope: CcmemScope; maxBuffer: number; timeout: number; stderr: string }): MemoryError {
  const what = `ccmem export --scope ${ctx.scope}`;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "EACCES") return new MemoryError("ccmem-missing", `${ctx.bin}: ${code} (${what})`);
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new MemoryError("ccmem-output-too-large", `${what} wrote more than ${ctx.maxBuffer} bytes`);
  if (error.killed === true) return new MemoryError("ccmem-timeout", `${what} did not finish within ${ctx.timeout} ms`);
  const status = typeof code === "number" ? String(code) : (error.signal ?? "unknown");
  return new MemoryError(`ccmem-failed:${status}`, `${what} exited ${status}: ${ctx.stderr.slice(0, STDERR_EXCERPT_BYTES)}`);
}
```

- [ ] **Step 6: Run to verify it passes** (`./node_modules/.bin/vitest run tests/memory > "$OUT/t4-green.txt" 2>&1`); `npm run typecheck` → `0`. Then confirm no fake survived: `pgrep -fl fake-ccmem > "$OUT/t4-pgrep.txt"; echo $?` → `1` (no match).

- [ ] **Step 7: Mutations (clone copy).**
  - M1: `"--scope", scope` → `"--scope"` (drop the value) ⇒ the fake answers `all` ⇒ M1 red (with `ccmem-output-invalid`); additionally delete the `row.scope !== scope` check in the copy ⇒ M1 red on "another project" being present.
  - M2: drop `cwd` from the `execFile` options ⇒ M2 red.
  - M3: `env: options.env` → `env: process.env` ⇒ M3 red.
  - M5: `` `ccmem-failed:${status}` `` → `"ccmem-failed:1"` ⇒ M5 red.
  - M6: drop `timeout` from the options ⇒ M6 red (test timeout).
  - M7: delete the `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` line ⇒ M7 red (`ccmem-timeout` instead).
  - M10: `get` → run a third `runExport(bin, "global", …)` with argv `["export", "--json"]` and search it too ⇒ M10 red.
  - M-RF1: delete the `!isAbsolute(bin)` line ⇒ Review Focus 1 red (the repository's `ccmem` is called).
  - M-H: `health` → `return { status: "ok" }` first line ⇒ the three health tests red.

- [ ] **Step 8: Commit**

```bash
git add tests/memory/fixtures/fake-ccmem.mjs tests/memory/helpers.ts src/memory/ccmem.ts tests/memory/ccmemAdapter.test.ts
git commit -m "feat(memory): the ccmem adapter, reading only ccmem export, in the repository, with the panel's env"
```

---

### Task 5: Panel options and the four routes

**Files:**
- Create: `src/memory/wire.ts`, `src/panel/memoryApi.ts`, `tests/memory/memoryApi.test.ts`
- Modify: `src/panel/server.ts`, `src/panel/api.ts`, `src/cli.ts`, `README.md`

**Interfaces:**
- Consumes: Task 4 `createCcmemAdapter`, `CcmemAdapterOptions`; Task 3 parsers and `MEMORY_LIMIT_DEFAULT`; `discoverRepos` (`src/metrics/discover.ts`).
- Produces (`src/memory/wire.ts`): `memoryRecordSchema`, `memoryPageSchema`, `memoryStatusResponseSchema`, `memoryPageResponseSchema`, `memoryItemResponseSchema`, types `MemoryStatusResponse`, `MemoryPageResponse`, `MemoryItemResponse`, `MemoryRecordWire`, and `MEMORY_RECORD_FIELDS: readonly string[]`.
- Produces (`src/panel/memoryApi.ts`): `MEMORY_REPO_UNKNOWN`, `MEMORY_NOT_FOUND`, `MEMORY_QUERY_INVALID`, `MEMORY_FIXED_CODES: readonly string[]` (every fixed code a memory route can answer), `memoryHttpStatus(code: string): number`, `sendChecked(res, schema, body): void`, `registerMemoryRoutes(app: Express, opts: PanelOptions): void`.
- Produces (`src/panel/server.ts`): `PanelOptions.memory?: CcmemAdapterOptions`; `parsePanelArgs` sets `memory: { ccmemBin, env }`.

- [ ] **Step 1: Write the failing test** `tests/memory/memoryApi.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { controlDisabled } from "../../src/panel/controlOptions.js";
import { MEMORY_FIXED_CODES, memoryHttpStatus, sendChecked } from "../../src/panel/memoryApi.js";
import { type PanelOptions, createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { memoryPageResponseSchema } from "../../src/memory/wire.js";
import { zhErrors } from "../../web/src/locales/zh.js";
import { type FakeCcmem, fakeCcmem, memoryRepo } from "./helpers.js";

/**
 * Spec §5.1. The routes choose a repository only from the panel's own discovery (a browser never names a path), check
 * every input before anything starts ccmem, answer each failure by name with its own status, and offer no way to
 * write (G9). These criteria go through the real server: a route that is unregistered, or registered after the
 * error handler, is what they would catch.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function panel(opts: { mode?: string; memory?: (fake: FakeCcmem) => PanelOptions["memory"] } = {}) {
  const fake = await fakeCcmem({ mode: opts.mode });
  const repo = await memoryRepo();
  const store = await mkdtemp(join(tmpdir(), "orca-mem-store-"));
  const dist = await mkdtemp(join(tmpdir(), "orca-mem-dist-"));
  await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  cleanups.push(fake.cleanup, () => rm(repo, { recursive: true, force: true }), () => rm(store, { recursive: true, force: true }), () => rm(dist, { recursive: true, force: true }));
  const options: PanelOptions = {
    by: "tester", bind: "127.0.0.1", port: 0, confirmedExternal: false, correctionsDir: store,
    repos: [{ projectKey: "mem", path: repo }], control: controlDisabled(), distDir: dist,
    memory: opts.memory ? opts.memory(fake) : { ccmemBin: fake.bin, env: fake.env },
  };
  const p = await createPanelServer(options);
  cleanups.push(() => p.close());
  const call = (path: string, init: RequestInit = {}, token = p.token) => fetch(`${p.url}${path}`, { ...init, headers: { "x-orca-token": token, ...(init.headers ?? {}) } });
  const json = async (path: string) => { const res = await call(path); return { status: res.status, body: await res.json() as any }; };
  return { fake, repo, call, json };
}

describe("the memory routes (spec §5.1)", () => {
  it("serves status without starting ccmem", async () => {
    const { fake, json } = await panel();
    const { status, body } = await json("/api/memory/status");
    expect(status).toBe(200);
    expect(body).toEqual({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] });
    expect(fake.calls()).toEqual([]);
  });

  it("lists, searches and opens one memory", async () => {
    const { json } = await panel();
    const list = await json("/api/memory/list?projectKey=mem");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ projectKey: "mem", query: "", page: { total: 4, truncated: false } });
    expect(list.body.page.records[0].ref).toBe("1"); // pinned first
    const search = await json("/api/memory/search?projectKey=mem&q=FOUR&limit=1");
    expect(search.body).toMatchObject({ query: "FOUR", page: { total: 1, records: [{ ref: "4" }] } });
    const item = await json("/api/memory/item?projectKey=mem&ref=3");
    expect(item).toMatchObject({ status: 200, body: { record: { ref: "3", content: "project three" } } });
  });

  it("answers 404 memory-not-found for a ref this repository cannot see (M10)", async () => {
    const { json } = await panel();
    expect(await json("/api/memory/item?projectKey=mem&ref=99")).toMatchObject({ status: 404, body: { code: "memory-not-found" } });
  });

  it("answers 404 for a repository the panel did not discover, without starting ccmem (M11)", async () => {
    const { fake, json } = await panel();
    expect(await json("/api/memory/list?projectKey=nope")).toMatchObject({ status: 404, body: { code: "memory-repo-unknown" } });
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    ["/api/memory/search?projectKey=mem&q=" + "a".repeat(201)],
    ["/api/memory/search?projectKey=mem&q=a%07b"],
    ["/api/memory/list?projectKey=mem&limit=0"],
    ["/api/memory/list?projectKey=mem&limit=201"],
    ["/api/memory/item?projectKey=mem&ref=abc"],
    ["/api/memory/search?projectKey=mem&q=a&q=b"],
    ["/api/memory/list?projectKey=mem&projectKey=mem"],
    ["/api/memory/list?projectKey=mem&limit=1&limit=2"],
  ])("answers 400 memory-query-invalid for %s, without starting ccmem (M11, Review Focus 2)", async (path) => {
    const { fake, json } = await panel();
    expect(await json(path)).toMatchObject({ status: 400, body: { code: "memory-query-invalid" } });
    expect(fake.calls()).toEqual([]);
  });

  it.each([["exit:3", 502, "ccmem-failed:3"], ["garbage", 502, "ccmem-output-invalid"]])("maps fake mode %s to %i %s", async (mode, status, code) => {
    const { json } = await panel({ mode });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status, body: { code } });
  });

  it("maps a timeout to 502 ccmem-timeout", async () => {
    const { json } = await panel({ mode: "sleep", memory: (fake) => ({ ccmemBin: fake.bin, env: fake.env, timeoutMs: 200 }) });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 502, body: { code: "ccmem-timeout" } });
  });

  it("has no write route and needs the token (M12, G9)", async () => {
    const { call, fake } = await panel();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await call("/api/memory/list?projectKey=mem", { method })).status, method).toBe(404);
    const anonymous = await call("/api/memory/status", {}, "wrong-token");
    expect(anonymous.status).toBe(401);
    expect(fake.calls()).toEqual([]);
  });
});

describe("configuration (spec §3.4)", () => {
  it("reads ORCA_CCMEM_BIN and keeps the env object it was given (M3)", () => {
    const env = { ...process.env, ORCA_CCMEM_BIN: "/x/ccmem", CCMEM_DATA_ROOT: "/elsewhere", HOME: "/home-elsewhere" };
    const opts = parsePanelArgs(["--by", "amy", "--no-control"], env);
    expect(opts.memory?.ccmemBin).toBe("/x/ccmem");
    expect(opts.memory?.env).toBe(env);
  });

  it("with ORCA_CCMEM_BIN unset, says ccmem-missing and starts nothing, even with a ccmem on PATH (M4)", async () => {
    const { fake, json } = await panel({ memory: (f) => parsePanelArgs(["--by", "amy", "--no-control"], { ...f.env, PATH: `${f.dir}:${f.env.PATH ?? ""}`, ORCA_CCMEM_BIN: "" }).memory });
    expect((await json("/api/memory/status")).body.health).toMatchObject({ status: "unavailable", code: "ccmem-missing" });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 503, body: { code: "ccmem-missing" } });
    expect(fake.calls()).toEqual([]);
  });

  it("treats an options object without memory as not configured", async () => {
    const { json } = await panel({ memory: () => undefined });
    expect(await json("/api/memory/list?projectKey=mem")).toMatchObject({ status: 503, body: { code: "ccmem-missing" } });
  });
});

describe("the response check and the codes (spec §5.1, M13)", () => {
  it("refuses to send a response with a key the schema does not have", () => {
    const res = { json: () => { throw new Error("must not be sent"); } } as unknown as express.Response;
    const body = { projectKey: "mem", query: "", page: { records: [], total: 0, truncated: false }, extra: 1 };
    expect(() => sendChecked(res, memoryPageResponseSchema, body)).toThrow(/extra/);
  });

  it("gives every fixed code its status and a Chinese entry", () => {
    expect(MEMORY_FIXED_CODES.map((code) => [code, memoryHttpStatus(code)])).toEqual([
      ["ccmem-missing", 503], ["ccmem-timeout", 502], ["ccmem-output-too-large", 502], ["ccmem-output-invalid", 502],
      ["memory-repo-unknown", 404], ["memory-not-found", 404], ["memory-query-invalid", 400],
    ]);
    expect(memoryHttpStatus("ccmem-failed:3")).toBe(502);
    expect(MEMORY_FIXED_CODES.filter((code) => !Object.prototype.hasOwnProperty.call(zhErrors, code))).toEqual([]);
  });
});
```

⚠️ The last `it` imports `web/src/locales/zh.ts`; its seven zh entries land in Task 6. To keep this task's commit green, add the seven `zhErrors` entries listed in Task 6 Step 3 **in this task** (they are data, no UI). Task 6 then only adds the UI keys.

- [ ] **Step 2: Run to verify it fails** (modules not found).

- [ ] **Step 3: Implement** `src/memory/wire.ts`:

```ts
import { z } from "zod";

/**
 * Memory tab spec §5.1: the three responses, strict. The server parses every body against these before sending it
 * (src/panel/memoryApi.ts `sendChecked`), so a field that drifts in is a loud 500, never a silent extra. web/ cannot
 * import zod or src/, so it keeps its own copies (web/src/memoryTypes.ts), held in step by tests/memory/memoryWebParity.test.ts.
 */
export const memoryRecordSchema = z.object({
  ref: z.string(),
  scope: z.enum(["global", "project"]),
  projectKey: z.string().nullable(),
  kind: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  source: z.string(),
  trust: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export const MEMORY_RECORD_FIELDS: readonly string[] = Object.keys(memoryRecordSchema.shape);

export const memoryPageSchema = z.object({
  records: z.array(memoryRecordSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

export const memoryStatusResponseSchema = z.object({
  adapter: z.object({
    id: z.string(),
    capabilities: z.object({ search: z.literal(true), get: z.literal(true), recordCorrection: z.literal(false) }).strict(),
  }).strict(),
  health: z.union([
    z.object({ status: z.literal("ok") }).strict(),
    z.object({ status: z.literal("unavailable"), code: z.string(), message: z.string() }).strict(),
  ]),
  repos: z.array(z.object({ projectKey: z.string() }).strict()),
}).strict();

export const memoryPageResponseSchema = z.object({ projectKey: z.string(), query: z.string(), page: memoryPageSchema }).strict();
export const memoryItemResponseSchema = z.object({ record: memoryRecordSchema }).strict();

export type MemoryRecordWire = z.infer<typeof memoryRecordSchema>;
export type MemoryStatusResponse = z.infer<typeof memoryStatusResponseSchema>;
export type MemoryPageResponse = z.infer<typeof memoryPageResponseSchema>;
export type MemoryItemResponse = z.infer<typeof memoryItemResponseSchema>;
```

`src/panel/memoryApi.ts`:

```ts
import type { Express, NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { MemoryError, type MemoryScope } from "../memory/adapter.js";
import { createCcmemAdapter } from "../memory/ccmem.js";
import { type Parsed, parseLimit, parseQuery, parseRef } from "../memory/search.js";
import { memoryItemResponseSchema, memoryPageResponseSchema, memoryStatusResponseSchema } from "../memory/wire.js";
import { discoverRepos } from "../metrics/discover.js";
import type { PanelOptions } from "./server.js";

/**
 * Memory tab spec §5.1. GET only (G9): there is no other method under /api/memory, so a write gets express's 404.
 * The repository comes from the panel's discovery on every request (spec §10 D1), never from a path in the request.
 * Every input is checked before anything starts ccmem, because starting ccmem may migrate its data root (spec §4).
 */
export const MEMORY_REPO_UNKNOWN = "memory-repo-unknown";
export const MEMORY_NOT_FOUND = "memory-not-found";
export const MEMORY_QUERY_INVALID = "memory-query-invalid";
/** Every fixed code a memory route answers; `ccmem-failed:<status>` is the one open family. */
export const MEMORY_FIXED_CODES = [
  "ccmem-missing", "ccmem-timeout", "ccmem-output-too-large", "ccmem-output-invalid",
  MEMORY_REPO_UNKNOWN, MEMORY_NOT_FOUND, MEMORY_QUERY_INVALID,
] as const;

export function memoryHttpStatus(code: string): number {
  if (code === "ccmem-missing") return 503;
  if (code.startsWith("ccmem-")) return 502;
  if (code === MEMORY_REPO_UNKNOWN || code === MEMORY_NOT_FOUND) return 404;
  return 400;
}

/** Spec §5.1: the server checks its own answer. An extra or missing key throws, and the shared error handler answers 500. */
export function sendChecked(res: Response, schema: ZodTypeAny, body: unknown): void {
  res.json(schema.parse(body));
}

const refuse = (res: Response, code: string, message: string): void => { res.status(memoryHttpStatus(code)).json({ code, message }); };

export function registerMemoryRoutes(app: Express, opts: PanelOptions): void {
  const adapter = createCcmemAdapter(opts.memory ?? { ccmemBin: null, env: {} });
  const discovered = async () => (await discoverRepos({ root: opts.root, repos: opts.repos })).repos;

  /** Checks the inputs, then the repository, and only then lets `run` start ccmem. Answers 400/404 itself. */
  const route = (inputs: (req: Request) => Parsed<unknown>[], run: (scope: MemoryScope, req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      void (async () => {
        const projectKey = parseProjectKey(req.query.projectKey);
        const bad = [projectKey, ...inputs(req)].find((p) => !p.ok);
        if (bad !== undefined && !bad.ok) { refuse(res, MEMORY_QUERY_INVALID, bad.message); return; }
        const key = (projectKey as { ok: true; value: string }).value;
        const repo = (await discovered()).find((r) => r.projectKey === key);
        if (repo === undefined) { refuse(res, MEMORY_REPO_UNKNOWN, `this panel discovered no repository ${JSON.stringify(key)}`); return; }
        try {
          await run({ projectKey: key, repoPath: repo.path }, req, res);
        } catch (err) {
          if (err instanceof MemoryError) { refuse(res, err.code, err.message); return; }
          throw err;
        }
      })().catch(next);
    };

  app.get("/api/memory/status", (_req, res, next) => {
    void (async () => {
      const repos = await discovered();
      sendChecked(res, memoryStatusResponseSchema, {
        adapter: { id: adapter.id, capabilities: adapter.capabilities() },
        health: await adapter.health(),
        repos: repos.map((r) => ({ projectKey: r.projectKey })),
      });
    })().catch(next);
  });

  app.get("/api/memory/list", route((req) => [parseLimit(req.query.limit)], async (scope, req, res) => {
    const limit = (parseLimit(req.query.limit) as { ok: true; value: number }).value;
    sendChecked(res, memoryPageResponseSchema, { projectKey: scope.projectKey, query: "", page: await adapter.search(scope, { query: "", limit }) });
  }));

  app.get("/api/memory/search", route((req) => [parseQuery(req.query.q), parseLimit(req.query.limit)], async (scope, req, res) => {
    const query = (parseQuery(req.query.q) as { ok: true; value: string }).value;
    const limit = (parseLimit(req.query.limit) as { ok: true; value: number }).value;
    sendChecked(res, memoryPageResponseSchema, { projectKey: scope.projectKey, query, page: await adapter.search(scope, { query, limit }) });
  }));

  app.get("/api/memory/item", route((req) => [parseRef(req.query.ref)], async (scope, req, res) => {
    const ref = (parseRef(req.query.ref) as { ok: true; value: string }).value;
    const record = await adapter.get(scope, ref);
    if (record === null) { refuse(res, MEMORY_NOT_FOUND, `memory ${ref} is not visible from ${scope.projectKey}`); return; }
    sendChecked(res, memoryItemResponseSchema, { record });
  }));
}

function parseProjectKey(raw: unknown): Parsed<string> {
  if (typeof raw !== "string" || raw === "") return { ok: false, message: Array.isArray(raw) ? "projectKey was given more than once" : "projectKey is required" };
  return { ok: true, value: raw };
}
```

`src/panel/server.ts`:
- add `import type { CcmemAdapterOptions } from "../memory/ccmem.js";`
- add to `PanelOptions`, after `control`:

```ts
  /**
   * Memory tab spec §3.4. Optional so the many criteria that build PanelOptions as a literal stay as they are
   * (plan D7); absent means not configured, and nothing starts ccmem. `parsePanelArgs` always sets it.
   */
  memory?: CcmemAdapterOptions;
```

- in `parsePanelArgs`'s returned object, after `control,`:

```ts
    // Memory tab spec §3.4: read at parse time from the env this panel was given, like correctionsDir. Unset or empty
    // means not configured; there is no PATH lookup, so a criterion reaches a real ccmem only by naming it.
    memory: { ccmemBin: env.ORCA_CCMEM_BIN !== undefined && env.ORCA_CCMEM_BIN !== "" ? env.ORCA_CCMEM_BIN : null, env },
```

`src/panel/api.ts`: add `import { registerMemoryRoutes } from "./memoryApi.js";` and, directly above `registerChainRoutes(app, deps.opts, objectBody);`:

```ts
  // Memory tab spec §5.1: GET only, above the error handler like every other route.
  registerMemoryRoutes(app, deps.opts);
```

`src/cli.ts`: in USAGE, right after the line `shows recovery, and refuses those commands by name.`, add (same indentation as that line):

```
                                 ORCA_CCMEM_BIN (an absolute path to ccmem) turns on the read-only
                                 Memory section; unset, the panel never starts ccmem.
```

`README.md`: add after the "Durable task control foundation" section's end, a new section:

```markdown
## Memory section (read-only)

`orca panel` shows a Memory section when `ORCA_CCMEM_BIN` is an absolute path to the ccmem executable. It reads
with `ccmem export --json --scope global` and then `--scope project`, in the repository's directory, so ccmem
computes the project key itself. Nothing is written by Orca. Opening the section starts ccmem, and ccmem may migrate
its own data root when it opens it (backup copy and pruning; spec `docs/superpowers/specs/2026-09-29-memory-tab-design.md` §4).
Unset, the section says it is not configured and ccmem is never started. A repository without a git remote may show
no project memory: ccmem keys such a project by the session's directory, which may differ from the repository root.
```

- [ ] **Step 4: Run to verify it passes.** `./node_modules/.bin/vitest run tests/memory tests/panel/usage.test.ts tests/panel/security.test.ts > "$OUT/t5-green.txt" 2>&1; echo $?` → `0`; `npm run typecheck` → `0`.

- [ ] **Step 5: Mutations (clone copy).**
  - M4: in `parsePanelArgs`, unset `ORCA_CCMEM_BIN` → `"ccmem"` (a PATH lookup), and drop the `isAbsolute` guard in the copy ⇒ M4 red (the fake on PATH is called).
  - M11: replace the `repo === undefined` branch with `const repo = { path: opts.repos[0]!.path }` ⇒ the unknown-repository criterion red (the fake is called).
  - M12: add `app.post("/api/memory/list", (_q, r) => { r.json({}); });` ⇒ M12 red.
  - M13: `sendChecked` body → `res.json(body);` ⇒ the "refuses to send…" criterion red.
  - M-route: move `registerMemoryRoutes(app, deps.opts);` below the error handler ⇒ the route criteria red (express no longer matches them as routes).
  - M-RF2: `parseProjectKey` → `{ ok: true, value: String(raw) }` ⇒ the `projectKey=mem&projectKey=mem` row red.

- [ ] **Step 6: Commit**

```bash
git add src/memory/wire.ts src/panel/memoryApi.ts src/panel/server.ts src/panel/api.ts src/cli.ts README.md tests/memory/memoryApi.test.ts web/src/locales/zh.ts
git commit -m "feat(panel): four read-only memory routes, behind the token, choosing only discovered repositories"
```

---

### Task 6: The web section

**Files:**
- Create: `web/src/memoryTypes.ts`, `web/src/memoryApi.ts`, `web/src/MemoryView.tsx`, `web/tests/memoryView.test.tsx`, `web/tests/memoryApp.test.tsx`, `tests/memory/memoryWebParity.test.ts`
- Modify: `web/src/api.ts` (`export` on `getJson` only), `web/src/sections.ts`, `web/src/Shell.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`, `web/tests/shell.test.tsx` (**one assertion, only with the human's OK, D10**)

**Interfaces:**
- Consumes: Task 5 routes and `src/memory/wire.ts` types (parity only).
- Produces: `WEB_MEMORY_RECORD_FIELDS`; `fetchMemoryStatus()`, `fetchMemoryList(projectKey)`, `fetchMemorySearch(projectKey, q)`, `fetchMemoryItem(projectKey, ref)`; `MemoryView({ active }: { active: boolean })`; `SECTIONS` with `"memory"` before `"metrics"`.

- [ ] **Step 1: Types and fetchers.** `web/src/memoryTypes.ts`:

```ts
/**
 * Memory tab spec §5.1: the web copies of src/memory/wire.ts's response shapes (web/ cannot import src/ or zod).
 * tests/memory/memoryWebParity.test.ts keeps them in step, at run time (field set) and at compile time (assignability).
 */
export interface MemoryRecord {
  ref: string;
  scope: "global" | "project";
  projectKey: string | null;
  kind: string;
  content: string;
  tags: string[];
  pinned: boolean;
  source: string;
  trust: number | null;
  createdAt: string;
  updatedAt: string;
}
export const WEB_MEMORY_RECORD_FIELDS = ["ref", "scope", "projectKey", "kind", "content", "tags", "pinned", "source", "trust", "createdAt", "updatedAt"] as const;
export interface MemoryPage { records: MemoryRecord[]; total: number; truncated: boolean }
export type MemoryHealth = { status: "ok" } | { status: "unavailable"; code: string; message: string };
export interface MemoryStatusResponse {
  adapter: { id: string; capabilities: { search: true; get: true; recordCorrection: false } };
  health: MemoryHealth;
  repos: Array<{ projectKey: string }>;
}
export interface MemoryPageResponse { projectKey: string; query: string; page: MemoryPage }
export interface MemoryItemResponse { record: MemoryRecord }
```

`web/src/api.ts`: change `async function getJson<T>(path: string): Promise<T> {` to `export async function getJson<T>(path: string): Promise<T> {` and nothing else.

`web/src/memoryApi.ts`:

```ts
/** GET /api/memory/* -- src/panel/memoryApi.ts. Each call is one getJson; a refusal arrives as a PanelRequestError. */
import { getJson } from "./api.js";
import type { MemoryItemResponse, MemoryPageResponse, MemoryStatusResponse } from "./memoryTypes.js";

const key = (projectKey: string): string => `projectKey=${encodeURIComponent(projectKey)}`;

export const fetchMemoryStatus = (): Promise<MemoryStatusResponse> => getJson<MemoryStatusResponse>("/api/memory/status");
export const fetchMemoryList = (projectKey: string): Promise<MemoryPageResponse> => getJson<MemoryPageResponse>(`/api/memory/list?${key(projectKey)}`);
export const fetchMemorySearch = (projectKey: string, q: string): Promise<MemoryPageResponse> =>
  getJson<MemoryPageResponse>(`/api/memory/search?${key(projectKey)}&q=${encodeURIComponent(q)}`);
export const fetchMemoryItem = (projectKey: string, ref: string): Promise<MemoryItemResponse> =>
  getJson<MemoryItemResponse>(`/api/memory/item?${key(projectKey)}&ref=${encodeURIComponent(ref)}`);
```

- [ ] **Step 2: Parity criterion** `tests/memory/memoryWebParity.test.ts` (fails until Step 1 exists; it is green once Step 1 is in):

```ts
import { describe, expect, it } from "vitest";
import type { MemoryItemResponse as ServerItem, MemoryPageResponse as ServerPage, MemoryStatusResponse as ServerStatus } from "../../src/memory/wire.js";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/wire.js";
import type { MemoryItemResponse as WebItem, MemoryPageResponse as WebPage, MemoryStatusResponse as WebStatus } from "../../web/src/memoryTypes.js";
import { WEB_MEMORY_RECORD_FIELDS } from "../../web/src/memoryTypes.js";

/**
 * Plan D9: the same two halves as tests/panel/webParity.test.ts, in a file of its own so that file is not edited.
 * Runtime: the record's field set. Compile time: the functions below must type-check both ways (npm run typecheck
 * checks this file); they are never called.
 */
describe("web/src/memoryTypes.ts stays in step with src/memory/wire.ts", () => {
  it("has the same record fields", () => {
    expect([...WEB_MEMORY_RECORD_FIELDS].sort()).toEqual([...MEMORY_RECORD_FIELDS].sort());
  });
});

function statusServerToWeb(x: ServerStatus): WebStatus { return x; }
function statusWebToServer(x: WebStatus): ServerStatus { return x; }
function pageServerToWeb(x: ServerPage): WebPage { return x; }
function pageWebToServer(x: WebPage): ServerPage { return x; }
function itemServerToWeb(x: ServerItem): WebItem { return x; }
function itemWebToServer(x: WebItem): ServerItem { return x; }
export const __memoryParityChecks__ = [statusServerToWeb, statusWebToServer, pageServerToWeb, pageWebToServer, itemServerToWeb, itemWebToServer];
```

- [ ] **Step 3: Text.** `web/src/locales/en.ts`: in `nav`, add `memory: "Memory"` (after `requirements`). Add a top-level `memory` block (place it before `metrics`):

```ts
  memory: {
    title: "Memory",
    notOpened: "Memory is read when this section is opened.",
    loading: "Reading memory…",
    repo: "Repository",
    noRepos: "This panel has no repository to read memory for.",
    configureHint: "Set ORCA_CCMEM_BIN to the ccmem executable and restart the panel to read memory.",
    migrationNote: "Memory is read through ccmem, which may migrate its own data directory when it opens it.",
    searchLabel: "Search memory",
    search: "Search",
    list: "Memory list",
    empty: "No memory matches.",
    noProjectHint: "No project memory. ccmem computes the project key from the repository directory; a repository without a remote may not match the key its sessions recorded.",
    truncated: "Showing {{shown}} of {{total}}; narrow the search.",
    scopeGlobal: "global",
    scopeProject: "project",
    pinned: "pinned",
    select: "Select a memory to read it.",
    yes: "yes",
    no: "no",
    field: { ref: "Id", scope: "Scope", projectKey: "Project key", kind: "Kind", source: "Source", trust: "Trust", tags: "Tags", pinned: "Pinned", createdAt: "Created", updatedAt: "Updated" },
  },
```

`web/src/locales/zh.ts`: `nav.memory: "记忆"`, and the same keys:

```ts
  memory: {
    title: "记忆",
    notOpened: "打开这个分区时才读取记忆。",
    loading: "正在读取记忆…",
    repo: "仓库",
    noRepos: "这个面板没有可以读取记忆的仓库。",
    configureHint: "把 ORCA_CCMEM_BIN 设成 ccmem 可执行文件的路径，然后重启面板，才能读取记忆。",
    migrationNote: "记忆经 ccmem 读取；ccmem 打开自己的数据目录时可能会迁移它。",
    searchLabel: "搜索记忆",
    search: "搜索",
    list: "记忆列表",
    empty: "没有匹配的记忆。",
    noProjectHint: "没有项目记忆。项目键由 ccmem 按仓库目录计算；没有 remote 的仓库可能与会话记下的键对不上。",
    truncated: "显示 {{shown}} / 共 {{total}} 条，请缩小搜索范围。",
    scopeGlobal: "全局",
    scopeProject: "项目",
    pinned: "置顶",
    select: "选一条记忆来阅读。",
    yes: "是",
    no: "否",
    field: { ref: "编号", scope: "范围", projectKey: "项目键", kind: "类型", source: "来源", trust: "可信度", tags: "标签", pinned: "置顶", createdAt: "创建时间", updatedAt: "更新时间" },
  },
```

In `zhErrors` (done in Task 5, listed here for completeness — do not add twice):

```ts
  // Memory tab spec §5.1 (src/panel/memoryApi.ts MEMORY_FIXED_CODES). ccmem-failed:<status> has no entry: it is an open family, shown as sent.
  "ccmem-missing": "没有配置 ccmem，或找不到它：{{message}}",
  "ccmem-timeout": "读取 ccmem 超时：{{message}}",
  "ccmem-output-too-large": "ccmem 的输出超过上限：{{message}}",
  "ccmem-output-invalid": "ccmem 的输出不符合预期格式：{{message}}",
  "memory-repo-unknown": "面板没有发现这个仓库：{{message}}",
  "memory-not-found": "这个仓库看不到这条记忆：{{message}}",
  "memory-query-invalid": "查询参数不合法：{{message}}",
```

- [ ] **Step 4: Write the failing view criteria** `web/tests/memoryView.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Memory tab spec §5.2, plan D8. Every request starts ccmem twice, so the view asks for nothing until it is opened,
 * reads the list once, searches only when the person submits, and never offers a write. Memory content is shown as
 * text, cut at 200 code points in the list, whole in the detail.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { MemoryView } from "../src/MemoryView.js";
import type { MemoryRecord } from "../src/memoryTypes.js";

const rec = (ref: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ref, scope: "global", projectKey: null, kind: "rule", content: `memory ${ref}`, tags: [], pinned: false, source: "user_explicit",
  trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ...over,
});
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK_STATUS = { adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] };
let requests: string[];
let status: unknown;
let records: MemoryRecord[];
let truncated: { total: number } | null;

beforeEach(() => {
  requests = []; status = OK_STATUS; records = [rec("1"), rec("2", { scope: "project", projectKey: "example.invalid/o/r" })]; truncated = null;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/memory/status") return json(status);
    if (url.startsWith("/api/memory/list") || url.startsWith("/api/memory/search")) {
      const query = new URL(url, "http://x").searchParams.get("q") ?? "";
      return json({ projectKey: "mem", query, page: { records, total: truncated?.total ?? records.length, truncated: truncated !== null } });
    }
    if (url.startsWith("/api/memory/item")) {
      const ref = new URL(url, "http://x").searchParams.get("ref");
      const found = records.find((r) => r.ref === ref);
      return found ? json({ record: found }) : json({ code: "memory-not-found", message: `memory ${ref} is not visible` }, 404);
    }
    return json({ code: "unexpected", message: url }, 500);
  }) as typeof fetch;
});
afterEach(() => cleanup());

describe("MemoryView (spec §5.2, W1)", () => {
  it("asks for nothing while the section has never been opened", async () => {
    const { rerender } = render(<MemoryView active={false} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toEqual([]);
    expect(screen.getByText("Memory is read when this section is opened.")).toBeTruthy();
    rerender(<MemoryView active />);
    await waitFor(() => expect(requests).toEqual(["/api/memory/status", "/api/memory/list?projectKey=mem"]));
    rerender(<MemoryView active={false} />);
    rerender(<MemoryView active />);
    await new Promise((r) => setTimeout(r, 30));
    expect(requests).toHaveLength(2); // opened again: nothing re-read
  });

  it("shows the refusal and the hint, and lists nothing, when ccmem is not configured", async () => {
    status = { ...OK_STATUS, health: { status: "unavailable", code: "ccmem-missing", message: "ORCA_CCMEM_BIN is not set" } };
    render(<MemoryView active />);
    expect(await screen.findByTestId("refusal-code")).toHaveProperty("textContent", "ccmem-missing");
    expect(screen.getByText(/Set ORCA_CCMEM_BIN/)).toBeTruthy();
    expect(requests).toEqual(["/api/memory/status"]);
  });

  it("searches only when the person submits", async () => {
    render(<MemoryView active />);
    await screen.findByRole("navigation", { name: "Memory list" });
    const box = screen.getByRole("searchbox", { name: "Search memory" });
    fireEvent.change(box, { target: { value: "pnpm" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(requests.filter((u) => u.includes("search"))).toEqual([]);
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/search?projectKey=mem&q=pnpm"));
  });

  it("says how much was cut, and that a remote-less repository may show no project memory", async () => {
    records = [rec("1")]; truncated = { total: 7 };
    render(<MemoryView active />);
    expect(await screen.findByText("Showing 1 of 7; narrow the search.")).toBeTruthy();
    expect(screen.getByText(/No project memory/)).toBeTruthy();
  });

  it("opens one memory in full, markup as text, and cuts the list at 200 code points (Review Focus 4)", async () => {
    const long = `<b>x</b>${"\u{1F600}".repeat(250)}`;
    records = [rec("5", { content: long, tags: ["a", "b"], pinned: true })];
    render(<MemoryView active />);
    const list = within(await screen.findByRole("navigation", { name: "Memory list" }));
    const row = list.getByRole("button");
    const shown = row.querySelector("[data-testid='memory-excerpt']")!.textContent!;
    expect([...shown].length).toBe(201); // 200 code points and the ellipsis
    expect(shown.startsWith("<b>x</b>")).toBe(true);
    expect(shown).not.toMatch(/[\uD800-\uDBFF]…$/); // no lone high surrogate before the ellipsis
    fireEvent.click(row);
    await waitFor(() => expect(requests.at(-1)).toBe("/api/memory/item?projectKey=mem&ref=5"));
    expect((await screen.findByTestId("memory-content")).textContent).toBe(long);
    expect(document.querySelector("b")).toBeNull(); // markup never became an element
  });

  it("shows a refused detail by its code", async () => {
    render(<MemoryView active />);
    const list = within(await screen.findByRole("navigation", { name: "Memory list" }));
    records = [];
    fireEvent.click(list.getAllByRole("button")[0]!);
    expect(await screen.findByTestId("refusal-code")).toHaveProperty("textContent", "memory-not-found");
  });

  it("offers no write: its only buttons are search and the rows (G9)", async () => {
    render(<MemoryView active />);
    await screen.findByRole("navigation", { name: "Memory list" });
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names[0]).toBe("Search");
    expect(names.slice(1).every((n) => n.includes("memory "))).toBe(true);
    expect(names).toHaveLength(1 + records.length);
  });

  it("speaks Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<MemoryView active />);
    expect(await screen.findByRole("navigation", { name: "记忆列表" })).toBeTruthy();
    expect(screen.getByText("全局")).toBeTruthy();
  });
});
```

`web/tests/memoryApp.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Review Focus 5 / plan D8: a panel used without visiting Memory never asks for it (so ccmem is never started), and
 * #memory mounts the view and reads it. App's other requests are answered with the minimum the page needs.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

const metrics = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let requests: string[];

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json(metrics);
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/memory/status") return json({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mem" }] });
    if (url.startsWith("/api/memory/list")) return json({ projectKey: "mem", query: "", page: { records: [], total: 0, truncated: false } });
    return json({ error: { code: "control-not-mounted", message: url } }, 404);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; });

describe("App and the Memory section (plan D8, Review Focus 5)", () => {
  it("never asks for memory while another section is in use", async () => {
    window.location.hash = "#decisions";
    render(<App />);
    await waitFor(() => expect(requests).toContain("/api/metrics"));
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.filter((u) => u.startsWith("/api/memory"))).toEqual([]);
  });

  it("reads memory when #memory is the section", async () => {
    window.location.hash = "#memory";
    render(<App />);
    await waitFor(() => expect(requests).toContain("/api/memory/list?projectKey=mem"));
    expect(screen.getByText("No memory matches.")).toBeTruthy();
  });
});
```

⚠️ If the App's fallback 404 body shape makes some other App fetch throw in a way that blocks render, copy the corresponding stub lines from `web/tests/requirementsApp.test.tsx:31-41` rather than changing App.

- [ ] **Step 5: Run to verify they fail.** From the repo root: `npm exec --workspace web -- vitest run tests/memoryView.test.tsx tests/memoryApp.test.tsx > "$OUT/t6-red.txt" 2>&1; echo $?` → non-zero (`MemoryView` missing). (`web/node_modules/.bin/vitest` does not exist at `c91d029`; the workspace resolves the root's vitest, the same way `npm run check --workspace web` does.)

- [ ] **Step 6: Implement** `web/src/MemoryView.tsx`:

```tsx
/**
 * Memory tab spec §5.2. Read-only (G9): no control here writes anything. Every request starts ccmem twice on the
 * server, so nothing is asked before the section is first opened (plan D8), the list is read once per repository
 * choice, and a search runs only when the person submits. Content is rendered as text; the list shows the first 200
 * code points, the detail all of it.
 */
import type { FormEvent, JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type PanelRefusal, failureFrom } from "./api.js";
import { fetchMemoryItem, fetchMemoryList, fetchMemorySearch, fetchMemoryStatus } from "./memoryApi.js";
import type { MemoryPageResponse, MemoryRecord, MemoryStatusResponse } from "./memoryTypes.js";
import { Refusal } from "./Refusal.js";

const EXCERPT_CODE_POINTS = 200;
const SCOPE_KEY = { global: "memory.scopeGlobal", project: "memory.scopeProject" } as const;

function excerpt(content: string): string {
  const points = [...content];
  return points.length <= EXCERPT_CODE_POINTS ? content : `${points.slice(0, EXCERPT_CODE_POINTS).join("")}…`;
}

export function MemoryView({ active }: { active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const opened = useRef(false);
  const [status, setStatus] = useState<MemoryStatusResponse | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<MemoryPageResponse | null>(null);
  const [record, setRecord] = useState<MemoryRecord | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (projectKey: string, query: string): Promise<void> => {
    setRefusal(null);
    setRecord(null);
    setLoading(true);
    try {
      setPage(query === "" ? await fetchMemoryList(projectKey) : await fetchMemorySearch(projectKey, query));
    } catch (err) {
      setPage(null);
      setRefusal(failureFrom(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!active || opened.current) return;
    opened.current = true;
    void (async () => {
      try {
        const answer = await fetchMemoryStatus();
        setStatus(answer);
        const first = answer.repos[0]?.projectKey ?? null;
        setRepo(first);
        if (answer.health.status === "ok" && first !== null) await load(first, "");
      } catch (err) {
        setRefusal(failureFrom(err));
      }
    })();
  }, [active]);

  const open = async (ref: string): Promise<void> => {
    if (repo === null) return;
    setRefusal(null);
    try {
      setRecord((await fetchMemoryItem(repo, ref)).record);
    } catch (err) {
      setRecord(null);
      setRefusal(failureFrom(err));
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (repo !== null) void load(repo, draft.trim());
  };

  const health = status?.health;
  const ready = health?.status === "ok" && repo !== null;
  const noProject = page !== null && page.query === "" && !page.page.records.some((r) => r.scope === "project");

  return (
    <section className="memory-view">
      <h2>{t("memory.title")}</h2>
      {status === null && refusal === null && <p className="empty">{t(opened.current ? "memory.loading" : "memory.notOpened")}</p>}
      {health !== undefined && health.status === "unavailable" && (
        <>
          <Refusal refusal={{ status: null, code: health.code, message: health.message }} />
          {health.code === "ccmem-missing" && <p className="caveat">{t("memory.configureHint")}</p>}
        </>
      )}
      {status !== null && status.repos.length === 0 && <p className="empty">{t("memory.noRepos")}</p>}
      {ready && (
        <>
          <p className="caveat">{t("memory.migrationNote")}</p>
          {status!.repos.length > 1 && (
            <label>
              {t("memory.repo")}
              <select name="memory-repo" value={repo!} onChange={(e) => { const next = e.currentTarget.value; setRepo(next); setDraft(""); void load(next, ""); }}>
                {status!.repos.map((r) => <option key={r.projectKey} value={r.projectKey}>{r.projectKey}</option>)}
              </select>
            </label>
          )}
          <form role="search" onSubmit={submit}>
            <input type="search" aria-label={t("memory.searchLabel")} value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
            <button type="submit">{t("memory.search")}</button>
          </form>
        </>
      )}
      {refusal !== null && <Refusal refusal={refusal} />}
      {loading && <p className="empty">{t("memory.loading")}</p>}
      {page !== null && (
        <nav aria-label={t("memory.list")}>
          {page.page.records.length === 0 && <p className="empty">{t("memory.empty")}</p>}
          {noProject && <p className="caveat">{t("memory.noProjectHint")}</p>}
          <ul className="memory-list">
            {page.page.records.map((r) => (
              <li key={r.ref}>
                <button type="button" className="memory-row" onClick={() => { void open(r.ref); }}>
                  <span className="memory-scope">{t(SCOPE_KEY[r.scope])}</span>
                  <span className="memory-kind">{r.kind}</span>
                  {r.pinned && <span className="memory-pinned">{t("memory.pinned")}</span>}
                  <span className="memory-excerpt" data-testid="memory-excerpt">{excerpt(r.content)}</span>
                  {r.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
                  <time dateTime={r.updatedAt}>{r.updatedAt}</time>
                </button>
              </li>
            ))}
          </ul>
          {page.page.truncated && <p className="caveat">{t("memory.truncated", { shown: page.page.records.length, total: page.page.total })}</p>}
        </nav>
      )}
      {page !== null && record === null && refusal === null && <p className="empty">{t("memory.select")}</p>}
      {record !== null && (
        <article className="memory-detail">
          <pre className="memory-content" data-testid="memory-content">{record.content}</pre>
          <dl>
            <dt>{t("memory.field.ref")}</dt><dd>{record.ref}</dd>
            <dt>{t("memory.field.scope")}</dt><dd>{t(SCOPE_KEY[record.scope])}</dd>
            <dt>{t("memory.field.projectKey")}</dt><dd>{record.projectKey ?? ""}</dd>
            <dt>{t("memory.field.kind")}</dt><dd>{record.kind}</dd>
            <dt>{t("memory.field.source")}</dt><dd>{record.source}</dd>
            <dt>{t("memory.field.trust")}</dt><dd>{record.trust ?? ""}</dd>
            <dt>{t("memory.field.tags")}</dt><dd>{record.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</dd>
            <dt>{t("memory.field.pinned")}</dt><dd>{t(record.pinned ? "memory.yes" : "memory.no")}</dd>
            <dt>{t("memory.field.createdAt")}</dt><dd><time dateTime={record.createdAt}>{record.createdAt}</time></dd>
            <dt>{t("memory.field.updatedAt")}</dt><dd><time dateTime={record.updatedAt}>{record.updatedAt}</time></dd>
          </dl>
        </article>
      )}
    </section>
  );
}
```

Note: `{t(opened.current ? … : …)}` reads a ref during render; it is only a label choice and the effect re-renders via `setStatus`. If the i18next key type check rejects a conditional key, split it into two `t` calls.

`web/src/sections.ts`: `export const SECTIONS = ["decisions", "chains", "tasks", "requirements", "memory", "metrics"] as const;`

`web/src/Shell.tsx`: `NAV_KEY` gets `memory: "nav.memory"` (between `requirements` and `metrics`). Nothing else.

`web/src/App.tsx`: `import { MemoryView } from "./MemoryView.js";` and, directly before the `metrics` pane:

```tsx
      <SectionPane section="memory" active={section}>
        <MemoryView active={section === "memory"} />
      </SectionPane>
```

`web/src/styles.css` (append):

```css
/* Memory tab spec §5.2: a memory is shown as written, line breaks kept, long words wrapped. */
.memory-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.memory-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  text-align: left;
  width: 100%;
}
```

`web/tests/shell.test.tsx` (**only after the human's explicit OK; D10**): replace the line
`    expect(SECTIONS).toEqual(["decisions", "chains", "tasks", "requirements", "metrics"]);`
with
`    expect(SECTIONS).toEqual(["decisions", "chains", "tasks", "requirements", "memory", "metrics"]); // rewritten under the human's 2026-10-03 OK at memory-tab plan review (plan D10)`
Without the OK, stop here and leave the task blocked with this one red, named, in the ledger.

- [ ] **Step 7: Run to verify.** From the repo root: `npm run build --workspace web > "$OUT/t6-build.txt" 2>&1; echo $?` → `0`; `npm run --ws check > "$OUT/t6-wscheck.txt" 2>&1; echo $?` → `0`; `./node_modules/.bin/vitest run tests/memory tests/panel/scanPanelText.test.ts tests/panel/refusalCoverage.test.ts tests/panel/noSkips.test.ts > "$OUT/t6-root.txt" 2>&1; echo $?` → `0`; `npm run typecheck` → `0`. Read every file in full.

- [ ] **Step 8: Mutations (clone copy).**
  - W1a: in `MemoryView`, run the effect without the `active` guard (`if (opened.current) return;`) ⇒ "asks for nothing while … never been opened" and `memoryApp` "never asks for memory…" red.
  - W1b: `onChange` of the search box also calls `load(repo!, e.currentTarget.value)` ⇒ "searches only when the person submits" red.
  - W1c: `excerpt` → `content.slice(0, 200) + "…"` ⇒ Review Focus 4 red (length/surrogate).
  - W1d: remove `{page.page.truncated && …}` ⇒ the truncation criterion red.
  - W-par: drop `trust` from `WEB_MEMORY_RECORD_FIELDS` ⇒ `memoryWebParity` red; change web `pinned: boolean` to `pinned: number` ⇒ `npm run typecheck` red.
  - W-zh: delete `scopeGlobal` from `zh.ts` ⇒ `web/tests/i18nKeys.test.ts` and "speaks Chinese" red.

- [ ] **Step 9: Commit**

```bash
git add web/src/memoryTypes.ts web/src/memoryApi.ts web/src/api.ts web/src/MemoryView.tsx web/src/sections.ts web/src/Shell.tsx web/src/App.tsx web/src/styles.css web/src/locales/en.ts web/src/locales/zh.ts web/tests/memoryView.test.tsx web/tests/memoryApp.test.tsx web/tests/shell.test.tsx tests/memory/memoryWebParity.test.ts
git commit -m "feat(web): a read-only Memory section that reads nothing until it is opened"
```

---

### Task 7: R1 against a real ccmem

**Files:**
- Create: `tests/memory/ccmemReal.test.ts`

**Interfaces:**
- Consumes: Task 4 `createCcmemAdapter`; Task 2's parser (through the adapter); `memoryRepo()`, `PROJECT_KEY` from `tests/memory/helpers.ts`.

- [ ] **Step 1: Write the criterion** `tests/memory/ccmemReal.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCcmemAdapter } from "../../src/memory/ccmem.js";
import { PROJECT_KEY, memoryRepo } from "./helpers.js";

/**
 * Spec §6.3 R1 (§10 D4). Fakes only know shapes; this criterion runs a real ccmem, in a temp data root and a temp
 * HOME, so a field the real export prints differently (tags arrive as JSON text) cannot stay hidden behind the fake.
 * Gated at run time with ctx.skip() -- not describe.skipIf -- so the per-file temp root is still removed
 * (tests/setup/scopeTmpdir.ts erratum). The gate (plan Task 8) runs it with ORCA_CCMEM_REAL_BIN set and checks it passed.
 */
const REAL = process.env.ORCA_CCMEM_REAL_BIN;
let cleanups: Array<() => Promise<void>> = [];
beforeEach((ctx) => { if (REAL === undefined || REAL === "") ctx.skip(); });
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

describe("a real ccmem (spec §6.3 R1)", () => {
  it("reads back one global and one project memory through the adapter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-real-ccmem-"));
    const repo = await memoryRepo();
    cleanups.push(() => rm(dir, { recursive: true, force: true }), () => rm(repo, { recursive: true, force: true }));
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), CCMEM_DATA_ROOT: join(dir, "root") };
    const seed = join(dir, "seed.json");
    await writeFile(seed, JSON.stringify({ version: "0.7", exported_at: 0, memories: [
      { scope: "global", project_key: null, type: "rule", content: "real global rule", pinned: 1, tags: "[\"seeded\"]" },
      { scope: "project", project_key: null, type: "fact", content: "real project fact", pinned: 0, tags: null },
    ] }));
    execFileSync(REAL!, ["import", seed], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });

    const adapter = createCcmemAdapter({ ccmemBin: REAL!, env });
    expect(await adapter.health()).toEqual({ status: "ok" });
    const page = await adapter.search({ projectKey: "panel-key", repoPath: repo }, { query: "", limit: 50 });
    expect(page.records.map((r) => [r.scope, r.content, r.projectKey, r.tags, r.pinned])).toEqual([
      ["global", "real global rule", null, ["seeded"], true],
      ["project", "real project fact", PROJECT_KEY, [], false],
    ]);
  });
});
```

- [ ] **Step 2: Run it skipped and run it real.**
  - `./node_modules/.bin/vitest run tests/memory/ccmemReal.test.ts --reporter=json --outputFile="$OUT/r1-skip.json" > "$OUT/r1-skip.txt" 2>&1; echo $?` → `0`, the test `skipped`.
  - Record `ls -1A ~/.claude/ccmem > "$OUT/r1-real-before.txt"`, then `ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem ./node_modules/.bin/vitest run tests/memory/ccmemReal.test.ts --reporter=json --outputFile="$OUT/r1-real.json" > "$OUT/r1-real.txt" 2>&1; echo $?` → `0`; then `node -e 'const r=require(process.argv[1]);const t=r.testResults.flatMap(f=>f.assertionResults);process.exit(t.length>0&&t.every(a=>a.status==="passed")?0:1)' "$OUT/r1-real.json"; echo $?` → `0`; then `ls -1A ~/.claude/ccmem > "$OUT/r1-real-after.txt"` and compare with `ccmemRootDiff` (a one-line `tsx -e` calling `tests/setup/ccmemRoot.ts`) → `[]`.

- [ ] **Step 3: Timing (spec §3.7).** Measure one `adapter.search` on the fake and on the real ccmem (temp root, two rows), 3 runs each, with `node --import tsx -e` and `performance.now()`. Record the numbers, the command and the commit in the ledger. No measurement on the real data root (ruling Q6).

- [ ] **Step 4: Mutation (clone copy).** In `src/memory/ccmemExport.ts`, `tags: z.string().nullable()` → `tags: z.array(z.string()).nullable()` ⇒ R1 red with `ccmem-output-invalid` (the real export prints tags as JSON text). The fake criteria in Task 4 must also go red under this mutation (the fake prints text too); record both.

- [ ] **Step 5: Commit**

```bash
git add tests/memory/ccmemReal.test.ts
git commit -m "test(memory): read a real ccmem through the adapter, in a temp data root"
```

---

### Task 8: The gate, the ledger and the handoff

**Files:**
- Modify: `.superpowers/sdd/2026-10-03-memory-tab/progress.md` (append), `docs/handoff/handoff.md` (Chinese; §三 status line, §4.0 rewritten for what is next), ccloop and ccmem handoffs' Orca sections (Chinese; one line each: memory tab done, ccmem untouched).

- [ ] **Step 1: Fresh copy.** `git clone --local /Users/biran/code/skills/loop/Orca "$SCRATCH/gate/orca"`, symlink `node_modules` and `web/node_modules` from the main tree, `cd` into it, `git config core.hooksPath scripts/githooks`, `npm run build --workspace web`. A ccloop clone at `ae2caa3` built for `ORCA_CCLOOP_BIN` (as in the last gate). `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` redirected into `$SCRATCH/gate/env/`; `TMPDIR=$(mktemp -d /private/tmp/cl-XXXX)`; `ORCA_AGENTS_TABLE` with fake codex in `integration` mode (`[node, <clone>/tests/fixtures/fake-codex.mjs, "integration", <marker>]` as the last gate did).

- [ ] **Step 2: Before.** `ls -1A ~/.claude/ccmem > "$OUT/ccmem-before.txt"`; `stat ~/.orca > "$OUT/orca-before.txt"` (plus the sha of every file under it, as the last gate did); `uptime > "$OUT/uptime-before.txt"`.

- [ ] **Step 3: Run `npm run verify`'s stages one by one** (it is an `&&` chain, so a red stops it), each redirected to its own file, each RC recorded: `npm run typecheck`; `npm test` (with `--reporter=json --outputFile`); `npm run ledger -- validate .decisions || [ $? -eq 2 ]`; `node scripts/check-claude-md-lines.mjs`; `node scripts/check-hooks-path.mjs`; `npm run verify:control`; `npm run verify:scheduler`; `npm run verify:chain`; `npm run build --workspace web`; `npm run verify:ccloop-pin`; `npm run verify:panel`; `npm run --ws check`; then `node scripts/check-tmp-leak.mjs`; then R1 real as in Task 7 Step 2 (RC 0 and "passed, not skipped").
  A timeout red in the full suite: rerun that file alone 3 times after the load has come down, record `uptime` with each, and compare it with the known flakes in handoff §三 (`controlShutdown`, `driverRecovery` "drives a retried run on…", `driverRequirementSplit` "fails the third consecutive invalid draft…", `driverLanding`, `executionDriverE2E`, `handoffE2E` G, `ccloopPort`, `driverProgress` R2, `gateCheck` K13). Only a red that is in that list and green 3/3 alone is called a flake.

- [ ] **Step 4: After.** `ls -1A ~/.claude/ccmem > "$OUT/ccmem-after.txt"` and `ccmemRootDiff` of the two → `[]`; `~/.orca` stat and shas identical; `uptime` again.

- [ ] **Step 5: Ledger.** Append the gate table (stage, command, RC, counts), the flake reruns with `uptime`, the R1 result, the timing numbers, and the before/after comparisons, each with its command and the commit it was observed at.

- [ ] **Step 6: Final review.** One whole-branch review (`superpowers:requesting-code-review`) over the commits from Task 0 on, with this plan, the spec §9/§10 and the ledger. Its load-bearing claims are re-checked by the controller before anything is fixed (`superpowers:receiving-code-review`).

- [ ] **Step 7: Handoffs and commit.** Update the three handoffs (Chinese, no current hashes, no push state), then:

```bash
git add -f .superpowers/sdd/2026-10-03-memory-tab/progress.md
git add docs/handoff/handoff.md
git commit -m "docs(handoff): the memory tab (N5) is done, read-only, ccmem untouched"
```

(ccloop's and ccmem's handoff commits are made in their own repositories, each with its own `git add` of the one file.) Re-run `/usr/bin/git ls-remote origin refs/heads/main` in all three repositories at the end. Pushing is the human's.

---

## Self-review (done at drafting)

1. **Spec coverage.** §0 view/adapter/read-only → Tasks 4–6; §0.1 non-goals → none implemented (no write, no correction link, no relevance, no cache/paging/polling; `searchRecords` is the whole search). §2 types → Task 2. §2.3 → Task 2 (no method) and Task 4 (`recordCorrection: false`). §3.1 argv/verb → Task 4 M1. §3.2 cwd, panel key only selects → Task 4 M2, Task 5 (`projectKey` never passed to ccmem). §3.3 sequence, env, timeout, buffer, mapping → Task 4. §3.4 → Tasks 4/5 (+D5). §3.5 → Task 3. §3.6 → Task 2 (+D11). §3.7 no cache, timing → Task 4 (re-export per call), Task 7 Step 3. §4 → README (Task 5), UI note (Task 6), ledger. §5.1 routes, statuses, schemas, G9 → Task 5. §5.2 → Task 6. §6.1 → Task 4. §6.2 → Task 1 (+D2/D3). §6.3 M1–M13, R1, W1, G1 → Tasks 1–7 (each named in a criterion title or a mutation). §6.4 → Task 8. §7 pre-registered criteria → `shell.test.tsx` (D10, needs OK), `vitest.config.ts` (Task 1), `parsePanelArgs` deep-equal (only `security.test.ts:328`, which compares `.repos`, measured by a python scan of `tests/` at `c91d029`) → no other rewrite expected; Task 8's full run is the check.
2. **Placeholder scan.** No TBD/TODO. Two conditional notes are instructions with a named fallback (Task 6 Step 4's App stub, Step 6's `t` key typing), not open work.
3. **Type consistency.** `CcmemAdapterOptions` (Task 4) is the type of `PanelOptions.memory` (Task 5). `Parsed<T>` (Task 3) is used by `memoryApi.ts`. `MEMORY_FIXED_CODES` (Task 5) is what the zh coverage test reads. `MemoryRecord` (Task 2, readonly tags) is never assigned to the wire type directly; `sendChecked` takes `unknown`. Web `MemoryRecord` mirrors `MemoryRecordWire` (parity file).
4. **Review Focus.** Five lines above, each with its pinning test in the owning task (Tasks 4, 5, 2, 6, 6).
