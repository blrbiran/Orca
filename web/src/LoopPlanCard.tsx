/**
 * Loop plans spec §4.1, §4.2 (D1, D4, D5, D9): a task's loop plan in plain words, and -- until the task starts -- a form
 * to change the plan, its inputs and its work budget (set-task-loop). The form keeps what the person typed as a draft
 * together with the loopVersion it started from, and sends that version, never the one the latest poll read, so a draft
 * begun before someone else's change is refused as task-loop-version-conflict instead of overwriting it (the label
 * editor's pattern, TaskDetail.tsx). The submit states its consequence for the group's reserve; that arithmetic is
 * display only -- the ledger decides and refuses by name. The plan's words come from the panel's resources, keyed by
 * plan version (panel i18n spec §3.1).
 */
import type { JSX } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import i18n, { enumText } from "./i18n.js";
import { WEB_LOOP_PLANS } from "./controlTypes.js";
import type { Amount, GroupViewV1, LoopPlanIdV1, LoopPlanViewV1, SetTaskLoopPayloadV1, WorkItemViewV1 } from "./controlTypes.js";

export const loopDraftKey = (groupId: string, taskId: string): string => `loop:${groupId}:${taskId}`;

/**
 * Panel i18n spec §3.1: a plan version's name or discipline line from the panel's resources (the registry is the English
 * source of record, §6.9). A version this panel has no words for (a newer server) shows the plan id, never nothing.
 */
export function planText(planId: LoopPlanIdV1, version: number, part: "name" | "discipline"): string {
  const key = `loopPlan.plan.${planId}.v${version}.${part}`;
  if (i18n.exists(key)) return i18n.t(key as never) as string;
  return part === "name" ? planId : `${planId} v${version}`;
}

/** "Bug fix (red first) · v1 · chosen by label `bug` · changed" (loop plans spec §4.1). */
export function loopPlanTitle(plan: LoopPlanViewV1): string {
  const how = plan.chosenBy === "explicit"
    ? i18n.t("loopPlan.title.byHand")
    : plan.chosenByLabel === null ? i18n.t("loopPlan.title.noLabel") : i18n.t("loopPlan.title.byLabel", { label: plan.chosenByLabel });
  const line = i18n.t("loopPlan.title.line", { name: planText(plan.planId, plan.planVersion, "name"), version: plan.planVersion, how });
  return plan.amended ? `${line}${i18n.t("loopPlan.title.changed")}` : line;
}

/**
 * Loop plans spec §4.1, panel i18n spec §3.1: the card's lines, each stating how hard it is (spec §2.1): the write set is
 * git-checked; protected paths and the file cap are only what the agent reports; the discipline line says who checks it.
 * The check commands' text is never in a line -- the card shows it collapsed. In English these are exactly the lines the
 * server's describeLoopPlan used to send (§6.3).
 */
export function loopSummaryLines(plan: LoopPlanViewV1): string[] {
  const inputs = plan.inputs;
  const separator = i18n.t("loopPlan.summary.pathSeparator");
  return [
    i18n.t("loopPlan.summary.goal", { goal: inputs.goal }),
    i18n.t("loopPlan.summary.doneWhen", { condition: inputs.successCondition }),
    i18n.t("loopPlan.summary.onlyChanges", { paths: inputs.targetPaths.join(separator) }),
    ...(inputs.protectedPaths.length > 0 ? [i18n.t("loopPlan.summary.mustNotChange", { paths: inputs.protectedPaths.join(separator) })] : []),
    plan.maxFiles === Number.MAX_SAFE_INTEGER ? i18n.t("loopPlan.summary.noFileLimit") : i18n.t("loopPlan.summary.files", { count: plan.maxFiles }),
    i18n.t("loopPlan.summary.checks", { count: inputs.checks.length }),
    ...(plan.hasDiscipline ? [planText(plan.planId, plan.planVersion, "discipline")] : []),
  ];
}

const FIELDS = ["goal", "successCondition", "targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths", "maxFilesTouched", "tokens", "activeMs", "attempts"] as const;
type Field = (typeof FIELDS)[number];
const LIST_FIELDS = new Set<Field>(["targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths"]);
const FIELD_KEY = {
  goal: "loopPlan.field.goal", successCondition: "loopPlan.field.successCondition", targetPaths: "loopPlan.field.targetPaths",
  checks: "loopPlan.field.checks", nonGoals: "loopPlan.field.nonGoals", relevantDocs: "loopPlan.field.relevantDocs",
  protectedPaths: "loopPlan.field.protectedPaths", maxFilesTouched: "loopPlan.field.maxFilesTouched", tokens: "loopPlan.field.tokens",
  activeMs: "loopPlan.field.activeMs", attempts: "loopPlan.field.attempts",
} as const satisfies Record<Field, string>;

/** What the person typed, as text, and the loopVersion shown when they started. */
interface LoopDraft { base: number; plan: LoopPlanIdV1; text: Record<Field, string> }

function readLoopDraft(drafts: Record<string, string>, key: string): LoopDraft | null {
  const raw = drafts[key];
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LoopDraft>;
    if (!Number.isSafeInteger(parsed.base) || !WEB_LOOP_PLANS.some((plan) => plan.planId === parsed.plan)) return null;
    const text = parsed.text as Record<string, unknown> | undefined;
    if (typeof text !== "object" || text === null || !FIELDS.every((field) => typeof text[field] === "string")) return null;
    return parsed as LoopDraft;
  } catch {
    return null;
  }
}

function draftOf(plan: LoopPlanViewV1, work: Amount): LoopDraft {
  const i = plan.inputs;
  return { base: plan.loopVersion, plan: plan.planId, text: {
    goal: i.goal, successCondition: i.successCondition, targetPaths: i.targetPaths.join("\n"), checks: i.checks.join("\n"),
    nonGoals: i.nonGoals.join("\n"), relevantDocs: i.relevantDocs.join("\n"), protectedPaths: i.protectedPaths.join("\n"),
    maxFilesTouched: i.maxFilesTouched === null ? "" : String(i.maxFilesTouched),
    tokens: String(work.tokens), activeMs: String(work.activeMs), attempts: String(work.attempts),
  } };
}

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
const positive = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isSafeInteger(value) && value > 0 ? value : null;
};

/**
 * The payload a draft sends, or why it cannot be sent yet (a number that is not a positive safe integer; the server re-checks everything).
 * Syncskill integration spec §10.4 (C14): the form does not edit skills, and a payload without them removes them, so the
 * task's current skill set is carried through unchanged.
 */
function payloadOf(draft: LoopDraft, skills: LoopPlanViewV1["skills"]): { payload: SetTaskLoopPayloadV1 } | { invalid: string } {
  const tokens = positive(draft.text.tokens), activeMs = positive(draft.text.activeMs), attempts = positive(draft.text.attempts);
  if (tokens === null || activeMs === null || attempts === null) return { invalid: i18n.t("loopPlan.badBudget") };
  const blankCap = draft.text.maxFilesTouched.trim() === "";
  const cap = blankCap ? null : positive(draft.text.maxFilesTouched);
  if (!blankCap && cap === null) return { invalid: i18n.t("loopPlan.badFileCap") };
  return { payload: {
    baseLoopVersion: draft.base, plan: draft.plan,
    inputs: {
      goal: draft.text.goal.trim(), successCondition: draft.text.successCondition.trim(), targetPaths: lines(draft.text.targetPaths),
      checks: lines(draft.text.checks), nonGoals: lines(draft.text.nonGoals), relevantDocs: lines(draft.text.relevantDocs),
      protectedPaths: lines(draft.text.protectedPaths), maxFilesTouched: cap,
    },
    work: { tokens, activeMs, attempts },
    ...(skills === undefined ? {} : { skills }),
  } };
}

/** Syncskill integration spec §4.6: the declared skill set, and for a profile the names it froze to once the group is confirmed. */
function skillSetText(plan: LoopPlanViewV1, t: TFunction): string {
  const skills = plan.skills;
  if (skills === undefined) return t("loopPlan.skillsNone");
  if ("names" in skills) return t("loopPlan.skillsNames", { names: skills.names.join(", ") });
  return plan.frozenSkillNames === undefined
    ? t("loopPlan.skillsProfile", { profile: skills.profile })
    : t("loopPlan.skillsProfileFrozen", { profile: skills.profile, names: plan.frozenSkillNames.join(", ") });
}

/** Spec §4.2: what the submit does to the group's reserve, and the shortfall that disables it (display only). */
export function consequenceOf(view: GroupViewV1, current: Amount, work: { tokens: number; activeMs: number; attempts: number }): { text: string; shortfall: string | null } {
  const reserve = view.ledger.explicitUnallocatedReserve;
  const parts: string[] = [];
  let shortfall: string | null = null;
  for (const dimension of ["tokens", "activeMs", "attempts"] as const) {
    const delta = work[dimension] - current[dimension];
    if (delta === 0) continue;
    const values = { delta: `${delta > 0 ? "+" : ""}${delta}`, unit: i18n.t(`loopPlan.unit.${dimension}`), left: reserve[dimension] - delta };
    parts.push(delta > 0 ? i18n.t("loopPlan.budgetTaken", values) : i18n.t("loopPlan.budgetReturned", values));
    if (delta > reserve[dimension] && shortfall === null) {
      shortfall = i18n.t("loopPlan.shortfall", { dimension: enumText("dimension", dimension), short: delta - reserve[dimension] });
    }
  }
  return { text: parts.length === 0 ? i18n.t("loopPlan.unchanged") : parts.join(i18n.t("loopPlan.partSeparator")), shortfall };
}

export interface LoopPlanCardProps {
  view: GroupViewV1;
  item: WorkItemViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /**
   * Board spec 2026-10-03 D7: the repository's workspace mode, for the git line. null: the page has not read it yet.
   * Absent: a caller that never reads it (older criteria) -- the line names the repository default, a worktree.
   */
  workspaceMode?: "worktree" | "clone" | null;
}

function LoopPlanEditor(props: LoopPlanCardProps & { plan: LoopPlanViewV1; current: Amount }): JSX.Element {
  const { t } = useTranslation();
  const { view, item, drafts, onDraft, onCommand, plan, current } = props;
  const groupId = view.summary.groupId, key = loopDraftKey(groupId, item.taskId), draft = readLoopDraft(drafts, key);
  // Spec §4.2 (D4): only a task that has not started may change; a finished run counts (spec §5.2 step 2).
  const started = (item.status !== "draft" && item.status !== "ready") || item.lineageRunIds.length > 0;
  if (started) return <p>{t("loopPlan.started")}</p>;
  // Spec §5.2 step 1: the server refuses every group state but draft/ready, and a stopped group, as group-state-invalid;
  // offering the form there would only let a person fill it in to be refused (final review, B6).
  const open = (view.summary.state === "draft" || view.summary.state === "ready") && view.summary.stopMode === null;
  if (!open) return <p>{t("loopPlan.notOpen")}</p>;
  if (draft === null) return <button type="button" onClick={() => onDraft(key, JSON.stringify(draftOf(plan, current)))}>{t("loopPlan.changePlan")}</button>;
  const set = (patch: Partial<LoopDraft>): void => onDraft(key, JSON.stringify({ ...draft, ...patch }));
  const checked = payloadOf(draft, plan.skills);
  const payload = "payload" in checked ? checked.payload : null;
  const consequence = payload === null ? null : consequenceOf(view, current, payload.work);
  const blocked = "invalid" in checked ? checked.invalid : consequence!.shortfall;
  return (
    <form aria-label={t("loopPlan.changePlanFor", { taskId: item.taskId })} onSubmit={(event) => {
      event.preventDefault();
      if (payload !== null && blocked === null) onCommand({ verb: "set-task-loop", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision, payload });
    }}>
      {draft.base !== plan.loopVersion && <p role="status">{t("loopPlan.draftBehind", { base: draft.base, current: plan.loopVersion })}</p>}
      <label>
        {t("loopPlan.planLabel")}
        <select aria-label={t("loopPlan.planLabel")} value={draft.plan} onChange={(event) => set({ plan: event.target.value as LoopPlanIdV1 })}>
          {WEB_LOOP_PLANS.map((option) => <option key={option.planId} value={option.planId}>{planText(option.planId, option.version, "name")}</option>)}
        </select>
      </label>
      {FIELDS.map((field) => (
        <label key={field}>
          {t(FIELD_KEY[field])}
          {LIST_FIELDS.has(field)
            ? <textarea aria-label={t(FIELD_KEY[field])} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />
            : <input aria-label={t(FIELD_KEY[field])} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />}
        </label>
      ))}
      {blocked !== null && <p role="alert">{blocked}</p>}
      <button type="submit" disabled={blocked !== null}>{consequence?.text ?? blocked}</button>
      <button type="button" onClick={() => onDraft(key, "")}>{t("loopPlan.discard")}</button>
    </form>
  );
}

function gitLineKey(mode: LoopPlanCardProps["workspaceMode"]): "loopPlan.git" | "loopPlan.gitClone" | "loopPlan.gitModeUnread" {
  if (mode === null) return "loopPlan.gitModeUnread";
  return mode === "clone" ? "loopPlan.gitClone" : "loopPlan.git";
}

export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null {
  const { t } = useTranslation();
  const { view, item } = props;
  // A view that says nothing about the plan (an older server, a literal fixture) gets no card rather than a wrong one.
  if (item.loopPlan === undefined) return null;
  if (item.loopPlan === null) {
    return (
      <section aria-label={t("loopPlan.region", { taskId: item.taskId })}>
        <h5>{t("loopPlan.handWritten")}</h5>
        {item.objective !== undefined && (
          <ul>
            <li>{t("loopPlan.summary.goal", { goal: item.objective.goal })}</li>
            <li>{t("loopPlan.summary.doneWhen", { condition: item.objective.successCondition })}</li>
          </ul>
        )}
      </section>
    );
  }
  const plan = item.loopPlan;
  const work = view.allocations.find((row) => row.ownerKind === "task" && row.ownerId === item.taskId && row.bucket === "work");
  return (
    <section aria-label={t("loopPlan.region", { taskId: item.taskId })}>
      <h5>{loopPlanTitle(plan)}</h5>
      <ul aria-label={t("loopPlan.summaryRegion", { taskId: item.taskId })}>
        {loopSummaryLines(plan).map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <details>
        <summary>{t("loopPlan.checkCommands", { n: plan.inputs.checks.length })}</summary>
        <ul>{plan.inputs.checks.map((check, index) => <li key={index}><code>{check}</code></li>)}</ul>
      </details>
      {work !== undefined && <p>{t("loopPlan.budgetLine", { tokens: work.amount.tokens, activeMs: work.amount.activeMs, attempts: work.amount.attempts })}</p>}
      <p><Trans i18nKey={gitLineKey(props.workspaceMode)} values={{ groupId: view.summary.groupId }} components={{ code: <code /> }} /></p>
      <p>{skillSetText(plan, t)}</p>
      {work !== undefined && <LoopPlanEditor {...props} plan={plan} current={work.amount} />}
    </section>
  );
}
