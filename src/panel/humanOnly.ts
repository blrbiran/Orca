import type { CommandVerbV1 } from "../control/webProtocol.js";

/**
 * Agent entry spec §5 (human ruling H3): over the socket an agent may do everything the Web UI can, except set a
 * group's budget amount -- the bound every other agent-permitted command stays under. Checked on the socket channel only.
 */
export const HUMAN_ONLY_VERBS: readonly CommandVerbV1[] = ["set-limit"];
export const HUMAN_ONLY_FIELDS: Readonly<Partial<Record<CommandVerbV1, readonly string[]>>> = {
  "requirement-open": ["limit"],
  "proposal-edit": ["proposedGroupLimit"],
};
/** Spec §5 / C19: an amount field an agent may send, with the reason. Empty until a reviewed exception exists. */
export const AGENT_AMOUNT_FIELDS: Readonly<Record<string, string>> = {};

export function humanOnlyRefusal(verb: CommandVerbV1, payload: unknown):
  { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null {
  if (HUMAN_ONLY_VERBS.includes(verb)) return { code: "control-verb-human-only", message: `${verb} is done by a person in the Web UI.` };
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const field = (HUMAN_ONLY_FIELDS[verb] ?? []).find((name) => Object.hasOwn(payload, name));
  return field === undefined ? null : { code: "control-field-human-only", message: `${verb}.${field} is set by a person in the Web UI; send the command without it.` };
}
