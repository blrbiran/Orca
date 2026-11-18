/**
 * Tester #373 (batch D C1): what to do next after a common refusal that no verb explains with its own hint. One fact per
 * code, with the command that answers it; the panel's refusal itself (code, message, exit 2) is unchanged.
 */
const NEXT: Readonly<Record<string, string>> = {
  // Start guard spec 2026-10-15 §3.2 keeps this a refusal; #374d: the start that is pending needs no second start.
  "group-execution-pending": "the start is already queued: the group begins on its own when its estimate ends or a slot frees; orca group brief <group> shows where it stands",
  "stop-mode-conflict": "a pause or stop is in force on this group; orca group brief <group> shows which, and orca group resume <group> lifts a pause",
  // #368a: after a start the proposal is fixed; another agent for one task goes through its retry.
  "grant-amendment-unsupported": "a task of this group already started, so its proposal and agent selection no longer change; to run a task on another agent: orca task retry <group> <task> --agent <installation>",
  "requirement-not-split": "the requirement is not split into tasks yet; orca requirement show <group> shows the open round",
  "group-state-invalid": "the group is not in a state this command accepts; orca group brief <group> shows its state",
  "no-op-command": "nothing to change: it is already as this command would set it",
  "group-archived": "the group is archived and refuses every command but unarchive; orca group unarchive <group> first",
};

export function nextForCode(code: string): string | null {
  return Object.hasOwn(NEXT, code) ? NEXT[code]! : null;
}
