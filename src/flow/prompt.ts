/**
 * Flow engine spec §12.1 and §4.3: every step prompt is built by code in one fixed envelope -- a stable role prefix, the
 * template's instruction (variables expanded once), code-generated pointers to the earlier active outputs, the
 * acceptance (gate checks, rubric), and, for `work` and `review`, the code-owned unattended fragment, which no template
 * can remove or reword.
 */

export const STEP_PROMPT_HEAD = "Orca flow step, instruction version 1.";

/** §4.3 rules 1-4, constant; changing it is a new instruction version. */
export const UNATTENDED_FRAGMENT = [
  "## Nobody is watching this step",
  "",
  "No person can answer you while this step runs. Skills you use may tell you to ask the user; instead:",
  "1. A question the skill would ask the user is answered from the run's inputs (the brief, earlier answers, the files in the workspace) when they answer it; otherwise take the recommended option and report that choice as a decision.",
  "2. A confirmation a skill requires before a side effect is given only by an Orca effect record id printed in this prompt; pass it to skills that take one (`--confirmed-by-orca <effect-record-id>`). Without one, stop before the side effect and report `flow.needs = {\"kind\": \"confirmation\", \"what\": ..., \"payloadSummary\": ...}` in your result.",
  "3. A question that has no recommended option: stop and report `flow.needs = {\"kind\": \"input\", \"question\": ..., \"candidates\": [...]}` in your result.",
  "4. When a skill would offer the user a choice (such as title candidates), pick the recommended one and list every candidate in your result under `flow.candidates.<name> = {\"items\": [at most 3], \"recommended\": <index>}`.",
  "",
].join("\n");

export interface StepPromptInput {
  role: string | null;
  instruction: string;
  /** One line (or block) per earlier active output, already bounded by the caller. */
  pointers: readonly string[];
  /** Gate commands and rubric lines. */
  acceptance: readonly string[];
  /** Feedback this execution must address (a review's findings, a person's answer), newest last. */
  feedback?: readonly string[];
  retryReason?: string | null;
  unattended: boolean;
}

export function buildStepPrompt(input: StepPromptInput): string {
  const blocks = [`${STEP_PROMPT_HEAD}\nRole: ${input.role ?? "agent"}.`, input.instruction.trimEnd()];
  if (input.pointers.length > 0) blocks.push(["## Earlier steps' outputs", "", ...input.pointers].join("\n"));
  if ((input.feedback ?? []).length > 0) blocks.push(["## Address this feedback", "", ...input.feedback!].join("\n"));
  if (input.acceptance.length > 0) blocks.push(["## Acceptance", "", ...input.acceptance.map((line) => `- ${line}`)].join("\n"));
  if (input.retryReason != null) blocks.push(`## Your previous answer was discarded\n\n${input.retryReason}`);
  if (input.unattended) blocks.push(UNATTENDED_FRAGMENT);
  return `${blocks.join("\n\n").trimEnd()}\n`;
}

/** Bound a text for a prompt or a record, recording the cut (spec §12.1 pointers; check output 64 KiB). */
export function bounded(text: string, maxBytes: number): { text: string; cut: number } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, cut: 0 };
  // Cut on a character boundary: decode the kept prefix and drop a trailing partial character.
  const kept = bytes.subarray(0, maxBytes).toString("utf8").replace(/�$/, "");
  return { text: kept, cut: bytes.length - Buffer.byteLength(kept, "utf8") };
}
