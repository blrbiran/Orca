/**
 * Loop plans spec §4.1, §4.2 (D1, D4, D5, D9): a task's loop plan in plain words, and -- until the task starts -- a form
 * to change the plan, its inputs and its work budget (set-task-loop). The form keeps what the person typed as a draft
 * together with the loopVersion it started from, and sends that version, never the one the latest poll read, so a draft
 * begun before someone else's change is refused as task-loop-version-conflict instead of overwriting it (the label
 * editor's pattern, TaskDetail.tsx). The submit states its consequence for the group's reserve; that arithmetic is
 * display only -- the ledger decides and refuses by name. Strings are the panel's English (plan ruling R-F5, rulings P1).
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import { WEB_LOOP_PLANS } from "./controlTypes.js";
import type { Amount, GroupViewV1, LoopPlanIdV1, LoopPlanViewV1, SetTaskLoopPayloadV1, WorkItemViewV1 } from "./controlTypes.js";

export const loopDraftKey = (groupId: string, taskId: string): string => `loop:${groupId}:${taskId}`;

/** "Bug fix (red first) · v1 · chosen by label `bug` · changed" (spec §4.1, plan ruling R-F5). */
export function loopPlanTitle(plan: LoopPlanViewV1): string {
  const how = plan.chosenBy === "explicit" ? "chosen by hand" : plan.chosenByLabel === null ? "no label, default" : `chosen by label \`${plan.chosenByLabel}\``;
  return `${plan.planName} · v${plan.planVersion} · ${how}${plan.amended ? " · changed" : ""}`;
}

const FIELDS = ["goal", "successCondition", "targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths", "maxFilesTouched", "tokens", "activeMs", "attempts"] as const;
type Field = (typeof FIELDS)[number];
const LIST_FIELDS = new Set<Field>(["targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths"]);
const FIELD_LABEL: Record<Field, string> = {
  goal: "Goal", successCondition: "Done when", targetPaths: "Only changes (one path per line)", checks: "Check commands (one per line)",
  nonGoals: "Non-goals (one per line)", relevantDocs: "Relevant docs (one per line)", protectedPaths: "Must not change (one path per line)",
  maxFilesTouched: "Max files changed (blank for default)", tokens: "Token budget", activeMs: "Active time (ms)", attempts: "Max attempts",
};
const BAD_BUDGET = "Budgets must be positive integers";
const BAD_FILE_CAP = "Max files changed must be a positive integer";

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

/** The payload a draft sends, or why it cannot be sent yet (a number that is not a positive safe integer; the server re-checks everything). */
function payloadOf(draft: LoopDraft): { payload: SetTaskLoopPayloadV1 } | { invalid: string } {
  const tokens = positive(draft.text.tokens), activeMs = positive(draft.text.activeMs), attempts = positive(draft.text.attempts);
  if (tokens === null || activeMs === null || attempts === null) return { invalid: BAD_BUDGET };
  const blankCap = draft.text.maxFilesTouched.trim() === "";
  const cap = blankCap ? null : positive(draft.text.maxFilesTouched);
  if (!blankCap && cap === null) return { invalid: BAD_FILE_CAP };
  return { payload: {
    baseLoopVersion: draft.base, plan: draft.plan,
    inputs: {
      goal: draft.text.goal.trim(), successCondition: draft.text.successCondition.trim(), targetPaths: lines(draft.text.targetPaths),
      checks: lines(draft.text.checks), nonGoals: lines(draft.text.nonGoals), relevantDocs: lines(draft.text.relevantDocs),
      protectedPaths: lines(draft.text.protectedPaths), maxFilesTouched: cap,
    },
    work: { tokens, activeMs, attempts },
  } };
}

/** Spec §4.2: what the submit does to the group's reserve, and the shortfall that disables it (display only). */
export function consequenceOf(view: GroupViewV1, current: Amount, work: { tokens: number; activeMs: number; attempts: number }): { text: string; shortfall: string | null } {
  const reserve = view.ledger.explicitUnallocatedReserve;
  const parts: string[] = [];
  let shortfall: string | null = null;
  for (const [dimension, unit] of [["tokens", "tokens"], ["activeMs", "ms active time"], ["attempts", "attempts"]] as const) {
    const delta = work[dimension] - current[dimension];
    if (delta === 0) continue;
    parts.push(`Budget ${delta > 0 ? "+" : ""}${delta} ${unit}, ${delta > 0 ? "taken from the group reserve" : "returned to the group reserve"}; ${reserve[dimension] - delta} left`);
    if (delta > reserve[dimension] && shortfall === null) shortfall = `Group reserve too small: ${dimension} short by ${delta - reserve[dimension]}`;
  }
  return { text: parts.length === 0 ? "Budget unchanged" : parts.join("; "), shortfall };
}

export interface LoopPlanCardProps {
  view: GroupViewV1;
  item: WorkItemViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
}

function LoopPlanEditor(props: LoopPlanCardProps & { plan: LoopPlanViewV1; current: Amount }): JSX.Element {
  const { view, item, drafts, onDraft, onCommand, plan, current } = props;
  const groupId = view.summary.groupId, key = loopDraftKey(groupId, item.taskId), draft = readLoopDraft(drafts, key);
  // Spec §4.2 (D4): only a task that has not started may change; a finished run counts (spec §5.2 step 2).
  const started = (item.status !== "draft" && item.status !== "ready") || item.lineageRunIds.length > 0;
  if (started) return <p>Started; the plan is frozen</p>;
  // Spec §5.2 step 1: the server refuses every group state but draft/ready, and a stopped group, as group-state-invalid;
  // offering the form there would only let a person fill it in to be refused (final review, B6).
  const open = (view.summary.state === "draft" || view.summary.state === "ready") && view.summary.stopMode === null;
  if (!open) return <p>The group is not open for changes; the plan is frozen</p>;
  if (draft === null) return <button type="button" onClick={() => onDraft(key, JSON.stringify(draftOf(plan, current)))}>Change plan</button>;
  const set = (patch: Partial<LoopDraft>): void => onDraft(key, JSON.stringify({ ...draft, ...patch }));
  const checked = payloadOf(draft);
  const payload = "payload" in checked ? checked.payload : null;
  const consequence = payload === null ? null : consequenceOf(view, current, payload.work);
  const blocked = "invalid" in checked ? checked.invalid : consequence!.shortfall;
  return (
    <form aria-label={`Change plan ${item.taskId}`} onSubmit={(event) => {
      event.preventDefault();
      if (payload !== null && blocked === null) onCommand({ verb: "set-task-loop", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision, payload });
    }}>
      {draft.base !== plan.loopVersion && <p role="status">The plan changed after you started this draft (v{draft.base} → v{plan.loopVersion})</p>}
      <label>
        Plan
        <select aria-label="Plan" value={draft.plan} onChange={(event) => set({ plan: event.target.value as LoopPlanIdV1 })}>
          {WEB_LOOP_PLANS.map((option) => <option key={option.planId} value={option.planId}>{option.name}</option>)}
        </select>
      </label>
      {FIELDS.map((field) => (
        <label key={field}>
          {FIELD_LABEL[field]}
          {LIST_FIELDS.has(field)
            ? <textarea aria-label={FIELD_LABEL[field]} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />
            : <input aria-label={FIELD_LABEL[field]} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />}
        </label>
      ))}
      {blocked !== null && <p role="alert">{blocked}</p>}
      <button type="submit" disabled={blocked !== null}>{consequence?.text ?? blocked}</button>
      <button type="button" onClick={() => onDraft(key, "")}>Discard plan draft</button>
    </form>
  );
}

export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null {
  const { view, item } = props;
  // A view that says nothing about the plan (an older server, a literal fixture) gets no card rather than a wrong one.
  if (item.loopPlan === undefined) return null;
  if (item.loopPlan === null) {
    return (
      <section aria-label={`Plan ${item.taskId}`}>
        <h5>Hand-written contract</h5>
        {item.objective !== undefined && (
          <ul>
            <li>Goal: {item.objective.goal}</li>
            <li>Done when: {item.objective.successCondition}</li>
          </ul>
        )}
      </section>
    );
  }
  const plan = item.loopPlan;
  const work = view.allocations.find((row) => row.ownerKind === "task" && row.ownerId === item.taskId && row.bucket === "work");
  return (
    <section aria-label={`Plan ${item.taskId}`}>
      <h5>{loopPlanTitle(plan)}</h5>
      <ul aria-label={`Plan summary ${item.taskId}`}>
        {plan.summary.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <details>
        <summary>Check commands ({plan.inputs.checks.length})</summary>
        <ul>{plan.inputs.checks.map((check, index) => <li key={index}><code>{check}</code></li>)}</ul>
      </details>
      {work !== undefined && <p>Budget: {work.amount.tokens} tokens · active time {work.amount.activeMs} ms · max attempts {work.amount.attempts}</p>}
      <p>Git workspace: its own worktree, merged back into <code>orca/{view.summary.groupId}</code>; pushing is done by a person</p>
      <p>Skill set: not supported yet</p>
      {work !== undefined && <LoopPlanEditor {...props} plan={plan} current={work.amount} />}
    </section>
  );
}
