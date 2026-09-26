/**
 * Agent selection spec §6.8 (T15): one layer's partial selection as three controls. The model is a free string
 * the panel never rewrites (ccloop validates it, §4.1); the context is a select over the options the effective
 * agent can express and nothing else -- there is no box to type a window into.
 */
import type { JSX } from "react";
import type { AgentInstallationV1, AgentsViewV1, ContextWindowV1, PartialSelectionV1 } from "./controlTypes.js";

export const contextLabel = (value: ContextWindowV1): string => (value === "agent-default" ? "agent default" : `${value} tokens`);
export const contextValue = (value: ContextWindowV1 | undefined): string => (value === undefined ? "" : String(value));

/**
 * The draft an emptied agent field is stored as. The control reducer forgets a draft whose text is "" (a budget
 * box then falls back to the server's value), which here would put back the very value the operator emptied.
 */
export const CLEARED_DRAFT = "\u0000cleared";

/** A draft's text, or the server's value when there is none; an emptied field reads as "". */
export function draftText(drafts: Record<string, string>, key: string, fallback: string): string {
  const draft = drafts[key];
  return draft === undefined ? fallback : draft === CLEARED_DRAFT ? "" : draft;
}

/** What an agent field hands to onDraft for the text typed or chosen. */
export const draftOf = (text: string): string => (text === "" ? CLEARED_DRAFT : text);

/** A select value back to a context; "" (inherit) and anything that is not a context read as unset. */
export function parseContext(text: string): ContextWindowV1 | undefined {
  if (text === "agent-default") return "agent-default";
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
}

/** An emptied box is "not set at this layer"; any other text is sent exactly as typed. */
export const textOrUndefined = (text: string): string | undefined => (text.trim() === "" ? undefined : text);

export function installationOf(agents: AgentsViewV1, id: string | undefined): AgentInstallationV1 | undefined {
  return id === undefined ? undefined : agents.installations.find((row) => row.id === id);
}

/**
 * The partial the drafts describe for one layer. A context the effective agent cannot express is dropped
 * rather than sent: the select never offers it, so it can only be a draft left over from another agent.
 */
export function partialFromFields(
  agents: AgentsViewV1,
  prefix: string,
  current: PartialSelectionV1 | undefined,
  drafts: Record<string, string>,
  inheritedAgent: string | undefined,
): PartialSelectionV1 {
  const pick = (field: string, fallback: string): string => draftText(drafts, `${prefix}:${field}`, fallback);
  const agent = textOrUndefined(pick("agent", current?.agent ?? ""));
  const model = textOrUndefined(pick("model", current?.model ?? ""));
  const parsed = parseContext(pick("context", contextValue(current?.contextWindow)));
  const options = installationOf(agents, agent ?? inheritedAgent)?.contextOptions ?? [];
  const contextWindow = parsed !== undefined && options.includes(parsed) ? parsed : undefined;
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

export interface SelectionFieldsProps {
  agents: AgentsViewV1;
  /** Draft key prefix; each control's `name` is `<prefix>:agent|model|context`. */
  prefix: string;
  label: string;
  current: PartialSelectionV1 | undefined;
  /** The agent whose options the context offers when this layer names none. */
  inheritedAgent: string | undefined;
  /** A per-agent row: the agent is fixed and not offered. */
  fixedAgent?: string;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
}

export function SelectionFields(props: SelectionFieldsProps): JSX.Element {
  const { agents, prefix, drafts, onDraft } = props;
  const draft = (field: string, fallback: string): string => draftText(drafts, `${prefix}:${field}`, fallback);
  const change = (field: string) => (event: { target: { value: string } }) => onDraft(`${prefix}:${field}`, draftOf(event.target.value));
  const agentText = props.fixedAgent ?? draft("agent", props.current?.agent ?? "");
  const effective = installationOf(agents, agentText === "" ? props.inheritedAgent : agentText);
  return (
    <fieldset aria-label={props.label}>
      <legend>{props.label}</legend>
      {props.fixedAgent === undefined && (
        <label>
          agent
          <select name={`${prefix}:agent`} value={agentText} onChange={change("agent")}>
            <option value="">inherit</option>
            {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id} ({row.kind} {row.version})</option>)}
          </select>
        </label>
      )}
      <label>
        model
        <input name={`${prefix}:model`} value={draft("model", props.current?.model ?? "")} placeholder={effective?.defaults.model ?? ""} onChange={change("model")} />
      </label>
      <label>
        context
        <select name={`${prefix}:context`} value={draft("context", contextValue(props.current?.contextWindow))} onChange={change("context")}>
          <option value="">inherit</option>
          {(effective?.contextOptions ?? []).map((option) => <option key={String(option)} value={String(option)}>{contextLabel(option)}</option>)}
        </select>
      </label>
    </fieldset>
  );
}
