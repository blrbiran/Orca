/**
 * Tester #373 (batch D C1): what to do next after a common refusal that no verb explains with its own hint. One fact per
 * code, with the command that answers it; the panel's refusal itself (code, message, exit 2) is unchanged.
 */
const NEXT: Readonly<Record<string, string>> = {
  // Start guard spec 2026-10-15 §3.2 keeps this a refusal; #374d: a queued start wake, or an active run or task
  // (executionPending.ts), so no second start is needed.
  "group-execution-pending": "the group's start is already queued or its work is under way; orca group brief <group> shows which",
  // Raised by start, retry, reopen, accept-attempt, continue and settlement under a pause, stop or shutdown.
  "stop-mode-conflict": "this command conflicts with the group's pause/stop state; orca group brief <group> shows it",
  // #368a: a proposal change after the start, or a funded-allowance policy after a task ran (fundedAllowance.ts).
  "grant-amendment-unsupported": "the group has started, so its proposal no longer changes",
  "requirement-not-split": "the requirement is not split into tasks yet; orca requirement show <group> shows the open round",
  "group-state-invalid": "the group is not in a state this command accepts; orca group brief <group> shows its state",
  "no-op-command": "nothing to change: it is already as this command would set it",
  // #355 review (minor 5): an archived group also takes close (a done one converts to closed).
  "group-archived": "the group is archived and refuses every command but unarchive and close (which converts a done one); orca group unarchive <group> first",
  // Tester #355: a closed group takes unclose (and archive, which converts it); only a done group closes.
  "group-closed": "the group is closed and refuses every command but unclose and archive; orca group unclose <group> first",
  "group-not-done": "only a done group closes; to set aside a group that is not done, orca group archive <group>",
  "close-delivery-pending": "the group's delivery is still owed (being pushed, backing off, in conflict or blocked, or a draft pull request not yet ready); orca group brief <group> shows it -- close works once it is delivered, and orca group archive <group> sets it aside now",
};

/** Fix wave m-6: `<group>` is the group's id when the CLI knows it. */
export function nextForCode(code: string, groupId?: string): string | null {
  if (!Object.hasOwn(NEXT, code)) return null;
  return groupId === undefined ? NEXT[code]! : NEXT[code]!.replaceAll("<group>", groupId);
}
