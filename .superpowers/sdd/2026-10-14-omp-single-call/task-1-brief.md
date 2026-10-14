### Task 1 (ccloop): Catalog rows

**Files:**
- Modify: `src/agents/types.ts` (add `CatalogRowV1` after `CapabilityViewV1`, line 32)
- Modify: `src/agents/ompModels.ts:1-64` (`readOmpCatalog`, `readOmpModels` on top of it, `ompSingleCallExecution`)
- Test: `tests/agents/ompCatalog.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CatalogRowV1 { selector: string; provider: string; contextWindow: number | null; maxTokens: number | null }` in `src/agents/types.ts`.
  - `export async function readOmpCatalog(installation: InstallationV1): Promise<CatalogRowV1[]>` in `src/agents/ompModels.ts`.
  - `export async function readOmpModels(installation: InstallationV1): Promise<string[]>` (unchanged signature).
  - `export function ompSingleCallExecution(row: CatalogRowV1 | undefined): "v1" | null`.

- [ ] **Step 1: Write the failing test** — `tests/agents/ompCatalog.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ompSingleCallExecution, readOmpCatalog, readOmpModels } from "../../src/agents/ompModels.js";
import type { InstallationV1 } from "../../src/agents/types.js";

// OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.1): the catalog's one spawn gives rows, and a number is
// used only when it is a positive safe integer -- so a malformed or absent value can never become a context window or the
// output bound Orca books. §3.2: only a row that declares the cap pi-ai sends, from a provider other than openrouter (for
// which pi-ai sends no cap without an explicit one), may answer "v1".
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function catalogInstallation(models: unknown[]): Promise<InstallationV1> {
  const dir = await mkdtemp(join(tmpdir(), "ccloop-omp-rows-"));
  dirs.push(dir);
  const binary = join(dir, "omp");
  await writeFile(binary, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("models")) { process.stdout.write(${JSON.stringify(`${JSON.stringify({ models })}\n`)}); process.exit(0); }
process.exit(2);
`, { mode: 0o700 });
  return { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 10_000, killGraceMs: 50, defaultModel: "gateway/a", profile: null };
}
const row = (provider: string, id: string, numbers: Record<string, unknown>) => ({ provider, id, selector: `${provider}/${id}`, kind: "chat", ...numbers });

describe("OMP catalog rows (omp single call §3.1)", () => {
  it("keeps contextWindow and maxTokens only when each is a positive safe integer, with the row's provider", async () => {
    const installation = await catalogInstallation([
      row("gateway", "a", { contextWindow: 200_000, maxTokens: 8_192 }),
      row("gateway", "zero", { contextWindow: 0, maxTokens: 0 }),
      row("gateway", "negative", { contextWindow: -1, maxTokens: -5 }),
      row("gateway", "fraction", { contextWindow: 1.5, maxTokens: 2.5 }),
      row("gateway", "string", { contextWindow: "128000", maxTokens: "16384" }),
      row("gateway", "unsafe", { contextWindow: 2 ** 53, maxTokens: 2 ** 53 }),
      row("gateway", "absent", {}),
      row("openrouter", "vendor/m", { contextWindow: 64_000, maxTokens: 4_096 }),
    ]);
    const none = { contextWindow: null, maxTokens: null };
    expect(await readOmpCatalog(installation)).toEqual([
      { selector: "gateway/a", provider: "gateway", contextWindow: 200_000, maxTokens: 8_192 },
      { selector: "gateway/zero", provider: "gateway", ...none },
      { selector: "gateway/negative", provider: "gateway", ...none },
      { selector: "gateway/fraction", provider: "gateway", ...none },
      { selector: "gateway/string", provider: "gateway", ...none },
      { selector: "gateway/unsafe", provider: "gateway", ...none },
      { selector: "gateway/absent", provider: "gateway", ...none },
      { selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 },
    ]);
    // The selector-list callers (detect, updates, older criteria) keep exactly what they had: the selectors, in order.
    expect(await readOmpModels(installation)).toEqual([
      "gateway/a", "gateway/zero", "gateway/negative", "gateway/fraction", "gateway/string", "gateway/unsafe", "gateway/absent", "openrouter/vendor/m",
    ]);
  });

  it("still refuses a row whose selector is not provider/id, from both readers", async () => {
    const installation = await catalogInstallation([{ provider: "gateway", id: "a", selector: "gateway/b", maxTokens: 8 }]);
    await expect(readOmpCatalog(installation)).rejects.toThrow("omp-model-catalog-invalid");
    await expect(readOmpModels(installation)).rejects.toThrow("omp-model-catalog-invalid");
  });

  it("answers v1 only for a row with a cap whose provider is not openrouter", () => {
    expect(ompSingleCallExecution({ selector: "gateway/a", provider: "gateway", contextWindow: null, maxTokens: 8_192 })).toBe("v1");
    expect(ompSingleCallExecution({ selector: "gateway/a", provider: "gateway", contextWindow: 200_000, maxTokens: null })).toBeNull();
    expect(ompSingleCallExecution({ selector: "openrouter/vendor/m", provider: "openrouter", contextWindow: 64_000, maxTokens: 4_096 })).toBeNull();
    expect(ompSingleCallExecution(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts > /private/tmp/osc/logs/t1-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-red.log
```
Read the whole log; its `RUN` line names `/Users/biran/code/skills/orca/ccloop-wt/omp-single-call`. Expected: FAIL — `readOmpCatalog`/`ompSingleCallExecution` are not exported (`is not a function`).

- [ ] **Step 3: Implement**

`src/agents/types.ts`, insert after the `CapabilityViewV1` interface (after line 32):

```ts
/**
 * OMP single call (Orca spec 2026-10-14-omp-single-call-design.md §3.1): one row of a kind's model catalog, as ccloop uses
 * it. A number is kept only when the catalog gave a positive safe integer; anything else is null.
 */
export interface CatalogRowV1 { selector: string; provider: string; contextWindow: number | null; maxTokens: number | null }
```

`src/agents/ompModels.ts`: change line 2 to `import type { CatalogRowV1, InstallationV1 } from "./types.js";` and replace lines 50-64 (`readOmpModels`) with:

```ts
const positiveSafe = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

/**
 * OMP single call (Orca spec 2026-10-14 §3.1): the catalog's rows from its one spawn, read under the same structured
 * profile/configuration as a phase. A number is kept only when it is a positive safe integer. This never sends a model prompt.
 */
export async function readOmpCatalog(installation: InstallationV1): Promise<CatalogRowV1[]> {
  const parsed = await runOmpJson(installation, ["models", "--json"]);
  if (parsed === null || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) throw new Error("omp-model-catalog-invalid");
  const rows = (parsed as { models: unknown[] }).models.map((row): CatalogRowV1 => {
    if (row === null || typeof row !== "object") throw new Error("omp-model-catalog-invalid");
    const value = row as Record<string, unknown>;
    if (typeof value.provider !== "string" || typeof value.id !== "string" || typeof value.selector !== "string"
      || value.selector !== `${value.provider}/${value.id}` || value.selector.length > 200) throw new Error("omp-model-catalog-invalid");
    return { selector: value.selector, provider: value.provider, contextWindow: positiveSafe(value.contextWindow), maxTokens: positiveSafe(value.maxTokens) };
  });
  if (new Set(rows.map((row) => row.selector)).size !== rows.length) throw new Error("omp-model-catalog-invalid");
  return rows;
}

/** Read the catalog under the same structured profile/configuration as a phase. This never sends a model prompt. */
export async function readOmpModels(installation: InstallationV1): Promise<string[]> {
  return (await readOmpCatalog(installation)).map((row) => row.selector);
}

/**
 * OMP single call (Orca spec 2026-10-14 §2, §3.2): "v1" only when the row declares the cap pi-ai sends (maxTokens) and its
 * provider is not openrouter, for which pi-ai sends no cap unless one is given explicitly.
 */
export function ompSingleCallExecution(row: CatalogRowV1 | undefined): "v1" | null {
  return row !== undefined && row.maxTokens !== null && row.provider !== "openrouter" ? "v1" : null;
}
```

- [ ] **Step 4: Run it green, with the selector callers' criteria**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/agents/ompCatalog.test.ts tests/agents/ompSelection.test.ts tests/agents/ompDetect.test.ts tests/agents/ompUpdates.test.ts > /private/tmp/osc/logs/t1-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t1-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t1-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`. (`ompUpdates` "preserves the unavailable reason…" is a registered load timeout; if it alone times out, rerun the file alone per `known-load-flakes.md`.)

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/agents/types.ts src/agents/ompModels.ts tests/agents/ompCatalog.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t1-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): read the model catalog as rows with their window and cap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```
Read `t1-diff.log` before committing.

---

