/**
 * Issue #156 (session 3cfc2e73): `orca group apply-estimate <group> [--dry-run]`, the CLI's "Apply all suggestions".
 * The panel's budget editor decides what to send in the browser (single-call estimate spec §7: an estimate is a
 * suggestion a person applies); the CLI had no equivalent, so an agent could not apply a ready estimate without
 * hand-built JSON. This sends exactly the commands the panel's "Apply all" sends -- the same pure transform
 * (src/control/budgetSuggestions.ts), in the same order, each at the revision the previous one answered (App.tsx
 * sendControlSequence). A loop task's sessions are never set by an estimate (R10), on either side.
 */
import { randomUUID } from "node:crypto";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "../../entry/envelope.js";
import { adviceOf, estimateIsAdvisory, suggestionActions, type SuggestionAction, type SuggestionView } from "../../control/budgetSuggestions.js";
import { printResponse, type SentRequest } from "../output.js";
import type { CommandIo, ParsedArgs } from "../types.js";

const routeOf = (action: SuggestionAction): string => action.verb === "proposal-edit"
  ? `groups/${action.groupId}/proposal/edit`
  : `groups/${action.groupId}/tasks/${action.taskId}/loop`;

interface Planned { verb: SuggestionAction["verb"]; route: string; payload: unknown }
interface Applied extends Planned { commandId: string; expectedRevision: number; commandRevision: number | null }

export function formatApplied(body: unknown): string {
  const b = body as { groupId: string; estimateId: string; dryRun: boolean; actions: Planned[]; applied: Applied[]; expectations?: Array<{ taskId: string; tokens: number }> };
  const list = b.dryRun ? b.actions : b.applied;
  // Budget defaults spec 2026-11-11 §7 item 5: in a group with no token limit the estimate is each task's expectation; no
  // task-work ceiling is sent, so "already matches / nothing to apply" would misstate what happened.
  const expected = b.expectations === undefined ? [] : [
    `${b.groupId}: the group has no token limit, so estimate ${b.estimateId} is recorded as the expectation, not a ceiling`,
    ...b.expectations.map((e) => `  task ${e.taskId}: expected ${e.tokens} tokens`),
  ];
  if (list.length === 0) return expected.length > 0 ? expected.join("\n") : `${b.groupId}: the proposal already matches estimate ${b.estimateId}; nothing to apply`;
  const lines = [...expected, `${b.groupId}: ${b.dryRun ? "would send" : "sent"} ${list.length} command(s) from estimate ${b.estimateId}`];
  for (const entry of list) {
    const payload = entry.payload as { operations?: Array<{ target: Record<string, string>; value: number }>; work?: Record<string, number | null>; workProvenance?: Record<string, unknown> };
    if (entry.verb === "proposal-edit") {
      for (const op of payload.operations ?? []) {
        const where = op.target.scope === "task" ? `task ${op.target.taskId} ${op.target.allocation}` : "goal review";
        lines.push(`  ${where} ${op.target.dimension} = ${op.value}`);
      }
    } else {
      const task = entry.route.split("/")[3];
      for (const dimension of Object.keys(payload.workProvenance ?? {})) lines.push(`  task ${task} work ${dimension} = ${payload.work?.[dimension]} (set-task-loop)`);
    }
  }
  if (list.some((entry) => entry.verb === "set-task-loop")) lines.push("  a loop task's sessions are not set by an estimate (R10)");
  return lines.join("\n");
}

export async function runApplyEstimate(args: ParsedArgs, io: CommandIo): Promise<number> {
  const print = (response: CliResponseV1, request?: SentRequest) => printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: formatApplied }, io, request);
  const { PanelAnswer, contextFor, openSession, resolveIds } = await import("../panelCommand.js");
  try {
    const { sendExactly, uncertain, withCurrentRevision } = await import("../write.js");
    const session = openSession(args, io);
    const ids = await resolveIds(args, session);
    const view = await contextFor(args, io, session, ids).read(`groups/${ids.group}`) as SuggestionView;
    const advice = adviceOf(view);
    if (advice === null) throw new EntryRejection("estimate-not-ready", `${ids.group} has no ready estimate for its current plan on an editable proposal (orca proposal show; orca group estimate)`);
    if (advice.stale) throw new EntryRejection("estimate-stale", `the newest estimate of ${ids.group} predates a set-task-loop change; run orca group estimate again`);
    const actions = suggestionActions(view, { kind: "all" });
    const base = { schema: "orca-apply-estimate-v1", groupId: view.summary.groupId, estimateId: advice.estimateId, dryRun: args.flags["dry-run"] === true,
      // §7 item 5: present only in a group with no token limit, so a finite group's answer keeps its bytes.
      ...(estimateIsAdvisory(view) ? { expectations: advice.output.tasks.map((task) => ({ taskId: task.taskId, tokens: task.work.tokens })) } : {}) };
    const planned: Planned[] = actions.map((action) => ({ verb: action.verb, route: routeOf(action), payload: action.payload }));
    if (base.dryRun || actions.length === 0) return print({ schema: "orca-cli-response-v1", status: 200, body: { ...base, actions: planned, applied: [] } });
    const prefix = session.client === "mcp" || session.client.startsWith("mcp:") ? "mcp" : "cli";
    const applied: Applied[] = [];
    let revision = args.global.ifRevision ?? view.summary.commandRevision;
    for (const [index, action] of planned.entries()) {
      const request: SentRequest = { route: action.route, expectedRevision: revision, payload: action.payload, commandId: index === 0 && args.global.commandId !== undefined ? args.global.commandId : `${prefix}-${randomUUID()}` };
      const response = withCurrentRevision(await sendExactly(session, request));
      if (exitCodeFor(response) !== 0) {
        // The commands before this one stand (each is its own ledger entry); the answer names them so nothing is guessed.
        if (!args.global.json && applied.length > 0) io.stderr(`orca: ${applied.length} of ${planned.length} command(s) were applied before this refusal\n`);
        const body = typeof response.body === "object" && response.body !== null ? { ...(response.body as object), applied } : response.body;
        return print({ ...response, body }, uncertain(response) ? request : undefined);
      }
      const next = (response.body as { commandRevision?: unknown }).commandRevision;
      applied.push({ ...action, commandId: request.commandId, expectedRevision: revision, commandRevision: typeof next === "number" ? next : null });
      if (typeof next !== "number") throw new EntryRejection("command-revision-missing", `the answer to ${action.verb} carried no commandRevision; ${applied.length} of ${planned.length} command(s) were applied`);
      revision = next;
    }
    return print({ schema: "orca-cli-response-v1", status: 200, body: { ...base, actions: planned, applied } });
  } catch (error) {
    if (error instanceof PanelAnswer) return print(error.response);
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
