/**
 * Flow engine spec §4.2 `work`, §6.2-§6.3, §9.6, §16.2 (plan Task 10): an agent session through ccloop in a hidden child
 * group on the vault. Code owns everything around the work: the composition the child starts from, the allocation it
 * draws from the run pool, the one-task plan (buildFlowStepPlanSource), the deterministic child id that makes a restart
 * find the same child instead of opening a second one, and what the settled child means for the step.
 *
 * The child itself is opened, confirmed and driven behind `FlowChildPort` (the driver-backed port); the kind only says
 * what to open and reads back how it settled.
 */
import type { LockSkill } from "../../skills/syncskill.js";
import type { SkillLock } from "../journal/fingerprint.js";
import { buildFlowStepPlanSource, type FlowStepPlanInput } from "../../control/flowStepPlan.js";
import type { Amount } from "../../control/types.js";
import type { FlowNeeds } from "../../control/reportedDecisions.js";
import type { ToolRulesReport } from "../../control/toolRules.js";
import { getFlowRun } from "../store.js";
import { allocationFor, childWorkAmount, drawAllocation, POOL_EXHAUSTED } from "../pool.js";
import type { KindContext, KindDefinition, KindOutcome } from "./registry.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expandKeepingSkillDirs } from "../template/vars.js";
import { vaultGitBytes, type Vault } from "../vault/vault.js";

/**
 * §12.1 `{{base:<path>}}` for a `work` step: the checks run later, in the child's attempt, so the copy is written now,
 * under the vault (dir 0700, file 0400, never from umask); a path the composition lacks is an empty file. A restart
 * finds the same copy (same execution, same composition) and leaves it.
 */
async function writeBaseCopy(vault: Vault, commit: string, path: string, file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const bytes = await vaultGitBytes(vault, ["cat-file", "blob", `${commit}:${path}`]).catch(() => Buffer.alloc(0));
  try { await writeFile(file, bytes, { mode: 0o400, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

export interface FlowChildOpen {
  childGroupId: string; parentGroupId: string; flowRunId: string; stepKey: string; seq: number; baseCommit: string; vaultPath: string;
  plan: ReturnType<typeof buildFlowStepPlanSource>; work: Amount;
  /** §12.2 phase 1: exactly the step's skills, injected once for this execution through today's inject path. */
  skills: string[];
  effectRecordId: string | null;
}
export type FlowChildStatus =
  | { state: "running" }
  | { state: "landed"; commit: string; spentTokens: number; toolRules?: ToolRulesReport; skills?: LockSkill[]; flow?: { needs?: FlowNeeds; candidates?: Record<string, { items: string[]; recommended: number }>; effect?: { remoteId: string; url?: string } } }
  | { state: "failed"; reason: string; spentTokens: number; toolRules?: ToolRulesReport; skills?: LockSkill[] };
/** The driver-backed side of a work step: open (idempotent per child id) and read how the child is doing. */
export interface FlowChildPort {
  open(request: FlowChildOpen): Promise<void>;
  status(childGroupId: string): Promise<FlowChildStatus | null>;
}

/** §6.2: deterministic, so a restart opens nothing twice. */
export const childGroupIdOf = (flowRunId: string, stepKey: string, seq: number): string => `flow-${flowRunId}-${stepKey}-${seq}`;

/**
 * §16.2 [IR-I8]: the rules ccloop could not hold the agent to are flagged red -- `detected` (seen after it ran),
 * `recorded-only` network (declared, not checked) and `refused` (not expressible on this agent kind).
 */
export function toolRuleFlags(report: ToolRulesReport | undefined): string[] {
  const flags = new Set<string>();
  for (const row of report?.rules ?? []) {
    if (row.status === "detected" || row.status === "refused" || (row.status === "recorded-only" && row.rule.kind === "network")) flags.add(`tool-rule:${row.status}`);
  }
  return [...flags].sort();
}

async function start(ctx: KindContext): Promise<KindOutcome> {
  const { step, key, run } = ctx;
  if (step.kind !== "work") return { failed: { reason: `kind-mismatch:${step.kind}` } };
  if (ctx.children === null) return { failed: { reason: "work-port-unavailable" } };
  const composition = await ctx.composition();
  if (composition === null) return { failed: { reason: "work-needs-workspace" } };
  const childGroupId = childGroupIdOf(key.flowRunId, key.stepKey, key.seq);
  const row = getFlowRun(ctx.store, key.flowRunId)!;
  const index = run.template.steps.findIndex((s) => s.id === step.id);
  const workLeft = run.template.steps.slice(index).filter((s) => s.kind === "work").length;
  const wanted = allocationFor(step, row.poolTokens - row.poolDrawn, workLeft);
  // §6.3: drawn in its own write, idempotent per child id (a restart draws nothing twice).
  const draw = ctx.store.transaction(() => drawAllocation(ctx.store, key.flowRunId, childGroupId, wanted));
  if ("exhausted" in draw) return { parked: { reason: POOL_EXHAUSTED, detail: draw.exhausted } };
  const effectRecordId = typeof ctx.body.effectRecordId === "string" ? ctx.body.effectRecordId : null;
  // §12.1: commands carry their variables expanded (a command never reads an unset parameter as empty); `{{base:<path>}}`
  // is a read-only copy of <path> at this execution's composition, kept with the vault; the skills' directories are the
  // driver's to fill once the child injected them.
  let gates: string[];
  let tools: typeof step.tools;
  try {
    const bases = join(composition.vault.path, "orca-base", key.flowRunId, `${key.stepKey}-${key.seq}`);
    const copies: Array<{ file: string; path: string }> = [];
    const scope = {
      params: run.params, runId: run.row.id, workspace: ".", ...(effectRecordId === null ? {} : { effectRecordId }),
      base: (path: string): string => {
        const known = copies.find((copy) => copy.path === path);
        if (known !== undefined) return known.file;
        const file = join(bases, `${copies.length + 1}-${path.replace(/[^A-Za-z0-9._-]/g, "_")}`);
        copies.push({ file, path });
        return file;
      },
    };
    const expand = (command: string): string => expandKeepingSkillDirs(command, scope, "command", step.skills ?? []);
    gates = (step.acceptance?.checks ?? []).filter((c) => c.role === "gate").map((c) => expand(c.run));
    tools = step.tools === undefined ? undefined : { ...step.tools, ...(step.tools.commands === undefined ? {} : {
      commands: step.tools.commands.map((rule) => ("exact" in rule ? { exact: expand(rule.exact) } : { prefix: expand(rule.prefix) })) }) };
    for (const copy of copies) await writeBaseCopy(composition.vault, composition.commit, copy.path, copy.file);
  } catch (error) { return { failed: { reason: `flow-command-vars:${(error as Error).message}` } }; }
  // §12.3: the step's role, as resolved at run start, is the child's agent (the plan's own layer).
  const role = step.role === undefined ? undefined : run.body.roles[step.role];
  const input: FlowStepPlanInput = {
    flowRunId: key.flowRunId, step: { ...step, ...(tools === undefined ? {} : { tools }) }, seq: key.seq, baseCommit: composition.commit, vaultPath: composition.vault.path,
    // The agent reads the gates as they will run (the tool rules allow exactly those spellings).
    promptEnvelope: ctx.prompt({ acceptance: gates.map((gate) => `gate: ${gate}`) }), gates, effectRecordId,
    ...(role === undefined ? {} : { agent: { agent: role.agent, ...(role.model === null ? {} : { model: role.model }) } }),
  };
  let plan: ReturnType<typeof buildFlowStepPlanSource>;
  try { plan = buildFlowStepPlanSource(input); }
  catch (error) { return { failed: { reason: (error as Error).message } }; }
  await ctx.children.open({
    childGroupId, parentGroupId: run.row.groupId, flowRunId: key.flowRunId, stepKey: key.stepKey, seq: key.seq, baseCommit: composition.commit,
    vaultPath: composition.vault.path, plan, work: childWorkAmount(step, draw.drawn), skills: [...(step.skills ?? [])], effectRecordId,
  });
  return { dispatched: { childGroupId, baseCommit: composition.commit } };
}

/**
 * §12.2 phase 1: what the child injected, as fingerprints read it (the actual content_md5), and a warning -- never a
 * refusal -- for each skill whose lock's resolved_commit is not the `ref` the template's `requires.skills` names.
 */
export function skillLocksOf(ctx: KindContext, lock: readonly LockSkill[] | undefined): { skillLocks: SkillLock[]; warnings: string[] } {
  const required = ctx.run.template.requires?.skills ?? [];
  const warnings: string[] = [];
  for (const entry of lock ?? []) {
    const pin = required.find((r) => r.skills.includes(entry.name));
    if (pin !== undefined && entry.resolved_commit !== pin.ref) warnings.push(`skill-ref-mismatch:${entry.name}`);
  }
  return { skillLocks: (lock ?? []).map((e) => ({ sourceId: e.source?.name ?? "", resolvedCommit: e.resolved_commit ?? "", contentMd5: e.content_md5 })), warnings };
}

/** How the settled child ends the step: its landed commit is the output; the tool-rule report is kept per execution. */
function settle(ctx: KindContext, status: Exclude<FlowChildStatus, { state: "running" }>, baseCommit: string): KindOutcome {
  const flags = toolRuleFlags(status.toolRules);
  const { skillLocks, warnings } = skillLocksOf(ctx, status.skills);
  const record = { toolRules: status.toolRules ?? null, ...(status.skills === undefined ? {} : { skills: status.skills }), ...(warnings.length === 0 ? {} : { warnings }) };
  if (status.state === "failed") return { failed: { reason: status.reason, record, ...(flags.length === 0 ? {} : { flags }) } };
  if (status.flow?.needs !== undefined) return { needs: status.flow.needs };
  return { done: {
    record, commit: { commit: status.commit, parent: baseCommit }, ...(flags.length === 0 ? {} : { flags }),
    ...(status.skills === undefined ? {} : { skillLocks }), ...(warnings.length === 0 ? {} : { warnings }),
    // §4.3, §9.6: what the agent reported for later asks, and the remote id of the effect it enacted.
    ...(status.flow?.candidates === undefined && status.flow?.effect === undefined ? {} : { reported: {
      ...(status.flow.candidates === undefined ? {} : { candidates: status.flow.candidates }), ...(status.flow.effect === undefined ? {} : { effect: status.flow.effect }) } }),
  } };
}

export const WORK_KIND: KindDefinition & { settle: typeof settle } = { kind: "work", kindVersion: 1, interactive: false, start, settle };
