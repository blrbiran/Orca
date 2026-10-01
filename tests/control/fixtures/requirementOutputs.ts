/** N1 spec §7.2: model outputs the criteria hand the single-call port, as a real model would write them. */
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
