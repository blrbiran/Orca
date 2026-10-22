/**
 * Flow engine spec §4.1: the closed set of step kinds, each registered once in code (a duplicate fails at start-up,
 * R §6). A registration is `{kind, kindVersion, start, collect?, projection?, interactive}`; `kindVersion` is stored on
 * every execution row. It generalises SingleCallHandler (src/control/singleCallPurposes.ts), which stays the mechanism
 * under the single-call kinds: `start` says what to call, the kernel dispatches it, `collect` judges what came back.
 * The zod schema of each kind is the template schema's (src/flow/template/schema.ts), which drives validation and forms.
 */
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

/** Plan Task 8: the parent group's single-call purposes a flow uses (the driver-backed port registers them, Task 10). */
export const FLOW_CALL_PURPOSES = ["clarify", "flow-draft", "flow-review", "flow-ask", "rerun-proposal"] as const;

export interface CallSpec { purpose: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }
export interface RecordOutput { record: unknown; flags?: string[] }
/** What a kind's start or collect leads to; the kernel writes it (state, output, head) and dispatches calls. */
export type KindOutcome =
  | { call: CallSpec }
  | { done: RecordOutput & { revise?: { stepKey: string; feedback: string[] }; decisions?: Array<{ grade: "major" | "minor"; by: string; body: unknown }> } }
  | { failed: { reason: string; record?: unknown } }
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
export interface FlowRunBody {
  templateRef: string; params: Record<string, ParamValue>; roles: Record<string, RoleResolution>; clarify: "skip" | null; unattended: boolean;
  projectId: string | null; dir: string | null; vaultPath: string | null; importCommit: string | null; by: string; via: string; startedAt: number;
}
export interface ExecutionBody {
  basis: Record<string, number>; retries: number; retryReason: string | null; feedback: string[];
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
  env: NodeJS.ProcessEnv;
  now(): number;
}

export interface KindDefinition {
  readonly kind: string;
  readonly kindVersion: number;
  readonly interactive: boolean;
  start(ctx: KindContext): Promise<KindOutcome>;
  collect?(ctx: KindContext, rawOutput: unknown, failure: string | null): KindOutcome;
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

/** The phase-1 kinds this module registers (Task 9 adds `ask`, Task 10 `work`); a fresh registry per call. */
export function builtinKinds(): KindRegistry {
  const registry = createKindRegistry();
  for (const kind of [CLARIFY_KIND, DRAFT_KIND, CHECK_KIND, REVIEW_KIND]) registry.register(kind);
  return registry;
}

export type { FlowStep, FlowTemplate };
