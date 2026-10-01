/**
 * N1 spec §11.2: the Requirements section. Every state and number on it is the server's (the requirement view);
 * the browser originates only intents. Model-written text is shown as written (human ruling H8); the panel's own words
 * go through t.
 */
import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText, refusalText } from "./i18n.js";
import type { PanelLanguage } from "./i18n.js";
import type { ControlAction } from "./controlApi.js";
import { nextCommandId } from "./controlApi.js";
import type { ControlRefusal } from "./controlState.js";
import type { AgentsViewV1, ControlConfigV1, ControlSummaryV1, RequirementViewV1 } from "./controlTypes.js";

type View = RequirementViewV1;
type Round = View["rounds"][number];
type Draft = View["drafts"][number];
/** Every reason code this section can show, each with its one-line explanation (requirements.reason.*). */
const REASONS = [
  "clarify-output-invalid", "split-output-invalid", "split-validation-exhausted", "requirement-budget-exhausted",
  "requirement-export-conflict", "requirement-export-path-blocked", "requirement-export-pending", "requirement-not-split",
] as const;
type Reason = (typeof REASONS)[number];
/** The reasons recovery-retry lifts: a failed round or draft re-queues, a blocked export re-arms (spec §11.1, §15 item 11). */
const RETRYABLE: readonly string[] = ["clarify-output-invalid", "split-output-invalid", "split-validation-exhausted", "requirement-export-conflict", "requirement-export-path-blocked"];
const BUDGET_EXHAUSTED = "requirement-budget-exhausted";
const EXPORT_PENDING = "requirement-export-pending";
const isReason = (code: string): code is Reason => (REASONS as readonly string[]).includes(code);

function revisionOf(view: View): number { return view.summary.commandRevision; }

function NewRequirement(props: { config: ControlConfigV1; agents: AgentsViewV1 | null; language: PanelLanguage; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const [repoId, setRepoId] = useState(props.config.repositories[0]?.repoId ?? "");
  const [idea, setIdea] = useState("");
  const [tokens, setTokens] = useState(10_000_000);
  // Spec §11.2: the content language defaults to the language the panel is shown in.
  const [language, setLanguage] = useState<PanelLanguage>(props.language);
  const [agent, setAgent] = useState("");
  if (props.config.repositories.length === 0) return <p role="note">{t("requirements.noRepository")}</p>;
  return (
    <form aria-label={t("requirements.newTitle")} onSubmit={(event) => {
      event.preventDefault();
      const groupId = `requirement-${nextCommandId()}`;
      props.onCommand({ verb: "requirement-open", groupId, expectedRevision: 0, payload: {
        groupId, repoId, idea, contentLanguage: language, limit: { tokens, activeMs: 14_400_000, attempts: 40, sessions: 40 }, ...(agent === "" ? {} : { agent: { agent } }) } });
    }}>
      <h3>{t("requirements.newTitle")}</h3>
      <label>{t("requirements.repository")}<select value={repoId} onChange={(e) => setRepoId(e.currentTarget.value)}>
        {props.config.repositories.map((repo) => <option key={repo.repoId} value={repo.repoId}>{repo.displayName}</option>)}</select></label>
      <label>{t("requirements.idea")}<textarea value={idea} onChange={(e) => setIdea(e.currentTarget.value)} required /></label>
      <label>{t("requirements.limit")}<input type="number" min={1} value={tokens} onChange={(e) => setTokens(Number(e.currentTarget.value))} /></label>
      <label>{t("requirements.contentLanguage")}<select value={language} onChange={(e) => setLanguage(e.currentTarget.value as PanelLanguage)}>
        {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}</select></label>
      <label>{t("requirements.agent")}<select value={agent} onChange={(e) => setAgent(e.currentTarget.value)}>
        <option value="">{t("requirements.agentDefault")}</option>
        {(props.agents?.installations ?? []).map((installation) => <option key={installation.id} value={installation.id}>{installation.id}</option>)}</select></label>
      <button type="submit" disabled={idea.trim() === ""}>{t("requirements.open")}</button>
    </form>
  );
}

function RoundForm(props: { view: View; round: Round; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result!;
  const [choice, setChoice] = useState<Record<string, { kind: "recommended" } | { kind: "text"; text: string }>>(() => Object.fromEntries(result.questions.map((q) => [q.id, { kind: "recommended" as const }])));
  const [decisions, setDecisions] = useState<Record<string, boolean>>(() => Object.fromEntries([...result.glossary, ...result.adrs].map((entry) => [entry.id, true])));
  const send = (all: boolean) => props.onCommand({ verb: "requirement-answer", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: {
    roundNo: props.round.roundNo,
    answers: result.questions.map((q) => { const c = all ? { kind: "recommended" as const } : choice[q.id]!; return c.kind === "text" ? { id: q.id, kind: "text", text: c.text } : { id: q.id, kind: "recommended" }; }),
    glossaryDecisions: result.glossary.map((entry) => ({ id: entry.id, accept: decisions[entry.id]! })),
    adrDecisions: result.adrs.map((adr) => ({ id: adr.id, accept: decisions[adr.id]! })),
  } });
  const decision = (id: string, label: string) => (
    <fieldset key={id} aria-label={`${id} ${label}`}>
      <legend>{id} {label}</legend>
      <label><input type="radio" name={`d-${id}`} checked={decisions[id]} onChange={() => setDecisions({ ...decisions, [id]: true })} />{t("requirements.accept")}</label>
      <label><input type="radio" name={`d-${id}`} checked={!decisions[id]} onChange={() => setDecisions({ ...decisions, [id]: false })} />{t("requirements.reject")}</label>
    </fieldset>
  );
  return (
    <form onSubmit={(event) => { event.preventDefault(); send(false); }}>
      {result.questions.length === 0 && <p>{t("requirements.noQuestions")}</p>}
      {result.questions.map((q) => (
        <fieldset key={q.id} aria-label={`${q.id} ${q.question}`}>
          <legend>{q.id} {q.question}</legend>
          <p>{t("requirements.recommended", { answer: q.recommendedAnswer })}</p>
          <p>{t("requirements.why", { why: q.why })}</p>
          <label><input type="radio" name={`q-${q.id}`} checked={choice[q.id]!.kind === "recommended"} onChange={() => setChoice({ ...choice, [q.id]: { kind: "recommended" } })} />{t("requirements.useRecommended")}</label>
          <label><input type="radio" name={`q-${q.id}`} checked={choice[q.id]!.kind === "text"} onChange={() => setChoice({ ...choice, [q.id]: { kind: "text", text: "" } })} />{t("requirements.ownAnswer")}</label>
          {choice[q.id]!.kind === "text" && <textarea value={(choice[q.id] as { text: string }).text} onChange={(e) => setChoice({ ...choice, [q.id]: { kind: "text", text: e.currentTarget.value } })} />}
        </fieldset>
      ))}
      {[...result.glossary.map((entry) => decision(entry.id, entry.term)), ...result.adrs.map((adr) => decision(adr.id, adr.title))]}
      <button type="button" onClick={() => send(true)}>{t("requirements.acceptAll")}</button>
      <button type="submit" disabled={result.questions.some((q) => { const c = choice[q.id]!; return c.kind === "text" && c.text.trim() === ""; })}>{t("requirements.sendAnswers")}</button>
    </form>
  );
}

function Consensus(props: { view: View; round: Round; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const branches = props.view.rounds.filter((r) => r.result !== null).at(-1)?.result?.openBranches ?? [];
  const send = () => props.onCommand({ verb: "requirement-consensus", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { roundNo: props.round.roundNo } });
  return (
    <>
      <button type="button" onClick={() => (branches.length > 0 ? setAsking(true) : send())}>{t("requirements.consensus")}</button>
      {asking && (
        <div role="dialog" aria-label={t("requirements.consensusTitle")}>
          <p>{t("requirements.consensusTitle")}</p>
          <ul>{branches.map((branch) => <li key={branch}>{branch}</li>)}</ul>
          <button type="button" onClick={() => { setAsking(false); send(); }}>{t("requirements.consensusConfirm")}</button>
          <button type="button" onClick={() => setAsking(false)}>{t("requirements.consensusCancel")}</button>
        </div>
      )}
    </>
  );
}

function DraftReview(props: { view: View; draft: Draft; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState("");
  const { draft } = props, groupId = props.view.summary.groupId;
  return (
    <section aria-label={t("requirements.draft", { n: draft.draftNo })}>
      <h4>{t("requirements.draft", { n: draft.draftNo })} · {enumText("draftState", draft.state)}</h4>
      {draft.output !== null && (
        <table><thead><tr>{(["id", "title", "labels", "loopPlan", "targetPaths", "checks", "dependsOn", "traces"] as const).map((c) => <th key={c}>{t(`requirements.columns.${c}`)}</th>)}</tr></thead>
          <tbody>{draft.output.tasks.map((task) => (
            <tr key={task.taskId}><td>{task.taskId}</td><td>{task.title}</td><td>{task.labels.join(", ")}</td><td>{task.loopPlan ?? ""}</td>
              <td>{task.targetPaths.join(", ")}</td><td>{task.checks.join(" ; ")}</td><td>{task.dependsOn.join(", ")}</td><td>{task.traces.join(", ")}</td></tr>))}</tbody></table>
      )}
      {draft.layers?.map((layer, index) => <p key={index}>{t("requirements.layer", { n: index + 1, tasks: layer.join(", ") })}</p>)}
      {draft.implicitEdges?.map((edge) => <p key={`${edge.from}>${edge.to}`}>{t("requirements.implicitEdge", { from: edge.from, to: edge.to, paths: [...new Set(edge.conflicts.map((c) => `${c.a} ∩ ${c.b}`))].join(", ") })}</p>)}
      {draft.reasons.length > 0 && <><p>{t("requirements.handedBack")}</p><ul>{draft.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
      {draft.state === "awaiting-review" && (
        <>
          <label>{t("requirements.feedback")}<textarea value={feedback} onChange={(e) => setFeedback(e.currentTarget.value)} /></label>
          <button type="button" disabled={feedback.trim() === ""} onClick={() => props.onCommand({ verb: "requirement-draft-feedback", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, feedback } })}>{t("requirements.sendBack")}</button>
          <button type="button" onClick={() => props.onCommand({ verb: "requirement-draft-accept", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, draftHash: draft.draftHash! } })}>{t("requirements.acceptSplit")}</button>
        </>
      )}
    </section>
  );
}

/** Spec §11.1: set-limit on a clarifying group edits its reduced ledger; the waiting call goes on once it fits. */
function RaiseLimit(props: { view: View; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState(props.view.ledger.limit.tokens);
  return (
    <form aria-label={t("requirements.raiseLimit")} onSubmit={(event) => {
      event.preventDefault();
      props.onCommand({ verb: "set-limit", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { limit: { ...props.view.ledger.limit, tokens } } });
    }}>
      <label>{t("requirements.limit")}<input type="number" min={1} value={tokens} onChange={(e) => setTokens(Number(e.currentTarget.value))} /></label>
      <button type="submit">{t("requirements.raiseLimit")}</button>
    </form>
  );
}

function Detail(props: { view: View; onCommand: (a: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const { view } = props, groupId = view.summary.groupId;
  const valid = view.rounds.filter((round) => round.result !== null);
  const latest = valid.at(-1)?.result ?? null;
  const round = view.rounds.at(-1) ?? null, draft = view.drafts.at(-1) ?? null;
  const accepted = (decisions: Round["glossaryDecisions"]) => new Set((decisions ?? []).filter((d) => d.accept).map((d) => d.id));
  const reason = view.summary.requirement?.waiting ?? view.summary.requirement?.reasonCode ?? null;
  const step = view.requirement.consensus === null ? round : draft;
  const drafting = step?.state === "drafting";
  // Spec §11.1: recovery-retry re-queues a failed or interrupted round or draft -- one the person stopped carries no reason code.
  const stalled = step?.state === "failed" || step?.state === "interrupted";
  const retryable = reason !== BUDGET_EXHAUSTED && ((reason !== null && RETRYABLE.includes(reason)) || stalled);
  const exportState = view.requirement.export.state;
  return (
    <article aria-label={view.requirement.slug ?? groupId}>
      <h3>{view.requirement.slug ?? groupId} · {enumText("groupState", view.summary.state)}</h3>
      <section aria-label={t("requirements.understanding")}>
        <h4>{t("requirements.understanding")}</h4>
        <p>{latest?.statement ?? t("requirements.nothingYet")}</p>
        <h5>{t("requirements.criteria")}</h5><ul>{(latest?.acceptanceCriteria ?? []).map((c) => <li key={c.id}>{c.id}: {c.text}</li>)}</ul>
        <h5>{t("requirements.glossary")}</h5><ul>{valid.flatMap((r) => r.result!.glossary.filter((e) => accepted(r.glossaryDecisions).has(e.id))).map((e) => <li key={e.id}>{e.term}: {e.definition}</li>)}</ul>
        <h5>{t("requirements.decisions")}</h5><ul>{valid.flatMap((r) => r.result!.adrs.filter((a) => accepted(r.adrDecisions).has(a.id))).map((a) => <li key={a.id}>{a.id} {a.title}</li>)}</ul>
        <h5>{t("requirements.openBranches")}</h5><ul>{(latest?.openBranches ?? []).map((branch) => <li key={branch}>{branch}</li>)}</ul>
        <p>{t("requirements.budget", { used: view.ledger.used.tokens, limit: view.ledger.limit.tokens, reserved: view.ledger.reserved.tokens })}</p>
        <progress max={view.ledger.limit.tokens} value={view.ledger.used.tokens} />
        {view.ledger.usageUnknown && <p role="status">{t("requirements.usageUnknown")}</p>}
      </section>
      {(reason !== null || retryable) && (
        <p role="alert">{reason !== null && <>{reason}{isReason(reason) ? ` · ${t(`requirements.reason.${reason}`, { groupId })}` : ""} </>}
          {retryable && <button type="button" onClick={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "group", groupId } })}>{t("requirements.retry")}</button>}
        </p>
      )}
      {reason === BUDGET_EXHAUSTED && <RaiseLimit view={view} onCommand={props.onCommand} />}
      <section aria-label={t("requirements.rounds")}>
        <h4>{t("requirements.rounds")}</h4>
        {view.rounds.map((r) => (
          <details key={r.roundNo} open={r === round}>
            <summary>{t("requirements.round", { n: r.roundNo })} · {enumText("roundState", r.state)}</summary>
            {r.state === "awaiting-answers" && r.result !== null && view.requirement.consensus === null && <RoundForm view={view} round={r} onCommand={props.onCommand} />}
            {r.answers?.map((a) => <p key={a.id}>{a.id}: {a.text}</p>)}
          </details>
        ))}
        {drafting && <p role="status">{t("requirements.drafting")} <button type="button" onClick={() => props.onCommand({ verb: "handoff-stop", groupId, expectedRevision: revisionOf(view), payload: {} })}>{t("requirements.stop")}</button></p>}
        {view.requirement.consensus === null && round !== null && ["answered", "awaiting-answers", "failed", "interrupted"].includes(round.state) && valid.length > 0 && <Consensus view={view} round={round} onCommand={props.onCommand} />}
      </section>
      {view.drafts.map((d) => <DraftReview key={d.draftNo} view={view} draft={d} onCommand={props.onCommand} />)}
      <section aria-label={t("requirements.document")}>
        <h4>{t("requirements.document")}</h4>
        <pre>{view.document}</pre>
        {exportState !== "not-due" && <p>{t("requirements.export", { state: enumText("exportState", exportState) })}{view.requirement.export.commit !== null ? ` · ${t("requirements.exportCommit", { commit: view.requirement.export.commit })}` : ""}</p>}
        {/* Spec §9.3: start is refused until the export is done; this says why before anyone presses Start. */}
        {exportState === "pending" && <p role="status">{EXPORT_PENDING} · {t(`requirements.reason.${EXPORT_PENDING}`, { groupId })}</p>}
      </section>
    </article>
  );
}

export function RequirementsPanel(props: { config: ControlConfigV1; summary: ControlSummaryV1; views: Record<string, RequirementViewV1>; selected: string | null;
  agents: AgentsViewV1 | null; language: PanelLanguage; onSelect: (groupId: string) => void; onCommand: (action: ControlAction) => void;
  /** The control state's last refusal: a refused requirement command is explained here, where it was pressed. */
  refusal?: ControlRefusal | null }): JSX.Element {
  const { t } = useTranslation();
  const listed = props.summary.groups.filter((group) => group.requirement !== undefined);
  const view = props.selected === null ? undefined : props.views[props.selected];
  const refusal = props.refusal ?? null;
  return (
    <section aria-label={t("requirements.title")} className="requirements">
      <h2>{t("requirements.title")}</h2>
      {refusal !== null && <p role="alert">{refusal.code} · {isReason(refusal.code) ? t(`requirements.reason.${refusal.code}`, { groupId: props.selected ?? "" }) : refusalText(refusal)}</p>}
      <div className="split">
        <nav aria-label={t("requirements.list")}>
          {listed.length === 0 && <p>{t("requirements.none")}</p>}
          {listed.map((group) => (
            <button key={group.groupId} type="button" aria-current={group.groupId === props.selected} onClick={() => props.onSelect(group.groupId)}>
              {group.groupId} · {enumText("groupState", group.state)}
            </button>
          ))}
          <NewRequirement config={props.config} agents={props.agents} language={props.language} onCommand={props.onCommand} />
        </nav>
        {view !== undefined && <Detail view={view} onCommand={props.onCommand} />}
      </div>
    </section>
  );
}
