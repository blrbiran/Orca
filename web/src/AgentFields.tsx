/**
 * Agent selection spec §6.8 (T15): one layer's partial selection as three controls. The model is a free string
 * the panel never rewrites (ccloop validates it, §4.1); the context is a select over the options the effective
 * agent can express and nothing else -- there is no box to type a window into.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInstallationV1, AgentSelectionV1, AgentsViewV1, ContextWindowV1, PanelPartialSelectionV1, PartialSelectionV1, SelectionProvenanceV1 } from "./controlTypes.js";
import i18n, { enumText } from "./i18n.js";

export const contextLabel = (value: ContextWindowV1): string => (value === "agent-default" ? i18n.t("agents.contextDefault") : i18n.t("agents.contextTokens", { value }));
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

export interface SelectionFieldError { field: "agent" | "contextWindow"; code: "missingAgent" | "unsupportedContext" | "invalidContext"; value?: string }

/** Validate the exact draft the person sees before a lossy low-level partial builder may be used. */
export function selectionFieldErrors(
  agents: AgentsViewV1, prefix: string, current: PanelPartialSelectionV1 | undefined,
  planned: PartialSelectionV1 | undefined, drafts: Record<string, string>, inheritedAgent: string | undefined,
  fixedAgent?: string,
): SelectionFieldError[] {
  const agentText = fixedAgent ?? draftText(drafts, `${prefix}:agent`, typeof current?.agent === "string" ? current.agent : "");
  const agent = textOrUndefined(agentText) ?? (isMasked(prefix, "agent", current, planned, drafts) ? inheritedAgent : planned?.agent ?? inheritedAgent);
  const priorAgent = typeof current?.agent === "string" ? current.agent : planned?.agent ?? inheritedAgent;
  const switched = fixedAgent === undefined && agentText !== "" && priorAgent !== undefined && agentText !== priorAgent;
  const errors: SelectionFieldError[] = [];
  if (!agent || !installationOf(agents, agent)) errors.push({ field: "agent", code: "missingAgent" });
  const contextText = draftText(drafts, `${prefix}:context`, switched ? "" : contextValue(current?.contextWindow ?? undefined));
  if (contextText !== "" && !isMasked(prefix, "contextWindow", current, planned, drafts)) {
    const context = parseContext(contextText);
    if (context === undefined) errors.push({ field: "contextWindow", code: "invalidContext", value: contextText });
    else if (!installationOf(agents, agent)?.contextOptions.includes(context)) errors.push({ field: "contextWindow", code: "unsupportedContext", value: contextText });
  }
  return errors;
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
  const switched = agent !== undefined && current?.agent !== undefined && agent !== current.agent;
  const model = textOrUndefined(pick("model", switched ? "" : current?.model ?? ""));
  const parsed = parseContext(pick("context", switched ? "" : contextValue(current?.contextWindow)));
  const options = installationOf(agents, agent ?? inheritedAgent)?.contextOptions ?? [];
  const contextWindow = parsed !== undefined && options.includes(parsed) ? parsed : undefined;
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

type Field = "agent" | "model" | "contextWindow";
const maskKey = (prefix: string, field: Field): string => `${prefix}:mask:${field}`;

/**
 * Ruling review R7: whether this layer masks the plan's value of `field` at the same level. Only a field the plan
 * wrote can be masked; the draft ("1" on, "0" off) wins over what the stored panel layer says (null = masked).
 */
export function isMasked(prefix: string, field: Field, current: PanelPartialSelectionV1 | undefined, planned: PartialSelectionV1 | undefined, drafts: Record<string, string>): boolean {
  if (planned?.[field] === undefined) return false;
  const draft = drafts[maskKey(prefix, field)];
  return draft === undefined ? current?.[field] === null : draft === "1";
}

/**
 * Ruling review R7: the panel layer one level's controls describe -- a field left empty is inherited (from the plan
 * at this level, then below), a masked field is sent as null (as if the plan had not written it), anything else as
 * given. The agent a context is offered for is this layer's own, else the plan's unless masked, else the inherited.
 */
export function panelPartialFromFields(
  agents: AgentsViewV1,
  prefix: string,
  current: PanelPartialSelectionV1 | undefined,
  planned: PartialSelectionV1 | undefined,
  drafts: Record<string, string>,
  inheritedAgent: string | undefined,
): PanelPartialSelectionV1 {
  const masked = (field: Field): boolean => isMasked(prefix, field, current, planned, drafts);
  const pick = (field: string, fallback: string): string => draftText(drafts, `${prefix}:${field}`, fallback);
  const text = (value: string | null | undefined): string => (typeof value === "string" ? value : "");
  const agent = masked("agent") ? undefined : textOrUndefined(pick("agent", text(current?.agent)));
  const priorAgent = typeof current?.agent === "string" ? current.agent : planned?.agent ?? inheritedAgent;
  const switched = agent !== undefined && priorAgent !== undefined && agent !== priorAgent;
  const model = masked("model") ? undefined : textOrUndefined(pick("model", switched ? "" : text(current?.model)));
  const effective = agent ?? (masked("agent") ? inheritedAgent : planned?.agent ?? inheritedAgent);
  const parsed = masked("contextWindow") ? undefined : parseContext(pick("context", switched ? "" : contextValue(current?.contextWindow ?? undefined)));
  const options = installationOf(agents, effective)?.contextOptions ?? [];
  const contextWindow = parsed !== undefined && options.includes(parsed) ? parsed : undefined;
  return {
    ...(masked("agent") ? { agent: null } : agent === undefined ? {} : { agent }),
    ...(masked("model") ? { model: null } : model === undefined ? {} : { model }),
    ...(masked("contextWindow") ? { contextWindow: null } : contextWindow === undefined ? {} : { contextWindow }),
  };
}

export interface SelectionFieldsProps {
  agents: AgentsViewV1;
  /** Draft key prefix; each control's `name` is `<prefix>:agent|model|context`. */
  prefix: string;
  label: string;
  current: PanelPartialSelectionV1 | undefined;
  /**
   * Ruling review R7: the plan file's values at this level. Each one the plan wrote is shown, with a box that masks
   * it (sent as null). Absent (the operator's own settings), nothing about a plan is rendered.
   */
  planned?: PartialSelectionV1;
  /** The agent whose options the context offers when this layer names none. */
  inheritedAgent: string | undefined;
  /** A per-agent row: the agent is fixed and not offered. */
  fixedAgent?: string;
  showMissingAgent?: boolean;
  /** The server's resolved slot, for fields that currently inherit at this layer. */
  inheritance?: { selection: AgentSelectionV1; provenance: SelectionProvenanceV1 };
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
}

export function SelectionFields(props: SelectionFieldsProps): JSX.Element {
  const { agents, prefix, drafts, onDraft } = props;
  const { t } = useTranslation();
  const draft = (field: string, fallback: string): string => draftText(drafts, `${prefix}:${field}`, fallback);
  const change = (field: string) => (event: { target: { value: string } }) => {
    const next = event.target.value;
    const previousAgent = draft("agent", typeof props.current?.agent === "string" ? props.current.agent : "");
    onDraft(`${prefix}:${field}`, draftOf(next));
    if (field === "agent" && next !== previousAgent) {
      onDraft(`${prefix}:model`, CLEARED_DRAFT);
      onDraft(`${prefix}:context`, CLEARED_DRAFT);
    }
  };
  const text = (value: string | null | undefined): string => (typeof value === "string" ? value : "");
  const masked = (field: Field): boolean => isMasked(prefix, field, props.current, props.planned, drafts);
  const agentText = props.fixedAgent ?? draft("agent", text(props.current?.agent));
  const below = masked("agent") ? props.inheritedAgent : props.planned?.agent ?? props.inheritedAgent ?? props.inheritance?.selection.agent;
  const priorAgent = typeof props.current?.agent === "string" ? props.current.agent : below;
  const switched = props.fixedAgent === undefined && agentText !== "" && priorAgent !== undefined && agentText !== priorAgent;
  const effective = installationOf(agents, agentText === "" ? below : agentText);
  const errors = selectionFieldErrors(agents, prefix, props.current, props.planned, drafts, below, props.fixedAgent);
  const contextText = draft("context", switched ? "" : contextValue(props.current?.contextWindow ?? undefined));
  const unsupportedContext = errors.find((error) => error.field === "contextWindow");
  const inheritedHint = (field: "model" | "contextWindow"): string | null => {
    if (!props.inheritance || props.current?.[field] !== undefined) return null;
    const value = props.inheritance.selection[field];
    const label = field === "contextWindow" ? contextLabel(value as ContextWindowV1) : String(value);
    return t("agents.inheritConcrete", { value: label, source: enumText("selectionSource", props.inheritance.provenance[field]) });
  };
  const planValue = (field: Field): string | null => {
    const value = props.planned?.[field];
    return value === undefined ? null : field === "contextWindow" ? contextLabel(value as ContextWindowV1) : String(value);
  };
  const maskBox = (field: Field): JSX.Element | null => {
    const value = planValue(field);
    if (value === null) return null;
    return (
      <label>
        <input type="checkbox" name={maskKey(prefix, field)} checked={masked(field)} onChange={(event) => onDraft(maskKey(prefix, field), event.target.checked ? "1" : "0")} />
        {t("agents.ignorePlan", { field: t(`agents.field.${field}`), value })}
      </label>
    );
  };
  return (
    <fieldset aria-label={props.label}>
      <legend>{props.label}</legend>
      {props.fixedAgent === undefined && (
        <label>
          {t("agents.label.agent")}
          <select name={`${prefix}:agent`} value={agentText} onChange={change("agent")}>
            <option value="">{props.inheritance && props.current?.agent === undefined
              ? t("agents.inheritConcrete", { value: props.inheritance.selection.agent, source: enumText("selectionSource", props.inheritance.provenance.agent) })
              : props.planned?.agent !== undefined && !masked("agent") ? t("agents.inheritPlan", { agent: props.planned.agent }) : t("agents.inherit")}</option>
            {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id} ({row.kind} {row.version})</option>)}
          </select>
        </label>
      )}
      {props.fixedAgent === undefined && maskBox("agent")}
      <label>
        {t("agents.label.model")}
        <input name={`${prefix}:model`} value={draft("model", switched ? "" : text(props.current?.model))} placeholder={(masked("model") ? undefined : props.planned?.model) ?? effective?.defaults.model ?? ""} onChange={change("model")} />
        {inheritedHint("model") && <small>{inheritedHint("model")}</small>}
      </label>
      {maskBox("model")}
      <label>
        {t("agents.label.context")}
        <select name={`${prefix}:context`} value={contextText} aria-invalid={unsupportedContext !== undefined} onChange={change("context")}>
          <option value="">{t("agents.inherit")}</option>
          {(effective?.contextOptions ?? []).map((option) => <option key={String(option)} value={String(option)}>{contextLabel(option)}</option>)}
          {unsupportedContext && contextText !== "" && <option value={contextText}>{contextText}</option>}
        </select>
        {inheritedHint("contextWindow") && <small>{inheritedHint("contextWindow")}</small>}
      </label>
      {errors.filter((error) => error.code !== "missingAgent" || props.showMissingAgent !== false).map((error) => <p key={error.field} role={error.code === "missingAgent" ? "note" : "alert"}>{t(`agents.fieldError.${error.code}`, { value: error.value ?? "" })}</p>)}
      {maskBox("contextWindow")}
    </fieldset>
  );
}
