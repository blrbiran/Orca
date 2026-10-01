import { canonicalBytes } from "./canonicalJson.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, buildEstimatePrompt } from "./estimatePrompt.js";
import { classifyEstimateOutput, readEstimateContract } from "./estimator.js";
import { readEstimateRecord } from "./queries.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { SingleCallPurpose } from "./singleCall.js";
import type { ControlStore } from "./store.js";
import type { WorkspaceRoots } from "./workspace.js";
import { completeEstimateInStore } from "./webService.js";
import { CLARIFY_HANDLER, SPLIT_HANDLER } from "./requirementCalls.js";

/**
 * N1 spec §5.1: each purpose registers four things -- build the request and prompt, the JSON schema, classify the output,
 * complete in the store. Claim plumbing, the protocol-3 envelope, steps A1/A2/B/Ce, the record check, accounting,
 * handoff-stop, stop intents and recovery are written once, in the driver, for every single call.
 */
export interface SingleCallRequest { prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }
export interface SingleCallRunRow { runId: string; groupId: string; workItemId: string; estimateId?: unknown; purpose?: unknown; [key: string]: unknown }
/** What A2 of a single call may use besides the store (phase 2's purposes read the target repository through it). */
export interface SingleCallPrepareDeps {
  store: ControlStore; roots: WorkspaceRoots; resolveRepository(repoId: string): string; ccloopBin: string; astGrepBin?: string | null;
  /** N1 spec §6: A2 of a requirement call stores its overview in its own admitted transaction. */
  admissionGate?: AdmissionGate;
}
export interface SingleCallHandler {
  readonly purpose: SingleCallPurpose;
  /** A2: the prompt, the hand-written response schema and the output cap -- or the reason the run is blocked at A2. */
  prepare(deps: SingleCallPrepareDeps, run: SingleCallRunRow): Promise<SingleCallRequest | { blocked: string }>;
  /** Ce, before the transaction: work that reads outside the store (the target repository); its result reaches `complete`. */
  evaluate?(deps: SingleCallPrepareDeps, run: SingleCallRunRow, rawOutput: unknown): Promise<unknown>;
  /** Ce: the purpose's own classifier of the raw output (code, never the model). */
  readonly classify: (...args: never[]) => unknown;
  /** Ce: settle the call and its run in one transaction; `commitTerminal` runs first, a throw rolls everything back. */
  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void): void;
  /** Ce: the block reason when the call's usage is not known (completion answered run-stop-unconfirmed). */
  readonly usageUnknownReason: string;
}

const ESTIMATE = {
  purpose: "estimate",
  async prepare(deps: SingleCallPrepareDeps, run: SingleCallRunRow): Promise<SingleCallRequest | { blocked: string }> {
    const estimateId = String(run.estimateId);
    const estimate = readEstimateRecord(deps.store, run.groupId, estimateId);
    if (estimate.request === null) return { blocked: "estimate-request-missing" };
    const contract = readEstimateContract(deps.store, run.groupId, estimateId);
    return {
      prompt: buildEstimatePrompt(contract.instructionVersion, canonicalBytes(estimate.request).toString("utf8")),
      responseSchema: BUDGET_ESTIMATE_JSON_SCHEMA as Record<string, unknown>,
      maxOutputTokens: contract.maxOutputTokens,
    };
  },
  classify: classifyEstimateOutput,
  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void): void {
    completeEstimateInStore(deps, run.groupId, String(run.estimateId), rawOutput, commitTerminal, ESTIMATE.classify);
  },
  usageUnknownReason: "estimate-usage-unknown",
} as const satisfies SingleCallHandler;

const HANDLERS: Readonly<Record<SingleCallPurpose, SingleCallHandler>> = Object.freeze({ estimate: ESTIMATE, clarify: CLARIFY_HANDLER, split: SPLIT_HANDLER });

export function singleCallHandler(purpose: SingleCallPurpose): SingleCallHandler {
  return HANDLERS[purpose];
}
