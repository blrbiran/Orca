import { describe, expect, it } from "vitest";
import { documentPathOf, renderRequirementDocument } from "../../src/control/requirementDocument.js";
import { classifyClarifyOutput } from "../../src/control/requirementClarify.js";
import { newRound } from "../../src/control/requirementRecords.js";
import type { RoundBody } from "../../src/control/requirementSchemas.js";
import { ROUND_ONE, ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// N1 spec §10 and §4.3: the document is derived from the records by one pure function; same records => same bytes.
const id = "0123456789abcdef0123456789abcdef";
function rounds(): RoundBody[] {
  const one = classifyClarifyOutput(ROUND_ONE, { roundNo: 1, requirementId: id, earlierQuestionIds: [] });
  const two = classifyClarifyOutput(ROUND_TWO, { roundNo: 2, requirementId: id, earlierQuestionIds: ["R1.Q1", "R1.Q2"] });
  if (!one.ok || !two.ok) throw new Error("fixture outputs must classify");
  // PR-I2: round 1 also proposes a glossary entry the person rejects, so a filter that keeps every proposal is seen red.
  const proposed = { ...one.result, glossary: [...one.result.glossary, { id: "R1.G2", term: "folder", definition: "A rejected proposal." }] };
  return [
    { ...newRound(1), state: "answered", result: proposed, answeredAt: "2026-10-02T08:00:00.000Z",
      answers: [{ id: "R1.Q1", kind: "recommended", text: "CommonMark" }, { id: "R1.Q2", kind: "text", text: "As links, relative to the note" }],
      glossaryDecisions: [{ id: "R1.G1", accept: true }, { id: "R1.G2", accept: false }], adrDecisions: [{ id: "R1.ADR1", accept: false }] },
    { ...newRound(2), state: "answered", result: two.result, answeredAt: "2026-10-02T08:05:00.000Z", answers: [], glossaryDecisions: [], adrDecisions: [] },
  ];
}
const requirement = { requirementId: id, repoId: "repo", slug: "markdown-export", contentLanguage: "en" as const, createdOn: "2026-10-02",
  consensus: { roundNo: 2, at: "2026-10-02T08:06:00.000Z", openBranches: ["sync to a cloud drive"], openQuestions: [] } };

describe("the requirement document (N1 spec §10)", () => {
  it("renders the records to exactly these bytes", () => {
    expect(renderRequirementDocument({ groupId: "r", requirement, rounds: rounds(), acceptedSplit: null })).toBe([
      "---", `orcaRequirementId: ${id}`, "orcaGroupId: r", "repo: repo", "createdOn: 2026-10-02", "---",
      "# markdown-export", "",
      "## Statement", "", "People can export a note as a CommonMark file; images are links.", "",
      "## Acceptance criteria", "", "- AC1: An exported note opens as CommonMark.", "- AC2: Images in the note are links in the file.", "",
      "## Glossary", "", "- **note**: One page of text a person wrote.", "",
      "## Decisions (ADRs)", "", "(none)", "",
      "## Rounds", "", "### Round 1", "",
      "- R1.Q1: Which Markdown flavour?", "  - recommended: CommonMark", "  - answer: CommonMark",
      "- R1.Q2: Are images exported?", "  - recommended: As links", "  - answer: As links, relative to the note", "",
      "### Round 2", "", "(no questions)", "",
      "## Consensus", "", "- round: 2", "- at: 2026-10-02T08:06:00.000Z", "- open branches:", "  - sync to a cloud drive", "",
    ].join("\n"));
  });

  it("gives the same bytes for the same records, and adds the Split table only after accept", () => {
    const input = { groupId: "r", requirement, rounds: rounds(), acceptedSplit: null };
    expect(renderRequirementDocument(input)).toBe(renderRequirementDocument(structuredClone(input)));
    const split = renderRequirementDocument({ ...input, acceptedSplit: VALID_SPLIT });
    expect(split.endsWith(["## Split", "", "| Criterion | Tasks |", "| --- | --- |", "| AC1 | exporter |", "| AC2 | images |", ""].join("\n"))).toBe(true);
  });

  it("writes headings in the requirement's content language and leaves identifiers alone (DR20)", () => {
    const text = renderRequirementDocument({ groupId: "r", requirement: { ...requirement, contentLanguage: "zh" }, rounds: rounds(), acceptedSplit: null });
    expect(text).toContain("## 陈述\n");
    expect(text).toContain("## 验收标准\n\n- AC1: ");
    expect(text).toContain("- R1.Q1: Which Markdown flavour?\n  - 推荐：CommonMark\n  - 回答：CommonMark");
  });

  it("names the document path, with a suffix only when one is needed", () => {
    expect(documentPathOf("2026-10-02", "markdown-export", 1)).toBe(".orca/requirements/2026-10-02-markdown-export.md");
    expect(documentPathOf("2026-10-02", "markdown-export", 3)).toBe(".orca/requirements/2026-10-02-markdown-export-3.md");
  });
});

// Final review fix wave (session b5e8d368, 2026-10-02): finding 6 (spec §10 "Decisions (ADRs) (accepted only)", the
// Task 7 deferred must-fix) and the triage's newline/pipe fix -- the bytes are frozen into the person's repository.
describe("the requirement document's decisions and its markdown (final review finding 6, triage T7)", () => {
  function withAdrs(): RoundBody[] {
    const [one, two] = rounds();
    const result = { ...one!.result!, adrs: [...one!.result!.adrs, { id: "R1.ADR2", title: "Zip every export", context: "A rejected proposal.", decision: "Zip it.", consequences: "None." }] };
    return [{ ...one!, result, adrDecisions: [{ id: "R1.ADR1", accept: true }, { id: "R1.ADR2", accept: false }] }, two!];
  }
  const decisions = (text: string) => text.slice(text.indexOf("## Decisions (ADRs)"), text.indexOf("## Rounds"));

  it("renders an accepted ADR with its context, decision and consequences, and leaves a rejected one out", () => {
    const text = renderRequirementDocument({ groupId: "r", requirement, rounds: withAdrs(), acceptedSplit: null });
    expect(decisions(text)).toBe([
      "## Decisions (ADRs)", "",
      "### R1.ADR1 One file per note", "",
      "- context: Notes are independent.", "- decision: Export each note to its own file.", "- consequences: Many notes make many files.", "", "",
    ].join("\n"));
  });

  it("keeps multi-line text inside its list item, and a heading on one line", () => {
    const [one, two] = withAdrs();
    const result = { ...one!.result!,
      adrs: [{ ...one!.result!.adrs[0]!, title: "One file\nper note", context: "Notes are independent.\n\nEven nested ones." }],
      glossary: [{ ...one!.result!.glossary[0]!, definition: "One page\nof text." }] };
    const answers = [{ id: "R1.Q1", kind: "recommended" as const, text: "CommonMark" }, { id: "R1.Q2", kind: "text" as const, text: "As links,\r\nrelative to the note\n- not a new item" }];
    const branches = { ...requirement.consensus, openBranches: ["sync to\na cloud drive"] };
    const text = renderRequirementDocument({ groupId: "r", requirement: { ...requirement, consensus: branches },
      rounds: [{ ...one!, result, answers, adrDecisions: [{ id: "R1.ADR1", accept: true }] }, two!], acceptedSplit: null });
    expect(text).toContain("- **note**: One page\n  of text.\n");
    expect(text).toContain("### R1.ADR1 One file per note\n\n- context: Notes are independent.\n\n  Even nested ones.\n- decision: ");
    expect(text).toContain("  - answer: As links,\n    relative to the note\n    - not a new item\n");
    expect(text).toContain("- open branches:\n  - sync to\n    a cloud drive\n");
  });

  it("escapes a pipe in a Split table cell and keeps each row on one line", () => {
    const [one, two] = rounds();
    const criteria = [{ id: "AC|1", text: "A criterion id with a pipe." }, { id: "AC2", text: "Plain." }];
    const split = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, taskId: "export|er", traces: ["AC|1"] }, { ...VALID_SPLIT.tasks[1]!, taskId: "images\nnext", traces: ["AC2"] }] };
    const text = renderRequirementDocument({ groupId: "r", requirement, rounds: [one!, { ...two!, result: { ...two!.result!, acceptanceCriteria: criteria } }], acceptedSplit: split });
    expect(text.endsWith(["## Split", "", "| Criterion | Tasks |", "| --- | --- |", "| AC\\|1 | export\\|er |", "| AC2 | images next |", ""].join("\n"))).toBe(true);
  });
});
