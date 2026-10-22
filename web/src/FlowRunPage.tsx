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
import type { TFunction } from "i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { FlowAskV1, FlowEffectV1, FlowExecutionViewV1, FlowJournalV1, FlowPlanV1, FlowRunViewV1, FlowToolRulesReportV1, RoundBodyV1 } from "./controlTypes.js";
import { currentLanguage } from "./i18n.js";
import { Refusal } from "./Refusal.js";
import { formatTokens, shortTokens } from "./TokenInput.js";

type Verb = "messages" | "plan" | "rerun" | "answer" | "effect" | "pool";
type Send = (verb: Verb, payload: Record<string, unknown>) => void;
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
    if (mode === "feedback") props.send("messages", { runId: props.runId, kind: "feedback", target: targetOf(), body: { text: text.trim() } });
    else props.send("messages", { runId: props.runId, kind: "edit", target: { kind: "step", stepKey: props.step.stepKey }, body: mode === "edit-record" ? { record: record()! } : { files: { [path.trim()]: text } } });
    setText(""); setPath("");
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

/** §10: a flow clarify round waiting on the person -- recommended answers or their own, then the round or consensus. */
function ClarifyForm(props: { round: RoundBodyV1; stepKey: string; runId: string; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result;
  const [own, setOwn] = useState<Record<string, string>>({});
  if (result === null) return <p>{t("flow.clarify.drafting", { n: props.round.roundNo })}</p>;
  const answers = result.questions.map((q) => (own[q.id] ?? "").trim() === "" ? { id: q.id, kind: "recommended" } : { id: q.id, kind: "text", text: own[q.id]!.trim() });
  return (
    <form aria-label={t("flow.clarify.title", { step: props.stepKey, n: props.round.roundNo })} onSubmit={(event) => {
      event.preventDefault();
      props.send("answer", { runId: props.runId, stepKey: props.stepKey, clarify: { roundNo: props.round.roundNo, answers,
        glossaryDecisions: result.glossary.map((g) => ({ id: g.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) } });
    }}>
      <p>{result.statement}</p>
      {result.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.id} {q.question}</legend>
          <p>{t("requirements.recommended", { answer: q.recommendedAnswer })}</p>
          <textarea aria-label={t("flow.clarify.own", { id: q.id })} value={own[q.id] ?? ""} onChange={(event) => setOwn({ ...own, [q.id]: event.currentTarget.value })} />
        </fieldset>
      ))}
      <button type="submit">{t("flow.clarify.send")}</button>
      <button type="button" onClick={() => props.send("answer", { runId: props.runId, stepKey: props.stepKey, consensus: true })}>{t("flow.clarify.consensus")}</button>
    </form>
  );
}

/** §9.3: the level an effect runs at and where it came from. */
function policyText(policy: FlowEffectV1["policy"], t: TFunction): string {
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
              return (
                <li key={c.stepKey} data-testid={`flow-plan-${c.stepKey}`}>
                  <label><input type="checkbox" checked={ticked.has(c.stepKey)} disabled={!props.may} onChange={(event) => toggle(c.stepKey, event.currentTarget.checked)} />
                    {c.stepKey}</label> · {t("flow.reasons", { reasons: c.reasons.join(", ") })}
                  {skip !== undefined && <p>{t("flow.plan.proposedSkip", { reason: skip.reason })}</p>}
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
    </section>
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

function StepCard(props: { step: Step; view: FlowRunViewV1; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { step, view } = props;
  const latest = step.latest;
  const older = step.executions.filter((e) => e.seq !== latest?.seq);
  const ask = latest?.state === "needs-person" ? latest.ask : null;
  const round = ask?.kind === "clarify-round" ? step.clarify?.rounds.find((r) => r.roundNo === ask.roundNo) ?? null : null;
  return (
    <section className="flow-step" aria-label={step.stepKey} data-testid={`flow-step-${step.stepKey}`}>
      <h4>
        {step.stepKey} · {step.kind}{" "}
        <span className="badge" data-tone={stateTone(latest?.state ?? "")} data-testid="flow-step-state">{latest === null ? t("flow.notRun") : t(`flow.execState.${latest.state}`, { defaultValue: latest.state })}</span>
        {step.effect !== null && <>{" "}<span className="badge">{t("flow.effectClass", { kind: step.effect.kind, cls: step.effect.class ?? "" })}</span></>}
        {step.parallelWith !== null && <>{" "}<span className="badge">{t("flow.parallelWith", { step: step.parallelWith })}</span></>}
      </h4>
      {step.executor !== null && step.executor !== "agent" && <p>{t(`flow.executor.${step.executor}`)}</p>}
      {latest !== null && <ExecutionFacts execution={latest} active={step.head === latest.seq} />}
      {latest !== null && step.head !== null && step.head !== latest.seq && <p>{t("flow.activeIs", { seq: step.head })}</p>}
      {ask !== null && ask.kind === "ask" && (props.may ? <AskForm ask={ask} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {ask !== null && (ask.kind === "input" || ask.kind === "confirmation") && (props.may ? <NeedsForm ask={ask} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {ask !== null && ask.kind === "effect-confirm" && <ConfirmCard ask={ask} may={props.may} send={props.send} />}
      {round !== null && (props.may ? <ClarifyForm round={round} stepKey={step.stepKey} runId={view.flowRunId} send={props.send} /> : <p role="note">{t("flow.ownerOnly")}</p>)}
      {latest?.state === "failed" && <button type="button" onClick={() => props.send("messages", { runId: view.flowRunId, kind: "command", target: { kind: "step", stepKey: step.stepKey }, body: { command: "retry" } })}>{t("flow.retry")}</button>}
      {older.length > 0 && (
        <details>
          <summary>{t("flow.earlier", { count: older.length })}</summary>
          {older.map((e) => <ExecutionFacts key={e.seq} execution={e} active={step.head === e.seq} />)}
        </details>
      )}
      {view.state !== "stopped" && <MessageBox step={step} runId={view.flowRunId} send={props.send} />}
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
          <input type="text" aria-label={t("flow.rewindTo")} value={to} onChange={(event) => setTo(event.currentTarget.value)} />{" "}
          <button type="button" disabled={rewind === null} onClick={() => { if (rewind !== null) { command({ command: "rewind", toStep: rewind[1], ...(rewind[2] === undefined ? {} : { toSeq: Number(rewind[2]) }) }); setTo(""); } }}>{t("flow.rewind")}</button>
        </p>
      )}
      {/* §6.3: the pool as stored -- the run's tokens and what its steps drew; no estimate of spend. */}
      <p title={`${formatTokens(view.poolDrawn, currentLanguage())} / ${formatTokens(view.poolTokens, currentLanguage())}`} data-testid="flow-pool">
        {t("flow.pool", { drawn: shortTokens(view.poolDrawn), pool: shortTokens(view.poolTokens) })}
      </p>
      {props.may && view.state !== "stopped" && (
        <p>
          <input type="number" min={1} aria-label={t("flow.raiseBy")} value={raise} onChange={(event) => setRaise(event.currentTarget.value)} />{" "}
          <button type="button" disabled={!Number.isSafeInteger(raiseBy) || raiseBy < 1} onClick={() => { props.send("pool", { runId: view.flowRunId, raiseTokens: raiseBy }); setRaise(""); }}>{t("flow.raise")}</button>
        </p>
      )}
    </section>
  );
}

export function FlowRunPage(props: { flowRunId: string; onBack?: () => void }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const [view, setView] = useState<FlowRunViewV1 | null>(null);
  const [journal, setJournal] = useState<FlowJournalV1 | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [unread, setUnread] = useState(false);
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
      const failure = answer.kind === "uncertain" ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
        : answer.status >= 400 ? refusalFromAnswer(answer) : null;
      await read();
      if (failure !== null) setRefusal(failure);
    })();
  };
  const lang = currentLanguage();
  const title = view?.template.title?.[lang] ?? view?.template.title?.en ?? view?.template.id ?? props.flowRunId;
  const plan = view?.plans.filter((p) => p.state === "proposed").at(-1) ?? null;
  return (
    <article className="flow-run" aria-label={t("flow.page", { title })}>
      {props.onBack !== undefined && <button type="button" onClick={props.onBack}>{t("flow.back")}</button>}
      <h3>{title} · <code>{props.flowRunId}</code>{view !== null && <>{" "}<span className="badge" data-tone={stateTone(view.state)} data-testid="flow-run-state">{t(`flow.state.${view.state}`, { defaultValue: view.state })}</span></>}</h3>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unread && <p data-testid="flow-unread">{t("flow.unread")}</p>}
      {view !== null && (
        <div key={JSON.stringify([view.state, view.plans.length, view.effects.map((e) => e.state), view.steps.map((s) => s.latest?.seq ?? 0)])}>
          <p>{t("flow.facts", { template: view.templateRef, dir: view.dir ?? "", by: view.by, via: view.via })}</p>
          {/* Spec §15 (H2): the article flow ends at the draft box; publishing stays the person's own act. */}
          {view.template.id === "wechat-article" && <p role="note" data-testid="flow-publish-note">{t("flow.wechatPublish")}</p>}
          {!may && <p role="note">{t("flow.ownerOnlyAll")}</p>}
          <RunControls view={view} may={may} send={send} />
          {plan !== null && <PlanChecklist plan={plan} steps={view.steps} runId={view.flowRunId} may={may} send={send} />}
          <section aria-label={t("flow.steps")}>
            <h4>{t("flow.steps")}</h4>
            {view.steps.map((step) => <StepCard key={step.stepKey} step={step} view={view} may={may} send={send} />)}
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
      )}
    </article>
  );
}
