import { ControlError } from "./errors.js";

/**
 * Single-call estimate spec §4.2: the estimator's instruction, by the profile's `instructionVersion`. The prompt ccloop
 * hands the model is this text, one blank line, and the estimate request's canonical bytes -- assembled here and
 * nowhere else, so ccloop never rebuilds it (Web spec §5.4). The text tells the model the exact output contract of
 * `budgetEstimateSchema` (webProtocol.ts); changing either means a new instruction version, never an edit of "1".
 */
const INSTRUCTION_V1 = [
  "You are estimating the budget of a plan of software tasks before any of them runs. You cannot run, open, edit or inspect anything: you have no tools, and everything you may use is in the request below. Answer with one JSON object and nothing else.",
  "",
  "## The request",
  "",
  "After this instruction, separated from it by one blank line, comes one JSON object whose \"schema\" is \"budget-estimate-request-v1\". Its fields:",
  "- \"planHash\": the identity of the plan. Copy it into your answer exactly.",
  "- \"planSnapshotCanonicalJson\": a JSON document encoded as a string. Parse it. Its \"goal\" and \"successConditions\" describe the whole plan. Its \"tasks\" array lists the tasks in their order; each task has a \"taskId\", its \"dependencyTaskIds\", and \"originalContractCanonicalJson\": the task's contract, itself a JSON document encoded as a string (its objective, the paths it may change, its execution policy and how it is verified).",
  "- \"estimatorCapabilities.contextWindowTokens\": the context window, in tokens, of the agent that will do the work.",
  "- Every other field identifies this request. Ignore them.",
  "",
  "## What to estimate",
  "",
  "For each task, estimate what one agent will spend to finish it, as four whole numbers:",
  "- \"tokens\": every model token the task will consume, input and output, over every call and every attempt;",
  "- \"activeMs\": the wall-clock milliseconds the agent will be actively working;",
  "- \"attempts\": how many attempts the task will need;",
  "- \"sessions\": how many agent sessions it will need.",
  "Give two such amounts for each task: \"work\", for doing the task, and \"handoff\", for writing down where it stands if it is interrupted partway (usually a small part of work; its attempts and sessions may be 0).",
  "Give one more amount, \"goalReviewReserve\", for a single review of the finished plan against its goal and success conditions.",
  "Rate each task's \"complexity\" as one of \"S\", \"M\", \"L\", \"XL\", and your \"confidence\" in its numbers as one of \"low\", \"medium\", \"high\".",
  "Explain each task's numbers in \"rationale\" (one or two sentences) and list the facts you assumed in \"assumptions\". Explain the plan as a whole in \"groupRationale\".",
  "A person will read these numbers as advice and may apply them to the plan's budget. Estimate honestly: do not pad them to be safe and do not cut them to look cheap.",
  "",
  "## The answer",
  "",
  "Answer with exactly this object, with no other key at any level:",
  "{",
  "  \"schema\": \"budget-estimate-v1\",",
  "  \"planHash\": the request's planHash, unchanged,",
  "  \"tasks\": one entry for each task of the plan, in the same order as the plan's \"tasks\" array, none added and none left out, each",
  "    { \"taskId\": the task's taskId, unchanged,",
  "      \"complexity\": \"S\" | \"M\" | \"L\" | \"XL\",",
  "      \"confidence\": \"low\" | \"medium\" | \"high\",",
  "      \"work\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "      \"handoff\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "      \"rationale\": a non-empty string,",
  "      \"assumptions\": [ non-empty strings ] },",
  "  \"goalReviewReserve\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "  \"groupRationale\": a non-empty string",
  "}",
  "",
  "The answer is checked against these rules, and an answer that breaks any one of them is discarded whole:",
  "- every n is a whole number from 0 to 9007199254740991, with no fraction, no exponent and no minus sign;",
  "- \"assumptions\" has at least one entry, no entry appears twice, and the entries are sorted in ascending order by character code;",
  "- every string is non-empty;",
  "- \"planHash\" and every \"taskId\" are copied exactly, and \"tasks\" keeps the plan's order.",
].join("\n");

export const ESTIMATE_INSTRUCTIONS: Readonly<Record<string, string>> = Object.freeze({ "1": INSTRUCTION_V1 });

/** Spec §4.2: instruction, "\n\n", request bytes. An unknown version never reaches here (the preflight blocks it). */
export function buildEstimatePrompt(instructionVersion: string, requestCanonicalJson: string): string {
  if (!Object.hasOwn(ESTIMATE_INSTRUCTIONS, instructionVersion)) throw new ControlError("recovery-blocked", `estimate-instruction-unknown:${instructionVersion}`);
  return `${ESTIMATE_INSTRUCTIONS[instructionVersion]}\n\n${requestCanonicalJson}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const amount = (): Record<string, unknown> => ({
  type: "object",
  properties: { tokens: { type: "integer" }, activeMs: { type: "integer" }, attempts: { type: "integer" }, sessions: { type: "integer" } },
  required: ["tokens", "activeMs", "attempts", "sessions"],
  additionalProperties: false,
});

/**
 * Spec §6.2 (controller decision, accepted by the human): `budget-estimate-v1` as a hand-written JSON Schema, the
 * response schema of the single call. Drafter finding F9: only the keywords real claude has already taken (type,
 * properties, required, additionalProperties false, items, enum); bounds, hex shapes, non-empty strings, uniqueness and
 * order are left to budgetEstimateSchema, which the answer is checked with afterwards (classifyEstimateOutput).
 * estimateSchema.test.ts pins both what this refuses and what it leaves to zod.
 */
export const BUDGET_ESTIMATE_JSON_SCHEMA: Readonly<Record<string, unknown>> = deepFreeze({
  type: "object",
  properties: {
    schema: { type: "string", enum: ["budget-estimate-v1"] },
    planHash: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          work: amount(),
          handoff: amount(),
          rationale: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["taskId", "complexity", "confidence", "work", "handoff", "rationale", "assumptions"],
        additionalProperties: false,
      },
    },
    goalReviewReserve: amount(),
    groupRationale: { type: "string" },
  },
  required: ["schema", "planHash", "tasks", "goalReviewReserve", "groupRationale"],
  additionalProperties: false,
});
