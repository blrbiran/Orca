/**
 * Flow engine spec §14.1 (plan Task 16): one flow run's page. Every state, number and list on it is the server's (GET
 * /api/control/flows/:id and its journal); the page originates only the person's intents, each one flow verb on the
 * `@flows` scope (revision 0, flowCommands.ts) and read back:
 *
 * - steps in template order with their state, the active execution, the reasons each execution ran, its output, red
 *   flags, the child group, and ccloop's tool-rule report row by row (§16.2: `detected`, `recorded-only` network,
 *   `refused` and a secret not present on this machine are red -- red flags, not gates, P2);
 * - the message box per step and execution (feedback, an edit of the output), run commands (pause, resume, stop,
 *   rewind, retry), the rerun plan as a checklist (§7.4: candidates ticked, the model's proposed skips unticked with
 *   their reasons, other steps addable), open asks and confirm cards, effect records with enact / discard, decisions
 *   by grade (P5), the message stream, and the pool as the tool gave it (no estimate).
 *
 * The human-only verbs (rerun, answer, effect, pool; §14.2) are offered only to a person who may send them.
 */
import { useCallback, useContext, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { RunTranscript } from "./AgentTranscript.js";
import { FolderImagePicker } from "./FolderImagePicker.js";
import type { TFunction } from "i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { controlGet, nextCommandId, refusalFromAnswer, sendControlCommand, uploadFlowAttachment } from "./controlApi.js";
import type {
  FlowAnchorV1, FlowAskV1, FlowEffectV1, FlowExecutionViewV1, FlowIntakeV1, FlowJournalV1, FlowMessageV1, FlowPlanV1, FlowRunViewV1, FlowSpendV1, FlowToolRulesReportV1, RoundBodyV1,
} from "./controlTypes.js";
import { currentLanguage } from "./i18n.js";
import { Refusal } from "./Refusal.js";
import { ReviseRound, chainEntries } from "./RequirementsPanel.js";
import { formatTokens, shortTokens } from "./TokenInput.js";

type Verb = "messages" | "plan" | "rerun" | "answer" | "effect" | "pool" | "plan-step";
type Send = (verb: Verb, payload: Record<string, unknown>) => void;
/** Gaps spec §4.7: stores one image in the run's attachment store and answers its id, or null (the refusal is shown). */
type Upload = (file: File) => Promise<string | null>;
/** Fix round 1 (M4): follow-up reads while something moves on the server by itself, each twice as late, then none. */
export const FOLLOW_UP_MS = 1500;
const FOLLOW_UPS = 5;
type Step = FlowRunViewV1["steps"][number];
type Rule = FlowToolRulesReportV1["rules"][number];
const segment = (value: string): string => encodeURIComponent(value);
const short = (sha: string | null): string => (sha === null ? "" : sha.slice(0, 10));

/** §16.2: the rules ccloop could not hold the agent to, and a declared secret this machine does not have. */
export function ruleIsRed(row: Rule): boolean {
  return row.status === "detected" || row.status === "refused" || (row.status === "recorded-only" && row.rule.kind === "network")
    || (row.rule.kind === "secretEnv" && row.present === false);
}

function ruleText(row: Rule, t: TFunction): string {
  switch (row.rule.kind) {
    case "commands-closed": return t("flow.tools.ruleText.closed");
    case "exact": case "prefix": return t(`flow.tools.ruleText.${row.rule.kind}`, { value: row.rule.value });
    case "network": return t(row.rule.value ? "flow.tools.ruleText.networkOn" : "flow.tools.ruleText.networkOff");
    case "secretEnv": return t("flow.tools.ruleText.secret", { name: row.rule.name });
  }
}

const stateTone = (state: string): "ok" | "warn" | "danger" | "info" | undefined =>
  state === "done" || state === "applied" ? "ok" : state === "failed" ? "danger" : state === "running" || state === "queued" ? "info"
  : state === "needs-person" || state === "parked" || state === "staged" || state === "paused" ? "warn" : undefined;

/** Gaps spec §10: the tool's tokens, or why there is none -- never 0 for unknown; money is never reported. */
export function spendText(spend: FlowSpendV1, t: TFunction): string {
  const tokens = spend.tokens === null
    ? (spend.unknownReason === null ? t("flow.spend.notAvailablePlain") : t("flow.spend.notAvailable", { reason: spendReason(spend.unknownReason, t) }))
    : spend.unknownReason === null ? t("flow.spend.tokens", { tokens: formatTokens(spend.tokens, currentLanguage()) })
    : t("flow.spend.partial", { tokens: formatTokens(spend.tokens, currentLanguage()), reason: spendReason(spend.unknownReason, t) });
  return t("flow.spend.line", { tokens, money: t("flow.spend.money") });
}

/** src/flow/spend.ts's reasons, in the page's language; one it does not know is shown as the server sent it. */
const SPEND_REASONS: Record<string, string> = {
  "no tool runs": "noRuns", "the tool reported no usage": "noUsage", "the tool reported 0 tokens": "zero", "no run record": "noRecord",
  "no usage reported yet": "notYet", "calls before run ids were kept": "legacy",
};
export function spendReason(reason: string, t: TFunction): string {
  const known = SPEND_REASONS[reason];
  if (known !== undefined) return t(`flow.spend.reason.${known}` as "flow.spend.reason.noRuns");
  const partial = /^partial: (\d+) runs unknown$/.exec(reason);
  if (partial !== null) return t("flow.spend.reason.partial", { n: Number(partial[1]) });
  const some = /^(\d+) runs unknown$/.exec(reason);
  if (some !== null) return t("flow.spend.reason.some", { n: Number(some[1]) });
  return reason;
}

function SpendLine(props: { spend: FlowSpendV1 }): JSX.Element {
  const { t } = useTranslation();
  return <p className="flow-spend" data-testid="flow-spend">{spendText(props.spend, t)}</p>;
}

/** Gaps spec §4.1: a quote, and a heading and/or paragraph number -- each part one anchor, as the CLI builds them. */
type AnchorDraft = { quote: string; heading: string; paragraph: string };
const NO_ANCHOR: AnchorDraft = { quote: "", heading: "", paragraph: "" };
function anchorsOf(draft: AnchorDraft): FlowAnchorV1[] {
  const out: FlowAnchorV1[] = [];
  if (draft.quote.trim() !== "") out.push({ quote: draft.quote.trim() });
  const paragraph = Number(draft.paragraph);
  const hasParagraph = draft.paragraph.trim() !== "" && Number.isSafeInteger(paragraph) && paragraph >= 1;
  if (draft.heading.trim() !== "" || hasParagraph) out.push({ ...(draft.heading.trim() === "" ? {} : { heading: draft.heading.trim() }), ...(hasParagraph ? { paragraph } : {}) });
  return out;
}

function AnchorFields(props: { draft: AnchorDraft; onChange: (draft: AnchorDraft) => void }): JSX.Element {
  const { t } = useTranslation();
  const { draft } = props;
  return (
    <fieldset className="flow-anchors">
      <legend>{t("flow.feedback.where")}</legend>
      <label>{t("flow.feedback.quote")}<input type="text" value={draft.quote} onChange={(event) => props.onChange({ ...draft, quote: event.currentTarget.value })} /></label>{" "}
      <label>{t("flow.feedback.heading")}<input type="text" value={draft.heading} onChange={(event) => props.onChange({ ...draft, heading: event.currentTarget.value })} /></label>{" "}
      <label>{t("flow.feedback.paragraph")}<input type="number" min={1} value={draft.paragraph} onChange={(event) => props.onChange({ ...draft, paragraph: event.currentTarget.value })} /></label>
    </fieldset>
  );
}

function ToolRules(props: { report: FlowToolRulesReportV1 }): JSX.Element {
  const { t } = useTranslation();
  return (
    <table className="flow-tool-rules" aria-label={t("flow.tools.title", { agent: props.report.agentKind })}>
      <thead><tr><th>{t("flow.tools.rule")}</th><th>{t("flow.tools.status")}</th><th>{t("flow.tools.reason")}</th></tr></thead>
      <tbody>
        {props.report.rules.map((row, i) => {
          const red = ruleIsRed(row);
          return (
            <tr key={i} data-testid="flow-tool-rule" data-tone={red ? "danger" : undefined}>
              <td><code>{ruleText(row, t)}</code></td>
              <td data-testid="flow-tool-rule-status">{row.status}{row.rule.kind === "secretEnv" && row.present === false ? ` · ${t("flow.tools.notPresent")}` : ""}</td>
              <td>{row.reason ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExecutionFacts(props: { execution: FlowExecutionViewV1; active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const e = props.execution;
  return (
    <div className="flow-execution" data-testid={`flow-execution-${e.seq}`}>
      <p>
        <span>{t("flow.execution", { seq: e.seq })}</span>{" "}
        <span className="badge" data-tone={stateTone(e.state)}>{t(`flow.execState.${e.state}`, { defaultValue: e.state })}</span>
        {props.active && <> <span className="badge" data-tone="ok">{t("flow.active")}</span></>}
        {" · "}{t("flow.byVia", { by: e.by, via: e.via })}
        {e.planNo !== null && <>{" · "}{t("flow.inPlan", { n: e.planNo })}</>}
      </p>
      {e.reasons.length > 0 && <p>{t("flow.reasons", { reasons: e.reasons.join(", ") })}</p>}
      {e.output !== null && e.output.kind !== "none" && (
        <p>{e.output.kind === "commit" ? t("flow.outputCommit", { sha: short(e.output.ref) }) : t("flow.outputRecord", { hash: short(e.output.ref) })}</p>
      )}
      {e.childGroupId !== null && <p>{t("flow.child", { groupId: e.childGroupId })}</p>}
      {e.failure !== null && <p data-tone="danger">{t("flow.failure", { reason: e.failure })}</p>}
      {e.flags.length > 0 && <p>{e.flags.map((flag) => <span key={flag} className="badge" data-tone="danger" data-testid="flow-flag">{flag}</span>)}</p>}
      {e.warnings.length > 0 && <p data-tone="warn">{e.warnings.join(", ")}</p>}
      {e.reported?.effect !== undefined && <p>{t("flow.remoteId", { id: e.reported.effect.remoteId })}</p>}
      {e.needsYou?.reason !== undefined && <p data-tone="warn">{t("flow.parked", { reason: e.needsYou.reason })}</p>}
      {e.toolRules !== null && <ToolRules report={e.toolRules} />}
      <SpendLine spend={e.spend} />
      {/* Live transcript spec §10.4.4: the execution's Orca runs (its calls, then its child group's runs), each with its
          transcript; a legacy entry names no run. */}
      {e.spend.runs.filter((run) => !run.runId.startsWith("legacy:")).map((run) => (
        <div key={run.runId} className="flow-run-transcript"><span>{run.purpose}</span> <RunTranscript runId={run.runId} active /></div>
      ))}
    </div>
  );
}

/** §8.1: feedback or an edit, on the step or one of its executions. */
function MessageBox(props: { step: Step; runId: string; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [target, setTarget] = useState("step");
  const [mode, setMode] = useState<"feedback" | "edit-record" | "edit-file">("feedback");
  const [text, setText] = useState("");
  const [path, setPath] = useState("");
  const [anchor, setAnchor] = useState<AnchorDraft>(NO_ANCHOR);
  const targetOf = (): Record<string, unknown> => (target === "step" ? { kind: "step", stepKey: props.step.stepKey } : { kind: "execution", stepKey: props.step.stepKey, seq: Number(target) });
  const record = (): Record<string, string> | null => {
    const out: Record<string, string> = {};
    for (const line of text.split("\n").filter((l) => l.trim() !== "")) {
      const at = line.indexOf("=");
      if (at < 1) return null;
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return Object.keys(out).length === 0 ? null : out;
  };
  const ready = mode === "feedback" ? text.trim() !== "" : mode === "edit-record" ? record() !== null : path.trim() !== "";
  const submit = (): void => {
    const anchors = anchorsOf(anchor);
    if (mode === "feedback") props.send("messages", { runId: props.runId, kind: "feedback", target: targetOf(), body: { text: text.trim(), ...(anchors.length === 0 ? {} : { anchors }) } });
    else props.send("messages", { runId: props.runId, kind: "edit", target: { kind: "step", stepKey: props.step.stepKey }, body: mode === "edit-record" ? { record: record()! } : { files: { [path.trim()]: text } } });
    setText(""); setPath(""); setAnchor(NO_ANCHOR);
  };
  return (
    <form className="flow-message" aria-label={t("flow.message.title", { step: props.step.stepKey })} onSubmit={(event) => { event.preventDefault(); if (ready) submit(); }}>
      <select aria-label={t("flow.message.kind")} value={mode} onChange={(event) => setMode(event.currentTarget.value as typeof mode)}>
        <option value="feedback">{t("flow.message.feedback")}</option>
        <option value="edit-record">{t("flow.message.editRecord")}</option>
        <option value="edit-file">{t("flow.message.editFile")}</option>
      </select>
      {mode === "feedback" && (
        <select aria-label={t("flow.message.target")} value={target} onChange={(event) => setTarget(event.currentTarget.value)}>
          <option value="step">{t("flow.message.onStep")}</option>
          {props.step.executions.map((e) => <option key={e.seq} value={String(e.seq)}>{t("flow.execution", { seq: e.seq })}</option>)}
        </select>
      )}
      {mode === "edit-file" && <input type="text" aria-label={t("flow.message.path")} value={path} onChange={(event) => setPath(event.currentTarget.value)} />}
      <textarea aria-label={t(mode === "feedback" ? "flow.message.text" : mode === "edit-record" ? "flow.message.recordText" : "flow.message.fileText")} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      {mode === "feedback" && <AnchorFields draft={anchor} onChange={setAnchor} />}
      <button type="submit" disabled={!ready}>{t(mode === "feedback" ? "flow.message.sendFeedback" : "flow.message.sendEdit")}</button>
    </form>
  );
}

/** An `ask` step's form (§4.4): candidates to pick from, the defaults prefilled, free text where allowed. */
function AskForm(props: { ask: Extract<FlowAskV1, { kind: "ask" }>; stepKey: string; runId: string; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => ({ ...props.ask.defaults }));
  const set = (field: string, value: string | number | boolean): void => setValues({ ...values, [field]: value });
  return (
    <form aria-label={t("flow.ask.title", { step: props.stepKey })} onSubmit={(event) => { event.preventDefault(); props.send("answer", { runId: props.runId, stepKey: props.stepKey, values }); }}>
      {Object.entries(props.ask.form).map(([field, spec]) => {
        const offered = props.ask.candidates[field] ?? [];
        const value = values[field];
        return (
          <fieldset key={field}>
            <legend>{field}</legend>
            {offered.map((item) => (
              <label key={item}><input type="radio" name={`ask-${props.stepKey}-${field}`} checked={value === item} onChange={() => set(field, item)} />{item}</label>
            ))}
            {spec.type === "bool" ? <input type="checkbox" aria-label={field} checked={value === true} onChange={(event) => set(field, event.currentTarget.checked)} />
              : spec.options !== undefined ? (
                <select aria-label={field} value={String(value ?? "")} onChange={(event) => set(field, event.currentTarget.value)}>
                  {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : <input type="text" aria-label={field} value={String(value ?? "")} onChange={(event) => set(field, spec.type === "int" ? Number(event.currentTarget.value) : event.currentTarget.value)} />}
          </fieldset>
        );
      })}
      <button type="submit">{t("flow.ask.send")}</button>
    </form>
  );
}

/** §4.3: an agent's question or confirmation request; the answer queues a revision of that step. */
function NeedsForm(props: { ask: Extract<FlowAskV1, { kind: "input" | "confirmation" }>; stepKey: string; runId: string; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const { ask } = props;
  return (
    <form aria-label={t("flow.needs.title", { step: props.stepKey })} onSubmit={(event) => { event.preventDefault(); if (text.trim() !== "") props.send("answer", { runId: props.runId, stepKey: props.stepKey, text: text.trim() }); }}>
      <p>{ask.kind === "input" ? ask.question : t("flow.needs.confirmation", { what: ask.what, summary: ask.payloadSummary })}</p>
      {ask.unclassed === true && <p data-tone="warn">{t("flow.needs.unclassed")}</p>}
      {ask.kind === "input" && ask.candidates.map((c) => <button key={c} type="button" onClick={() => setText(c)}>{c}</button>)}
      <textarea aria-label={t("flow.needs.answer")} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      <button type="submit" disabled={text.trim() === ""}>{t("flow.needs.send")}</button>
    </form>
  );
}

type ClarifyAnswer = { id: string; kind: "recommended" } | { id: string; kind: "text"; text: string };
/**
 * §10, gaps spec §4.6: a clarify round waiting on the person -- recommended answers or their own, then the round or
 * consensus. One form for a flow clarify step's round and a feedback intake's round; `extra` holds what only one has.
 */
function QuestionsForm(props: { label: string; statement: string | null; questions: Array<{ id: string; question: string; recommendedAnswer: string }>;
  onAnswer: (answers: ClarifyAnswer[]) => void; onConsensus: () => void; extra?: JSX.Element }): JSX.Element {
  const { t } = useTranslation();
  const [own, setOwn] = useState<Record<string, string>>({});
  const answers = props.questions.map((q): ClarifyAnswer => (own[q.id] ?? "").trim() === "" ? { id: q.id, kind: "recommended" } : { id: q.id, kind: "text", text: own[q.id]!.trim() });
  return (
    <form aria-label={props.label} onSubmit={(event) => { event.preventDefault(); props.onAnswer(answers); }}>
      {props.statement !== null && <p>{props.statement}</p>}
      {props.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.id} {q.question}</legend>
          <p>{t("requirements.recommended", { answer: q.recommendedAnswer })}</p>
          <textarea aria-label={t("flow.clarify.own", { id: q.id })} value={own[q.id] ?? ""} onChange={(event) => setOwn({ ...own, [q.id]: event.currentTarget.value })} />
        </fieldset>
      ))}
      <button type="submit">{t("flow.clarify.send")}</button>
      <button type="button" onClick={props.onConsensus}>{t("flow.clarify.consensus")}</button>
      {props.extra}
    </form>
  );
}

function ClarifyForm(props: { round: RoundBodyV1; stepKey: string; runId: string; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result;
  if (result === null) return <p>{t("flow.clarify.drafting", { n: props.round.roundNo })}</p>;
  return (
    <QuestionsForm label={t("flow.clarify.title", { step: props.stepKey, n: props.round.roundNo })} statement={result.statement} questions={result.questions}
      onAnswer={(answers) => props.send("answer", { runId: props.runId, stepKey: props.stepKey, clarify: { roundNo: props.round.roundNo, answers,
        glossaryDecisions: result.glossary.map((g) => ({ id: g.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) } })}
      onConsensus={() => props.send("answer", { runId: props.runId, stepKey: props.stepKey, consensus: true })} />
  );
}

/**
 * Gaps spec §9: a flow clarify step's rounds on its active chain, each answered one revisable with the Requirements
 * revise form (one UI, Rule 7); the revision is sent as an `edit` at that round. While a revision is at work on a newer
 * execution, its rounds are listed as such and they are the ones revised.
 */
function ClarifyRounds(props: { step: Step; runId: string; open: boolean; send: Send }): JSX.Element | null {
  const { t } = useTranslation();
  const { step } = props;
  const shown = step.clarifyRevision ?? step.clarify;
  if (shown === null || shown.rounds.length === 0) return null;
  const entries = chainEntries(shown.rounds, shown.chain);
  return (
    <details className="flow-rounds" data-testid="flow-rounds">
      <summary>{step.clarifyRevision !== null ? t("flow.clarify.revising", { seq: step.clarifyRevision.seq }) : t("flow.clarify.rounds", { count: entries.length })}</summary>
      {step.clarifyRevision !== null && step.clarify !== null && <p role="note">{t("flow.clarify.activeStays", { seq: step.head ?? 0 })}</p>}
      <ul>
        {entries.map(({ round: r, position }) => {
          const revisable = props.open && r.state === "answered" && r.result !== null && r.answers !== null;
          const later = entries.filter((e) => e.position > position).map((e) => ({ roundNo: e.round.roundNo, position: e.position }));
          return (
            <li key={r.roundNo} data-testid={`flow-round-${r.roundNo}`}>
              {t(r.revises === undefined ? "requirements.round" : "requirements.roundRevised", { n: position })} · {r.state}
              {revisable && <ReviseRound round={r} position={position} later={later} onRevise={({ roundNo, ...body }) =>
                props.send("messages", { runId: props.runId, kind: "edit", target: { kind: "round", stepKey: step.stepKey, roundNo }, body })} />}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** §9.3: the level an effect runs at and where it came from. */
function policyText(policy: FlowEffectV1["policy"], t: TFunction): string {
  // §10: a clamped effect is held because a schedule started the run; the person sees why, not a bare level.
  if (policy.source === "schedule") return t("flow.effect.scheduledHeld");
  return t("flow.effect.policy", { level: policy.value, source: t(`flow.source.${policy.source}`), lock: policy.lockedBy === null ? "" : ` · ${t("flow.effect.locked")}` });
}

function ConfirmCard(props: { ask: Extract<FlowAskV1, { kind: "effect-confirm" }>; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { ask } = props;
  return (
    <div className="flow-confirm" role="group" aria-label={t("flow.confirm.title", { step: ask.stepKey })} data-tone="warn">
      <p>{t("flow.confirm.what", { step: ask.stepKey, kind: ask.effectKind, cls: ask.class })}</p>
      <p data-testid="flow-policy">{policyText(ask.policy, t)}</p>
      <pre className="flow-summary">{ask.summary}</pre>
      {props.may && <>
        <button type="button" className="btn-primary" onClick={() => props.send("effect", { recordId: ask.recordId, action: "confirm" })}>{t("flow.confirm.run")}</button>{" "}
        <button type="button" onClick={() => props.send("effect", { recordId: ask.recordId, action: "discard" })}>{t("flow.effect.discard")}</button>
      </>}
    </div>
  );
}

function Effects(props: { effects: FlowEffectV1[]; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section aria-label={t("flow.effect.title")}>
      <h4>{t("flow.effect.title")}</h4>
      {props.effects.length === 0 ? <p>{t("flow.effect.none")}</p> : (
        <ul>
          {props.effects.map((e) => (
            <li key={e.id} data-testid={`flow-effect-${e.id}`}>
              {t("flow.effect.row", { step: e.stepKey, seq: e.seq, kind: e.effectKind, cls: e.class })}{" "}
              <span className="badge" data-tone={e.state === "applied" || e.state === "failed" ? "danger" : stateTone(e.state)}>{t(`flow.effectState.${e.state}`)}</span>{" "}
              <span data-testid="flow-policy">{policyText(e.policy, t)}</span>
              {e.remoteRef !== null && <>{" · "}<span data-testid="flow-remote-id">{t("flow.remoteId", { id: e.remoteRef })}</span></>}
              {e.state === "applied" && <>{" · "}{t("flow.effect.review")}</>}
              {/* §9.2: a staged record is enacted later (the step runs then) or discarded; a confirm card has its own buttons. */}
              {props.may && e.state === "staged" && e.level === "stage-only" && <>{" "}
                <button type="button" onClick={() => props.send("effect", { recordId: e.id, action: "enact" })}>{t("flow.effect.enact")}</button>{" "}
                <button type="button" onClick={() => props.send("effect", { recordId: e.id, action: "discard" })}>{t("flow.effect.discard")}</button>
              </>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** §7.4: the plan as a checklist -- candidates ticked, the model's proposed skips unticked with reasons, others addable. */
function PlanChecklist(props: { plan: FlowPlanV1; steps: Step[]; runId: string; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { plan } = props;
  const skips = plan.proposal?.skips ?? null;
  const candidates = plan.candidates.list;
  const isCandidate = new Set(candidates.map((c) => c.stepKey));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.stepKey).filter((key) => !(skips ?? []).some((s) => s.stepKey === key))));
  const toggle = (key: string, on: boolean): void => { const next = new Set(ticked); if (on) next.add(key); else next.delete(key); setTicked(next); };
  const others = props.steps.map((s) => s.stepKey).filter((key) => !isCandidate.has(key));
  const run = (): void => props.send("rerun", {
    runId: props.runId, planNo: plan.planNo,
    skip: candidates.map((c) => c.stepKey).filter((key) => !ticked.has(key)), add: others.filter((key) => ticked.has(key)),
  });
  return (
    <section aria-label={t("flow.plan.title", { n: plan.planNo })} data-tone="warn">
      <h4>{t("flow.plan.title", { n: plan.planNo })}</h4>
      {skips === null ? <p role="status">{plan.proposal?.exhausted != null ? t("flow.plan.noProposal") : t("flow.plan.proposing")}</p> : (
        <>
          <ul>
            {candidates.map((c) => {
              const skip = skips.find((s) => s.stepKey === c.stepKey);
              const unsure = plan.proposal?.unsure?.find((u) => u.stepKey === c.stepKey);
              return (
                <li key={c.stepKey} data-testid={`flow-plan-${c.stepKey}`}>
                  <label><input type="checkbox" checked={ticked.has(c.stepKey)} disabled={!props.may} onChange={(event) => toggle(c.stepKey, event.currentTarget.checked)} />
                    {c.stepKey}</label> · {t("flow.reasons", { reasons: c.reasons.join(", ") })}
                  {skip !== undefined && <p>{t("flow.plan.proposedSkip", { reason: skip.reason })}</p>}
                  {unsure !== undefined && <p>{t("flow.plan.unsure", { question: unsure.question })}</p>}
                </li>
              );
            })}
          </ul>
          {others.length > 0 && (
            <details>
              <summary>{t("flow.plan.addOthers")}</summary>
              {others.map((key) => <label key={key}><input type="checkbox" checked={ticked.has(key)} disabled={!props.may} onChange={(event) => toggle(key, event.currentTarget.checked)} />{key}</label>)}
            </details>
          )}
          <p role="note">{t("flow.plan.keepNote")}</p>
          {props.may ? <button type="button" className="btn-primary" onClick={run}>{t("flow.plan.run")}</button> : <p role="note">{t("flow.ownerOnly")}</p>}
        </>
      )}
      {/* T18 enact: the person may withdraw the plan instead of running it; its feedback is excluded. */}
      {props.may && <button type="button" onClick={() => props.send("rerun", { runId: props.runId, planNo: plan.planNo, discard: true })}>{t("flow.plan.discard")}</button>}
      <SpendLine spend={plan.spend} />
    </section>
  );
}

/** HH:MM in the viewer's clock. */
const clock = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** The time left before a deadline, ticking once a second while shown. */
function Remaining(props: { deadline: number }): JSX.Element {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.ceil((props.deadline - now) / 1000));
  return <span data-testid="flow-remaining" className="flow-remaining">{t("flow.plan.left", { left: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</span>;
}

/**
 * Gaps spec §5.2-§5.5, §14.3: the running plan's open questions (each with its deadline and the two answers), the steps
 * it ran (each may be accepted as unchanged, so later steps whose only reason it was are dropped), and the accepts made
 * (by the person, by the timeout, or carried from an earlier plan). Both answers are the human-only `flow-plan-step`.
 */
function RunningPlan(props: { plan: FlowPlanV1; steps: Step[]; runId: string; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { plan } = props;
  const pending = (plan.chosen?.pending ?? []).filter((p) => p.answer === null && p.closed === undefined);
  const accepted = plan.chosen?.accepted ?? [];
  const acceptedKeys = new Set(accepted.map((a) => a.stepKey));
  const ran = (plan.chosen?.steps ?? []).filter((key) => !acceptedKeys.has(key)
    && (props.steps.find((s) => s.stepKey === key)?.executions ?? []).some((e) => e.planNo === plan.planNo && e.state === "done"));
  const answer = (stepKey: string, choice: "run" | "accept-unchanged"): void => props.send("plan-step", { runId: props.runId, planNo: plan.planNo, stepKey, choice });
  const source = (a: (typeof accepted)[number]): string => a.source === "carried" ? t("flow.plan.byCarried", { n: a.fromPlan ?? 0 }) : t(a.source === "person" ? "flow.plan.byYou" : "flow.plan.byTimeout");
  return (
    <section aria-label={t("flow.plan.title", { n: plan.planNo })} data-tone={pending.length > 0 ? "warn" : undefined}>
      <h4>{t("flow.plan.title", { n: plan.planNo })} <span className="badge" data-tone="info">{t(`flow.planState.${plan.state}`)}</span></h4>
      {pending.length > 0 && <>
        <ul>
          {pending.map((p) => (
            <li key={p.stepKey} data-testid={`flow-pending-${p.stepKey}`}>
              <p><strong>{p.stepKey}</strong>: {p.question}</p>
              <p>{t("flow.plan.keepsAt", { time: clock(p.deadline) })} · <Remaining deadline={p.deadline} /></p>
              {props.may ? <>
                <button type="button" onClick={() => answer(p.stepKey, "run")}>{t("flow.plan.runIt")}</button>{" "}
                <button type="button" onClick={() => answer(p.stepKey, "accept-unchanged")}>{t("flow.plan.accept")}</button>
              </> : <p role="note">{t("flow.ownerOnly")}</p>}
            </li>
          ))}
        </ul>
        <p role="note" data-testid="flow-plan-depends">{t("flow.plan.depends", { step: props.steps.find((s) => pending.some((p) => p.stepKey === s.stepKey))?.stepKey ?? pending[0]!.stepKey })}</p>
      </>}
      {ran.length > 0 && (
        <ul>{ran.map((key) => (
          <li key={key} data-testid={`flow-plan-ran-${key}`}>
            {t("flow.plan.ran", { step: key })}
            {props.may && <>{" "}<button type="button" onClick={() => answer(key, "accept-unchanged")}>{t("flow.plan.accept")}</button></>}
          </li>
        ))}</ul>
      )}
      {accepted.length > 0 && <ul>{accepted.map((a) => <li key={a.stepKey} data-testid={`flow-plan-accepted-${a.stepKey}`}>{t("flow.plan.accepted", { step: a.stepKey, source: source(a) })}</li>)}</ul>}
      <SpendLine spend={plan.spend} />
    </section>
  );
}

/** Gaps spec §4.1, §4.7: feedback on the whole run -- where it is (optional), screenshots, and "use my words as they are". */
function RunFeedback(props: { runId: string; send: Send; upload: Upload }): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [anchor, setAnchor] = useState<AnchorDraft>(NO_ANCHOR);
  const [files, setFiles] = useState<File[]>([]);
  const [asIs, setAsIs] = useState(false);
  const [busy, setBusy] = useState(false);
  const tooMany = files.length > 4;
  const submit = async (): Promise<void> => {
    setBusy(true);
    const ids: string[] = [];
    for (const file of files) {
      const id = await props.upload(file);
      if (id === null) { setBusy(false); return; }
      ids.push(id);
    }
    const anchors = anchorsOf(anchor);
    props.send("messages", { runId: props.runId, kind: "feedback", target: { kind: "run" }, body: {
      text: text.trim(), ...(anchors.length === 0 ? {} : { anchors }), ...(ids.length === 0 ? {} : { attachments: ids }), ...(asIs ? { asIs: true } : {}),
    } });
    setText(""); setAnchor(NO_ANCHOR); setFiles([]); setAsIs(false); setBusy(false);
  };
  return (
    <form className="flow-message" aria-label={t("flow.feedback.title")} onSubmit={(event) => { event.preventDefault(); if (text.trim() !== "" && !tooMany && !busy) void submit(); }}>
      <h4>{t("flow.feedback.title")}</h4>
      <textarea aria-label={t("flow.message.text")} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      <AnchorFields draft={anchor} onChange={setAnchor} />
      <label>{t("flow.feedback.attach")} <input type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={t("flow.feedback.attach")}
        onChange={(event) => setFiles([...(event.currentTarget.files ?? [])])} /></label>
      {tooMany && <p data-tone="warn" role="status">{t("flow.feedback.tooMany")}</p>}
      <label><input type="checkbox" checked={asIs} onChange={(event) => setAsIs(event.currentTarget.checked)} />{t("flow.feedback.asIs")}</label>
      <button type="submit" disabled={text.trim() === "" || tooMany || busy}>{t("flow.message.sendFeedback")}</button>
    </form>
  );
}

const intakeTone = (state: FlowIntakeV1["state"]): "warn" | "info" | "danger" | undefined =>
  state === "needs-location" || state === "clarifying" ? "warn" : state === "failed" ? "danger" : state === "planned" || state === "withdrawn" ? undefined : "info";

/**
 * Gaps spec §4.2-§4.8, §14.2: one open feedback intake -- where it was found; when the quote is found more than once,
 * the places to pick from ("this one" replaces the message with that hit) or a rewrite; its clarify round with "use my
 * words as they are"; the steps it went to and why, with "change target"; and what its single calls cost.
 */
function IntakeCard(props: { intake: FlowIntakeV1; steps: Step[]; runId: string; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { intake } = props;
  const [rewriting, setRewriting] = useState(false);
  const [text, setText] = useState(intake.text);
  const [anchor, setAnchor] = useState<AnchorDraft>(NO_ANCHOR);
  const [retarget, setRetarget] = useState("");
  const target = intake.stepKey === null ? { kind: "run" } : { kind: "step", stepKey: intake.stepKey };
  // §4.8 (fix round 1, I1): a replacement is the same feedback adjusted -- it keeps the screenshots, "use my words as they
  // are" and the location, except what the replacement itself gives (a picked hit pins the place; a rewrite gives new anchors).
  const kept = { ...(intake.attachments.length === 0 ? {} : { attachments: intake.attachments }), ...(intake.asIs ? { asIs: true } : {}) };
  const keptAnchors = intake.anchors.length === 0 ? {} : { anchors: intake.anchors };
  const replace = (body: Record<string, unknown>, to: Record<string, unknown> = target): void =>
    props.send("messages", { runId: props.runId, kind: "feedback", target: to, body: { text: intake.text, replaces: intake.messageSeq, ...kept, ...body } });
  const hits = intake.results.flatMap((r) => ("hits" in r ? r.hits : []));
  const located = intake.results.flatMap((r) => ("located" in r ? [r.located] : []));
  const where = (h: { file: string; paragraph: number; headingPath: string[] }): string =>
    [t("flow.intake.where", { file: h.file, paragraph: h.paragraph }), ...(h.headingPath.length === 0 ? [] : [h.headingPath.join(" › ")])].join(" · ");
  const asIsButton = <button type="button" onClick={() => replace({ ...keptAnchors, asIs: true })}>{t("flow.feedback.asIs")}</button>;
  return (
    <section className="flow-intake" aria-label={t("flow.intake.title", { seq: intake.messageSeq })} data-testid={`flow-intake-${intake.messageSeq}`} data-tone={intakeTone(intake.state)}>
      <h4>{t("flow.intake.title", { seq: intake.messageSeq })} <span className="badge" data-tone={intakeTone(intake.state)}>{t(`flow.intakeState.${intake.state}`)}</span></h4>
      <p>{intake.text}</p>
      {intake.restated !== null && <p>{t("flow.intake.restated", { text: intake.restated })}</p>}
      {located.map((h, i) => <blockquote key={i}><p>{h.excerpt}</p><p>{where(h)}</p></blockquote>)}
      {intake.state === "needs-location" && <>
        {hits.length > 0 ? <ol>{hits.map((h, i) => (
          <li key={i} data-testid="flow-intake-hit">
            <blockquote><p>{h.excerpt}</p><p>{where(h)}</p></blockquote>
            <button type="button" onClick={() => replace({ hit: i + 1 })}>{t("flow.intake.thisOne")}</button>
          </li>
        ))}</ol> : <p data-tone="warn">{intake.ambiguousFiles.length > 0 ? t("flow.intake.ambiguous", { files: intake.ambiguousFiles.join(", ") }) : t("flow.intake.notFound")}</p>}
        {rewriting ? (
          <form aria-label={t("flow.intake.rewrite")} onSubmit={(event) => { event.preventDefault(); if (text.trim() === "") return; const anchors = anchorsOf(anchor); setRewriting(false);
            props.send("messages", { runId: props.runId, kind: "feedback", target, body: { text: text.trim(), replaces: intake.messageSeq, ...kept, ...(anchors.length === 0 ? {} : { anchors }) } }); }}>
            <textarea aria-label={t("flow.message.text")} value={text} onChange={(event) => setText(event.currentTarget.value)} />
            <AnchorFields draft={anchor} onChange={setAnchor} />
            <button type="submit" disabled={text.trim() === ""}>{t("flow.message.sendFeedback")}</button>
          </form>
        ) : <button type="button" onClick={() => setRewriting(true)}>{t("flow.intake.rewrite")}</button>}
      </>}
      {intake.state === "clarifying" && intake.clarify !== null && (props.may ? (
        <QuestionsForm label={t("flow.intake.clarify", { seq: intake.messageSeq })} statement={null} questions={intake.clarify.questions}
          onAnswer={(answers) => props.send("answer", { runId: props.runId, feedback: intake.messageSeq, clarify: { roundNo: intake.clarify!.roundNo, answers, glossaryDecisions: [], adrDecisions: [] } })}
          onConsensus={() => props.send("answer", { runId: props.runId, feedback: intake.messageSeq, consensus: true })} extra={asIsButton} />
      ) : <p>{t("flow.ownerOnly")} {asIsButton}</p>)}
      {intake.targets.length > 0 && (
        <ul>{intake.targets.map((g) => <li key={g.stepKey} data-testid="flow-intake-target">{t("flow.intake.target", { step: g.stepKey, why: g.why })}</li>)}</ul>
      )}
      {intake.flags.length > 0 && <p>{intake.flags.map((flag) => <span key={flag} className="badge" data-tone="warn" data-testid="flow-intake-flag">{flag}</span>)}</p>}
      {intake.state !== "failed" && (
        <p>
          <select aria-label={t("flow.intake.changeTarget")} value={retarget} onChange={(event) => setRetarget(event.currentTarget.value)}>
            <option value="">{t("flow.intake.pickStep")}</option>
            {props.steps.map((s) => <option key={s.stepKey} value={s.stepKey}>{s.stepKey}</option>)}
          </select>{" "}
          <button type="button" disabled={retarget === ""} onClick={() => { replace(keptAnchors, { kind: "step", stepKey: retarget }); setRetarget(""); }}>{t("flow.intake.changeTarget")}</button>
        </p>
      )}
      <SpendLine spend={intake.spend} />
    </section>
  );
}

/** The step kinds a person may skip or defer (gaps spec §6.1: clarify takes consensus, ask its answer). */
const MARKABLE = new Set(["work", "draft", "check", "review"]);

/**
 * Gaps spec §6.1-§6.3: skip, defer or fill a step. A defer asks, in a dialog, what each external/irreversible effect
 * step after it should do (preselected: wait) -- only when there is such a step; otherwise it is sent at once.
 */
function StepMarks(props: { step: Step; runId: string; send: Send }): JSX.Element | null {
  const { t } = useTranslation();
  const { step } = props;
  const [asking, setAsking] = useState<Record<string, "proceed" | "wait"> | null>(null);
  if (!MARKABLE.has(step.kind)) return null;
  const command = (body: Record<string, unknown>): void => props.send("messages", { runId: props.runId, kind: "command", target: { kind: "step", stepKey: step.stepKey }, body });
  // §6.1: a repeated skip/defer replaces the mark -- how a skip becomes a defer, or a defer's effect choices change later.
  const ask = (): void => setAsking(Object.fromEntries(step.deferHolds.map((key) => [key, step.mark?.kind === "defer" ? step.mark.effects[key] ?? "wait" : "wait" as const])));
  const defer = (): void => (step.deferHolds.length === 0 ? command({ command: "defer" }) : ask());
  return (
    <div className="flow-marks">
      {step.mark === null ? <>
        <button type="button" onClick={() => command({ command: "skip" })}>{t("flow.mark.skip")}</button>{" "}
        <button type="button" onClick={defer}>{t("flow.mark.defer")}</button>
      </> : <>
        <button type="button" onClick={() => command({ command: "fill" })}>{t("flow.mark.fill")}</button>{" "}
        {step.mark.kind === "skip"
          ? <button type="button" onClick={defer}>{t("flow.mark.deferInstead")}</button>
          : <button type="button" onClick={() => command({ command: "skip" })}>{t("flow.mark.skipInstead")}</button>}
        {step.mark.kind === "defer" && step.deferHolds.length > 0 && <>{" "}<button type="button" onClick={ask}>{t("flow.mark.changeEffects")}</button></>}
      </>}
      {asking !== null && (
        <div role="dialog" aria-label={t("flow.mark.deferTitle", { step: step.stepKey })}>
          <p>{t("flow.mark.deferAsk", { step: step.stepKey })}</p>
          {step.deferHolds.map((key) => (
            <fieldset key={key}>
              <legend>{key}</legend>
              <label><input type="radio" name={`defer-${step.stepKey}-${key}`} checked={asking[key] === "wait"} onChange={() => setAsking({ ...asking, [key]: "wait" })} />{t("flow.mark.wait")}</label>
              <label><input type="radio" name={`defer-${step.stepKey}-${key}`} checked={asking[key] === "proceed"} onChange={() => setAsking({ ...asking, [key]: "proceed" })} />{t("flow.mark.proceed")}</label>
            </fieldset>
          ))}
          <button type="button" onClick={() => { command({ command: "defer", effects: asking }); setAsking(null); }}>{t("flow.mark.defer")}</button>{" "}
          <button type="button" onClick={() => setAsking(null)}>{t("flow.mark.cancel")}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Gaps spec §6.3: an effect step a deferral holds. "Push now without <step>" re-sends that step's defer with `proceed`
 * for this effect (its other choices kept) -- only the person may (a member's is refused, and the refusal is shown);
 * "Wait" keeps it held, which needs no message.
 */
function HeldCard(props: { step: Step; steps: Step[]; runId: string; send: Send; messages: FlowMessageV1[]; waiting: boolean; onWait: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { step, waiting } = props;
  // A push the server refused (a member's; flow-effect-needs-person), newer than the defer that holds now -- read from
  // the journal, so a rejection that lands at a later boundary shows here too, not only one answered at once.
  const refused = props.messages.filter((m) => m.state === "rejected" && (m.reason ?? "").startsWith("flow-effect-needs-person") && m.kind === "command"
    && step.heldBy.includes(String((m.body.target as { stepKey?: unknown } | undefined)?.stepKey))
    && (m.body.effects as Record<string, unknown> | undefined)?.[step.stepKey] === "proceed"
    && m.seq > (props.steps.find((s) => s.stepKey === (m.body.target as { stepKey: string }).stepKey)?.mark?.messageSeq ?? 0));
  return (
    <div className="flow-held" role="group" aria-label={t("flow.held.title", { step: step.stepKey })} data-tone="warn">
      <p>{t("flow.held.what", { step: step.stepKey, deferred: step.heldBy.join(", ") })}</p>
      {refused.length > 0 && <p data-tone="danger" data-testid="flow-held-refused">{t("flow.held.refused", { step: step.stepKey })}</p>}
      {waiting ? <p>{t("flow.held.waiting")}</p> : <>
        {step.heldBy.map((deferred) => {
          const effects = props.steps.find((s) => s.stepKey === deferred)?.mark?.effects ?? {};
          return <span key={deferred}><button type="button" onClick={() => props.send("messages", { runId: props.runId, kind: "command", target: { kind: "step", stepKey: deferred },
            body: { command: "defer", effects: { ...effects, [step.stepKey]: "proceed" } } })}>{t("flow.held.push", { step: deferred })}</button>{" "}</span>;
        })}
        <button type="button" onClick={props.onWait}>{t("flow.held.wait")}</button>
      </>}
    </div>
  );
}

/** Gaps spec §8.4: on a failed or deferred step whose `when` reads a param, set that param instead (a `params` command). */
function SetParam(props: { param: { id: string; type: string | null }; current: string | number | boolean | undefined; runId: string; send: Send; /** Plan Task 10-B: the run's folder and template, for an image param's picker. */ dir: string | null; template: string }): JSX.Element {
  const { t } = useTranslation();
  const { param } = props;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(props.current === undefined || typeof props.current === "boolean" ? "" : String(props.current));
  const [flag, setFlag] = useState<boolean>(props.current === true);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>{t("flow.param.instead", { param: param.id })}</button>;
  const typed = param.type === "bool" ? flag : param.type === "int" ? Number(value) : value.trim();
  const ready = param.type === "bool" || (param.type === "int" ? Number.isSafeInteger(Number(value)) && value.trim() !== "" : value.trim() !== "");
  return (
    <form aria-label={t("flow.param.instead", { param: param.id })} onSubmit={(event) => { event.preventDefault(); if (!ready) return; setOpen(false);
      props.send("messages", { runId: props.runId, kind: "command", target: { kind: "run" }, body: { command: "params", set: { [param.id]: typed } } }); }}>
      {param.type === "bool"
        ? <label><input type="checkbox" checked={flag} onChange={(event) => setFlag(event.currentTarget.checked)} />{param.id}</label>
        : <input type={param.type === "int" ? "number" : "text"} aria-label={param.type === "image" || param.type === "path" ? t("flow.param.path", { param: param.id }) : param.id}
          value={value} onChange={(event) => setValue(event.currentTarget.value)} />}{" "}
      {param.type === "image" && props.dir !== null && <FolderImagePicker dir={props.dir} template={props.template} paramId={param.id} value={value} hasDefault={false} onPick={setValue} />}
      <button type="submit" disabled={!ready}>{t("flow.param.set")}</button>{" "}
      <button type="button" onClick={() => setOpen(false)}>{t("flow.mark.cancel")}</button>
    </form>
  );
}

function Decisions(props: { decisions: FlowRunViewV1["decisions"] }): JSX.Element {
  const { t } = useTranslation();
  const [minor, setMinor] = useState(false);
  const shown = props.decisions.filter((d) => minor || d.grade === "major");
  return (
    <section aria-label={t("flow.decisions.title")}>
      <h4>{t("flow.decisions.title")}</h4>
      <label><input type="checkbox" checked={minor} onChange={(event) => setMinor(event.currentTarget.checked)} />{t("flow.decisions.showMinor", { count: props.decisions.filter((d) => d.grade === "minor").length })}</label>
      {shown.length === 0 ? <p>{t("flow.decisions.none")}</p> : (
        <ul>{shown.map((d) => (
          <li key={d.seq} data-testid="flow-decision">
            <span className="badge" data-tone={d.grade === "major" ? "warn" : undefined}>{t(`flow.decisions.grade.${d.grade}`)}</span>{" "}
            {d.stepKey ?? ""} · {String(d.body.kind ?? "")} · {d.by}{" "}<code>{JSON.stringify(d.body)}</code>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Messages(props: { journal: FlowJournalV1 | null }): JSX.Element {
  const { t } = useTranslation();
  const messages = props.journal?.messages ?? [];
  return (
    <section aria-label={t("flow.messages.title")}>
      <h4>{t("flow.messages.title")}</h4>
      {messages.length === 0 ? <p>{t("flow.messages.none")}</p> : (
        <ol>{messages.map((m) => {
          const target = m.body.target as { kind?: string; stepKey?: string; seq?: number } | undefined;
          const where = target?.stepKey === undefined ? m.target : target.seq === undefined ? target.stepKey : `${target.stepKey}#${target.seq}`;
          const what = typeof m.body.text === "string" ? m.body.text : typeof m.body.command === "string" ? m.body.command : JSON.stringify(m.body.record ?? Object.keys((m.body.files as object | undefined) ?? {}));
          return (
            <li key={m.seq} data-testid="flow-message" data-tone={m.state === "rejected" ? "danger" : undefined}>
              #{m.seq} {m.kind} · {where} · {what} · {t("flow.byVia", { by: m.by, via: m.via })} · {t(`flow.messageState.${m.state}`)}{m.reason !== null ? ` (${m.reason})` : ""}
            </li>
          );
        })}</ol>
      )}
    </section>
  );
}

function StepCard(props: { step: Step; view: FlowRunViewV1; may: boolean; send: Send; messages: FlowMessageV1[]; waiting: boolean; onWait: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { step, view } = props;
  const latest = step.latest;
  const older = step.executions.filter((e) => e.seq !== latest?.seq);
  const ask = latest?.state === "needs-person" ? latest.ask : null;
  // Gaps spec §9: the waiting round of a revision in progress is the revision's, not the active execution's.
  const round = ask?.kind === "clarify-round" ? (step.clarifyRevision ?? step.clarify)?.rounds.find((r) => r.roundNo === ask.roundNo) ?? null : null;
  const open = view.state !== "stopped";
  return (
    <section className="flow-step" aria-label={step.stepKey} data-testid={`flow-step-${step.stepKey}`}>
      <h4>
        {step.stepKey} · {step.kind}{" "}
        <span className="badge" data-tone={stateTone(latest?.state ?? "")} data-testid="flow-step-state">{latest === null ? t("flow.notRun") : t(`flow.execState.${latest.state}`, { defaultValue: latest.state })}</span>
        {step.effect !== null && <>{" "}<span className="badge">{t("flow.effectClass", { kind: step.effect.kind, cls: step.effect.class ?? "" })}</span></>}
        {step.parallelWith !== null && <>{" "}<span className="badge">{t("flow.parallelWith", { step: step.parallelWith })}</span></>}
        {step.mark !== null && <>{" "}<span className="badge" data-tone={step.mark.kind === "defer" ? "warn" : undefined} data-testid="flow-mark">{t(step.mark.kind === "skip" ? "flow.mark.skipped" : "flow.mark.deferred")}</span></>}
      </h4>
      {step.executor !== null && step.executor !== "agent" && <p>{t(`flow.executor.${step.executor}`)}</p>}
      {latest !== null && <ExecutionFacts execution={latest} active={step.head === latest.seq} />}
      {latest !== null && step.head !== null && step.head !== latest.seq && <p>{t("flow.activeIs", { seq: step.head })}</p>}
      {ask !== null && ask.kind === "ask" && (props.may ? <AskForm ask={ask} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {ask !== null && (ask.kind === "input" || ask.kind === "confirmation") && (props.may ? <NeedsForm ask={ask} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {ask !== null && ask.kind === "effect-confirm" && <ConfirmCard ask={ask} may={props.may} send={props.send} />}
      {round !== null && (props.may ? <ClarifyForm round={round} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {latest?.state === "failed" && <button type="button" onClick={() => props.send("messages", { runId: view.flowRunId, kind: "command", target: { kind: "step", stepKey: step.stepKey }, body: { command: "retry" } })}>{t("flow.retry")}</button>}
      {open && (latest?.state === "failed" || step.mark?.kind === "defer") && step.whenParams.map((param) => (
        <SetParam key={param.id} param={param} current={view.params[param.id]} runId={view.flowRunId} send={props.send} dir={view.dir} template={view.template.id} />
      ))}
      {open && step.heldBy.length > 0 && <HeldCard step={step} steps={view.steps} runId={view.flowRunId} send={props.send} messages={props.messages} waiting={props.waiting} onWait={props.onWait} />}
      {/* Task 11 acceptance (session ffec7b28): a finished run offers no new skip or defer; a standing mark can still be filled. */}
      {open && (view.state !== "done" || step.mark !== null) && <StepMarks step={step} runId={view.flowRunId} send={props.send} />}
      {step.kind === "clarify" && <ClarifyRounds step={step} runId={view.flowRunId} open={open} send={props.send} />}
      {older.length > 0 && (
        <details>
          <summary>{t("flow.earlier", { count: older.length })}</summary>
          {older.map((e) => <ExecutionFacts key={e.seq} execution={e} active={step.head === e.seq} />)}
        </details>
      )}
      {/* Task 11 acceptance (session ffec7b28): with one execution the step's sum is that execution's line again. */}
      {step.executions.length > 1 && <SpendLine spend={step.spend} />}
      {open && <MessageBox step={step} runId={view.flowRunId} send={props.send} />}
    </section>
  );
}

function RunControls(props: { view: FlowRunViewV1; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { view } = props;
  const [raise, setRaise] = useState("");
  const [to, setTo] = useState("");
  const command = (body: Record<string, unknown>): void => props.send("messages", { runId: view.flowRunId, kind: "command", target: { kind: "run" }, body });
  const raiseBy = Number(raise);
  const rewind = /^([a-z0-9][a-z0-9-]*)(?:#(\d+))?$/.exec(to.trim());
  return (
    <section aria-label={t("flow.controls")}>
      <p>
        {view.state === "running" && <button type="button" onClick={() => command({ command: "pause" })}>{t("flow.pause")}</button>}
        {view.state === "paused" && <button type="button" onClick={() => command({ command: "resume" })}>{t("flow.resume")}</button>}
        {view.state !== "stopped" && <>{" "}<button type="button" onClick={() => command({ command: "stop" })}>{t("flow.stop")}</button></>}
        {view.state !== "stopped" && <>{" "}<button type="button" onClick={() => props.send("plan", { runId: view.flowRunId })}>{t("flow.makePlan")}</button></>}
      </p>
      {view.state !== "stopped" && (
        <p>
          <label>{t("flow.rewindTo")}<input type="text" value={to} onChange={(event) => setTo(event.currentTarget.value)} /></label>{" "}
          <button type="button" disabled={rewind === null} onClick={() => { if (rewind !== null) { command({ command: "rewind", toStep: rewind[1], ...(rewind[2] === undefined ? {} : { toSeq: Number(rewind[2]) }) }); setTo(""); } }}>{t("flow.rewind")}</button>
        </p>
      )}
      {/* §6.3: the pool as stored -- the run's tokens and what its steps drew; no estimate of spend. */}
      <p title={`${formatTokens(view.poolDrawn, currentLanguage())} / ${formatTokens(view.poolTokens, currentLanguage())}`} data-testid="flow-pool">
        {t("flow.pool", { drawn: shortTokens(view.poolDrawn), pool: shortTokens(view.poolTokens) })}
      </p>
      {props.may && view.state !== "stopped" && (
        <p>
          <label>{t("flow.raiseBy")}<input type="number" min={1} value={raise} onChange={(event) => setRaise(event.currentTarget.value)} /></label>{" "}
          <button type="button" disabled={!Number.isSafeInteger(raiseBy) || raiseBy < 1} onClick={() => { props.send("pool", { runId: view.flowRunId, raiseTokens: raiseBy }); setRaise(""); }}>{t("flow.raise")}</button>
        </p>
      )}
    </section>
  );
}

/** The run's body re-mounts when its shape moves (forms reset to the new state); what must survive sits outside it. */
const remountKey = (view: FlowRunViewV1): string => JSON.stringify([view.state, view.plans.length, view.effects.map((e) => e.state), view.steps.map((s) => s.latest?.seq ?? 0)]);

export function FlowRunPage(props: { flowRunId: string; onBack?: () => void }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const [view, setView] = useState<FlowRunViewV1 | null>(null);
  const [journal, setJournal] = useState<FlowJournalV1 | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [unread, setUnread] = useState(false);
  // Fix round 1: what must outlive a re-mount of the run's body (M5), the messages this page sent that the server has
  // not taken yet (M4: a later rejection is shown), and how many follow-up reads were made since the last act.
  const [waitingHeld, setWaitingHeld] = useState<ReadonlySet<string>>(new Set());
  const [tracked, setTracked] = useState<readonly number[]>([]);
  const [followUps, setFollowUps] = useState(0);
  const base = `/api/control/flows/${segment(props.flowRunId)}`;
  const read = useCallback(async (): Promise<void> => {
    try {
      const [next, messages] = await Promise.all([controlGet<FlowRunViewV1>(base), controlGet<FlowJournalV1>(`${base}/journal`)]);
      setView(next); setJournal(messages); setUnread(false);
    } catch { setUnread(true); }
  }, [base]);
  useEffect(() => { void read(); }, [read]);

  const send: Send = (verb, payload) => {
    void (async () => {
      const answer = await sendControlCommand(`/api/control/flows/${verb}`, { commandId: nextCommandId(), expectedRevision: 0, payload });
      setRefusal(null);
      // Gaps spec §6.3 (Task 9): a flow message is stored even when refused -- the verb answers 200 with the message
      // `rejected` (e.g. flow-effect-needs-person for a member's "push now") -- so a refusal there is shown as one too.
      const stored = answer.kind === "answered" && answer.status < 400 ? (answer.body as { result?: { kind?: string; state?: string; reason?: string | null } }).result : undefined;
      const rejected = stored?.kind === "flow-message-stored" && stored.state === "rejected" && typeof stored.reason === "string"
        ? { status: answer.kind === "answered" ? answer.status : null, code: stored.reason.split(":")[0]!, message: stored.reason } : null;
      const seq = (stored as { seq?: unknown } | undefined)?.seq;
      if (stored?.kind === "flow-message-stored" && stored.state === "accepted" && typeof seq === "number") setTracked((now) => [...now, seq]);
      setFollowUps(0);
      const failure = answer.kind === "uncertain" ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
        : answer.status >= 400 ? refusalFromAnswer(answer) : rejected;
      await read();
      if (failure !== null) setRefusal(failure);
    })();
  };
  const upload: Upload = async (file) => {
    const answer = await uploadFlowAttachment(props.flowRunId, file);
    if (answer.ok) return answer.id;
    setRefusal(answer.refusal);
    return null;
  };
  // M4: a message this page sent that the server took later -- refused (a member's push, at the next boundary) is shown.
  useEffect(() => {
    if (journal === null || tracked.length === 0) return;
    const settled = journal.messages.filter((m) => tracked.includes(m.seq) && m.state !== "accepted");
    if (settled.length === 0) return;
    const refused = settled.find((m) => m.state === "rejected" && m.reason !== null);
    if (refused !== undefined) setRefusal({ status: null, code: refused.reason!.split(":")[0]!, message: refused.reason! });
    setTracked((now) => now.filter((s) => !settled.some((m) => m.seq === s)));
  }, [journal, tracked]);
  // M4: one read just after a shown deadline passes, and a few spaced reads while an intake locates or triages or a message
  // waits for its boundary -- bounded, not a poll.
  useEffect(() => {
    if (view === null) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const now = Date.now();
    const deadlines = view.plans.filter((p) => p.state === "running").flatMap((p) => (p.chosen?.pending ?? [])
      .filter((q) => q.answer === null && q.closed === undefined).map((q) => q.deadline)).filter((d) => d > now);
    if (deadlines.length > 0) timers.push(setTimeout(() => void read(), Math.min(...deadlines) - now + 1000));
    const moving = view.intakes.some((i) => i.state === "locating" || i.state === "triaging") || tracked.length > 0
      || (journal?.messages ?? []).some((m) => m.state === "accepted");
    if (moving && followUps < FOLLOW_UPS) timers.push(setTimeout(() => { setFollowUps((n) => n + 1); void read(); }, FOLLOW_UP_MS * 2 ** followUps));
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [view, journal, tracked, followUps, read]);
  const lang = currentLanguage();
  const title = view?.template.title?.[lang] ?? view?.template.title?.en ?? view?.template.id ?? props.flowRunId;
  const plan = view?.plans.filter((p) => p.state === "proposed").at(-1) ?? null;
  const running = view?.plans.filter((p) => p.state === "running").at(-1) ?? null;
  const intakes = (view?.intakes ?? []).filter((i) => i.state !== "planned" && i.state !== "withdrawn");
  return (
    <article className="flow-run" aria-label={t("flow.page", { title })}>
      {props.onBack !== undefined && <button type="button" onClick={props.onBack}>{t("flow.back")}</button>}
      <h3>{title} · <code>{props.flowRunId}</code>{view !== null && <>{" "}<span className="badge" data-tone={stateTone(view.state)} data-testid="flow-run-state">{t(`flow.state.${view.state}`, { defaultValue: view.state })}</span></>}{view?.scheduled != null && <>{" "}<span className="badge" data-tone="info" data-testid="flow-run-scheduled">{t("board.card.scheduled", { name: view.scheduled.name })}</span></>}</h3>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unread && <p data-testid="flow-unread">{t("flow.unread")}</p>}
      {view !== null && (<>
        <div key={remountKey(view)}>
          <p>{t("flow.facts", { template: view.templateRef, dir: view.dir ?? "", by: view.by, via: view.via })}</p>
          {/* Spec §15 (H2): the article flow ends at the draft box; publishing stays the person's own act. */}
          {view.template.id === "wechat-article" && <p role="note" data-testid="flow-publish-note">{t("flow.wechatPublish")}</p>}
          {!may && <p role="note">{t("flow.ownerOnlyAll")}</p>}
          <RunControls view={view} may={may} send={send} />
          {/* Gaps spec §10: the run's spend, the tool's numbers only. */}
          <p data-testid="flow-run-spend">{spendText(view.spend, t)} · <span role="note">{t("flow.spend.note")}</span></p>
          {plan !== null && <PlanChecklist plan={plan} steps={view.steps} runId={view.flowRunId} may={may} send={send} />}
          {running !== null && <RunningPlan plan={running} steps={view.steps} runId={view.flowRunId} may={may} send={send} />}
          {intakes.map((intake) => <IntakeCard key={intake.messageSeq} intake={intake} steps={view.steps} runId={view.flowRunId} may={may} send={send} />)}
        </div>
        {/* M5: outside the re-mount key, so a half-written feedback and its chosen screenshots survive another act. */}
        {view.state !== "stopped" && <RunFeedback runId={view.flowRunId} send={send} upload={upload} />}
        <div key={`steps:${remountKey(view)}`}>
          <section aria-label={t("flow.steps")}>
            <h4>{t("flow.steps")}</h4>
            {view.steps.map((step) => <StepCard key={step.stepKey} step={step} view={view} may={may} send={send} messages={journal?.messages ?? []}
              waiting={waitingHeld.has(step.stepKey)} onWait={() => setWaitingHeld((now) => new Set([...now, step.stepKey]))} />)}
          </section>
          <Effects effects={view.effects} may={may} send={send} />
          <Decisions decisions={view.decisions} />
          <Messages journal={journal} />
          {view.plans.length > 0 && (
            <details>
              <summary>{t("flow.plan.history", { count: view.plans.length })}</summary>
              <ul>{view.plans.map((p) => <li key={p.planNo}>{t("flow.plan.row", { n: p.planNo, state: t(`flow.planState.${p.state}`), steps: (p.chosen?.steps ?? []).join(", "), skips: (p.chosen?.skips ?? []).join(", ") })}</li>)}</ul>
            </details>
          )}
        </div>
      </>)}
    </article>
  );
}
