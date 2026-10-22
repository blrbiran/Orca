/**
 * Gaps spec §4.4 (Rule 5, P7): which step takes a run-level feedback. Code bounds the candidates `T` and validates;
 * one single call, purpose `feedback-triage`, call key `{flowRunId, "@feedback", messageSeq}`, only classifies. Pure:
 * the prompt, the response schema and the validator; the intake driver (intake.ts) sends and settles the call.
 */
export const TRIAGE_PURPOSE = "feedback-triage";
export const TRIAGE_MAX_OUTPUT_TOKENS = 2_000;
/** §4.4 input bounds: each located passage with its neighbours, and the reading file for whole-article feedback. */
export const PASSAGE_MAX_BYTES = 2 * 1024;
export const READING_MAX_BYTES = 32 * 1024;

export const TRIAGE_JSON_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["targets"],
  properties: {
    targets: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["stepKey", "why"], properties: { stepKey: { type: "string" }, why: { type: "string" } } } },
    clarity: { type: "string", enum: ["concrete", "vague"] },
    restated: { type: "string" },
  },
});

export interface TriageCandidate { stepKey: string; kind: string; skills: readonly string[]; owns: readonly string[] }
export interface TriageInput {
  text: string;
  /** Each located passage: where, and the text with ±1 paragraph around it (bounded). */
  passages: ReadonlyArray<{ file: string; paragraph: number; headingPath: readonly string[]; context: string; cut: number }>;
  /** Whole-article feedback: the reading file, bounded with the cut recorded. */
  reading: { path: string; text: string; cut: number } | null;
  candidates: readonly TriageCandidate[];
  qa: ReadonlyArray<{ question: string; answer: string }>;
  attachments: readonly string[];
  mayBeVague: boolean;
  restatedRequired: boolean;
  lastInvalid: string | null;
}
export type TriageVerdict = { ok: true; targets: Array<{ stepKey: string; why: string }>; clarity: "concrete" | "vague" | null; restated: string | null } | { ok: false; why: string };

/** New copy (gaps plan Task 5; the human reviews it as a diff). */
export function triagePrompt(input: TriageInput): string {
  const lines = [
    "Orca feedback triage, instruction version 1.",
    "A person gave feedback on the result of a flow run. Code located what they pointed at (if anything) and listed the steps",
    "that may take the feedback (the candidates): the steps that produced an output up to the file the person reads. Choose the",
    "step or steps (1 to 3) whose revision would address the feedback, and give one short reason (`why`) for each. You cannot",
    "name a step that is not a candidate, and you cannot run, open or inspect anything.",
  ];
  if (input.mayBeVague) {
    lines.push(
      "Also judge the feedback (`clarity`): \"concrete\" when an editor could act on it as written; \"vague\" when it is only a feeling",
      "about the whole article that needs a short clarifying round with the person first.",
    );
  } else if (input.restatedRequired) {
    lines.push(
      "The person answered a short clarifying round (below). Write `restated`: the feedback as concrete, actionable instructions, in",
      "the person's language, built from their words and their answers. `clarity` must be \"concrete\" or left out.",
    );
  } else {
    lines.push("`clarity` may only be \"concrete\" or left out: take the person's words as they are.");
  }
  lines.push("Answer JSON {\"targets\": [{\"stepKey\", \"why\"}], \"clarity\"?: \"concrete\" | \"vague\", \"restated\"?: string}.", "", "## The person's feedback", "", input.text.trimEnd());
  if (input.passages.length > 0) {
    lines.push("", "## Located passages");
    for (const p of input.passages) {
      const where = p.headingPath.length === 0 ? "" : ` under «${p.headingPath.join(" › ")}»`;
      lines.push("", `### in \`${p.file}\`, paragraph ${p.paragraph}${where}`, "", p.context.trimEnd(), ...(p.cut > 0 ? [`[cut: ${p.cut} more bytes]`] : []));
    }
  }
  if (input.reading !== null) {
    lines.push("", `## The article as the person reads it (\`${input.reading.path}\`)`, "", input.reading.text.trimEnd(), ...(input.reading.cut > 0 ? [`[cut: ${input.reading.cut} more bytes]`] : []));
  }
  lines.push("", "## Candidates", ...input.candidates.map((c) => {
    const extra = [c.skills.length === 0 ? "" : `skills: ${c.skills.join(", ")}`, c.owns.length === 0 ? "" : `owns: ${c.owns.join("; ")}`].filter((s) => s !== "");
    return `- ${c.stepKey} (${c.kind})${extra.length === 0 ? "" : ` -- ${extra.join(" -- ")}`}`;
  }));
  if (input.qa.length > 0) lines.push("", "## The clarifying round", ...input.qa.flatMap((qa) => [`- Q: ${qa.question}`, `  A: ${qa.answer}`]));
  if (input.attachments.length > 0) lines.push("", "## Screenshots the person attached (names only; you cannot see them)", ...input.attachments.map((a) => `- ${a}`));
  if (input.lastInvalid !== null) lines.push("", `## Your previous answer was discarded\n\n${input.lastInvalid}`);
  return `${lines.join("\n")}\n`;
}

/** §4.4: every target a candidate, 1–3, no duplicates; `vague` only where allowed; `restated` when a round ran. */
export function validateTriage(raw: unknown, ctx: { candidates: readonly string[]; mayBeVague: boolean; restatedRequired: boolean }): TriageVerdict {
  const bad = (why: string): TriageVerdict => ({ ok: false, why });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("not-an-object");
  const out = raw as Record<string, unknown>;
  const extra = Object.keys(out).filter((k) => k !== "targets" && k !== "clarity" && k !== "restated");
  if (extra.length > 0) return bad(`unknown-field:${extra.join(",")}`);
  if (!Array.isArray(out.targets) || out.targets.length < 1 || out.targets.length > 3) return bad("targets: give 1 to 3");
  const targets: Array<{ stepKey: string; why: string }> = [];
  for (const t of out.targets as unknown[]) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) return bad("targets: each is {stepKey, why}");
    const { stepKey, why, ...rest } = t as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof stepKey !== "string" || typeof why !== "string" || why.trim() === "") return bad("targets: each is {stepKey, why} with a reason");
    if (!ctx.candidates.includes(stepKey)) return bad(`target-not-candidate:${stepKey}`);
    if (targets.some((x) => x.stepKey === stepKey)) return bad(`duplicate-target:${stepKey}`);
    targets.push({ stepKey, why });
  }
  const clarity = out.clarity === undefined ? null : out.clarity;
  if (clarity !== null && clarity !== "concrete" && clarity !== "vague") return bad("clarity: concrete or vague");
  if (clarity === "vague" && !ctx.mayBeVague) return bad("vague-not-allowed: only a whole-article feedback's first triage may be vague");
  const restated = out.restated === undefined ? null : out.restated;
  if (restated !== null && (typeof restated !== "string" || restated.trim() === "")) return bad("restated: a non-empty string");
  if (ctx.restatedRequired && restated === null) return bad("restated-missing: write the feedback as concrete instructions");
  return { ok: true, targets, clarity: clarity as "concrete" | "vague" | null, restated: restated as string | null };
}
