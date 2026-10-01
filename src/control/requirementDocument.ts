import type { RequirementBlock } from "./requirementRecords.js";
import type { RoundBody, SplitOutput } from "./requirementSchemas.js";

/** DR20: prose headings in the requirement's content language; ids, paths and dates are not translated. */
const WORDS = {
  en: { statement: "Statement", criteria: "Acceptance criteria", glossary: "Glossary", decisions: "Decisions (ADRs)", rounds: "Rounds", round: "Round",
    consensus: "Consensus", split: "Split", recommended: "- recommended: ", answer: "- answer: ", unanswered: "(not answered)", noQuestions: "(no questions)",
    none: "(none)", roundLine: "- round: ", atLine: "- at: ", openBranches: "- open branches:", openQuestions: "- open questions:", criterion: "Criterion", tasks: "Tasks",
    context: "- context: ", decision: "- decision: ", consequences: "- consequences: " },
  zh: { statement: "陈述", criteria: "验收标准", glossary: "术语", decisions: "决策（ADR）", rounds: "问答轮次", round: "轮次", consensus: "共识", split: "拆分",
    recommended: "- 推荐：", answer: "- 回答：", unanswered: "（未回答）", noQuestions: "（本轮无问题）", none: "（无）", roundLine: "- 轮次：", atLine: "- 时间：",
    openBranches: "- 暂缓的分支：", openQuestions: "- 未回答的问题：", criterion: "标准", tasks: "任务", context: "- 背景：", decision: "- 决定：", consequences: "- 后果：" },
} as const;

export interface RequirementDocumentInput {
  groupId: string;
  requirement: Pick<RequirementBlock, "requirementId" | "repoId" | "slug" | "contentLanguage" | "createdOn" | "consensus">;
  rounds: readonly RoundBody[];
  acceptedSplit: SplitOutput | null;
}

/** Spec §9.2: `.orca/requirements/<createdOn>-<slug>.md`; the n-th candidate (n >= 2) gets `-<n>`. */
export function documentPathOf(createdOn: string, slug: string, suffix: number): string {
  return `.orca/requirements/${createdOn}-${slug}${suffix === 1 ? "" : `-${suffix}`}.md`;
}

/**
 * Final review triage (T7 minors): the text is frozen into the person's repository, so model and person text stays
 * inside the markdown construct it is written in. A list item's later lines are indented under its marker (blank lines
 * stay empty); a heading or a table cell is one line, and a table cell's `|` is escaped.
 */
const lines = (text: string): string[] => text.split(/\r\n|\r|\n/);
const item = (marker: string, text: string): string => lines(text).map((line, i) => (i === 0 ? `${marker}${line}` : line === "" ? "" : `${" ".repeat(marker.length - marker.trimStart().length + 2)}${line}`)).join("\n");
const oneLine = (text: string): string => lines(text).join(" ");
const cell = (text: string): string => oneLine(text).replace(/\|/g, "\\|");

/** N1 spec §10 and §4.3: the one renderer; the panel shows its output and the export writes its output. */
export function renderRequirementDocument(input: RequirementDocumentInput): string {
  const w = WORDS[input.requirement.contentLanguage];
  const valid = input.rounds.filter((round) => round.result !== null);
  const latest = valid.at(-1)?.result ?? null;
  const accepted = (decisions: RoundBody["glossaryDecisions"]) => new Set((decisions ?? []).filter((d) => d.accept).map((d) => d.id));
  const glossary = valid.flatMap((round) => round.result!.glossary.filter((entry) => accepted(round.glossaryDecisions).has(entry.id)));
  const adrs = valid.flatMap((round) => round.result!.adrs.filter((adr) => accepted(round.adrDecisions).has(adr.id)));
  const out: string[] = [
    "---", `orcaRequirementId: ${input.requirement.requirementId}`, `orcaGroupId: ${input.groupId}`, `repo: ${input.requirement.repoId}`, `createdOn: ${input.requirement.createdOn}`, "---",
    `# ${input.requirement.slug ?? `requirement-${input.requirement.requirementId.slice(0, 8)}`}`, "",
  ];
  const section = (title: string, body: string[]) => { out.push(`## ${title}`, "", ...(body.length === 0 ? [w.none] : body), ""); };
  section(w.statement, latest === null ? [] : [latest.statement]);
  section(w.criteria, (latest?.acceptanceCriteria ?? []).map((c) => item("- ", `${c.id}: ${c.text}`)));
  section(w.glossary, glossary.map((entry) => item("- ", `**${oneLine(entry.term)}**: ${entry.definition}`)));
  section(w.decisions, adrs.flatMap((adr) => [`### ${adr.id} ${oneLine(adr.title)}`, "", item(w.context, adr.context), item(w.decision, adr.decision), item(w.consequences, adr.consequences), ""]).slice(0, -1));
  out.push(`## ${w.rounds}`, "");
  if (valid.length === 0) out.push(w.none, "");
  for (const round of valid) {
    const answers = new Map((round.answers ?? []).map((answer) => [answer.id, answer.text]));
    out.push(`### ${w.round} ${round.roundNo}`, "");
    if (round.result!.questions.length === 0) out.push(w.noQuestions);
    for (const q of round.result!.questions) out.push(item("- ", `${q.id}: ${q.question}`), item(`  ${w.recommended}`, q.recommendedAnswer), item(`  ${w.answer}`, answers.get(q.id) ?? w.unanswered));
    out.push("");
  }
  const consensus = input.requirement.consensus;
  section(w.consensus, consensus === null ? [] : [
    `${w.roundLine}${consensus.roundNo}`, `${w.atLine}${consensus.at}`,
    ...(consensus.openBranches.length === 0 ? [] : [w.openBranches, ...consensus.openBranches.map((branch) => item("  - ", branch))]),
    ...(consensus.openQuestions.length === 0 ? [] : [w.openQuestions, ...consensus.openQuestions.map((question) => `  - ${question}`)]),
  ]);
  if (input.acceptedSplit !== null) {
    const rows = (latest?.acceptanceCriteria ?? []).map((c) => {
      const tasks = input.acceptedSplit!.tasks.filter((task) => task.traces.includes(c.id)).map((task) => task.taskId);
      return `| ${cell(c.id)} | ${tasks.length === 0 ? "—" : tasks.map(cell).join(", ")} |`;
    });
    out.push(`## ${w.split}`, "", `| ${w.criterion} | ${w.tasks} |`, "| --- | --- |", ...rows, "");
  }
  return out.join("\n");
}
