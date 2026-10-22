/**
 * Flow engine spec §2, §4, §6, §8.2, §12 (plan Task 8): the flow kernel. Code decides everything here -- which step is
 * ready (template order, `when`, `parallelWith`), what each execution starts from, what a call's output means, where
 * the active pointer moves (Rule 5, P7); the model only drafts, reviews and clarifies through the kinds' calls.
 *
 * A run is a parent group (§6.1, 1:1). Each step key has executions numbered `seq`; the newest is the one the kernel
 * acts on and `step_heads` names the active output. A step whose newest execution is done (or skipped) on the same
 * earlier active outputs it started from (its `basis`) is satisfied; one whose earlier outputs moved since runs again
 * (the conservative default of §7.2; the re-run planner of Task 11 narrows it). A needs-person or parked execution
 * parks only its step and the steps after it in order; a `parallelWith` sibling continues (§8.2). A failed execution
 * stops the run at that step. A running step is never interrupted: everything here happens at step boundaries.
 *
 * Calls go out through `deps.calls` and come back through `completeFlowCall` (the single-call settlement's hook; the
 * driver-backed port on the parent group's pool is Task 10's).
 */
import { recordProjectionChange } from "../control/projectionJournal.js";
import { randomUUID } from "node:crypto";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../control/snapshot.js";
import { MAX_AUTO_RETRIES } from "../control/requirementSchemas.js";
import type { FlowNeeds } from "../control/reportedDecisions.js";
import type { ControlStore } from "../control/store.js";
import { definitionHash, outputHashOfCommit, outputHashOfRecord, type SkillLock } from "./journal/fingerprint.js";
import { runShell } from "./kinds/check.js";
import { builtinKinds, type ExecutionBody, type FlowRunBody, type KindContext, type KindDefinition, type KindOutcome, type KindRegistry, type LoadedRun, type RoleResolution } from "./kinds/registry.js";
import { buildStepPrompt, bounded } from "./prompt.js";
import {
  appendExecution, appendFlowDecision, appendMessage, finishExecution, getFlowRun, getHead, insertFlowRun, listExecutions, listFlowRunIds, listHeads, setDefinitionHash, setFlowRunState, setHead,
  type ExecutionKey, type ExecutionRow, type ExecutionState,
} from "./store.js";
import { isInsidePath } from "./template/checklist.js";
import { loadBuiltin } from "./template/load.js";
import type { FlowStep, FlowTemplate } from "./template/schema.js";
import { deriveParam, expandKeepingSkillDirs } from "./template/vars.js";
import { evaluateWhen, type ParamValue } from "./template/when.js";
import { returnUnspent } from "./pool.js";
import type { FlowChildPort } from "./kinds/work.js";
import { activeOutputs, advanceHead, advanceHeadWithRetry, compose, type ExecutionOutput } from "./vault/compose.js";
import { changesBetween, copyBack } from "./vault/copyBack.js";
import { DEFAULT_CAPS, importSnapshot } from "./vault/snapshot.js";
import { openVault, type Vault } from "./vault/vault.js";
import { vaultKeyOf } from "./vault/paths.js";
import { flowVaultRepoId } from "./groups.js";
import { parentGroupBody, type FlowParentConfirmation } from "./parent.js";
import type { FlowCallResult } from "./calls.js";
import { completePlanCall, finishPlan, planOf, PLAN_KEY } from "./rerun.js";
import { flowLayers, readFlowSettings } from "./settings.js";
import { gateEffect, settleEffect } from "./effects.js";
import { consumeAtBoundary } from "./messages.js";

/** A refusal by name (spec §14, Global Constraints' codes); nothing was written. */
export class FlowRefusal extends Error {
  constructor(public readonly code: string, detail = "") {
    super(detail === "" ? code : `${code}: ${detail}`);
    this.name = "FlowRefusal";
  }
}

export interface FlowCallRequest { key: ExecutionKey; groupId: string; purpose: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }
export interface FlowCallPort { request(req: FlowCallRequest): void }
export interface AgentCandidate { agent: string; model: string | null; tier: "low" | "mid" | "high" }
export interface RoleChoice { agent: string; model?: string }

export interface FlowDeps {
  store: ControlStore;
  now(): number;
  /** ORCA_VAULT_DIR and every other path redirect (Rule 17); never os.homedir() at a call site. */
  env: NodeJS.ProcessEnv;
  calls: FlowCallPort;
  /** The agents this machine can run, today's default selection first (src/control/agentSelection.ts). */
  agents(): AgentCandidate[];
  /** §12.3: `flows.roles` of the project and global settings layers (Task 12 supplies them; absent: none). */
  roleSettings?(projectId: string | null): { project?: Record<string, RoleChoice>; global?: Record<string, RoleChoice> };
  builtinRoot?: string;
  registry?: KindRegistry;
  runCommand?(command: string, cwd: string): Promise<{ exitCode: number; output: string }>;
  /** §6.2: the driver-backed child groups `work` steps run in (absent: a `work` step fails `work-port-unavailable`). */
  children?: FlowChildPort;
  /**
   * §6.2-§6.3: what the parent is confirmed with at start (the panel freezes the call profile and slot and the children's
   * profiles; a FlowRefusal refuses the start). Absent: confirmed with neither (a criterion's fake ports serve the run).
   */
  /** §7.4, §11.2: `flows.rerunReview` of a project; absent: read from the settings layers. */
  rerunReview?(projectId: string | null): "auto" | "review";
  confirmParent?(input: { flowRunId: string; groupId: string; projectId: string | null; by: string }): Promise<FlowParentConfirmation>;
}

/** Spec §4.3: the kinds whose prompts carry the unattended fragment. */
const UNATTENDED_KINDS: ReadonlySet<string> = new Set(["work", "review"]);
/** Global Constraints default: the run pool when nothing sets one (settings arrive with Task 12). */
export const DEFAULT_TOKENS_PER_RUN = 2_000_000;
const POINTER_MAX_BYTES = 16 * 1024;

let defaultRegistry: KindRegistry | null = null;
const registryOf = (deps: FlowDeps): KindRegistry => deps.registry ?? (defaultRegistry ??= builtinKinds());

// ---------------------------------------------------------------------------------------------------------------- start

export interface StartFlowInput {
  templateRef: string;
  projectId?: string;
  dir?: string;
  params: Record<string, ParamValue>;
  clarify?: "skip";
  pool?: number;
  unattended?: boolean;
  by: string;
  via: string;
}

const TIER_RANK = { low: 0, mid: 1, high: 2 } as const;

/** Spec §3.2 param types, checked at start; `derive` and `default` fill what was not given. */
function resolveParams(template: FlowTemplate, given: Record<string, ParamValue>, now: Date): Record<string, ParamValue> {
  const declared = template.params ?? {};
  for (const id of Object.keys(given)) if (!(id in declared)) throw new FlowRefusal(`flow-param-invalid:${id}`, "not a parameter of the template");
  const out: Record<string, ParamValue> = {};
  for (const [id, param] of Object.entries(declared)) {
    let value = given[id] ?? (param.derive === undefined ? undefined : deriveParam(param.derive, { ...given, ...out }, now)) ?? param.default;
    if (value === undefined) {
      if (param.required === true) throw new FlowRefusal(`flow-param-invalid:${id}`, "required");
      continue;
    }
    const bad = (why: string): never => { throw new FlowRefusal(`flow-param-invalid:${id}`, why); };
    switch (param.type) {
      case "text": case "longtext": if (typeof value !== "string") bad("must be text"); break;
      case "bool": if (typeof value !== "boolean") bad("must be true or false"); break;
      case "int": if (typeof value !== "number" || !Number.isInteger(value)) bad("must be an integer"); break;
      case "enum": if (!param.options!.includes(String(value))) bad(`must be one of ${param.options!.join(", ")}`); value = String(value); break;
      case "slug": if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) bad("must be a slug"); break;
      // Review Focus 1-2: a path stays inside the workspace and holds no quote, NUL or newline.
      case "path": if (typeof value !== "string" || !isInsidePath(value) || value.includes("'")) bad("must be a workspace-relative path"); break;
    }
    out[id] = value;
  }
  return out;
}

/**
 * Spec §12.3: project → global → template `suggest` → today's default selection, each filtered by `tier` and
 * `distinctFrom`; nothing matching ⇒ `role-unresolved:<role>`, never a borrowed agent. Roles without `distinctFrom` first.
 */
function resolveRoles(deps: FlowDeps, template: FlowTemplate, projectId: string | null): Record<string, RoleResolution> {
  const roles = template.roles ?? {};
  const available = deps.agents();
  // §12.3: the `flows.roles` of the project and global settings layers (§11.2), unless the caller supplies them.
  const settings = deps.roleSettings?.(projectId) ?? (() => { const layers = flowLayers(deps.store, projectId); return { project: layers.project?.roles, global: layers.global?.roles }; })();
  const out: Record<string, RoleResolution> = {};
  const order = Object.keys(roles).sort((a, b) => Number(roles[a]!.distinctFrom !== undefined) - Number(roles[b]!.distinctFrom !== undefined));
  for (const name of order) {
    const role = roles[name]!;
    const other = role.distinctFrom === undefined ? null : out[role.distinctFrom] ?? null;
    const fits = (c: AgentCandidate): boolean => TIER_RANK[c.tier] >= TIER_RANK[role.tier]
      && (other === null || c.agent !== other.agent || c.model !== other.model);
    const pick = (choice: { agent?: string; model?: string } | undefined): AgentCandidate | null => {
      if (choice?.agent === undefined) return null;
      return available.find((c) => c.agent === choice.agent && (choice.model === undefined || c.model === choice.model) && fits(c)) ?? null;
    };
    const sources: Array<[RoleResolution["source"], AgentCandidate | null]> = [
      ["project", pick(settings.project?.[name])], ["global", pick(settings.global?.[name])], ["template", pick(role.suggest)],
      ["default", available[0] !== undefined && fits(available[0]) ? available[0] : null],
    ];
    const found = sources.find(([, candidate]) => candidate !== null);
    if (found === undefined) throw new FlowRefusal(`role-unresolved:${name}`);
    out[name] = { agent: found[1]!.agent, model: found[1]!.model, source: found[0] };
  }
  return out;
}

/** Every asset a step names (prompt, background, rubric), read once and stored with the run (§6.1 `artifacts`). */
function assetsOf(template: FlowTemplate, read: (rel: string) => string): Record<string, string> {
  const paths = new Set<string>();
  for (const step of template.steps) {
    if ("prompt" in step && step.prompt !== undefined) paths.add(step.prompt);
    if (step.kind === "clarify" && step.background !== undefined) paths.add(step.background);
    if (step.kind === "review" && step.rubric !== undefined) paths.add(step.rubric);
  }
  return Object.fromEntries([...paths].sort().map((rel) => [rel, read(rel)]));
}

export async function startFlowRun(deps: FlowDeps, input: StartFlowInput): Promise<{ flowRunId: string; groupId: string }> {
  const match = /^builtin\/([a-z0-9][a-z0-9-]*)(?:@\d+)?$/.exec(input.templateRef);
  if (match === null) throw new FlowRefusal("flow-template-invalid", `${input.templateRef} is not a built-in template (phase 1 ships built-ins only)`);
  let loaded: ReturnType<typeof loadBuiltin>;
  try { loaded = loadBuiltin(match[1]!, deps.builtinRoot); }
  catch (error) { throw new FlowRefusal("flow-template-invalid", (error as Error).message); }
  const template = loaded.template;
  const params = resolveParams(template, input.params, new Date(deps.now()));
  const run = deps.runCommand ?? ((command: string, cwd: string) => runShell(command, cwd, deps.env.PATH === undefined ? process.env : { ...process.env, ...deps.env }));
  for (const command of template.requires?.commands ?? []) {
    const result = await run(command.check, input.dir ?? process.cwd());
    if (result.exitCode !== 0) throw new FlowRefusal(`flow-command-missing:${command.name}`, `\`${command.check}\` exited ${result.exitCode}`);
  }
  const projectId = input.projectId ?? null;
  const roles = resolveRoles(deps, template, projectId);
  const id = randomUUID();
  const flowRunId = `fr-${id}`;
  const groupId = `flow-${id}`;
  // §6.3: confirmed once, before anything is written (a refusal leaves no vault import either).
  const confirmation: FlowParentConfirmation = deps.confirmParent === undefined ? { call: null, children: null } : await deps.confirmParent({ flowRunId, groupId, projectId, by: input.by });
  // §5.2: the person's folder is imported into its vault; the import is the base of every composition.
  let vault: Vault | null = null;
  let importCommit: string | null = null;
  if (input.dir !== undefined) {
    vault = await openVault(deps.env, input.dir, { excludes: template.workspace.excludes ?? [] });
    importCommit = (await importSnapshot(vault, input.dir, { flowRunId, caps: DEFAULT_CAPS })).commit;
    await advanceHead(vault, flowRunId, null, importCommit);
  }
  const stored = { template, assets: assetsOf(template, (rel) => loaded.assets.read(rel)) };
  const templateHash = sha256Canonical(stored);
  const body: FlowRunBody = {
    templateRef: input.templateRef, params, roles, clarify: input.clarify ?? null, unattended: input.unattended ?? false, projectId, dir: vault?.dir ?? null,
    vaultPath: vault?.path ?? null, importCommit, by: input.by, via: input.via, startedAt: deps.now(),
  };
  const vaultId = vault === null ? null : vaultKeyOf(vault.dir);
  // §6.3: the pool is project ?? global ?? the template's suggestion ?? the built-in default (a start's `pool` is the person's).
  const configured = readFlowSettings(deps.store, projectId).budgets.tokensPerRun;
  const poolTokens = input.pool ?? (configured.source !== "builtin" ? configured.value : template.budget?.tokensPerRun ?? DEFAULT_TOKENS_PER_RUN);
  deps.store.transaction(() => {
    // The parent group (§6.2 body block `flow`), confirmed once by orca-auto with the run pool (§6.3); no plan, no tasks.
    // At revision 1 with its projection recorded, as a group its creating command leaves (a shutdown lists its versions).
    deps.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,?,0,?)").run(groupId, 1, 1, JSON.stringify(parentGroupBody({
      groupId, flowRunId, projectId, workspaceKind: template.workspace.kind, vaultId, repoId: vaultId === null ? projectId : flowVaultRepoId(vaultId),
      poolTokens, confirmation, at: deps.now(), goal: `Flow run ${flowRunId} (${input.templateRef})`,
    })));
    recordProjectionChange(deps.store, [groupId]);
    writeCanonicalRecord(deps.store, groupId, templateHash, canonicalBytes(stored).toString("utf8"));
    insertFlowRun(deps.store, {
      id: flowRunId, groupId, templateRef: input.templateRef, templateSha256: templateHash, workspace: { projectId, kind: template.workspace.kind },
      vaultId, paramsSha256: sha256Canonical(params), poolTokens, poolDrawn: 0, state: "running", revision: 0, body,
    });
  });
  return { flowRunId, groupId };
}

// ---------------------------------------------------------------------------------------------------------- load + ctx

export function loadRun(store: ControlStore, flowRunId: string): LoadedRun {
  const row = getFlowRun(store, flowRunId);
  if (row === null) throw new FlowRefusal("flow-run-not-found", flowRunId);
  const stored = JSON.parse(readCanonicalRecord(store, row.templateSha256)) as { template: FlowTemplate; assets: Record<string, string> };
  const body = row.body as FlowRunBody;
  return { row, template: stored.template, assets: stored.assets, params: body.params, body };
}

export function stepOf(run: LoadedRun, stepKey: string): FlowStep {
  const step = run.template.steps.find((s) => s.id === stepKey);
  if (step === undefined) throw new FlowRefusal("flow-step-not-found", stepKey);
  return step;
}

export const latestByStep = (executions: readonly ExecutionRow[]): Map<string, ExecutionRow> => {
  const out = new Map<string, ExecutionRow>();
  for (const e of executions) { const seen = out.get(e.stepKey); if (seen === undefined || seen.seq < e.seq) out.set(e.stepKey, e); }
  return out;
};

export function recordOfExecution(store: ControlStore, execution: ExecutionRow | undefined): unknown | null {
  if (execution === undefined || execution.outputKind !== "artifact" || execution.outputRef === null) return null;
  return JSON.parse(readCanonicalRecord(store, execution.outputRef));
}

export function vaultOf(run: LoadedRun): Vault | null {
  return run.body.vaultPath === null || run.body.dir === null ? null : { path: run.body.vaultPath, dir: run.body.dir };
}

/** §5.3: the composition `stepKey` starts from -- the import plus every earlier step's active commit output. */
export async function compositionFor(store: ControlStore, run: LoadedRun, stepKey: string | null): Promise<{ vault: Vault; commit: string } | null> {
  const vault = vaultOf(run);
  if (vault === null || run.body.importCommit === null) return null;
  const commits: ExecutionOutput[] = listExecutions(store, run.row.id).filter((e) => e.outputKind === "commit" && e.outputRef !== null)
    .map((e) => ({ stepKey: e.stepKey, seq: e.seq, commit: e.outputRef!, parent: String((e.body as { parent?: string }).parent ?? e.baseCommit) }));
  // Record outputs (clarify, draft, check, review) are not in the workspace: only heads on commit outputs compose.
  const heads = Object.fromEntries(Object.entries(listHeads(store, run.row.id)).filter(([key, seq]) => commits.some((c) => c.stepKey === key && c.seq === seq)));
  const composed = await compose(vault, run.body.importCommit, activeOutputs(commits, heads, run.template.steps.map((s) => s.id), stepKey));
  if ("conflict" in composed) throw new FlowRefusal("compose-conflict", composed.conflict);
  return { vault, commit: composed.commit };
}

function kindFor(deps: FlowDeps, step: FlowStep): KindDefinition | undefined { return registryOf(deps).get(step.kind); }

export function contextFor(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow): KindContext {
  const step = stepOf(run, execution.stepKey);
  const body = execution.body as ExecutionBody;
  const asset = (rel: string): string => {
    const text = run.assets[rel];
    if (text === undefined) throw new Error(`orca: asset ${rel} is not stored with run ${run.row.id}`);
    return text;
  };
  const executions = () => listExecutions(deps.store, run.row.id);
  const pointers = (): string[] => {
    const heads = listHeads(deps.store, run.row.id);
    const all = executions();
    const out: string[] = [];
    for (const earlier of run.template.steps.slice(0, run.template.steps.findIndex((s) => s.id === step.id))) {
      const seq = heads[earlier.id];
      if (seq === undefined) continue;
      const exec = all.find((e) => e.stepKey === earlier.id && e.seq === seq);
      if (exec === undefined) continue;
      let summary: string;
      if (exec.outputKind === "artifact") {
        const record = recordOfExecution(deps.store, exec);
        const projection = kindFor(deps, earlier)?.projection;
        summary = projection === undefined ? JSON.stringify(record) : projection(record);
      } else if (exec.outputKind === "commit") summary = `workspace commit ${exec.outputRef}`;
      else continue;
      const cut = bounded(summary, POINTER_MAX_BYTES);
      out.push(`### ${earlier.id} (${earlier.kind}, execution ${seq})\n${cut.text}${cut.cut > 0 ? `\n[cut: ${cut.cut} more bytes]` : ""}`);
    }
    return out;
  };
  const instructionOf = (): string => {
    if (!("prompt" in step) || step.prompt === undefined) return "";
    // §12.1: a declared parameter the run left unset reads empty in a prompt (never in a command); the workspace is the
    // agent's working directory; a skill's directory is filled when its copy is injected (the driver's A2).
    const unset = Object.fromEntries(Object.keys(run.template.params ?? {}).map((id) => [id, ""]));
    return expandKeepingSkillDirs(asset(step.prompt), {
      params: { ...unset, ...run.params }, runId: run.row.id, workspace: ".",
      ...(typeof body.effectRecordId === "string" ? { effectRecordId: body.effectRecordId } : {}),
    }, "prompt", "skills" in step ? step.skills ?? [] : []);
  };
  const acceptanceOf = (): string[] => step.kind === "work" ? (step.acceptance?.checks ?? []).filter((c) => c.role === "gate").map((c) => `gate: ${c.run}`) : [];
  return {
    store: deps.store, run, step, key: { flowRunId: execution.flowRunId, stepKey: execution.stepKey, seq: execution.seq }, execution, body,
    prompt: (override = {}) => buildStepPrompt({
      role: "role" in step ? step.role ?? null : null,
      instruction: override.instruction ?? instructionOf(),
      pointers: pointers(),
      acceptance: override.acceptance ?? acceptanceOf(),
      feedback: body.feedback,
      retryReason: body.retryReason,
      unattended: UNATTENDED_KINDS.has(step.kind),
    }),
    asset,
    composition: () => compositionFor(deps.store, run, step.id),
    recordOf: (stepKey) => { const seq = getHead(deps.store, run.row.id, stepKey); return seq === null ? null : recordOfExecution(deps.store, executions().find((e) => e.stepKey === stepKey && e.seq === seq)); },
    executions,
    runCommand: deps.runCommand ?? ((command, cwd) => runShell(command, cwd)),
    children: deps.children ?? null,
    env: deps.env,
    now: deps.now,
  };
}

// ------------------------------------------------------------------------------------------------------------- outcomes

export function writeRecord(store: ControlStore, groupId: string, record: unknown): string {
  const hash = sha256Canonical(record);
  writeCanonicalRecord(store, groupId, hash, canonicalBytes(record).toString("utf8"));
  return hash;
}

/**
 * Write what a kind decided: state, output, head, follow-ups -- in one transaction -- then send the call it asked for.
 * `from` is the execution's state as the caller read it (the store refuses a stale one).
 */
export async function applyOutcome(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow, from: ExecutionState, outcome: KindOutcome): Promise<void> {
  const key: ExecutionKey = { flowRunId: execution.flowRunId, stepKey: execution.stepKey, seq: execution.seq };
  const body = execution.body as ExecutionBody;
  const at = deps.now();
  const step = stepOf(run, key.stepKey);
  if ("invalid" in outcome) {
    if (body.retries >= MAX_AUTO_RETRIES) {
      return applyOutcome(deps, run, execution, from, { failed: { reason: `${step.kind}-output-invalid`, record: { lastInvalidReason: outcome.invalid } } });
    }
    const next: ExecutionRow = { ...execution, body: { ...body, retries: body.retries + 1, retryReason: outcome.invalid } };
    deps.store.transaction(() => finishExecution(deps.store, key, from, "running", at, { body: next.body }));
    const retried = await kindFor(deps, step)!.start(contextFor(deps, run, { ...next, state: "running" }));
    return applyOutcome(deps, run, { ...next, state: "running" }, "running", retried);
  }
  if ("call" in outcome) {
    deps.store.transaction(() => finishExecution(deps.store, key, from, "running", at, { body: { ...body, call: { purpose: outcome.call.purpose } } }));
    deps.calls.request({ key, groupId: run.row.groupId, ...outcome.call });
    return;
  }
  if ("dispatched" in outcome) {
    deps.store.transaction(() => finishExecution(deps.store, key, from, "running", at, {
      childGroupId: outcome.dispatched.childGroupId, baseCommit: outcome.dispatched.baseCommit, body: { ...body, child: outcome.dispatched },
    }));
    return;
  }
  if ("parked" in outcome) {
    // §6.3: only this run waits; the needs-you item is the parked execution with its reason.
    deps.store.transaction(() => finishExecution(deps.store, key, from, "parked", at, { body: { ...body, needsYou: outcome.parked } }));
    return;
  }
  const workspaceOutput = "done" in outcome && outcome.done.commit !== undefined ? outcome.done.commit : null;
  const vault = vaultOf(run);
  const changed = workspaceOutput === null || vault === null ? null : await changesBetween(vault, workspaceOutput.parent, workspaceOutput.commit);
  deps.store.transaction(() => {
    if ("done" in outcome) {
      // §9.2: an applied effect is flagged red for review, with the remote id the agent reported.
      const effectFlags = settleEffect(deps.store, body, "done", outcome.done.reported?.effect?.remoteId ?? null, at);
      const flags = [...(outcome.done.flags ?? []), ...effectFlags];
      const extra = {
        ...(flags.length === 0 ? {} : { flags }),
        ...(outcome.done.skillLocks === undefined ? {} : { skillLocks: outcome.done.skillLocks }),
        ...(outcome.done.warnings === undefined ? {} : { warnings: outcome.done.warnings }),
        ...(outcome.done.reported === undefined ? {} : { reported: outcome.done.reported }),
      };
      if (workspaceOutput !== null) {
        finishExecution(deps.store, key, from, "done", at, {
          output: { kind: "commit", ref: workspaceOutput.commit, hash: outputHashOfCommit((changed ?? []).map((c) => ({ path: c.path, blob: c.newBlob }))) },
          baseCommit: workspaceOutput.parent, body: { ...body, ...extra, parent: workspaceOutput.parent, record: outcome.done.record },
        });
      } else {
        const hash = writeRecord(deps.store, run.row.groupId, outcome.done.record);
        finishExecution(deps.store, key, from, "done", at, { output: { kind: "artifact", ref: hash, hash: outputHashOfRecord(hash) }, body: { ...body, ...extra } });
      }
      // §12.2 phase 1: fingerprints use the skills' actual content_md5, known once the execution injected them.
      if (outcome.done.skillLocks !== undefined) setDefinitionHash(deps.store, key, definitionOf(deps, run, step, outcome.done.skillLocks));
      setHead(deps.store, key.flowRunId, key.stepKey, getHead(deps.store, key.flowRunId, key.stepKey), key.seq);
      for (const decision of outcome.done.decisions ?? []) appendFlowDecision(deps.store, { flowRunId: key.flowRunId, grade: decision.grade, stepKey: key.stepKey, body: decision.body, by: decision.by });
      if (outcome.done.revise !== undefined) queueRevision(deps, run, outcome.done.revise.stepKey, outcome.done.revise.feedback, { reviewedBy: key.stepKey }, at);
    } else if ("failed" in outcome) {
      const hash = outcome.failed.record === undefined ? null : writeRecord(deps.store, run.row.groupId, outcome.failed.record);
      // §9.6: a failed effect is red and is not retried until the person retries (a new execution, a new record).
      const flags = [...(outcome.failed.flags ?? []), ...settleEffect(deps.store, body, "failed", null, at)];
      finishExecution(deps.store, key, from, "failed", at, {
        ...(hash === null ? {} : { output: { kind: "artifact" as const, ref: hash, hash: outputHashOfRecord(hash) } }),
        body: { ...body, failure: outcome.failed.reason, ...(flags.length === 0 ? {} : { flags }) },
      });
    } else if ("waiting" in outcome) {
      finishExecution(deps.store, key, from, "needs-person", at, { body: { ...body, ask: outcome.waiting.ask } });
    } else if ("needs" in outcome) {
      // §4.3: an unclassed step's confirmation request is how an unclassed side effect becomes visible (§9.5).
      const ask = { ...outcome.needs, unclassed: !("effect" in step && step.effect !== undefined) };
      finishExecution(deps.store, key, from, "needs-person", at, { body: { ...body, ask } });
    }
  });
  if (workspaceOutput !== null && vault !== null) await advanceWorkspace(deps, run, vault, key);
}

/**
 * §5.3-§5.4: after a workspace output becomes active, the flow head moves by CAS to the composition of every active
 * output and the change is copied back into the person's folder; a copy-back conflict leaves the person's file as it is
 * and flags the execution red (`copy-back-conflict`).
 */
export async function advanceWorkspace(deps: FlowDeps, run: LoadedRun, vault: Vault, key: ExecutionKey): Promise<void> {
  let previous: string | null = null;
  const next = await advanceHeadWithRetry(vault, run.row.id, async (current) => {
    previous = current;
    const composition = await compositionFor(deps.store, run, null);
    return composition!.commit;
  });
  if (previous === null || run.body.dir === null) return;
  const result = await copyBack(vault, run.body.dir, previous, next);
  if (result.conflicts.length === 0) return;
  const execution = listExecutions(deps.store, key.flowRunId).find((e) => e.stepKey === key.stepKey && e.seq === key.seq)!;
  const body = execution.body as ExecutionBody;
  deps.store.transaction(() => finishExecution(deps.store, key, execution.state, execution.state, deps.now(), {
    body: { ...body, flags: [...(body.flags ?? []), "copy-back-conflict"], copyBackConflicts: result.conflicts },
  }));
}

/** §4.2 review `revise` (and later feedback): an `orca-auto` feedback message and a queued revision of the step. */
function queueRevision(deps: FlowDeps, run: LoadedRun, stepKey: string, feedback: string[], extra: Record<string, unknown>, at: number): void {
  const executions = listExecutions(deps.store, run.row.id).filter((e) => e.stepKey === stepKey);
  const seq = (executions.at(-1)?.seq ?? 0) + 1;
  appendMessage(deps.store, {
    flowRunId: run.row.id, requestId: `orca-auto:revise:${stepKey}:${seq}`, kind: "feedback", target: "step", body: { stepKey, text: feedback.join("\n"), ...extra },
    by: "orca-auto", via: "orca", state: "applied", reason: null, at,
  });
  appendQueued(deps, run, stepKey, seq, ["feedback"], { feedback, ...extra }, "orca-auto", "orca", at);
}

/** fp1's definition of a step (§6.4): its fields, prompt bytes, skill locks, checks, tools and kind version. */
export function definitionOf(deps: FlowDeps, run: LoadedRun, step: FlowStep, skillLocks: readonly SkillLock[]): string {
  const kind = kindFor(deps, step);
  const promptRel = "prompt" in step ? step.prompt : undefined;
  return definitionHash({
    step, promptBytes: promptRel === undefined ? "" : run.assets[promptRel] ?? "", skillLocks,
    checks: "acceptance" in step && step.acceptance !== undefined ? step.acceptance.checks.map((c) => c.run) : [],
    tools: "tools" in step ? step.tools ?? null : null, kindVersion: kind?.kindVersion ?? 0,
  });
}

export function appendQueued(deps: FlowDeps, run: LoadedRun, stepKey: string, seq: number, reasons: string[], extra: Record<string, unknown>, by: string, via: string, at: number, planNo: number | null = null): void {
  const step = stepOf(run, stepKey);
  const kind = kindFor(deps, step);
  appendExecution(deps.store, {
    flowRunId: run.row.id, stepKey, seq, kind: step.kind, kindVersion: kind?.kindVersion ?? 0, state: "queued",
    // A step with skills is defined again with their actual locks when it ran (§12.2 phase 1); until then none.
    definitionHash: definitionOf(deps, run, step, []),
    baseCommit: null, ranOn: null, fingerprint: null, outputKind: null, outputRef: null, outputHash: null, readSetHash: null, reasons, planNo, childGroupId: null,
    by, via, createdAt: at, updatedAt: at, body: { basis: {}, retries: 0, retryReason: null, feedback: [], ...extra } satisfies ExecutionBody,
  });
  // A run that had finished has work again (a later answer or feedback): it is advanced again.
  if (getFlowRun(deps.store, run.row.id)?.state === "done") setFlowRunState(deps.store, run.row.id, "done", "running");
}

// -------------------------------------------------------------------------------------------------------------- advance

/** The earlier active outputs a step starts from; a `parallelWith` sibling is not one of them (§6.5). */
const basisOf = (run: LoadedRun, index: number, heads: Record<string, number>): Record<string, number> => {
  const step = run.template.steps[index]!;
  return Object.fromEntries(run.template.steps.slice(0, index).filter((s) => heads[s.id] !== undefined && !parallel(s, step)).map((s) => [s.id, heads[s.id]!]));
};
const sameBasis = (a: Record<string, number> | undefined, b: Record<string, number>): boolean =>
  canonicalBytes(a ?? {}).equals(canonicalBytes(b));
const parallel = (a: FlowStep, b: FlowStep): boolean => a.parallelWith === b.id || b.parallelWith === a.id;
// §9.2: a `staged` effect waits for nobody: the flow goes on (or ends) without it.
const WAITING: ReadonlySet<ExecutionState> = new Set(["needs-person", "parked"]);
const SETTLED: ReadonlySet<ExecutionState> = new Set(["done", "skipped", "staged"]);

/** Start a queued execution: it takes its basis now and its kind's start decides the rest. */
async function runQueued(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow, basis: Record<string, number>): Promise<void> {
  const step = stepOf(run, execution.stepKey);
  const key: ExecutionKey = { flowRunId: execution.flowRunId, stepKey: execution.stepKey, seq: execution.seq };
  // §6.4, §7.2: what it ran on, so a later plan can tell which of its inputs moved since.
  const body: ExecutionBody = { ...(execution.body as ExecutionBody), basis, ranOnInputs: ranOnInputsOf(deps.store, run, step.id) };
  // §9.2: an effect-classed step is gated on its level before it starts (its record is written with the move).
  const gate = deps.store.transaction(() => {
    const gated = (execution.body as ExecutionBody).effectRecordId === undefined ? gateEffect(deps, run, execution, step) : null;
    const at = deps.now();
    if (gated !== null && "staged" in gated) { finishExecution(deps.store, key, "queued", "staged", at, { body: { ...body, effectRecordId: gated.staged } }); return gated; }
    if (gated !== null && "waiting" in gated) { finishExecution(deps.store, key, "queued", "needs-person", at, { body: { ...body, effectRecordId: gated.waiting.recordId, ask: gated.waiting.ask } }); return gated; }
    if (gated !== null) body.effectRecordId = gated.run;
    finishExecution(deps.store, key, "queued", "running", at, { body });
    return gated;
  });
  if (gate !== null && !("run" in gate)) return;
  const running: ExecutionRow = { ...execution, state: "running", body };
  const kind = kindFor(deps, step);
  if (kind === undefined) return applyOutcome(deps, run, running, "running", { failed: { reason: `kind-not-available:${step.kind}` } });
  return applyOutcome(deps, run, running, "running", await kind.start(contextFor(deps, run, running)));
}

/**
 * §6.4, §7.2: the inputs an execution ran on -- the import, the params, and the active output of every earlier step
 * (template order). A `parallelWith` sibling is not an input (§6.5): it is recorded as it stands when the planner reads
 * it, so only its re-run (never its finishing later) makes this step a candidate.
 */
export function ranOnInputsOf(store: ControlStore, run: LoadedRun, stepKey: string): RanOnInputs {
  const heads = listHeads(store, run.row.id);
  const all = listExecutions(store, run.row.id);
  const index = run.template.steps.findIndex((s) => s.id === stepKey);
  const step = run.template.steps[index]!;
  const earlier = run.template.steps.slice(0, index).filter((s) => !parallel(s, step)).map((s) => {
    const active = all.find((e) => e.stepKey === s.id && e.seq === heads[s.id]);
    return { stepKey: s.id, outputHash: active?.state === "done" ? active.outputHash : null, projection: null };
  });
  return { start: run.body.importCommit ?? "none", params: run.row.paramsSha256, earlier };
}
export interface RanOnInputs { start: string; params: string; earlier: Array<{ stepKey: string; outputHash: string | null; projection: null }> }

/**
 * §9.2: a confirmed card or an enacted staged record: the waiting execution runs now, with its record id in the prompt.
 * Then the run goes on from its boundaries.
 */
export async function resumeExecution(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow): Promise<void> {
  const key: ExecutionKey = { flowRunId: execution.flowRunId, stepKey: execution.stepKey, seq: execution.seq };
  const { ask: _card, ...rest } = execution.body as ExecutionBody;
  const body = rest as ExecutionBody;
  deps.store.transaction(() => finishExecution(deps.store, key, execution.state, "running", deps.now(), { body }));
  const running: ExecutionRow = { ...execution, state: "running", body };
  const kind = kindFor(deps, stepOf(run, execution.stepKey));
  if (kind === undefined) await applyOutcome(deps, run, running, "running", { failed: { reason: `kind-not-available:${execution.kind}` } });
  else await applyOutcome(deps, run, running, "running", await kind.start(contextFor(deps, run, running)));
  if (getFlowRun(deps.store, run.row.id)?.state === "done") setFlowRunState(deps.store, run.row.id, "done", "running");
  await advanceRun(deps, run.row.id);
}

/** One pass over a run: start at most one execution; true when something moved (the caller passes again). */
async function passRun(deps: FlowDeps, run: LoadedRun): Promise<boolean> {
  // §8.2: the person's messages are taken at a boundary only, never in the middle of a running step.
  if (await consumeAtBoundary(deps, run.row.id)) return true;
  const fresh = loadRun(deps.store, run.row.id);
  if (fresh.row.state !== "running") return false;
  // §7.4-§7.5: an open plan the person (or the proposal) has not settled holds the run; a running one decides what runs.
  const planned = await planOf(deps, fresh);
  if (planned === "moved") return true;
  if (planned === "wait") return false;
  const plan = planned;
  const executions = listExecutions(deps.store, run.row.id);
  const latest = latestByStep(executions);
  const heads = listHeads(deps.store, run.row.id);
  const blockers: FlowStep[] = [];
  let satisfied = true;
  for (const [index, step] of run.template.steps.entries()) {
    const current = latest.get(step.id);
    const basis = basisOf(run, index, heads);
    const free = blockers.every((b) => parallel(b, step));
    if (current?.state === "running" && step.kind === "work" && (current.body as ExecutionBody).call === undefined && await pollChild(deps, run, current)) return true;
    // §6.2: a call the driver settled left its raw output on the execution; the kind judges it now.
    const callResult = current?.state === "running" ? (current.body as { callResult?: FlowCallResult }).callResult : undefined;
    if (callResult !== undefined && (current!.body as ExecutionBody).call !== undefined) {
      await completeFlowCall(deps, { flowRunId: run.row.id, stepKey: step.id, seq: current!.seq }, callResult.rawOutput, callResult.failure);
      return true;
    }
    if (current !== undefined && (current.state === "running" || WAITING.has(current.state))) { satisfied = false; blockers.push(step); continue; }
    if (current?.state === "failed") return false;
    if (current?.state === "queued") {
      if (!free) return false;
      await runQueued(deps, run, current, basis);
      return true;
    }
    const executedUnderPlan = plan !== null && executions.some((e) => e.stepKey === step.id && e.planNo === plan.planNo && (e.body as ExecutionBody).carriedForward === undefined);
    // §7.5: a chosen step runs once under the plan, in template order, with the plan's reasons and the feedback for it.
    if (plan !== null && plan.chosen.steps.includes(step.id) && !executedUnderPlan) {
      satisfied = false;
      if (!free) return false;
      const seq = (current?.seq ?? 0) + 1;
      const at = deps.now();
      const reasons = plan.candidates.list.find((c) => c.stepKey === step.id)?.reasons ?? ["added"];
      const feedback = plan.candidates.feedback[step.id] ?? [];
      deps.store.transaction(() => appendQueued(deps, run, step.id, seq, reasons, { feedback }, plan.by, plan.via, at, plan.planNo));
      await runQueued(deps, run, listExecutions(deps.store, run.row.id).find((e) => e.stepKey === step.id && e.seq === seq)!, basis);
      return true;
    }
    if (current !== undefined && SETTLED.has(current.state) && sameBasis((current.body as ExecutionBody).basis, basis)) continue;
    // §7.5: a step the plan does not run keeps its active output: a skipped execution carries it onto the new basis.
    if (plan !== null && current !== undefined && (current.state === "done" || current.state === "skipped") && !executedUnderPlan) {
      if (!free) return false;
      const at = deps.now();
      deps.store.transaction(() => {
        appendQueued(deps, run, step.id, current.seq + 1, ["plan-skip"], { basis, carriedForward: getHead(deps.store, run.row.id, step.id) }, plan.by, plan.via, at, plan.planNo);
        setExecutionStateSkipped(deps.store, { flowRunId: run.row.id, stepKey: step.id, seq: current.seq + 1 }, at);
      });
      return true;
    }
    satisfied = false;
    if (!free) return false;
    const seq = (current?.seq ?? 0) + 1;
    const at = deps.now();
    const reasons = [current === undefined ? "first-run" : "upstream-changed"];
    if (step.when !== undefined && !evaluateWhen(step.when, { params: run.params, classification: null })) {
      deps.store.transaction(() => {
        appendQueued(deps, run, step.id, seq, reasons, { basis }, "orca-auto", "orca", at, plan?.planNo ?? null);
        setExecutionStateSkipped(deps.store, { flowRunId: run.row.id, stepKey: step.id, seq }, at);
      });
      return true;
    }
    deps.store.transaction(() => appendQueued(deps, run, step.id, seq, reasons, {}, "orca-auto", "orca", at, plan?.planNo ?? null));
    await runQueued(deps, run, listExecutions(deps.store, run.row.id).find((e) => e.stepKey === step.id && e.seq === seq)!, basis);
    return true;
  }
  if (plan !== null && satisfied) { deps.store.transaction(() => finishPlan(deps.store, plan)); return true; }
  if (satisfied && run.row.state === "running") { deps.store.transaction(() => setFlowRunState(deps.store, run.row.id, "running", "done")); }
  return false;
}

/**
 * §6.2: a running `work` execution. With no child named yet (a restart between the draw and the dispatch record) its
 * start runs again -- the child id and the draw are deterministic, so nothing is opened or drawn twice. With a child,
 * its settlement ends the step and the unspent allocation goes back to the pool. True when something moved.
 */
async function pollChild(deps: FlowDeps, run: LoadedRun, execution: ExecutionRow): Promise<boolean> {
  const kind = kindFor(deps, stepOf(run, execution.stepKey));
  if (kind === undefined) return false;
  if (execution.childGroupId === null) {
    await applyOutcome(deps, run, execution, "running", await kind.start(contextFor(deps, run, execution)));
    return true;
  }
  const status = deps.children === undefined ? null : await deps.children.status(execution.childGroupId);
  if (status === null || status.state === "running" || kind.settle === undefined) return false;
  const outcome = kind.settle(contextFor(deps, run, execution), status, execution.baseCommit!);
  deps.store.transaction(() => { returnUnspent(deps.store, run.row.id, execution.childGroupId!, status.spentTokens); });
  await applyOutcome(deps, run, execution, "running", outcome);
  return true;
}

function setExecutionStateSkipped(store: ControlStore, key: ExecutionKey, at: number): void {
  finishExecution(store, key, "queued", "skipped", at);
}

/** Spec §8.2: called by the panel's pump after each orchestration pass; advances every running run at its boundaries. */
export async function advanceFlowRuns(deps: FlowDeps): Promise<void> {
  for (const flowRunId of listFlowRunIds(deps.store, "running")) await advanceRun(deps, flowRunId);
}

/** Advance one run at its boundaries (a message, a plan run or an answer moved it). */
export async function advanceRun(deps: FlowDeps, flowRunId: string): Promise<void> {
  for (let pass = 0; pass < 1000; pass += 1) {
    if (!(await passRun(deps, loadRun(deps.store, flowRunId)))) break;
  }
}

/**
 * The single-call settlement's hook: the call this execution sent came back (`rawOutput`, or `failure`, ccloop's code).
 * The kind judges it; a call for an execution that no longer waits on one is ignored (a replay after a restart).
 */
export async function completeFlowCall(deps: FlowDeps, key: ExecutionKey, rawOutput: unknown, failure: string | null = null): Promise<void> {
  if (key.stepKey === PLAN_KEY) return completePlanCall(deps, key.flowRunId, key.seq, rawOutput, failure);
  const run = loadRun(deps.store, key.flowRunId);
  const execution = listExecutions(deps.store, key.flowRunId).find((e) => e.stepKey === key.stepKey && e.seq === key.seq);
  if (execution === undefined || execution.state !== "running" || (execution.body as ExecutionBody).call === undefined) return;
  const kind = kindFor(deps, stepOf(run, key.stepKey));
  const ctx = contextFor(deps, run, execution);
  if (failure !== null) kind?.callFailed?.(ctx, failure);
  const outcome: KindOutcome = kind?.collect === undefined ? { failed: { reason: "kind-has-no-collect" } }
    : failure !== null ? { invalid: `call-failed:${failure}` } : await kind.collect(ctx, rawOutput, failure);
  const body = { ...(execution.body as ExecutionBody) };
  delete body.call;
  delete body.callResult;
  await applyOutcome(deps, run, { ...execution, body }, "running", outcome);
}

// ---------------------------------------------------------------------------------------------------------- asks/needs

/** The run's open asks: newest executions waiting on a person with an ask (§4.3, §8.2). */
export function openAsks(store: ControlStore, flowRunId: string): Array<{ stepKey: string; seq: number; ask: unknown }> {
  return [...latestByStep(listExecutions(store, flowRunId)).values()]
    .filter((e) => e.state === "needs-person" && (e.body as ExecutionBody).ask !== undefined && !((e.body as { ask: { kind?: string } }).ask.kind ?? "").startsWith("clarify-"))
    .map((e) => ({ stepKey: e.stepKey, seq: e.seq, ask: (e.body as ExecutionBody).ask }));
}

/**
 * §4.3: the person's answer to a `flow.needs` ask queues a revision of that step carrying the question and the answer
 * in its prompt. The answer is a `command` message (§8.1); the waiting execution stays as it ended (history).
 */
export async function answerNeeds(deps: FlowDeps, target: { flowRunId: string; stepKey: string }, answer: string, by: string, via: string): Promise<void> {
  const run = loadRun(deps.store, target.flowRunId);
  stepOf(run, target.stepKey);
  const waiting = latestByStep(listExecutions(deps.store, target.flowRunId)).get(target.stepKey);
  if (waiting === undefined || waiting.state !== "needs-person" || (waiting.body as ExecutionBody).ask === undefined) throw new FlowRefusal("flow-ask-closed", target.stepKey);
  const needs = (waiting.body as { ask: FlowNeeds }).ask;
  const asked = needs.kind === "input" ? `Question: ${needs.question}` : `Confirmation asked for: ${needs.what} (${needs.payloadSummary})`;
  const at = deps.now();
  deps.store.transaction(() => {
    appendMessage(deps.store, {
      flowRunId: run.row.id, requestId: `answer:${target.stepKey}:${waiting.seq}`, kind: "command", target: "execution",
      body: { command: "answer", stepKey: target.stepKey, seq: waiting.seq, answer }, by, via, state: "applied", reason: null, at,
    });
    appendQueued(deps, run, target.stepKey, waiting.seq + 1, ["answer"], { feedback: [`The person answered the step's request.\n${asked}\nAnswer: ${answer}`], answerOf: waiting.seq }, by, via, at);
  });
}
