import { canonicalBytes } from "./canonicalJson.js";
import { FLOW_CALL_HANDLER, isFlowCallRun } from "../flow/calls.js";
import { buildEstimatePrompt, estimateResponseSchema, estimateTaskIds } from "./estimatePrompt.js";
import { classifyEstimateOutput, readEstimateContract } from "./estimator.js";
import { readEstimateRecord } from "./queries.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { MultiDirProjectOf } from "./multiGroup.js";
import type { SingleCallPurpose } from "./singleCall.js";
import type { ControlStore } from "./store.js";
import type { WorkspaceRoots } from "./workspace.js";
import { completeEstimateInStore, completeEstimateInTransaction } from "./estimateSettlement.js";
import { ControlError } from "./errors.js";
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
  /**
   * Dir-requirements spec §6.1 (Rule 17): the environment a dir group's vault is found by ($ORCA_VAULT_DIR), the panel's
   * own -- never os.homedir() at a call site. A dir group's call without it is blocked (repository-path).
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Multi-directory projects spec §6.3: the members of the multi-dir project a repo id names, for a member's display
   * name in the composed overview. Absent or null: the member is named by its key.
   */
  multiDirProjectOf?: MultiDirProjectOf;
}
export interface SingleCallHandler {
  readonly purpose: SingleCallPurpose;
  /** A2: the prompt, the hand-written response schema and the output cap -- or the reason the run is blocked at A2. */
  prepare(deps: SingleCallPrepareDeps, run: SingleCallRunRow): Promise<SingleCallRequest | { blocked: string }>;
  /** Ce, before the transaction: work that reads outside the store (the target repository); its result reaches `complete`. */
  evaluate?(deps: SingleCallPrepareDeps, run: SingleCallRunRow, rawOutput: unknown, failure?: string | null): Promise<unknown>;
  /** Ce: the purpose's own classifier of the raw output (code, never the model). */
  readonly classify: (...args: never[]) => unknown;
  /** Ce: settle the call and its run in one transaction; `commitTerminal` runs first, a throw rolls everything back. */
  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure?: string | null): void;
  /**
   * Spec 2026-10-27 single-call unknown usage §9 R2: `complete`'s core inside the caller's transaction (no gate, no
   * transaction of its own); `complete` wraps it. Absent: the purpose's call cannot be settled by a person (flow calls, R1).
   */
  completeInTransaction?(store: ControlStore, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure?: string | null): void;
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
    const taskIds = estimateTaskIds(estimate.request);
    return {
      prompt: buildEstimatePrompt(contract.instructionVersion, canonicalBytes(estimate.request).toString("utf8"), { taskIds, ...(contract.retryProblems ? { retryProblems: contract.retryProblems } : {}) }),
      responseSchema: estimateResponseSchema(contract.instructionVersion, taskIds),
      maxOutputTokens: contract.maxOutputTokens,
    };
  },
  classify: classifyEstimateOutput,
  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure: string | null = null): void {
    completeEstimateInStore(deps, run.groupId, String(run.estimateId), rawOutput, commitTerminal, ESTIMATE.classify, failure);
  },
  completeInTransaction(store: ControlStore, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure: string | null = null): void {
    completeEstimateInTransaction(store, run.groupId, String(run.estimateId), rawOutput, commitTerminal, ESTIMATE.classify, failure);
  },
  usageUnknownReason: "estimate-usage-unknown",
} as const satisfies SingleCallHandler;

/** Flow engine spec §6.2, §10.1: a `clarify` call is a requirement's or a flow clarify step's; its run row tells which. */
const CLARIFY_ANY: SingleCallHandler = {
  purpose: "clarify",
  prepare: (deps, run) => (isFlowCallRun(run) ? flowHandler("clarify") : CLARIFY_HANDLER).prepare(deps, run),
  classify: CLARIFY_HANDLER.classify,
  complete: (deps, run, rawOutput, commitTerminal, failure) => (isFlowCallRun(run) ? flowHandler("clarify") : CLARIFY_HANDLER).complete(deps, run, rawOutput, commitTerminal, failure),
  // Spec 2026-10-27 §9 R1: a flow clarify call is out of the settlement's scope; singleCallSettlement.ts never reaches it.
  completeInTransaction: (store, run, rawOutput, commitTerminal, failure) => {
    if (isFlowCallRun(run)) throw new ControlError("run-usage-not-settleable", "flow-call");
    CLARIFY_HANDLER.completeInTransaction!(store, run, rawOutput, commitTerminal, failure);
  },
  usageUnknownReason: CLARIFY_HANDLER.usageUnknownReason,
};
const flowHandler = (purpose: SingleCallPurpose): SingleCallHandler => ({ purpose, ...FLOW_CALL_HANDLER });

const HANDLERS: Readonly<Record<SingleCallPurpose, SingleCallHandler>> = Object.freeze({
  estimate: ESTIMATE, clarify: CLARIFY_ANY, split: SPLIT_HANDLER,
  "flow-draft": flowHandler("flow-draft"), "flow-review": flowHandler("flow-review"), "flow-ask": flowHandler("flow-ask"), "rerun-proposal": flowHandler("rerun-proposal"),
  "feedback-triage": flowHandler("feedback-triage"),
});

export function singleCallHandler(purpose: SingleCallPurpose): SingleCallHandler {
  return HANDLERS[purpose];
}
