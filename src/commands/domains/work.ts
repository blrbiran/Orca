/**
 * CLI v2 plan Task 4: requirement, group and task writes (spec §4 table; plan "Control verbs → commands"). Every pin
 * (round and draft numbers, draft hash, proposal version, plan hash, profile hashes, selections hash, base versions, the
 * run a retry acts on) is filled from a read made in this invocation.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, WriteContext } from "../types.js";
import {
  checkpointOf, config, currentRun, file, group, GROUP, groupView, invalid, json, list, newGroupId, profileBinding, str, task, TASK, verb, workItem,
} from "./verbs.js";
import { SCHEME_FLAGS, schemeFromFlags } from "./settings.js";

interface RequirementView { summary: { requirement?: { roundNo: number | null; draftNo: number | null } }; drafts: Array<{ draftNo: number; draftHash: string | null }> }
const requirement = async (c: WriteContext): Promise<RequirementView> => await c.read(`groups/${group(c)}/requirement`) as RequirementView;
async function roundNo(c: WriteContext): Promise<number> {
  const round = (await requirement(c)).summary.requirement?.roundNo ?? null;
  if (round === null) throw new EntryRejection("requirement-no-round", `${group(c)} has no clarification round`);
  return round;
}
async function latestDraft(c: WriteContext): Promise<{ draftNo: number; draftHash: string | null }> {
  const view = await requirement(c);
  const draftNo = view.summary.requirement?.draftNo ?? null;
  const draft = draftNo === null ? undefined : view.drafts.find((d) => d.draftNo === draftNo);
  if (draft === undefined) throw new EntryRejection("requirement-no-draft", `${group(c)} has no draft`);
  return draft;
}
const decision = (value: string, flag: string): { id: string; accept: boolean } => {
  const at = value.lastIndexOf("=");
  const verdict = value.slice(at + 1);
  if (at <= 0 || (verdict !== "accept" && verdict !== "reject")) throw invalid(`--${flag} wants <id>=accept|reject, got ${JSON.stringify(value)}`);
  return { id: value.slice(0, at), accept: verdict === "accept" };
};

const empty = (domain: string, action: string, summary: string, verbName: Parameters<typeof verb>[0]["verb"], path: string): CommandDef =>
  verb({ domain, action, summary, verb: verbName, positionals: [GROUP], route: (c) => `groups/${group(c)}/${path}`, payload: () => ({}) });

export const WORK_ROWS: CommandDef[] = [
  // --- requirement
  verb({ domain: "requirement", action: "open", summary: "open a requirement from an idea; the group id is generated unless --group names one", verb: "requirement-open",
    flags: [
      { name: "idea", type: "string", required: true, summary: "what to build" }, { name: "group", type: "string", summary: "the new group's id" },
      { name: "language", type: "string", summary: "en|zh: the requirement's content language" },
      { name: "limit", type: "string", humanOnly: true, summary: "the requirement's budget as JSON {tokens,activeMs,attempts,sessions}" },
    ],
    scopeId: (c) => newGroupIdOnce(c), route: () => "requirements",
    payload: async (c) => ({
      groupId: newGroupIdOnce(c), repoId: (await c.project()).repoId, idea: str(c, "idea"),
      ...(str(c, "language") === undefined ? {} : { contentLanguage: str(c, "language") }), ...(str(c, "limit") === undefined ? {} : { limit: json(c, "limit") }),
    }),
    examples: ["orca requirement open --idea \"add a dark mode\""] }),
  verb({ domain: "requirement", action: "answer", summary: "answer the current round: --answer <qid> takes the recommendation, --answer <qid>=<text> answers in words",
    verb: "requirement-answer", positionals: [GROUP],
    flags: [
      { name: "answer", type: "string", repeatable: true, summary: "<questionId> or <questionId>=<text>" },
      { name: "glossary", type: "string", repeatable: true, summary: "<id>=accept|reject" }, { name: "adr", type: "string", repeatable: true, summary: "<id>=accept|reject" },
    ],
    route: (c) => `groups/${group(c)}/requirement/answer`,
    payload: async (c) => ({
      roundNo: await roundNo(c),
      answers: list(c, "answer").map((value) => {
        const at = value.indexOf("=");
        return at === -1 ? { id: value, kind: "recommended" } : { id: value.slice(0, at), kind: "text", text: value.slice(at + 1) };
      }),
      glossaryDecisions: list(c, "glossary").map((v) => decision(v, "glossary")), adrDecisions: list(c, "adr").map((v) => decision(v, "adr")),
    }) }),
  verb({ domain: "requirement", action: "consensus", summary: "close clarification at the current round", verb: "requirement-consensus", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/consensus`, payload: async (c) => ({ roundNo: await roundNo(c) }) }),
  verb({ domain: "requirement", action: "continue", summary: "grant exactly one more clarification round after the cap", verb: "requirement-clarify-more", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/clarify-more`, payload: async (c) => ({ roundNo: await roundNo(c) }) }),
  verb({ domain: "requirement", action: "feedback", summary: "ask for a new draft of the split", verb: "requirement-draft-feedback", positionals: [GROUP],
    flags: [{ name: "text", type: "string", required: true, summary: "what to change" }],
    route: (c) => `groups/${group(c)}/requirement/feedback`, payload: async (c) => ({ draftNo: (await latestDraft(c)).draftNo, feedback: str(c, "text") }) }),
  verb({ domain: "requirement", action: "accept", summary: "accept the current draft: the group becomes a draft task group", verb: "requirement-draft-accept", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/accept`,
    payload: async (c) => { const d = await latestDraft(c); if (d.draftHash === null) throw new EntryRejection("requirement-no-draft", `draft ${d.draftNo} has no output yet`); return { draftNo: d.draftNo, draftHash: d.draftHash }; } }),
  verb({ domain: "requirement", action: "classify", summary: "set the requirement's class (it sets the clarification caps)", verb: "requirement-classify", positionals: [GROUP],
    flags: [{ name: "scope", type: "string", required: true, summary: "small|medium|large" }, { name: "clarity", type: "string", required: true, summary: "the clarity class" }],
    route: (c) => `groups/${group(c)}/requirement/classify`, payload: (c) => ({ scope: str(c, "scope"), clarity: str(c, "clarity") }) }),

  // --- group
  verb({ domain: "group", action: "import", summary: "import a registered plan as a new draft group", verb: "import-plan",
    positionals: [{ name: "plan", summary: "a plan id (or unique prefix) from orca project show / config", required: true }],
    flags: [
      { name: "group", type: "string", summary: "the new group's id" }, { name: "estimator-profile", type: "string", summary: "estimate with this profile" },
      { name: "estimate-mode", type: "string", summary: "strict|soft" },
    ],
    scopeId: (c) => newGroupIdOnce(c), route: () => "groups/import-plan",
    payload: async (c) => {
      const plans = (await config(c)).plans;
      const planId = resolveId("plan", c.ids.plan!, plans.map((p) => p.planId));
      const profile = str(c, "estimator-profile");
      const binding = profile === undefined ? null : await profileBinding(c, profile);
      return {
        groupId: newGroupIdOnce(c), repoId: plans.find((p) => p.planId === planId)!.repoId, planId,
        ...(binding === null ? {} : { estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash }),
        ...(str(c, "estimate-mode") === undefined ? {} : { estimateMode: str(c, "estimate-mode") }),
      };
    } }),
  verb({ domain: "group", action: "estimate", summary: "ask the estimator for budgets at the current proposal version", verb: "estimate", positionals: [GROUP],
    flags: [{ name: "estimator-profile", type: "string", summary: "default: the panel's estimator" }, { name: "mode", type: "string", summary: "strict|soft; default: the panel's" }],
    route: (c) => `groups/${group(c)}/estimates`,
    payload: async (c) => {
      const defaults = (await config(c)).defaults;
      const named = str(c, "estimator-profile");
      const binding = named !== undefined ? await profileBinding(c, named) : defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
      const mode = str(c, "mode") ?? defaults?.estimateMode;
      if (binding === null || mode === undefined) throw new EntryRejection("estimator-unconfigured", "the panel has no estimator default; pass --estimator-profile and --mode");
      return { proposalVersion: (await groupView(c)).proposal.proposalVersion, estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash, estimateMode: mode };
    } }),
  verb({ domain: "group", action: "confirm", summary: "confirm the task plan as shown now; it starts when a slot is free unless --hold", verb: "confirm", positionals: [GROUP],
    flags: [
      { name: "hold", type: "boolean", summary: "confirm only; start it later with orca group start" },
      { name: "budget-mode", type: "string", summary: "strict|soft when the proposal has none" },
      { name: "worker-profile", type: "string", summary: "bind the worker profile" }, { name: "handoff-profile", type: "string", summary: "bind the handoff profile" },
      { name: "goal-review-profile", type: "string", summary: "bind the goal-review profile" },
      { name: "handoff-at-context-tokens", type: "integer", summary: "hand off at this many context tokens" },
    ],
    route: (c) => `groups/${group(c)}/confirm`, payload: (c) => confirmPayload(c) }),
  empty("group", "start", "start a confirmed group (one confirmed with --hold)", "start", "start"),
  empty("group", "pause", "stop dispatching new runs (running ones finish)", "pause-dispatch", "pause-dispatch"),
  empty("group", "resume", "dispatch again after a pause", "resume-dispatch", "resume-dispatch"),
  verb({ domain: "group", action: "stop-handoff", summary: "stop: running tasks hand off and stop", verb: "handoff-stop", positionals: [GROUP],
    flags: [{ name: "deadline", type: "string", summary: "UTC YYYY-MM-DDTHH:mm:ss.sssZ" }],
    route: (c) => `groups/${group(c)}/handoff-stop`, payload: (c) => (str(c, "deadline") === undefined ? {} : { handoffDeadlineAt: str(c, "deadline") }) }),
  verb({ domain: "group", action: "resume-handoff", summary: "resume after a completed handoff; --continue <task> continues that task from its checkpoint", verb: "resume-from-handoff",
    positionals: [GROUP], flags: [{ name: "continue", type: "string", repeatable: true, summary: "a task to continue (repeatable)" }],
    route: (c) => `groups/${group(c)}/resume-from-handoff`,
    payload: async (c) => {
      const items = (await groupView(c)).workItems;
      const selections = [];
      for (const given of list(c, "continue")) {
        const taskId = resolveId("task", given, items.map((w) => w.taskId));
        const runId = items.find((w) => w.taskId === taskId)!.currentRunId;
        if (runId === null) throw new EntryRejection("task-has-no-run", `task ${taskId} has no run to continue`);
        selections.push({ taskId, predecessorRunId: runId, checkpointId: await checkpointOf(c, runId) });
      }
      return { selections };
    } }),
  empty("group", "archive", "archive a group: records stay, it refuses every command but unarchive", "archive-group", "archive"),
  empty("group", "unarchive", "unarchive a group", "unarchive-group", "unarchive"),
  verb({ domain: "group", action: "set-limit", summary: "set the group's budget limit", verb: "set-limit", positionals: [GROUP], access: "token",
    flags: [{ name: "limit", type: "string", required: true, summary: "JSON {tokens,activeMs,attempts,sessions}" }],
    route: (c) => `groups/${group(c)}/set-limit`, payload: (c) => ({ limit: json(c, "limit") }) }),
  verb({ domain: "group", action: "set-integration", summary: "where this group's finished work goes", verb: "set-group-integration", positionals: [GROUP], flags: SCHEME_FLAGS,
    route: (c) => `groups/${group(c)}/integration`, payload: (c) => ({ integration: schemeFromFlags(c) }) }),
  empty("group", "retry-integration", "a blocked or conflicted integration back to idle", "retry-integration", "integration/retry"),
  empty("group", "resolve-integration", "approve an agent resolving the group's integration conflict", "resolve-integration-conflict", "integration/resolve"),
  ...(["depend", "undepend"] as const).map((action) => verb({
    domain: "group", action, summary: action === "depend" ? "make the group wait until --on <group> has landed" : "remove that wait",
    verb: action === "depend" ? "add-group-dependency" : "remove-group-dependency", positionals: [GROUP],
    flags: [{ name: "on", type: "string", required: true, summary: "the group that must land first" }],
    route: (c) => `groups/${group(c)}/dependencies/${action === "depend" ? "add" : "remove"}`,
    payload: async (c) => {
      const summary = await c.read("summary") as { groups: Array<{ groupId: string }> };
      return { dependsOn: resolveId("group", str(c, "on")!, summary.groups.map((g) => g.groupId)) };
    },
  })),

  // --- task
  verb({ domain: "task", action: "retry", summary: "start again a task whose current run failed (the run read now is the one retried)", verb: "retry-task", positionals: [GROUP, TASK],
    route: (c) => `groups/${group(c)}/retry-task`, payload: async (c) => ({ taskId: task(c), runId: await currentRun(c) }) }),
  verb({ domain: "task", action: "continue", summary: "continue a task's current run from its newest complete checkpoint", verb: "continue-task", positionals: [GROUP, TASK],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/continue`,
    payload: async (c) => { const runId = await currentRun(c); return { predecessorRunId: runId, checkpointId: await checkpointOf(c, runId) }; } }),
  verb({ domain: "task", action: "set-loop", summary: "set a task's loop plan from a JSON file {plan,inputs,work,workProvenance?,skills?}", verb: "set-task-loop", positionals: [GROUP, TASK],
    flags: [{ name: "file", type: "string", required: true, summary: "the loop JSON" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/loop`,
    payload: async (c) => {
      const body = file(c);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("--file wants a JSON object");
      return { baseLoopVersion: (await workItem(c)).loopPlan?.loopVersion ?? 0, ...(body as object) };
    } }),
  verb({ domain: "task", action: "set-labels", summary: "set a task's labels (--label repeatable), or --clear back to the plan's", verb: "set-task-labels", positionals: [GROUP, TASK],
    flags: [{ name: "label", type: "string", repeatable: true, summary: "a label" }, { name: "clear", type: "boolean", summary: "drop the operator's labels" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/labels`,
    payload: async (c) => {
      if (c.args.flags.clear === true && list(c, "label").length > 0) throw invalid("--clear takes no --label");
      return { labels: c.args.flags.clear === true ? null : list(c, "label"), baseLabelsVersion: (await workItem(c)).labelsVersion ?? 0 };
    } }),
  verb({ domain: "task", action: "verify-saved-result", summary: "verify the current run's saved result instead of re-running (after run eligibility says eligible)",
    verb: "verify-saved-result", positionals: [GROUP, TASK],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/verify-saved-result`,
    payload: async (c) => {
      const answer = await c.read(`runs/${await currentRun(c)}/saved-result-eligibility`) as { status: string; reason?: string; recoveryOf?: { sourceRunId: string; sourceAttempt: number; capsuleHash: string } };
      if (answer.status !== "eligible" || answer.recoveryOf === undefined) throw new EntryRejection("saved-result-unavailable", `the saved result is not eligible: ${answer.reason ?? answer.status}`);
      const { sourceRunId, sourceAttempt, capsuleHash } = answer.recoveryOf;
      return { sourceRunId, sourceAttempt, capsuleHash };
    } }),
  verb({ domain: "task", action: "settle-usage", summary: "settle a run's unknown usage (cannot be undone)", verb: "settle-unknown-usage", positionals: [GROUP, TASK], access: "token",
    flags: [{ name: "acknowledge", type: "string", required: true, summary: "charge-remaining-grant|release-unmetered" }],
    route: (c) => `groups/${group(c)}/settle-unknown-usage`,
    payload: async (c) => {
      const runId = await currentRun(c);
      const generation = (await groupView(c)).runs.find((r) => r.runId === runId)?.unknownUsageSettlement?.generation;
      if (generation === undefined) throw new EntryRejection("usage-not-unknown", `run ${runId} has no unknown usage to settle`);
      return { taskId: task(c), runId, generation, acknowledge: str(c, "acknowledge") };
    } }),
];

/** One generated id per invocation: the payload and the revision lookup must name the same new group. */
const generated = new WeakMap<WriteContext, string>();
function newGroupIdOnce(c: WriteContext): string {
  let id = generated.get(c);
  if (id === undefined) { id = newGroupId(c); generated.set(c, id); }
  return id;
}

/** Spec §4: confirm's pins, as the Web's confirm builds them (BudgetEditor.tsx submitConfirm), read now. */
async function confirmPayload(c: WriteContext): Promise<unknown> {
  const view = await groupView(c);
  const defaults = (await config(c)).defaults;
  const preview = await c.read(`groups/${group(c)}/agent-preview`) as { proposalVersion?: number; selectionsHash: string | null };
  if (preview.selectionsHash === null || preview.proposalVersion !== view.proposal.proposalVersion) {
    throw new EntryRejection("agent-selection-unresolved", "an agent slot does not resolve at this proposal version; see orca proposal show and orca agent list");
  }
  const flagFor = { worker: "worker-profile", handoff: "handoff-profile", goalReview: "goal-review-profile" } as const;
  const bind = async (kind: "estimator" | "worker" | "handoff" | "goalReview") => {
    if (kind !== "estimator" && str(c, flagFor[kind]) !== undefined) return profileBinding(c, str(c, flagFor[kind])!);
    if (view.proposal.profiles !== null) return view.proposal.profiles[kind];
    return defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
  };
  const bindings = { estimator: await bind("estimator"), worker: await bind("worker"), handoff: await bind("handoff"), goalReview: await bind("goalReview") };
  for (const kind of ["worker", "handoff", "goalReview"] as const) {
    if (bindings[kind] === null) throw new EntryRejection("confirm-profile-missing", `no ${kind} profile; pass --${flagFor[kind]} <id>`);
  }
  const budgetMode = view.proposal.budgetMode ?? str(c, "budget-mode") ?? defaults?.estimateMode;
  if (budgetMode === undefined) throw new EntryRejection("confirm-budget-mode-missing", "the proposal has no budget mode; pass --budget-mode strict|soft");
  const tokens = c.args.flags["handoff-at-context-tokens"];
  return {
    planHash: view.plan.planHash, proposalVersion: view.proposal.proposalVersion, budgetMode,
    profileIds: { estimator: bindings.estimator?.profileId ?? null, worker: bindings.worker!.profileId, handoff: bindings.handoff!.profileId, goalReview: bindings.goalReview!.profileId },
    profileHashes: { estimator: bindings.estimator?.profileHash ?? null, worker: bindings.worker!.profileHash, handoff: bindings.handoff!.profileHash, goalReview: bindings.goalReview!.profileHash },
    contextPolicy: { handoffAtContextTokens: typeof tokens === "number" ? tokens : view.proposal.contextPolicy.handoffAtContextTokens },
    selectionsHash: preview.selectionsHash,
    ...(view.integration === undefined ? {} : { integrationHash: view.integration.schemeHash }),
    ...(c.args.flags.hold === true ? { hold: true } : {}),
  };
}
