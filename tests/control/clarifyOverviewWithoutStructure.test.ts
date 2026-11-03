import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { multiHarness } from "./fixtures/multiRequirement.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Overview findings 2026-11-01 §4 (a), human ruling session 43913afc: 「先 (a)，前后质量对比过了再 (b)」. The overview is 88-98%
// of a clarify prompt on a large repository and `structure` (exported symbols) about half of it; clarify asks about intent,
// which symbols do not answer, so it is sent without them. Split keeps them: it names the paths a task writes.

const FENCED = /<<<ORCA-DATA repository-overview ([0-9a-f]{16})\n([\s\S]*?)\nORCA-DATA repository-overview \1>>>/;
const fenced = (prompt: string): { nonce: string; overview: Record<string, unknown> } => {
  const match = FENCED.exec(prompt)!;
  return { nonce: match[1]!, overview: JSON.parse(match[2]!) as Record<string, unknown> };
};
const promptOf = (envelope: { work: { kind: string } }): string => (envelope.work as unknown as { prompt: string }).prompt;

describe("clarify sees the overview without its exported symbols; split still sees them", () => {
  // mutation: give clarify the whole overview -> `structure` in its fence -> red
  // mutation: name the run by the whole overview's hash -> run.overview.hash differs from what was fenced -> red
  it("a clarify prompt's overview has the files and documents but no structure, and the run names the overview it sent", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const sent = x.fake.calls.accept[0]!;
      const { nonce, overview } = fenced(promptOf(sent));
      expect(Object.keys(overview)).not.toContain("structure");
      expect(overview).toMatchObject({ schema: "orca-repository-overview-v1", files: { cut: false }, docs: { status: "ok" } });
      const run = x.runs().find((r) => r.runId === sent.claim.runId)!;
      expect(run.overview.hash).toBe(sha256Canonical(overview));
      expect(nonce).toBe(run.overview.hash.slice(0, 16));
    } finally { await x.dispose(); }
  });

  // mutation: leave a multi project's members whole -> `structure` in a member's overview -> red
  it("a multi-directory project's clarify prompt has no structure in any member, and the run names what was sent", async () => {
    const x = await multiHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.open();
      await x.until(() => x.round(1).state !== "drafting");
      const match = /<<<ORCA-DATA project-overview ([0-9a-f]{16})\n([\s\S]*?)\nORCA-DATA project-overview \1>>>/.exec(x.promptOf(0))!;
      const project = JSON.parse(match[2]!) as { dirs: Array<{ key: string; overview: Record<string, unknown> }> };
      expect(project.dirs.map((dir) => dir.key)).toEqual(["posts", "alpha"]);
      for (const dir of project.dirs) {
        expect(Object.keys(dir.overview)).not.toContain("structure");
        expect(dir.overview).toMatchObject({ files: { status: "ok" } });
      }
      expect((x.runs()[0]!.overview as { hash: string }).hash).toBe(sha256Canonical(project));
    } finally { await x.dispose(); }
  });

  // mutation: strip structure for split too -> no `structure` in the split fence -> red
  it("a split prompt's overview keeps its structure", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const { overview } = fenced(promptOf(x.fake.calls.accept[0]!));
      expect(Object.keys(overview)).toContain("structure");
    } finally { await x.dispose(); }
  });
});
