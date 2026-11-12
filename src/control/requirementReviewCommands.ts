import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { openFixTask, saveReview } from "./requirementReview.js";
import { reviewOf, type RequirementReview } from "./requirementReviewRecord.js";
import { commandSuccess } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Tester follow-up G spec §3.5 (controller's call): the three ways out of a requirement review that did not pass, for a
 * person and an orchestrating agent alike (§7). Each answers a `not-passed` review only (`requirement-review-not-open:<state>`).
 * - `review-accept`: the group is accepted as it is (`accepted`, with who and why); the done gate then holds.
 * - `review-rerun`: the review runs again on the same tip, its prompt carrying the note.
 * - `review-fix`: a fix task by hand, its goal the person's or agent's words; it does not use up an automatic round.
 */
export type ReviewAcceptCommand = Extract<RawAuthorityCommandV1, { verb: "review-accept" }>;
export type ReviewRerunCommand = Extract<RawAuthorityCommandV1, { verb: "review-rerun" }>;
export type ReviewFixCommand = Extract<RawAuthorityCommandV1, { verb: "review-fix" }>;

function notPassed(store: ControlStore, groupId: string): RequirementReview {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) throw new ControlError("group-not-found");
  const review = reviewOf(JSON.parse(String(row.body)));
  if (review === null || review.state !== "not-passed") throw new ControlError("requirement-review-not-open", review?.state ?? "none");
  return review;
}
const principalOf = (command: { commandId: string; actorId: string }): string => commandPrincipalFor(command.commandId) ?? command.actorId;

export function applyReviewAccept(deps: { store: ControlStore }, command: ReviewAcceptCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId, review = notPassed(deps.store, groupId), by = principalOf(command), at = deps.store.now();
      const { why: _why, ...rest } = review;
      saveReview(deps.store, groupId, { ...rest, state: "accepted", accepted: { by, note: command.payload.note, at } });
      recordActivity(deps.store, { groupId, kind: "requirement-review", body: { action: "accepted", by, note: command.payload.note } });
      return commandSuccess(context, { kind: "review-accepted", groupId });
    },
  }).body;
}

export function applyReviewRerun(deps: { store: ControlStore }, command: ReviewRerunCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId, review = notPassed(deps.store, groupId), by = principalOf(command), at = deps.store.now();
      const { why: _why, ...rest } = review;
      saveReview(deps.store, groupId, { ...rest, state: "pending", rerun: { by, note: command.payload.note, at } });
      recordActivity(deps.store, { groupId, kind: "requirement-review", body: { action: "rerun", by, note: command.payload.note } });
      return commandSuccess(context, { kind: "review-rerun-requested", groupId });
    },
  }).body;
}

export function applyReviewFix(deps: { store: ControlStore }, command: ReviewFixCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId, review = notPassed(deps.store, groupId), by = principalOf(command);
      const last = review.rounds.at(-1);
      if (last === undefined) throw new ControlError("requirement-review-not-open", "no-round");
      const opened = openFixTask(deps.store, groupId, last, by, command.payload.goal, command.payload.paths);
      if ("refused" in opened) throw new ControlError(opened.refused === "unfunded" ? "group-budget-unavailable" : "recovery-blocked", "review-fix");
      const rounds = review.rounds.map((round) => round === last ? { ...round, fixTaskId: opened.taskId, fixBy: by } : round);
      const { why: _why, ...rest } = review;
      saveReview(deps.store, groupId, { ...rest, rounds, state: "fixing" });
      recordActivity(deps.store, { groupId, kind: "requirement-review", body: { action: "fix-opened", by, taskId: opened.taskId, goal: command.payload.goal } });
      return commandSuccess(context, { kind: "review-fix-opened", groupId, taskId: opened.taskId });
    },
  }).body;
}
