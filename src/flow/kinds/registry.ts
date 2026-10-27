/**
 * Flow engine spec §4.1: the closed set of step kinds, each registered once in code (a duplicate fails at start-up,
 * R §6). A registration is `{kind, kindVersion, start, collect?, projection?, interactive}`; `kindVersion` is stored on
 * every execution row. It generalises SingleCallHandler (src/control/singleCallPurposes.ts), which stays the mechanism
 * under the single-call kinds: `start` says what to call, the kernel dispatches it, `collect` judges what came back.
 * The zod schema of each kind is the template schema's (src/flow/template/schema.ts), which drives validation and forms.
 */
import type { SkillLock } from "../journal/fingerprint.js";
import type { FlowNeeds } from "../../control/reportedDecisions.js";
import type { ControlStore } from "../../control/store.js";
import type { FlowStep, FlowTemplate } from "../template/schema.js";
import type { ParamValue } from "../template/when.js";
import type { ExecutionKey, ExecutionRow, FlowRunRow } from "../store.js";
import type { Vault } from "../vault/vault.js";
import { CHECK_KIND } from "./check.js";
import { CLARIFY_KIND } from "./clarify.js";
import { DRAFT_KIND } from "./draft.js";
import { REVIEW_KIND } from "./review.js";
import { ASK_KIND } from "./ask.js";
import { WORK_KIND, type FlowChildPort, type FlowChildStatus } from "./work.js";

/** Plan Task 8: the parent group's single-call purposes a flow uses (the driver-backed port registers them, Task 10). */
export const FLOW_CALL_PURPOSES = ["clarify", "flow-draft", "flow-review", "flow-ask", "rerun-proposal", "feedback-triage"] as const;

export interface CallSpec { purpose: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }
export interface RecordOutput { record: unknown; flags?: string[] }
/** What a kind's start or collect leads to; the kernel writes it (state, output, head) and dispatches calls. */
export type KindOutcome =
  | { call: CallSpec }
  | { done: RecordOutput & {
      revise?: { stepKey: string; feedback: string[] };
      decisions?: Array<{ grade: "major" | "minor"; by: string; body: unknown }>;
      /** A workspace output (§5.3): a vault commit on `parent`; the record, if any, is kept in the body. */
      commit?: { commit: string; parent: string };
      /** §4.3 rule 4: what the agent reported for later `ask` steps (`candidatesFrom`). */
      reported?: { candidates?: Record<string, { items: string[]; recommended: number }>; effect?: { remoteId: string; url?: string } };
      /** §12.2 phase 1: the skills the execution actually ran with; its definition hash is recomputed with their content_md5. */
      skillLocks?: SkillLock[];
      /** Run-page warnings (never a refusal), e.g. a skill lock that is not at the template's pinned ref. */
      warnings?: string[];
    } }
  | { failed: { reason: string; record?: unknown; flags?: string[] } }
  /** §6.2: a `work` execution's child group is open; the kernel reads how it settles through the child port. */
  | { dispatched: { childGroupId: string; baseCommit: string } }
  /** §6.3: the run cannot go on until a person acts (`flow-pool-exhausted`); only this run waits. */
  | { parked: { reason: string; detail?: unknown } }
  /** The step waits for a person (an open ask, a clarify round's answers); parks itself and later steps (§8.2). */
  | { waiting: { ask: unknown } }
  /** §4.3: the agent reported `flow.needs`. */
  | { needs: FlowNeeds }
  /** The output broke the kind's schema: the existing retry path (at most MAX_AUTO_RETRIES, then failed). */
  | { invalid: string };

export interface LoadedRun {
  row: FlowRunRow;
  template: FlowTemplate;
  assets: Readonly<Record<string, string>>;
  params: Readonly<Record<string, ParamValue>>;
  body: FlowRunBody;
}
export interface RoleResolution { agent: string; model: string | null; source: "project" | "global" | "template" | "default" }
/** Live transcript spec §10.5.1: the pause a flow run is waiting on, with one entry per running work child. */
export interface FlowPauseStep {
  stepKey: string; seq: number; childGroupId: string; acceptedAt: string; deadlineAt: string;
  /** `note`: the pause took over the stop a note had already placed on this child, so its marker is the note's. */
  stop?: "note";
}
export interface FlowPauseIntent { messageSeq: number; at: string; steps: FlowPauseStep[] }
/** Live transcript spec §10.5.2 (plan D6): the note recorded on the work execution that received it. */
export interface OperatorNoteEntry {
  seq: number; by: string; at: string; text: string; scope: "next-attempt" | "remaining-attempts";
  /** The continuation runs the note was delivered to (a `remaining-attempts` one stays pending). */
  deliveredTo?: string[]; consumedAt?: string;
  /** Why a consumed note never reached the agent (its child settled before the boundary); absent: it was delivered. */
  undelivered?: string;
}
/** Live transcript spec §10.5.2 (plan D6): the step a note owes a boundary delivery; `seq` is the execution's. */
export interface FlowNoteStep { stepKey: string; seq: number; childGroupId: string; acceptedAt: string; deadlineAt: string }
export interface FlowNoteIntent { steps: FlowNoteStep[] }
export interface FlowRunBody {
  templateRef: string; params: Record<string, ParamValue>; roles: Record<string, RoleResolution>; clarify: "skip" | null; unattended: boolean;
  projectId: string | null; dir: string | null; vaultPath: string | null; importCommit: string | null; by: string; via: string; startedAt: number;
  /** Gaps spec §8.1: each `image` param as stored at start or at its last `params` change (absent: none). */
  images?: Record<string, { source: string; sha256: string; ext: "png" | "jpg" | "gif" | "webp" }>;
  /** §8 step 2: a scheduled fire's schedule and slot (absent: a hand start). */
  origin?: { kind: "schedule"; scheduleId: string; slot: number };
  /** Live transcript spec §10.5.1: the stops a pause placed on the run's running work children (absent: no pause). */
  pauseIntent?: FlowPauseIntent;
  /** Live transcript spec §10.5.2: the boundary deliveries accepted notes owe (absent: none). */
  noteIntent?: FlowNoteIntent;
  /** The last error a pump pass met advancing this run (other runs went on); cleared by the next clean pass. */
  lastError?: { message: string; at: number };
}
export interface ExecutionBody {
  basis: Record<string, number>; retries: number; retryReason: string | null; feedback: string[];
  /** Live transcript spec §10.5.2 (plan D6): the notes this execution received, oldest first (absent: none). */
  operatorNotes?: OperatorNoteEntry[];
  call?: { purpose: string }; failure?: string; flags?: string[]; ask?: unknown; [key: string]: unknown;
}

export interface KindContext {
  store: ControlStore;
  run: LoadedRun;
  step: FlowStep;
  key: ExecutionKey;
  execution: ExecutionRow;
  body: ExecutionBody;
  /** The kernel's envelope (spec §12.1) for this execution; `override` replaces the instruction or acceptance lines. */
  prompt(override?: { instruction?: string; acceptance?: string[] }): string;
  /** The text of a template asset (prompt, background, rubric), as stored with the run. */
  asset(rel: string): string;
  /** The composition this execution starts from (§5.3); null for a run without a workspace import. */
  composition(): Promise<{ vault: Vault; commit: string } | null>;
  /** The active output record of an earlier step, or null. */
  recordOf(stepKey: string): unknown | null;
  /** Earlier executions of every step (the journal so far). */
  executions(): ExecutionRow[];
  runCommand(command: string, cwd: string): Promise<{ exitCode: number; output: string }>;
  /** §6.2: the driver-backed child groups (`work`); null where no driver is wired. */
  children: FlowChildPort | null;
  /** §12.3: the installations the panel can run, in the table's order (the first is today's default selection). */
  agents?(): ReadonlyArray<{ agent: string; model: string | null }>;
  env: NodeJS.ProcessEnv;
  now(): number;
}

export interface KindDefinition {
  readonly kind: string;
  readonly kindVersion: number;
  readonly interactive: boolean;
  start(ctx: KindContext): Promise<KindOutcome>;
  collect?(ctx: KindContext, rawOutput: unknown, failure: string | null): KindOutcome | Promise<KindOutcome>;
  /** A call that failed before any output (ccloop's code): what the kind records of it; the kernel retries as for invalid. */
  callFailed?(ctx: KindContext, failure: string): void;
  /** A child-group kind (`work`): what its settled child means for the step. */
  settle?(ctx: KindContext, status: Exclude<FlowChildStatus, { state: "running" }>, baseCommit: string): KindOutcome | Promise<KindOutcome>;
  /** A record's summary for later steps' pointers (§12.1). */
  projection?(record: unknown): string;
}

export interface KindRegistry {
  register(kind: KindDefinition): void;
  get(kind: string): KindDefinition | undefined;
}

export function createKindRegistry(): KindRegistry {
  const kinds = new Map<string, KindDefinition>();
  return {
    register(kind) {
      if (kinds.has(kind.kind)) throw new Error(`orca: duplicate kind ${kind.kind} in the flow kind registry`);
      kinds.set(kind.kind, kind);
    },
    get: (kind) => kinds.get(kind),
  };
}

/** The phase-1 kinds; a fresh registry per call. */
export function builtinKinds(): KindRegistry {
  const registry = createKindRegistry();
  for (const kind of [CLARIFY_KIND, DRAFT_KIND, WORK_KIND, CHECK_KIND, REVIEW_KIND, ASK_KIND]) registry.register(kind);
  return registry;
}

export type { FlowStep, FlowTemplate, FlowChildPort, FlowChildStatus };
