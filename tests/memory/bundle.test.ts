import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MEMORY_BUNDLE_MAX_BYTES, estimateMemoryTokens, memoryBundleOf, produceMemoryBundle, selectMemoryRows } from "../../src/memory/bundle.js";
import type { MemoryRecord } from "../../src/memory/adapter.js";

/**
 * Orca half of the memory-in-runs spec (`2026-11-20-memory-in-runs-and-read-api-design.md` §4.1, Q2 in §9): pick a
 * deterministic, bounded slice of ccmem's export, render it, and hand ccloop one exact text whose sha256 it can check.
 * Nothing here trusts ccmem to be up: a failure is a recorded error on the run, never a failed run.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const row = (id: number, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ref: String(id),
  scope: "global",
  projectKey: null,
  kind: "rule",
  content: `memory ${id}`,
  tags: [],
  pinned: false,
  source: "user_explicit",
  trust: 0.5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over
});

describe("the run's memory bundle (#417/#418)", () => {
  it("ranks pinned, then trust, then the most recently updated, and keeps the order", () => {
    const rows = [row(1, { trust: 0.9 }), row(2, { pinned: true, trust: 0.1 }), row(3, { trust: 0.9, updatedAt: "2026-02-01T00:00:00.000Z" })];
    // mutation (sort by id) -> [1,2,3], red.
    expect(selectMemoryRows(rows, 10_000).map((record) => record.ref)).toEqual(["2", "3", "1"]);
  });

  it("keeps orca-correction rows and drops every other retrieval_only row", () => {
    const rows = [
      row(1, { tags: ["retrieval_only"], source: "external" }),
      row(2, { tags: ["retrieval_only", "orca-correction"], content: "do not do that again" }),
      row(3)
    ];
    // mutation (drop every retrieval_only row) -> [3], red.
    expect(selectMemoryRows(rows, 10_000).map((record) => record.ref)).toEqual(["2", "3"]);
  });

  it("stops at the token budget and reports the exact text and its hash", () => {
    const rows = [row(1, { content: "a".repeat(400) }), row(2, { content: "b".repeat(400) })];
    const bundle = memoryBundleOf(rows, 150).bundle!;
    // 400 ASCII chars ≈ 100 tokens each; the header fits, so one row is in and the next is out.
    expect(bundle.text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1);
    expect(bundle.tokens).toBe(estimateMemoryTokens(bundle.text));
    expect(bundle.ids).toEqual([1]);
    expect(bundle.sha256).toBe(createHash("sha256").update(bundle.text, "utf8").digest("hex"));
  });

  it("drops an over-size bundle instead of cutting it", () => {
    const rows = [row(1, { content: "x".repeat(MEMORY_BUNDLE_MAX_BYTES + 10) })];
    // mutation (truncate instead of drop) -> a bundle is returned, red; mutation (throw) -> the run would fail, red.
    expect(memoryBundleOf(rows, 1_000_000)).toEqual({ bundle: null, error: "too-large" });
  });

  it("answers no bundle when nothing is selected", () => {
    expect(memoryBundleOf([], 1200)).toEqual({ bundle: null });
  });

  it("runs both export scopes once and maps the sha256 ccloop will verify", async () => {
    const root = mkdtempSync(join(tmpdir(), "orca-bundle-"));
    roots.push(root);
    const bin = join(root, "fake-ccmem.mjs");
    writeFileSync(bin, `#!/usr/bin/env node
const scope = process.argv[process.argv.indexOf("--scope") + 1];
process.stdout.write(JSON.stringify({ version: "0.7", exported_at: 1, memories: [{
  id: scope === "project" ? 11 : 12, scope, project_key: scope === "project" ? "github.com/acme/x" : null,
  type: "rule", content: scope + " memory", pinned: 0, source: "user_explicit", trust_score: 0.5,
  tags: null, created_at: 1, updated_at: 1
}] }));
`);
    chmodSync(bin, 0o755);
    const produced = await produceMemoryBundle({ ccmemBin: bin, env: process.env, cwd: root, budgetTokens: 1200, timeoutMs: 20_000 });
    expect(produced.bundle?.ids).toEqual([11, 12]);
    expect(produced.bundle?.text).toContain("project memory");
    expect(produced.bundle?.text).toContain("global memory");
  });

  it("records a ccmem failure instead of failing the run", async () => {
    const root = mkdtempSync(join(tmpdir(), "orca-bundle-fail-"));
    roots.push(root);
    const bin = join(root, "failing-ccmem.mjs");
    writeFileSync(bin, "#!/usr/bin/env node\nprocess.stderr.write('nope'); process.exit(3);\n");
    chmodSync(bin, 0o755);
    // mutation (throw from produceMemoryBundle) -> the caller cannot dispatch, red.
    const produced = await produceMemoryBundle({ ccmemBin: bin, env: process.env, cwd: root, timeoutMs: 20_000 });
    expect(produced.bundle).toBeNull();
    expect(produced.error).toMatch(/^ccmem-failed:/);
  });
});