/**
 * N1 spec §11.2: the Requirements section. Every state and number on it is the server's (the requirement view);
 * the browser originates only intents. Model-written text is shown as written (human ruling H8); the panel's own words
 * go through t.
 */
import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText, refusalText } from "./i18n.js";
import type { PanelLanguage } from "./i18n.js";
import type { ControlAction } from "./controlApi.js";
import { nextCommandId } from "./controlApi.js";
import type { ControlRefusal } from "./controlState.js";
import type { AgentsViewV1, ControlConfigV1, ControlSummaryV1, RequirementViewV1 } from "./controlTypes.js";
import { inScope } from "./projectScope.js";
import type { GroupScope } from "./projectScope.js";
import { EMPTY_DRAFTS, answerKey, feedbackKey, limitKey, setDraft } from "./detailDrafts.js";
import type { AnswerChoice, AnswerDraft, DetailDrafts, DraftSlot, EditableDrafts, NewRequirementDraft } from "./detailDrafts.js";

type View = RequirementViewV1;
type Round = View["rounds"][number];
type Draft = View["drafts"][number];
/** Every reason code this section can show, each with its one-line explanation (requirements.reason.*). */
const REASONS = [
  "clarify-output-invalid", "split-output-invalid", "split-validation-exhausted", "requirement-budget-exhausted", "requirement-usage-unknown",
  "requirement-export-conflict", "requirement-export-path-blocked", "requirement-export-pending", "requirement-not-split",
] as const;
type Reason = (typeof REASONS)[number];
/** The reasons recovery-retry lifts: a failed round or draft re-queues, a blocked export re-arms (spec §11.1, §15 item 11). */
const RETRYABLE: readonly string[] = ["clarify-output-invalid", "split-output-invalid", "split-validation-exhausted", "requirement-export-conflict", "requirement-export-path-blocked"];
const BUDGET_EXHAUSTED = "requirement-budget-exhausted";
const EXPORT_PENDING = "requirement-export-pending";
const isReason = (code: string): code is Reason => (REASONS as readonly string[]).includes(code);

function revisionOf(view: View): number { return view.summary.commandRevision; }

/** What a requirement command may clear once it succeeded: the submitted draft, by its slot and key (spec §11 R2). */
export interface Submitted { slot: DraftSlot; key: string; value: unknown }
type OnCommand = (action: ControlAction, submitted?: Submitted) => void;

function NewRequirement(props: { config: ControlConfigV1; agents: AgentsViewV1 | null; language: PanelLanguage; onCommand: OnCommand;
  repoId?: string | null; onRepo?: (repoId: string) => void;
  scope?: GroupScope; targets?: readonly string[]; repoLabel?: (repoId: string) => string } & EditableDrafts): JSX.Element | null {
  const { t } = useTranslation();
  const scope = props.scope;
  const all = scope?.kind === "all";
  const chosenRepoId = scope?.kind === "project" ? scope.repoId : props.repoId;
  const [localRepoId, setLocalRepoId] = useState(props.config.repositories[0]?.repoId ?? "");
  // Spec §6: in All projects the target is this form's own, empty until chosen, and choosing it does not leave All.
  const [target, setTarget] = useState("");
  useEffect(() => { setTarget(""); }, [scope?.kind]);
  // Spec §6 and §8 (Task 4 review M1): only a held target -- a registered project's control repository -- counts as
  // chosen; one that dropped out of the project list is unchosen again, whatever this form still remembers.
  const choices = all ? props.config.repositories.filter((repo) => (props.targets ?? []).includes(repo.repoId)) : props.config.repositories;
  // Project switcher spec D4: the chosen project's repository when the control plane holds it, else this form's own.
  const repoId = all ? (choices.some((repo) => repo.repoId === target) ? target : "")
    : chosenRepoId != null && props.config.repositories.some((repo) => repo.repoId === chosenRepoId) ? chosenRepoId : localRepoId;
  // Spec §11 R2: the content belongs to its concrete target. Text typed in All before a target is chosen belongs to
  // no project; it goes to the first target chosen that has no draft of its own, never over another target's draft.
  const defaults: NewRequirementDraft = { idea: "", tokens: 10_000_000, language: props.language, agent: "" };
  const [unowned, setUnowned] = useState<NewRequirementDraft | null>(null);
  const draft = repoId === "" ? unowned ?? defaults : props.drafts.newRequirement[repoId] ?? defaults;
  const edit = (change: Partial<NewRequirementDraft>): void => {
    if (repoId === "") setUnowned({ ...draft, ...change });
    else props.onDraft("newRequirement", repoId, { ...draft, ...change });
  };
  const setRepoId = (next: string): void => {
    if (all) {
      if (unowned !== null && props.drafts.newRequirement[next] === undefined) { props.onDraft("newRequirement", next, unowned); setUnowned(null); }
      setTarget(next);
      return;
    }
    setLocalRepoId(next); props.onRepo?.(next);
  };
  if (props.config.repositories.length === 0) return <p role="note">{t("requirements.noRepository")}</p>;
  // Plan decision P1: no target is safe without a project list; the list's own note above says why.
  if (scope?.kind === "unresolved") return null;
  if (scope?.kind === "project" && scope.repoId === null) return <p role="note">{t("requirements.notUnderControl")}</p>;
  const { idea, tokens, language, agent } = draft;
  return (
    <form aria-label={t("requirements.newTitle")} onSubmit={(event) => {
      event.preventDefault();
      if (repoId === "") return;
      const groupId = `requirement-${nextCommandId()}`;
      props.onCommand({ verb: "requirement-open", groupId, expectedRevision: 0, payload: {
        groupId, repoId, idea, contentLanguage: language, limit: { tokens, activeMs: 14_400_000, attempts: 40, sessions: 40 }, ...(agent === "" ? {} : { agent: { agent } }) } },
      { slot: "newRequirement", key: repoId, value: draft });
    }}>
      <h3>{t("requirements.newTitle")}</h3>
      <label>{t("requirements.repository")}<select value={repoId} onChange={(e) => setRepoId(e.currentTarget.value)}>
        {all && <option value="" disabled>{t("project.chooseTarget")}</option>}
        {choices.map((repo) => <option key={repo.repoId} value={repo.repoId}>{all ? props.repoLabel?.(repo.repoId) ?? repo.displayName : repo.displayName}</option>)}</select></label>
      <label>{t("requirements.idea")}<textarea value={idea} onChange={(e) => edit({ idea: e.currentTarget.value })} required /></label>
      <label>{t("requirements.limit")}<input type="number" min={1} value={tokens} onChange={(e) => edit({ tokens: Number(e.currentTarget.value) })} /></label>
      <label>{t("requirements.contentLanguage")}<select value={language} onChange={(e) => edit({ language: e.currentTarget.value as PanelLanguage })}>
        {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}</select></label>
      <label>{t("requirements.agent")}<select value={agent} onChange={(e) => edit({ agent: e.currentTarget.value })}>
        <option value="">{t("requirements.agentDefault")}</option>
        {(props.agents?.installations ?? []).map((installation) => <option key={installation.id} value={installation.id}>{installation.id}</option>)}</select></label>
      <button type="submit" disabled={idea.trim() === "" || repoId === ""}>{t("requirements.open")}</button>
    </form>
  );
}

/** Spec §11 R2: a requirement's owner identity, the first part of every key its drafts are stored under. */
const ownerOf = (view: View) => ({ repoId: view.summary.repoId, groupId: view.summary.groupId, requirementId: view.requirement.requirementId });

function RoundForm(props: { view: View; round: Round; onCommand: OnCommand } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result!;
  const owner = ownerOf(props.view);
  const key = answerKey(owner.repoId, owner.groupId, owner.requirementId, props.round.roundNo);
  const stored = props.drafts.answer[key];
  // Spec §11 R2: only this round's current ids are shown or sent; an id the draft lacks is today's default.
  const choiceOf = (id: string): AnswerChoice => stored?.choice[id] ?? { kind: "recommended" };
  const decisionOf = (id: string): boolean => stored?.decisions[id] ?? true;
  const current: AnswerDraft = stored ?? { choice: {}, decisions: {} };
  const setChoice = (id: string, value: AnswerChoice): void => props.onDraft("answer", key, { ...current, choice: { ...current.choice, [id]: value } });
  const setDecision = (id: string, accept: boolean): void => props.onDraft("answer", key, { ...current, decisions: { ...current.decisions, [id]: accept } });
  const send = (all: boolean) => props.onCommand({ verb: "requirement-answer", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: {
    roundNo: props.round.roundNo,
    answers: result.questions.map((q) => { const c = all ? { kind: "recommended" as const } : choiceOf(q.id); return c.kind === "text" ? { id: q.id, kind: "text", text: c.text } : { id: q.id, kind: "recommended" }; }),
    glossaryDecisions: result.glossary.map((entry) => ({ id: entry.id, accept: decisionOf(entry.id) })),
    adrDecisions: result.adrs.map((adr) => ({ id: adr.id, accept: decisionOf(adr.id) })),
  } }, stored === undefined ? undefined : { slot: "answer", key, value: stored });
  const decision = (id: string, label: string) => (
    <fieldset key={id} aria-label={`${id} ${label}`}>
      <legend>{id} {label}</legend>
      <label><input type="radio" name={`d-${id}`} checked={decisionOf(id)} onChange={() => setDecision(id, true)} />{t("requirements.accept")}</label>
      <label><input type="radio" name={`d-${id}`} checked={!decisionOf(id)} onChange={() => setDecision(id, false)} />{t("requirements.reject")}</label>
    </fieldset>
  );
  return (
    <form onSubmit={(event) => { event.preventDefault(); send(false); }}>
      {result.questions.length === 0 && <p>{t("requirements.noQuestions")}</p>}
      {result.questions.map((q) => {
        const c = choiceOf(q.id);
        return (
          <fieldset key={q.id} aria-label={`${q.id} ${q.question}`}>
            <legend>{q.id} {q.question}</legend>
            <p>{t("requirements.recommended", { answer: q.recommendedAnswer })}</p>
            <p>{t("requirements.why", { why: q.why })}</p>
            <label><input type="radio" name={`q-${q.id}`} checked={c.kind === "recommended"} onChange={() => setChoice(q.id, { kind: "recommended" })} />{t("requirements.useRecommended")}</label>
            <label><input type="radio" name={`q-${q.id}`} checked={c.kind === "text"} onChange={() => setChoice(q.id, { kind: "text", text: "" })} />{t("requirements.ownAnswer")}</label>
            {c.kind === "text" && <textarea value={c.text} onChange={(e) => setChoice(q.id, { kind: "text", text: e.currentTarget.value })} />}
          </fieldset>
        );
      })}
      {[...result.glossary.map((entry) => decision(entry.id, entry.term)), ...result.adrs.map((adr) => decision(adr.id, adr.title))]}
      <button type="button" onClick={() => send(true)}>{t("requirements.acceptAll")}</button>
      <button type="submit" disabled={result.questions.some((q) => { const c = choiceOf(q.id); return c.kind === "text" && c.text.trim() === ""; })}>{t("requirements.sendAnswers")}</button>
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

function DraftReview(props: { view: View; draft: Draft; onCommand: OnCommand } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  const { draft } = props, groupId = props.view.summary.groupId;
  const owner = ownerOf(props.view);
  const key = feedbackKey(owner.repoId, owner.groupId, owner.requirementId, draft.draftNo);
  const feedback = props.drafts.feedback[key] ?? "";
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
          <label>{t("requirements.feedback")}<textarea value={feedback} onChange={(e) => props.onDraft("feedback", key, e.currentTarget.value)} /></label>
          <button type="button" disabled={feedback.trim() === ""} onClick={() => props.onCommand({ verb: "requirement-draft-feedback", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, feedback } },
            { slot: "feedback", key, value: feedback })}>{t("requirements.sendBack")}</button>
          <button type="button" onClick={() => props.onCommand({ verb: "requirement-draft-accept", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, draftHash: draft.draftHash! } })}>{t("requirements.acceptSplit")}</button>
        </>
      )}
    </section>
  );
}

/** Spec §11.1: set-limit on a clarifying group edits its reduced ledger; the waiting call goes on once it fits. */
function RaiseLimit(props: { view: View; onCommand: OnCommand } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  // Spec §11 R2: a typed limit is the group's, kept across detail closure; the ledger's limit until one is typed.
  const key = limitKey(props.view.summary.repoId, props.view.summary.groupId);
  const stored = props.drafts.limit[key];
  const tokens = stored ?? props.view.ledger.limit.tokens;
  return (
    <form aria-label={t("requirements.raiseLimit")} onSubmit={(event) => {
      event.preventDefault();
      props.onCommand({ verb: "set-limit", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { limit: { ...props.view.ledger.limit, tokens } } },
        stored === undefined ? undefined : { slot: "limit", key, value: stored });
    }}>
      <label>{t("requirements.limit")}<input type="number" min={1} value={tokens} onChange={(e) => props.onDraft("limit", key, Number(e.currentTarget.value))} /></label>
      <button type="submit">{t("requirements.raiseLimit")}</button>
    </form>
  );
}

function Detail(props: { view: View; onCommand: OnCommand } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  const { view } = props, groupId = view.summary.groupId;
  const editable: EditableDrafts = { drafts: props.drafts, onDraft: props.onDraft };
  const valid = view.rounds.filter((round) => round.result !== null);
  const latest = valid.at(-1)?.result ?? null;
  const round = view.rounds.at(-1) ?? null, draft = view.drafts.at(-1) ?? null;
  const accepted = (decisions: Round["glossaryDecisions"]) => new Set((decisions ?? []).filter((d) => d.accept).map((d) => d.id));
  const reason = view.summary.requirement?.waiting ?? view.summary.requirement?.reasonCode ?? null;
  const step = view.requirement.consensus === null ? round : draft;
  const drafting = step?.state === "drafting";
  // Spec §11.1: recovery-retry re-queues a failed or interrupted round or draft -- one the person stopped carries no reason code.
  const stalled = step?.state === "failed" || step?.state === "interrupted";
  // Final review finding 5: a stop that completed with no call in flight interrupts nothing; recovery-retry lifts it (DR15).
  const stopped = view.summary.state === "clarifying" && view.summary.stopState === "handoff-complete";
  const retryable = (reason !== null && RETRYABLE.includes(reason)) || stalled || stopped;
  // Final review finding 4: the step's call blocked by the driver, retried on its run.
  const blockedRun = view.summary.requirement?.blockedRun ?? null;
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
          {stopped && <>{t("requirements.stopped")} </>}
          {retryable && <button type="button" onClick={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "group", groupId } })}>{t("requirements.retry")}</button>}
        </p>
      )}
      {blockedRun !== null && (
        <p role="alert">{blockedRun.reason !== null && <>{blockedRun.reason} · </>}{t("requirements.blockedRun")}{" "}
          <button type="button" onClick={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "run", runId: blockedRun.runId } })}>{t("requirements.retryRun")}</button>
        </p>
      )}
      {reason === BUDGET_EXHAUSTED && <RaiseLimit view={view} onCommand={props.onCommand} {...editable} />}
      <section aria-label={t("requirements.rounds")}>
        <h4>{t("requirements.rounds")}</h4>
        {view.rounds.map((r) => (
          <details key={r.roundNo} open={r === round}>
            <summary>{t("requirements.round", { n: r.roundNo })} · {enumText("roundState", r.state)}</summary>
            {r.state === "awaiting-answers" && r.result !== null && view.requirement.consensus === null && <RoundForm view={view} round={r} onCommand={props.onCommand} {...editable} />}
            {r.answers?.map((a) => <p key={a.id}>{a.id}: {a.text}</p>)}
          </details>
        ))}
        {drafting && view.summary.stopState === null && <p role="status">{t("requirements.drafting")} <button type="button" onClick={() => props.onCommand({ verb: "handoff-stop", groupId, expectedRevision: revisionOf(view), payload: {} })}>{t("requirements.stop")}</button></p>}
        {view.requirement.consensus === null && round !== null && ["answered", "awaiting-answers", "failed", "interrupted"].includes(round.state) && valid.length > 0 && <Consensus view={view} round={round} onCommand={props.onCommand} />}
      </section>
      {view.drafts.map((d) => <DraftReview key={d.draftNo} view={view} draft={d} onCommand={props.onCommand} {...editable} />)}
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
  agents: AgentsViewV1 | null; language: PanelLanguage; onSelect: (groupId: string) => void;
  /** `submitted` names the draft a success may clear, when it is still unchanged (spec §11 R2). */
  onCommand: (action: ControlAction, submitted?: Submitted) => void;
  /** The control state's last refusal: a refused requirement command is explained here, where it was pressed. */
  refusal?: ControlRefusal | null;
  /** Project switcher spec D4: the chosen project's control repository, and how choosing one here moves the selection. */
  repoId?: string | null; onRepo?: (repoId: string) => void;
  /** Project filtering spec §5: which requirements are listed, as in Task control (undefined: all, as before). */
  scope?: GroupScope; repoLabel?: (repoId: string) => string;
  /** Spec §6: the repositories a new requirement may target in All projects. */
  targets?: readonly string[];
  /** Spec §11 R2: the App-owned draft store; without it (a panel rendered on its own) the panel keeps its own. */
  drafts?: DetailDrafts; onDraft?: EditableDrafts["onDraft"] }): JSX.Element {
  const { t } = useTranslation();
  const scope = props.scope;
  const [ownDrafts, setOwnDrafts] = useState<DetailDrafts>(EMPTY_DRAFTS);
  const owned = props.drafts !== undefined && props.onDraft !== undefined;
  const editable: EditableDrafts = owned
    ? { drafts: props.drafts!, onDraft: props.onDraft! }
    : { drafts: ownDrafts, onDraft: <S extends DraftSlot>(slot: S, key: string, value: DetailDrafts[S][string]) => setOwnDrafts((all) => setDraft(all, slot, key, value)) };
  // Only the store's owner can clear a submitted draft, so only it is told which one was submitted.
  const onCommand: OnCommand = owned ? props.onCommand : (action) => props.onCommand(action);
  const listed = props.summary.groups.filter((group) => group.requirement !== undefined && (scope === undefined || inScope(scope, group.repoId)));
  const view = props.selected === null ? undefined : props.views[props.selected];
  const refusal = props.refusal ?? null;
  return (
    <section aria-label={t("requirements.title")} className="requirements">
      <h2>{t("requirements.title")}</h2>
      {refusal !== null && <p role="alert">{refusal.code} · {isReason(refusal.code) ? t(`requirements.reason.${refusal.code}`, { groupId: props.selected ?? "" }) : refusalText(refusal)}</p>}
      <div className="split">
        <nav aria-label={t("requirements.list")}>
          {scope?.kind === "unresolved" ? <p role="note">{t("project.listUnavailable")}</p> : listed.length === 0 && <p>{t("requirements.none")}</p>}
          {listed.map((group) => (
            <button key={group.groupId} type="button" aria-current={group.groupId === props.selected} onClick={() => props.onSelect(group.groupId)}>
              {group.groupId} · {enumText("groupState", group.state)}
              {scope?.kind === "all" ? ` · ${props.repoLabel?.(group.repoId) ?? group.repoId}` : ""}
            </button>
          ))}
          <NewRequirement config={props.config} agents={props.agents} language={props.language} onCommand={onCommand} repoId={props.repoId} onRepo={props.onRepo}
            scope={scope} targets={props.targets} repoLabel={props.repoLabel} {...editable} />
        </nav>
        {view !== undefined && <Detail view={view} onCommand={onCommand} {...editable} />}
      </div>
    </section>
  );
}
