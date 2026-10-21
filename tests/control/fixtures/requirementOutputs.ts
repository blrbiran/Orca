/** N1 spec §7.2: model outputs the criteria hand the single-call port, as a real model would write them. */
/** Clarify caps spec 2026-10-21 §3.1: round 1's judgement (medium tier: two rounds, as these fixtures run). */
export const CLASSIFICATION = { scope: "medium", scopeReason: "An exporter and its image handling.", clarity: "fair", clarityReason: "The format is open." } as const;
export const ROUND_ONE = {
  slug: "markdown-export",
  statement: "People can export a note as a Markdown file.",
  acceptanceCriteria: [{ id: "AC1", text: "An exported note opens as Markdown." }],
  questions: [
    { key: "format", question: "Which Markdown flavour?", recommendedAnswer: "CommonMark", why: "Most readers accept it.", dependsOn: [] },
    { key: "images", question: "Are images exported?", recommendedAnswer: "As links", why: "It keeps one file per note.", dependsOn: ["format"] },
  ],
  frontierEmpty: false,
  openBranches: ["sync to a cloud drive"],
  glossary: [{ term: "note", definition: "One page of text a person wrote." }],
  adrs: [{ title: "One file per note", context: "Notes are independent.", decision: "Export each note to its own file.", consequences: "Many notes make many files." }],
  classification: CLASSIFICATION,
};
export const ROUND_TWO = {
  statement: "People can export a note as a CommonMark file; images are links.",
  acceptanceCriteria: [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }],
  questions: [], frontierEmpty: true, openBranches: ["sync to a cloud drive"], glossary: [], adrs: [],
};
/** Spec §8.1: a split that validates against a repository holding README.md and src/a.ts (DR19). */
export const VALID_SPLIT = {
  tasks: [
    { taskId: "exporter", title: "Write the exporter", labels: ["feature"], goal: "Export a note as CommonMark.", successCondition: "src/export.ts exports a note.", targetPaths: ["src/export.ts", "answer.txt"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
    { taskId: "images", title: "Export images as links", labels: ["feature"], goal: "Write images as links.", successCondition: "src/images.ts turns images into links.", targetPaths: ["src/images.ts", "answer.txt"], checks: ["true"], dependsOn: ["exporter"], traces: ["AC2"] },
  ],
  notes: "Two tasks; the second needs the first.",
};
/** Spec §8.3.4: a target under a directory the commit does not have. */
export const INVALID_SPLIT = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, targetPaths: ["missing/dir/x.ts"] }, VALID_SPLIT.tasks[1]!] };
/**
 * Issue 88 (external tester, 2026-10-08): the split that hit "a cycle slipped through" -- fifteen tasks writing one file,
 * with the dependsOn edges the issue lists. Its taskIds put "t10".."t15" before "t2" in lexicographic order.
 */
const ISSUE_88_DEPENDS_ON: Record<string, string[]> = {
  "t1-preflight": [], "t2-env-introspection": ["t1-preflight"], "t3-test-baseline-1": ["t2-env-introspection"],
  "t4-dim-cli": ["t2-env-introspection"], "t5-dim-sync": ["t2-env-introspection"], "t6-dim-err": ["t2-env-introspection"], "t7-dim-rcv": ["t2-env-introspection"],
  "t8-findings-consolidation": ["t4-dim-cli", "t5-dim-sync", "t6-dim-err", "t7-dim-rcv"], "t9-rev-section": ["t4-dim-cli", "t5-dim-sync", "t6-dim-err", "t7-dim-rcv"],
  "t10-doc-drift": ["t1-preflight"], "t11-dimension-tables": ["t8-findings-consolidation", "t9-rev-section", "t10-doc-drift"],
  "t12-unverified-index": ["t8-findings-consolidation"], "t13-impl-section": ["t3-test-baseline-1", "t8-findings-consolidation", "t10-doc-drift"],
  "t14-overview-appendix": ["t11-dimension-tables", "t12-unverified-index", "t13-impl-section"], "t15-final-verify": ["t14-overview-appendix"],
};
export const ISSUE_88_SPLIT = {
  tasks: Object.entries(ISSUE_88_DEPENDS_ON).map(([taskId, dependsOn]) => ({ ...VALID_SPLIT.tasks[0]!, taskId, title: taskId, targetPaths: ["README.md"], dependsOn, traces: ["AC1", "AC2"] })),
  notes: "R11.Q1-Q5 were not answered.",
};
