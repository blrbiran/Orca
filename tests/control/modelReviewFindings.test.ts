import { describe, expect, it } from "vitest";
import { parseFindings, validateFindings, type FindingsDoc } from "../../src/control/modelReview/findings.js";
import type { RangeGroup } from "../../src/control/checks/range.js";

/**
 * Checks spec 2026-10-22 §6.3–§6.4, criterion 7: the model finds, code decides validity (Rule 5, P7). A finding stands
 * only with evidence from at least two groups landed in the range, each on a path that group changed and a line that
 * exists at the range's head; anything else is dropped with its reason (kept for later learning, never shown as a flag).
 * A file that fails the schema or names another range is not read at all.
 */
const FROM = "a".repeat(40), TO = "b".repeat(40);
const groups: RangeGroup[] = [
  { groupId: "g1", integratedCommit: "1".repeat(40), target: "main", checks: [], paths: ["src/api.ts", "src/errors.ts"] },
  { groupId: "g2", integratedCommit: "2".repeat(40), target: "main", checks: [], paths: ["src/client.ts"] },
  { groupId: "g3", integratedCommit: "3".repeat(40), target: "main", checks: [], paths: ["src/util.ts"] },
];
const lines: Record<string, number> = { "src/api.ts": 40, "src/errors.ts": 10, "src/client.ts": 25, "src/util.ts": 5, "README.md": 3 };
const lineCount = (path: string): number | null => lines[path] ?? null;
const finding = (id: string, evidence: Array<[string, string, number]>, severity: "major" | "minor" = "major") => ({
  id, category: "contract-drift" as const, severity, title: `t ${id}`, explanation: "e", suggestedFix: "f",
  evidence: evidence.map(([groupId, path, line]) => ({ groupId, path, line, note: "n" })),
});
const doc = (findings: unknown[], range = { from: FROM, to: TO }): unknown => ({ schema: "orca-model-review-findings-v1", range, findings });

describe("findings validation (code-side)", () => {
  it("keeps the findings with two-sided in-range evidence and drops each other one with its reason", () => {
    const parsed = parseFindings(doc([
      finding("keep-major", [["g1", "src/errors.ts", 3], ["g2", "src/client.ts", 25]]),
      finding("keep-minor", [["g2", "src/client.ts", 1], ["g3", "src/util.ts", 5], ["g2", "src/client.ts", 2]], "minor"),
      finding("out-of-range-group", [["g1", "src/api.ts", 1], ["g9", "src/client.ts", 1]]),
      finding("path-not-changed", [["g1", "README.md", 1], ["g2", "src/client.ts", 1]]),
      finding("line-past-eof", [["g1", "src/api.ts", 41], ["g2", "src/client.ts", 1]]),
      finding("one-sided", [["g1", "src/api.ts", 1], ["g1", "src/errors.ts", 2]]),
    ]), { from: FROM, to: TO });
    if (!parsed.ok) throw new Error(parsed.reason);
    const out = validateFindings(parsed.doc, groups, lineCount);
    expect(out.valid.map((f) => f.id)).toEqual(["keep-major", "keep-minor"]);
    expect(out.dropped.map((d) => [d.finding.id, d.reason])).toEqual([
      ["out-of-range-group", "ref-not-in-range:g9:src/client.ts"],
      ["path-not-changed", "ref-not-in-range:g1:README.md"],
      ["line-past-eof", "line-out-of-file"],
      ["one-sided", "one-sided"],
    ]);
  });

  it("refuses the whole file when its range differs from the review's, or when it fails the schema", () => {
    const ok = doc([finding("x", [["g1", "src/api.ts", 1], ["g2", "src/client.ts", 1]])]);
    expect(parseFindings(ok, { from: FROM, to: TO }).ok).toBe(true);
    expect(parseFindings(doc([], { from: FROM, to: "c".repeat(40) }), { from: FROM, to: TO })).toEqual({ ok: false, reason: "range-mismatch" });
    for (const bad of [
      { ...(ok as FindingsDoc), schema: "v0" },
      { ...(ok as FindingsDoc), extra: 1 },
      doc(Array.from({ length: 21 }, (_, i) => finding(`f${i}`, [["g1", "src/api.ts", 1], ["g2", "src/client.ts", 1]]))),
      doc([finding("one-entry", [["g1", "src/api.ts", 1]])]),
      doc([{ ...finding("bad-cat", [["g1", "src/api.ts", 1], ["g2", "src/client.ts", 1]]), category: "style" }]),
      doc([finding("line-zero", [["g1", "src/api.ts", 0], ["g2", "src/client.ts", 1]])]),
      doc([finding("dup", [["g1", "src/api.ts", 1], ["g2", "src/client.ts", 1]]), finding("dup", [["g1", "src/api.ts", 2], ["g2", "src/client.ts", 2]])]),
    ]) {
      const parsed = parseFindings(bad, { from: FROM, to: TO });
      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? "" : parsed.reason).toMatch(/^schema:/);
    }
  });
});
