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
    ["a source ccmem never had", out([row({ source: "orca" })]), "global", /memories\.0\.source \(row id 7\)/],
    ["a version other than 0.7", out([], { version: "0.8" }), "global", /version/],
    ["tags that are not JSON", out([row({ tags: "tooling" })]), "global", /row id 7: tags is not JSON/],
    ["tags that are not an array of strings", out([row({ tags: "[1]" })]), "global", /row id 7: tags is not a JSON array of strings/],
    ["a project row in a global answer", out([row({ scope: "project", project_key: "a/b" })]), "global", /row id 7: asked for --scope global, got scope project/],
    ["a global row in a project answer", out([row()]), "project", /row id 7: asked for --scope project, got scope global/],
    ["a project row without a key", out([row({ scope: "project", project_key: null })]), "project", /row id 7: a project row without project_key/],
    ["a project row with an empty key", out([row({ scope: "project", project_key: "" })]), "project", /without project_key/],
    ["a created_at past the Date range (Review Focus 3)", out([row({ created_at: 9e15 })]), "global", /row id 7/],
    ["a negative updated_at", out([row({ updated_at: -1 })]), "global", /row id 7/],
  ])("refuses %s as ccmem-output-invalid, naming where", (_name, stdout, scope, message) => {
    const err = invalid(() => parseCcmemExport(stdout, scope as "global" | "project"));
    expect(err.code).toBe("ccmem-output-invalid");
    expect(err.message).toMatch(message);
    expect(err.message).toContain(`--scope ${scope}`);
  });
});
