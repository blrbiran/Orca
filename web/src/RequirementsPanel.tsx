/**
 * N1 spec §11.2: the Requirements section. Every state and number on it is the server's (the requirement view);
 * the browser originates only intents. Model-written text is shown as written (human ruling H8); the panel's own words
 * go through t.
 */
import { RequirementMarkdown } from "./RequirementMarkdown.js";
import { overviewRegionId } from "./overviewNavigation.js";
import { goalSummary } from "./CardGoal.js";
import type { OverviewTarget } from "./overviewNavigation.js";
import { useContext, useEffect, useState, type JSX } from "react";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { useTranslation } from "react-i18next";
import { GroupActionsMenu } from "./GroupActionsMenu.js";
import { ChargeRetry } from "./ChargeRetry.js";
import { LANGUAGE_NAMES, PANEL_LANGUAGES, enumText } from "./i18n.js";
import { explainBesideCode, explainEstimateReason, explainEstimatorCheck } from "./ccloopCodes.js";
import { explainRefusal, explainRunReason } from "./refusalExplain.js";
import type { PanelLanguage } from "./i18n.js";
import { TokenInput, shortTokens } from "./TokenInput.js";
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
  // Accounts spec §3.5: requirement-open.limit is human-only. A member opens with the server's default limit instead.
  const mayLimit = mayHumanOnly(useContext(AccountContext));
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
  const held = choices.some((repo) => repo.repoId === target);
  // Fix round 1 (ruling M1): a target seen unheld is forgotten, so a later re-listing needs a new choice.
  useEffect(() => { if (all && target !== "" && !held) setTarget(""); }, [all, target, held]);
  // Project switcher spec D4: the chosen project's repository when the control plane holds it, else this form's own.
  const repoId = all ? (held ? target : "")
    : chosenRepoId != null && props.config.repositories.some((repo) => repo.repoId === chosenRepoId) ? chosenRepoId : localRepoId;
  // Spec §11 R2: the content belongs to its concrete target. Text typed in All before a target is chosen belongs to
  // no project; the next explicit choice takes it when that target has no draft of its own, and drops it either way
  // (ruling M2), so it never resurfaces under a later target or over another target's draft.
  const defaults: NewRequirementDraft = { idea: "", tokens: null, language: props.language, agent: "" };
  const [unowned, setUnowned] = useState<NewRequirementDraft | null>(null);
  // Text in the limit field that is not an amount: the held number is stale, so the form must not send it.
  const [limitBad, setLimitBad] = useState(false);
  const draft = repoId === "" ? unowned ?? defaults : props.drafts.newRequirement[repoId] ?? defaults;
  const edit = (change: Partial<NewRequirementDraft>): void => {
    if (repoId === "") setUnowned({ ...draft, ...change });
    else props.onDraft("newRequirement", repoId, { ...draft, ...change });
  };
  const setRepoId = (next: string): void => {
    if (all) {
      if (unowned !== null) {
        if (props.drafts.newRequirement[next] === undefined) props.onDraft("newRequirement", next, unowned);
        setUnowned(null);
      }
      setTarget(next);
      return;
    }
    setLocalRepoId(next); props.onRepo?.(next);
  };
  if (props.config.repositories.length === 0) return <p role="note">{t("requirements.noRepository")}</p>;
  // Plan decision P1: no target is safe without a project list; the list's own note above says why.
  if (scope?.kind === "unresolved") return null;
  if (scope?.kind === "project" && scope.repoId === null) return <p role="note">{t("requirements.notUnderControl")}</p>;
  // A held-by-the-project repository the control plane's config lacks is no target either: never fall back to the first.
  if (scope?.kind === "project" && scope.repoId !== null && !props.config.repositories.some((repo) => repo.repoId === scope.repoId)) {
    return <p role="note">{t("requirements.repositoryNotConfigured")}</p>;
  }
  const { idea, tokens, language, agent } = draft;
  return (
    <form aria-label={t("requirements.newTitle")} onSubmit={(event) => {
      event.preventDefault();
      if (repoId === "" || limitBad) return;
      const groupId = `requirement-${nextCommandId()}`;
      props.onCommand({ verb: "requirement-open", groupId, expectedRevision: 0, payload: {
        groupId, repoId, idea, contentLanguage: language, ...(mayLimit ? { limit: { tokens, activeMs: 14_400_000, attempts: 40, sessions: 40 } } : {}),
        ...(agent === "" ? {} : { agent: { agent } }) } },
      { slot: "newRequirement", key: repoId, value: draft });
    }}>
      <h3>{t("requirements.newTitle")}</h3>
      <label>{t("requirements.repository")}<select value={repoId} onChange={(e) => setRepoId(e.currentTarget.value)}>
        {all && <option value="" disabled>{t("project.chooseTarget")}</option>}
        {choices.map((repo) => <option key={repo.repoId} value={repo.repoId}>{all ? props.repoLabel?.(repo.repoId) ?? repo.displayName : repo.displayName}</option>)}</select></label>
      <label>{t("requirements.idea")}<textarea value={idea} onChange={(e) => edit({ idea: e.currentTarget.value })} required /></label>
      {mayLimit && <TokenInput label={t("requirements.limit")} aria-label={t("requirements.limit")} min={0} value={tokens} allowEmpty emptyLabel={t("budget.unlimited")} onClear={()=>{setLimitBad(false);edit({tokens:null});}} onChange={(n) => { setLimitBad(false); edit({ tokens: n }); }} onInvalid={() => setLimitBad(true)} onReset={() => setLimitBad(false)} />}
      <label>{t("requirements.contentLanguage")}<select value={language} onChange={(e) => edit({ language: e.currentTarget.value as PanelLanguage })}>
        {PANEL_LANGUAGES.map((lang) => <option key={lang} value={lang}>{LANGUAGE_NAMES[lang]}</option>)}</select></label>
      <label>{t("requirements.agent")}<select value={agent} onChange={(e) => edit({ agent: e.currentTarget.value })}>
        <option value="">{t("requirements.agentDefault")}</option>
        {(props.agents?.installations ?? []).map((installation) => <option key={installation.id} value={installation.id}>{installation.id}</option>)}</select></label>
      <p role="note">{t("requirements.capabilityNote")}</p>
      <button type="submit" className="btn-primary" disabled={idea.trim() === "" || repoId === "" || limitBad}>{t("requirements.open")}</button>
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
  // Issue 88: consensus on a round still awaiting answers closes it unanswered (requirementCommands.ts
  // applyRequirementConsensus records them as the consensus's openQuestions). The split prompt is the document, which
  // lists them as not answered beside their recommended answers; nothing makes the split take those answers.
  const unanswered = props.round.state === "awaiting-answers" ? props.round.result?.questions.length ?? 0 : 0;
  const unansweredTitle = t("requirements.consensusUnansweredTitle", { count: unanswered, round: props.round.roundNo });
  const send = () => props.onCommand({ verb: "requirement-consensus", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { roundNo: props.round.roundNo } });
  return (
    <>
      <button type="button" onClick={() => (branches.length > 0 || unanswered > 0 ? setAsking(true) : send())}>{t("requirements.consensus")}</button>
      {asking && (
        <div role="dialog" aria-label={unanswered > 0 ? unansweredTitle : t("requirements.consensusTitle")}>
          {unanswered > 0 && <><p>{unansweredTitle}</p><p>{t("requirements.consensusUnanswered")}</p></>}
          {branches.length > 0 && <><p>{t("requirements.consensusTitle")}</p>
          <ul>{branches.map((branch) => <li key={branch}>{branch}</li>)}</ul></>}
          <button type="button" onClick={() => { setAsking(false); send(); }}>{t("requirements.consensusConfirm")}</button>
          <button type="button" onClick={() => setAsking(false)}>{t("requirements.consensusCancel")}</button>
        </div>
      )}
    </>
  );
}

function DraftReview(props: { view: View; draft: Draft; onCommand: OnCommand; archived?: boolean } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  const { draft } = props, groupId = props.view.summary.groupId;
  const owner = ownerOf(props.view);
  const key = feedbackKey(owner.repoId, owner.groupId, owner.requirementId, draft.draftNo);
  const feedback = props.drafts.feedback[key] ?? "";
  // Scheduled flows and groups spec 2026-10-24 §13.3: the person may keep this split in the plan library.
  const maySave = mayHumanOnly(useContext(AccountContext)) && props.archived !== true && draft.draftHash !== null
    && (draft.state === "awaiting-review" || props.view.requirement.acceptedDraftNo === draft.draftNo);
  return (
    <section aria-label={t("requirements.draft", { n: draft.draftNo })}>
      <h4>{t("requirements.draft", { n: draft.draftNo })} · {enumText("draftState", draft.state)}</h4>
      {draft.output !== null && (
        // Tester #31: four columns to review the split by (task, title, depends on, checks); the rest of a task folds
        // under its title, so eight columns no longer crowd out the ones that decide the review.
        <table className="split-draft"><thead><tr>{(["id", "title", "dependsOn", "checks"] as const).map((c) => <th key={c}>{t(`requirements.columns.${c}`)}</th>)}</tr></thead>
          <tbody>{draft.output.tasks.map((task) => {
            // Multi-directory projects spec §6.2: a multi task's paths and checks are per directory.
            const writes = "writes" in task ? task.writes : [{ dir: "", targetPaths: task.targetPaths, checks: task.checks }];
            const targetPaths = writes.flatMap((write) => write.targetPaths.map((path) => (write.dir === "" ? path : `${write.dir}:${path}`)));
            const more = ([["targetPaths", targetPaths.join(", ")], ["labels", task.labels.join(", ")], ["loopPlan", task.loopPlan ?? ""], ["traces", task.traces.join(", ")]] as const)
              .filter(([, value]) => value !== "");
            return (
            <tr key={task.taskId}><td>{task.taskId}</td>
              <td>{task.title}
                {more.length > 0 && <details data-task-more={task.taskId}><summary>{t("requirements.taskMore")}</summary>
                  <dl>{more.map(([column, value]) => <div key={column}><dt>{t(`requirements.columns.${column}`)}</dt><dd>{value}</dd></div>)}</dl></details>}</td>
              <td>{task.dependsOn.join(", ")}</td><td>{writes.flatMap((write) => write.checks).join(" ; ")}</td></tr>);
          })}</tbody></table>
      )}
      {draft.layers?.map((layer, index) => <p key={index}>{t("requirements.layer", { n: index + 1, tasks: layer.join(", ") })}</p>)}
      {draft.implicitEdges?.map((edge) => <p key={`${edge.from}>${edge.to}`}>{t("requirements.implicitEdge", { from: edge.from, to: edge.to, paths: [...new Set(edge.conflicts.map((c) => `${c.a} ∩ ${c.b}`))].join(", ") })}</p>)}
      {draft.reasons.length > 0 && <><p>{t("requirements.handedBack")}</p><ul>{draft.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
      {!props.archived && draft.state === "awaiting-review" && (
        <>
          <label>{t("requirements.feedback")}<textarea value={feedback} onChange={(e) => props.onDraft("feedback", key, e.currentTarget.value)} /></label>
          <button type="button" disabled={feedback.trim() === ""} onClick={() => props.onCommand({ verb: "requirement-draft-feedback", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, feedback } },
            { slot: "feedback", key, value: feedback })}>{t("requirements.sendBack")}</button>
          <button type="button" onClick={() => props.onCommand({ verb: "requirement-draft-accept", groupId, expectedRevision: revisionOf(props.view), payload: { draftNo: draft.draftNo, draftHash: draft.draftHash! } })}>{t("requirements.acceptSplit")}</button>
        </>
      )}
      {maySave && (
        <button type="button" onClick={() => props.onCommand({ verb: "plan-library-save", groupId, expectedRevision: 0, payload: {
          source: { kind: "requirement-draft", groupId, draftNo: draft.draftNo, draftHash: draft.draftHash! },
          name: (props.view.requirement.slug ?? props.view.requirement.idea).slice(0, 200),
        } })}>{t("requirements.saveSplit")}</button>
      )}
    </section>
  );
}

/** Spec §11.1: set-limit on a clarifying group edits its reduced ledger; the waiting call goes on once it fits. */
function RaiseLimit(props: { view: View; onCommand: OnCommand } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  // Accounts spec §3.5: set-limit is human-only; a member is told who can raise it instead of a control that 403s.
  const mayLimit = mayHumanOnly(useContext(AccountContext));
  // Spec §11 R2: a typed limit is the group's, kept across detail closure; the ledger's limit until one is typed.
  const key = limitKey(props.view.summary.repoId, props.view.summary.groupId);
  const stored = props.drafts.limit[key];
  const tokens = stored===undefined?props.view.ledger.limit.tokens:stored;
  const [limitBad, setLimitBad] = useState(false);
  if (!mayLimit) return <p role="note">{t("requirements.ownerRaisesLimit")}</p>;
  return (
    <form aria-label={t("requirements.raiseLimit")} onSubmit={(event) => {
      event.preventDefault();
      if (limitBad) return;
      props.onCommand({ verb: "set-limit", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { limit: { ...props.view.ledger.limit, tokens } } },
        stored === undefined ? undefined : { slot: "limit", key, value: stored });
    }}>
      <TokenInput label={t("requirements.limit")} aria-label={t("requirements.limit")} min={0} value={tokens} allowEmpty emptyLabel={t("budget.unlimited")} onClear={()=>{setLimitBad(false);props.onDraft("limit",key,null);}} onChange={(n) => { setLimitBad(false); props.onDraft("limit", key, n); }} onInvalid={() => setLimitBad(true)} onReset={() => setLimitBad(false)} />
      <button type="submit" disabled={limitBad}>{t("requirements.raiseLimit")}</button>
    </form>
  );
}

/**
 * Issue #77: the document read as sections at its `## ` headings (src/control/requirementDocument.ts writes them), each
 * heading and body as plain text nodes -- no markdown is interpreted and nothing is injected. Text before the first
 * heading stays above the sections; a document without one stays a single preformatted block.
 */
function DocumentText(props: { text: string }): JSX.Element {
  const parts = props.text.split(/^## /m);
  if (parts.length === 1) return <pre>{props.text}</pre>;
  const [lead, ...sections] = parts;
  return (
    <>
      {lead!.trim() !== "" && <p className="requirement-text">{lead!.trim()}</p>}
      {sections.map((section, index) => {
        const cut = section.indexOf("\n");
        const title = (cut === -1 ? section : section.slice(0, cut)).trim(), body = cut === -1 ? "" : section.slice(cut + 1).trim();
        return (
          <section key={index} aria-label={title}>
            <h5>{title}</h5>
            {/* Issue 96: the body's markdown subset is rendered; every other construct stays text. */}
            {body !== "" && <RequirementMarkdown text={body} />}
          </section>
        );
      })}
    </>
  );
}

const SCOPES = ["small", "medium", "large"] as const;
const CLARITIES = ["clear", "fair", "vague"] as const;

/**
 * Clarify caps spec 2026-10-21 §3.6: the class code holds clarification to -- the model's judgement with its reasons,
 * the person's own when set -- the caps it gives (the server's numbers), and a way to set it while clarifying.
 */
function ClarifySize(props: { view: View; onCommand: OnCommand; editable: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const clarify = props.view.clarify;
  const effective = clarify?.override ?? clarify?.classification ?? null;
  const [scope, setScope] = useState<(typeof SCOPES)[number]>(effective?.scope ?? "medium");
  const [clarity, setClarity] = useState<(typeof CLARITIES)[number]>(effective?.clarity ?? "fair");
  // Before round 1 has answered there is nothing judged yet: the model's class is still coming.
  if (clarify === undefined || (clarify.override === null && (props.view.rounds[0]?.result ?? null) === null)) return null;
  const { classification, override } = clarify;
  return (
    <section aria-label={t("requirements.size")}>
      <h4>{t("requirements.size")} · {enumText("requirementScope", clarify.tier)}</h4>
      {/* Tester #37: what the size is for, in one line; setting one's own folds away, the model's judgement is the default. */}
      <p role="note">{t("requirements.sizeExplain")}</p>
      {classification !== null
        ? <p>{t("requirements.modelJudged", { scope: enumText("requirementScope", classification.scope), scopeReason: classification.scopeReason,
          clarity: enumText("requirementClarity", classification.clarity), clarityReason: classification.clarityReason })}</p>
        : override === null && <p>{t("requirements.unclassified")}</p>}
      {override !== null && <p>{t("requirements.personSet", { scope: enumText("requirementScope", override.scope), clarity: enumText("requirementClarity", override.clarity) })}</p>}
      <p>{t("requirements.caps", { rounds: clarify.roundCap, questions: clarify.questions, glossary: clarify.glossary, adrs: clarify.adrs })}</p>
      {props.editable && (
        <details className="requirement-set-size"><summary>{t("requirements.setOwnSize")}</summary>
        <form aria-label={t("requirements.setSize")} onSubmit={(event) => {
          event.preventDefault();
          props.onCommand({ verb: "requirement-classify", groupId: props.view.summary.groupId, expectedRevision: revisionOf(props.view), payload: { scope, clarity } });
        }}>
          <label>{t("requirements.scope")}<select value={scope} onChange={(e) => setScope(e.currentTarget.value as (typeof SCOPES)[number])}>
            {SCOPES.map((value) => <option key={value} value={value}>{enumText("requirementScope", value)}</option>)}</select></label>
          <label>{t("requirements.clarity")}<select value={clarity} onChange={(e) => setClarity(e.currentTarget.value as (typeof CLARITIES)[number])}>
            {CLARITIES.map((value) => <option key={value} value={value}>{enumText("requirementClarity", value)}</option>)}</select></label>
          <button type="submit" disabled={effective !== null && effective.scope === scope && effective.clarity === clarity}>{t("requirements.setSize")}</button>
        </form>
        </details>
      )}
    </section>
  );
}

/** Issue #83: an answered round as one line per question -- a recommended answer once, marked -- with the rest folded away. */
function AnsweredRound(props: { round: Round }): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result!;
  const questionOf = new Map(result.questions.map((q) => [q.id, q]));
  const decided = (decisions: Round["glossaryDecisions"]) => new Map((decisions ?? []).map((d) => [d.id, d.accept]));
  const glossary = decided(props.round.glossaryDecisions), adrs = decided(props.round.adrDecisions);
  return (
    <>
      <ul>{(props.round.answers ?? []).map((a) => (
        <li key={a.id}><span title={questionOf.get(a.id)?.question}>{a.id}</span>: {a.text}{a.kind === "recommended" ? ` ${t("requirements.recommendedMark")}` : ""}</li>
      ))}</ul>
      <details>
        <summary>{t("requirements.roundDetails")}</summary>
        {result.questions.map((q) => <p key={q.id}>{q.id} {q.question} · {t("requirements.why", { why: q.why })}</p>)}
        {result.glossary.map((e) => <p key={e.id}>{e.id} {e.term}: {e.definition} · {t(glossary.get(e.id) ? "requirements.accept" : "requirements.reject")}</p>)}
        {result.adrs.map((a) => <p key={a.id}>{a.id} {a.title} · {t(adrs.get(a.id) ? "requirements.accept" : "requirements.reject")}</p>)}
      </details>
    </>
  );
}

/**
 * Spec §10.3: the active chain (the server's `clarify.chain`; every round when an older view has none), each round with
 * its 1-based position, and the superseded rounds folded under the earliest later revision on the chain.
 */
function chainOf(view: View): Array<{ round: Round; position: number; superseded: Round[] }> {
  return chainEntries(view.rounds, view.clarify?.chain);
}

/** The same over any host's rounds (gaps spec §9: a flow clarify step's rounds take this UI, not a fork of it). */
export function chainEntries(rounds: Round[], chain: number[] | undefined): Array<{ round: Round; position: number; superseded: Round[] }> {
  const order = chain ?? rounds.map((r) => r.roundNo);
  const byNo = new Map(rounds.map((r) => [r.roundNo, r]));
  const entries = order.flatMap((roundNo, i) => { const r = byNo.get(roundNo); return r === undefined ? [] : [{ round: r, position: i + 1, superseded: [] as Round[] }]; });
  const onChain = new Set(order);
  for (const r of rounds) {
    if (onChain.has(r.roundNo)) continue;
    const holder = entries.find((e) => e.round.revises !== undefined && e.round.roundNo > r.roundNo) ?? entries.at(-1);
    holder?.superseded.push(r);
  }
  return entries;
}

/**
 * Spec §10.3 (Issue #76): edit an answered round's answers and send them as a revision. It is appended as a new round,
 * never overwriting this one; later rounds on the chain become superseded and their answers are carried into the next
 * round as recommendations unless the person keeps them out. The dialog states the cost before anything is sent.
 */
/** What a revision sends (`requirement-revise`'s payload; a flow clarify step's round edit carries the same body). */
export type RoundRevision = {
  roundNo: number; answers: Array<{ id: string; kind: "recommended" } | { id: string; kind: "text"; text: string }>;
  glossaryDecisions: Array<{ id: string; accept: boolean }>; adrDecisions: Array<{ id: string; accept: boolean }>; reason?: string; exclude?: number[];
};

export function ReviseRound(props: { round: Round; position: number; later: Array<{ roundNo: number; position: number }>; onRevise: (revision: RoundRevision) => void }): JSX.Element {
  const { t } = useTranslation();
  const result = props.round.result!;
  const answered = new Map((props.round.answers ?? []).map((a) => [a.id, a]));
  const initial = (): Record<string, AnswerChoice> => Object.fromEntries(result.questions.map((q) => {
    const a = answered.get(q.id);
    return [q.id, a?.kind === "text" ? { kind: "text", text: a.text } : { kind: "recommended" }];
  }));
  const decided = new Map([...(props.round.glossaryDecisions ?? []), ...(props.round.adrDecisions ?? [])].map((d) => [d.id, d.accept]));
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [choice, setChoice] = useState<Record<string, AnswerChoice>>(initial);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [exclude, setExclude] = useState<number[]>([]);
  const accepts = (id: string): boolean => decisions[id] ?? decided.get(id) ?? true;
  const send = (): void => {
    setAsking(false); setOpen(false);
    props.onRevise({
      roundNo: props.round.roundNo,
      answers: result.questions.map((q) => { const c = choice[q.id] ?? { kind: "recommended" as const }; return c.kind === "text" ? { id: q.id, kind: "text" as const, text: c.text } : { id: q.id, kind: "recommended" as const }; }),
      glossaryDecisions: result.glossary.map((entry) => ({ id: entry.id, accept: accepts(entry.id) })),
      adrDecisions: result.adrs.map((adr) => ({ id: adr.id, accept: accepts(adr.id) })),
      ...(reason.trim() === "" ? {} : { reason: reason.trim() }), ...(exclude.length === 0 ? {} : { exclude }),
    });
  };
  if (!open) return <button type="button" onClick={() => { setChoice(initial()); setOpen(true); }}>{t("requirements.revise")}</button>;
  const label = t("requirements.reviseTitle", { n: props.position });
  return (
    <form aria-label={label} onSubmit={(event) => { event.preventDefault(); setAsking(true); }}>
      {result.questions.map((q) => {
        const c = choice[q.id] ?? { kind: "recommended" as const };
        return (
          <fieldset key={q.id} aria-label={`${q.id} ${q.question}`}>
            <legend>{q.id} {q.question}</legend>
            <p>{t("requirements.recommended", { answer: q.recommendedAnswer })}</p>
            <label><input type="radio" name={`rv-${props.round.roundNo}-${q.id}`} checked={c.kind === "recommended"} onChange={() => setChoice({ ...choice, [q.id]: { kind: "recommended" } })} />{t("requirements.useRecommended")}</label>
            <label><input type="radio" name={`rv-${props.round.roundNo}-${q.id}`} checked={c.kind === "text"} onChange={() => setChoice({ ...choice, [q.id]: { kind: "text", text: "" } })} />{t("requirements.ownAnswer")}</label>
            {c.kind === "text" && <textarea aria-label={t("requirements.answerOf", { id: q.id })} value={c.text} onChange={(e) => setChoice({ ...choice, [q.id]: { kind: "text", text: e.currentTarget.value } })} />}
          </fieldset>
        );
      })}
      {[...result.glossary.map((e) => [e.id, e.term] as const), ...result.adrs.map((a) => [a.id, a.title] as const)].map(([id, text]) => (
        <fieldset key={id} aria-label={`${id} ${text}`}>
          <legend>{id} {text}</legend>
          <label><input type="radio" name={`rvd-${props.round.roundNo}-${id}`} checked={accepts(id)} onChange={() => setDecisions({ ...decisions, [id]: true })} />{t("requirements.accept")}</label>
          <label><input type="radio" name={`rvd-${props.round.roundNo}-${id}`} checked={!accepts(id)} onChange={() => setDecisions({ ...decisions, [id]: false })} />{t("requirements.reject")}</label>
        </fieldset>
      ))}
      <label>{t("requirements.reviseReason")}<textarea aria-label={t("requirements.reviseReason")} value={reason} onChange={(e) => setReason(e.currentTarget.value)} /></label>
      {props.later.map(({ roundNo, position }) => (
        <label key={roundNo}><input type="checkbox" checked={exclude.includes(roundNo)}
          onChange={(e) => { const on = e.currentTarget.checked; setExclude(on ? [...exclude, roundNo].sort((a, b) => a - b) : exclude.filter((n) => n !== roundNo)); }} />
          {t("requirements.reviseExclude", { n: position })}</label>
      ))}
      <button type="submit" disabled={result.questions.some((q) => { const c = choice[q.id]; return c?.kind === "text" && c.text.trim() === ""; })}>{t("requirements.reviseSend")}</button>
      <button type="button" onClick={() => setOpen(false)}>{t("requirements.reviseCancel")}</button>
      {asking && (
        <div role="dialog" aria-label={t("requirements.reviseConfirmTitle", { n: props.position })}>
          <p>{t("requirements.reviseCost")}</p>
          <button type="button" onClick={send}>{t("requirements.reviseConfirm")}</button>
          <button type="button" onClick={() => setAsking(false)}>{t("requirements.reviseKeep")}</button>
        </div>
      )}
    </form>
  );
}

/** Issue #87: the time since the drafting step was asked for, ticking once a second while it is shown. */
function Elapsed(props: { since: number }): JSX.Element {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - props.since) / 1000));
  const elapsed = seconds < 60 ? t("requirements.elapsedSeconds", { n: seconds }) : t("requirements.elapsedMinutes", { m: Math.floor(seconds / 60), s: seconds % 60 });
  return <>{t("requirements.draftingFor", { elapsed })}</>;
}

/** Tester #35: the share of a finite token limit from which the requirement's budget line warns. */
const NEAR_LIMIT = 0.8;

type NextStep = { key: "retry" | "settle" | "answer" | "consensus" | "review" | "prepare" | "waiting"; n?: number; region: "problem" | "answers" | "draft" | null };

/**
 * Tester #27, #33, #34: the one next step, said under the heading, from the facts the page already shows further down.
 * Earlier entries win: something failed or stopped, then the person's answers, the split to review, consensus, preparation.
 */
function NextStepLine(props: { groupId: string; step: NextStep }): JSX.Element {
  const { t } = useTranslation();
  const { step } = props;
  const go = (): void => {
    if (step.region === null) return;
    const element = document.getElementById(overviewRegionId("requirement", props.groupId, step.region));
    element?.focus(); element?.scrollIntoView?.({ block: "start" });
  };
  return (
    <p data-testid="requirement-next" data-tone={step.key === "waiting" ? undefined : "warn"}>
      <strong>{t("requirements.next.label")}</strong>{t(`requirements.next.${step.key}` as const, { n: step.n ?? 0 })}
      {step.region !== null && <>{" "}<button type="button" onClick={go}>{t("requirements.next.go")}</button></>}
    </p>
  );
}

function Detail(props: { view: View; onCommand: OnCommand; onPrepare?: (groupId: string) => void } & EditableDrafts): JSX.Element {
  const { t } = useTranslation();
  const { view } = props, groupId = view.summary.groupId;
  const editable: EditableDrafts = { drafts: props.drafts, onDraft: props.onDraft };
  const valid = view.rounds.filter((round) => round.result !== null);
  const latest = valid.at(-1)?.result ?? null;
  const round = view.rounds.at(-1) ?? null, draft = view.drafts.at(-1) ?? null;
  const short = (tokens: number): string => shortTokens(tokens);
  const accepted = (decisions: Round["glossaryDecisions"]) => new Set((decisions ?? []).filter((d) => d.accept).map((d) => d.id));
  const reason = view.summary.requirement?.waiting ?? view.summary.requirement?.reasonCode ?? null;
  const step = view.requirement.consensus === null ? round : draft;
  // ccloop error codes spec (2026-10-15) §4.5-§4.6: a failed step names its latest failed call's ccloop code.
  const failedCall = step?.state === "failed" ? [...step.calls].reverse().find((call) => call.outcome === "failed") ?? null : null;
  const drafting = step?.state === "drafting";
  // Clarify caps spec §3.3: no next round was drafted after the latest answered one (requirementCommands.ts requirement-clarify-more).
  const stoppedClarifying = view.summary.state === "clarifying" && view.requirement.consensus === null && round !== null && round.state === "answered" && !round.closedByConsensus;
  // Spec §11.1: recovery-retry re-queues a failed or interrupted round or draft -- one the person stopped carries no reason code.
  const stalled = step?.state === "failed" || step?.state === "interrupted";
  // Final review finding 5: a stop that completed with no call in flight interrupts nothing; recovery-retry lifts it (DR15).
  // Issue 91: a partial stop (a frozen call could not hand off) is lifted the same way; an unresolved one (a frozen call's
  // outcome unknown) is not lifted, its retry asks for that outcome again (stopIntent.ts retryRequirementInTransaction).
  const stopped = view.summary.state === "clarifying" && (view.summary.stopState === "handoff-complete" || view.summary.stopState === "handoff-partial");
  const stopUnresolved = view.summary.state === "clarifying" && view.summary.stopState === "handoff-unresolved";
  // Review fix: only where the server says the retry can act (a frozen call's outcome unknown); the line stays either way.
  const retryable = (reason !== null && RETRYABLE.includes(reason)) || stalled || stopped || (stopUnresolved && view.summary.requirement?.stopRetryable === true);
  // Final review finding 4: the step's call blocked by the driver, retried on its run.
  const blockedRun = view.summary.requirement?.blockedRun ?? null;
  // Spec 2026-10-27 single-call unknown usage §9 R1: such a call's retry charges its grant (ChargeRetry), never a plain retry.
  const blockedCharge = view.summary.requirement?.blockedRunCharge ?? null;
  // ccloop error codes spec (2026-10-15) §4.6: only a blocked reason that carries a ccloop code after its prefix is explained;
  // a bare reason keeps its code alone (web/tests/requirements.test.tsx "names a blocked call's reason ...").
  const blockedWords = blockedRun?.reason?.includes(":") ? explainRunReason(blockedRun.reason) : null;
  const exportState = view.requirement.export.state;
  const archived = view.summary.archived === true;
  const archiveAllowed = view.summary.state === "clarifying" && !drafting && blockedRun === null
    && (view.summary.stopMode === null || view.summary.stopMode === "pause"
      || view.summary.stopState === "handoff-complete" || view.summary.stopState === "handoff-partial");
  const lastEntry = chainOf(view).at(-1) ?? null;
  const nextStep: NextStep | null = archived ? null
    // Spec 2026-10-27 single-call unknown usage §5 O4: a call blocked on unknown usage is settled (its grant charged), then retried.
    : blockedCharge !== null ? { key: "settle", region: "problem" }
    : blockedRun !== null || retryable || stopUnresolved ? { key: "retry", region: "problem" }
    : drafting ? { key: "waiting", region: null }
    : lastEntry !== null && lastEntry.round.state === "awaiting-answers" && lastEntry.round.result !== null && view.requirement.consensus === null
      ? { key: "answer", n: lastEntry.position, region: "answers" }
    : draft !== null && draft.state === "awaiting-review" ? { key: "review", n: draft.draftNo, region: "draft" }
    : view.requirement.acceptedDraftNo !== null && view.summary.state !== "clarifying" ? { key: "prepare", region: null }
    : view.requirement.consensus === null && round !== null && round.state === "answered" && valid.length > 0 ? { key: "consensus", region: "answers" }
    : null;
  return (
    <article aria-label={view.requirement.slug ?? groupId}>
      <h3>{view.requirement.slug ?? groupId} · {enumText("groupState", view.summary.state)}</h3>
      {nextStep !== null && <NextStepLine groupId={groupId} step={nextStep} />}
      {view.requirement.acceptedDraftNo !== null && view.summary.state !== "clarifying" &&
        <button type="button" onClick={() => props.onPrepare?.(groupId)}>{t("requirements.goToPreparation")}</button>}
      {archived ? <section aria-label={t("control.group.archivedRegion")}>
        <p>{t("control.group.archivedBanner")}</p>
        <button type="button" onClick={() => props.onCommand({ verb: "unarchive-group", groupId, expectedRevision: revisionOf(view), payload: {} })}>{t("control.group.unarchive")}</button>
      </section> : archiveAllowed && <button type="button" onClick={() => props.onCommand({ verb: "archive-group", groupId, expectedRevision: revisionOf(view), payload: {} })}>{t("control.group.archive")}</button>}
      {/* Issue #74: the idea as the person wrote it, in every state, so each round can be read against it. */}
      {/* Tester #28: once a round is answered the current understanding leads, so the idea folds -- its summary keeps the
          idea's start on screen, so a round can still be read against it (#74). */}
      <section aria-label={t("requirements.originalIdea")}>
        {view.rounds.some((r) => r.state === "answered") ? (
          <details className="requirement-idea">
            <summary><h4>{t("requirements.originalIdea")}</h4> <span>{goalSummary(view.requirement.idea)}</span></summary>
            <p className="requirement-text">{view.requirement.idea}</p>
          </details>
        ) : <><h4>{t("requirements.originalIdea")}</h4><p className="requirement-text">{view.requirement.idea}</p></>}
      </section>
      <section aria-label={t("requirements.understanding")}>
        <h4>{t("requirements.understanding")}</h4>
        <p>{latest?.statement ?? t("requirements.nothingYet")}</p>
        <h5>{t("requirements.criteria")}</h5><ul>{(latest?.acceptanceCriteria ?? []).map((c) => <li key={c.id}>{c.id}: {c.text}</li>)}</ul>
        {/* Issue #83: the supporting detail folds away under one summary. */}
        <details>
          <summary>{t("requirements.moreDetails")}</summary>
          <h5>{t("requirements.glossary")}</h5><ul>{valid.flatMap((r) => r.result!.glossary.filter((e) => accepted(r.glossaryDecisions).has(e.id))).map((e) => <li key={e.id}>{e.term}: {e.definition}</li>)}</ul>
          <h5>{t("requirements.decisions")}</h5><ul>{valid.flatMap((r) => r.result!.adrs.filter((a) => accepted(r.adrDecisions).has(a.id))).map((a) => <li key={a.id}>{a.id} {a.title}</li>)}</ul>
          <h5>{t("requirements.openBranches")}</h5><ul>{(latest?.openBranches ?? []).map((branch) => <li key={branch}>{branch}</li>)}</ul>
        </details>
        {/* Issue #79: short figures; `reserved` is the grant held by calls in flight (requirementRecords.ts), never a cap. */}
        {/* Tester #35: at 80% of a finite limit the line turns warn, before the next call is refused for budget. */}
        <p data-testid="requirement-budget" data-tone={view.ledger.limit.tokens !== null && view.ledger.used.tokens >= view.ledger.limit.tokens * NEAR_LIMIT ? "warn" : undefined}>{t("requirements.budget", { used: short(view.ledger.used.tokens), limit: view.ledger.limit.tokens===null?t("budget.unlimited"):short(view.ledger.limit.tokens) })}
          <span title={t("requirements.heldTip")}>{t("requirements.held", { reserved: short(view.ledger.reserved.tokens) })}</span></p>
        {view.ledger.limit.tokens!==null&&<progress max={view.ledger.limit.tokens} value={view.ledger.used.tokens} />}
        {view.ledger.usageUnknown && <p role="status">{t("requirements.usageUnknown")}</p>}
      </section>
      <ClarifySize view={view} onCommand={props.onCommand} editable={!archived && view.summary.state === "clarifying" && view.requirement.consensus === null} />
      <div id={overviewRegionId("requirement", groupId, "problem")} tabIndex={-1} data-overview-region="problem">
      {!archived && (reason !== null || retryable || stopUnresolved) && (
        <p role="alert">{reason !== null && <>{reason}{isReason(reason) ? ` · ${t(`requirements.reason.${reason}`, { groupId })}` : ""} </>}
          {stopped && <>{t("requirements.stopped")} </>}
          {stopUnresolved && <>{t("requirements.stopUnresolved")} </>}
          {retryable && <button type="button" onClick={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "group", groupId } })}>{t("requirements.retry")}</button>}
        </p>
      )}
      {!archived && failedCall?.reason != null && <p role="status">{failedCall.reason}{explainBesideCode(failedCall.reason) !== null ? ` · ${explainBesideCode(failedCall.reason)}` : ""}</p>}
      {!archived && blockedRun !== null && (
        <p role="alert">{blockedRun.reason !== null && <>{blockedRun.reason}{blockedWords !== null ? ` · ${blockedWords}` : ""} · </>}
          {blockedCharge !== null ? <ChargeRetry charge={blockedCharge}
            onCharge={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "run", runId: blockedRun.runId, acknowledge: "charge-remaining-grant" } })} /> : <>{t("requirements.blockedRun")}{" "}
          <button type="button" onClick={() => props.onCommand({ verb: "recovery-retry", groupId, expectedRevision: revisionOf(view), payload: { scope: "run", runId: blockedRun.runId } })}>{t("requirements.retryRun")}</button></>}
        </p>
      )}
      {!archived && reason === BUDGET_EXHAUSTED && <RaiseLimit view={view} onCommand={props.onCommand} {...editable} />}
      </div>
      <section id={overviewRegionId("requirement", groupId, "answers")} tabIndex={-1} data-overview-region="answers" aria-label={t("requirements.rounds")}>
        <h4>{t("requirements.rounds")}</h4>
        {chainOf(view).map(({ round: r, position, superseded }) => {
          // Issue #83: the round waiting on the person stands out (warn: needs action) and is open; answered ones fold.
          const pending = !archived && r.state === "awaiting-answers" && r.result !== null && view.requirement.consensus === null;
          const answered = r.state === "answered" && r.result !== null && r.answers !== null && !r.closedByConsensus;
          // Spec §10.3: an answered round on the chain may be revised until a split is accepted (requirement-already-accepted).
          const revisable = !archived && r.state === "answered" && r.result !== null && r.answers !== null && view.requirement.acceptedDraftNo === null && view.summary.stopState === null;
          const later = chainOf(view).filter((entry) => entry.position > position).map((entry) => ({ roundNo: entry.round.roundNo, position: entry.position }));
          return (
            <details key={r.roundNo} className="requirement-round" open={pending || (!answered && r === round)} data-tone={pending ? "warn" : undefined}>
              <summary>{t(r.revises === undefined ? "requirements.round" : "requirements.roundRevised", { n: position })} · {enumText("roundState", r.state)}{r.result !== null ? ` · ${t("requirements.questionCount", { n: r.result.questions.length })}` : ""}</summary>
              {r.reason !== undefined && <p>{t("requirements.revisedBecause", { reason: r.reason })}</p>}
              {pending && <RoundForm view={view} round={r} onCommand={props.onCommand} {...editable} />}
              {answered ? <AnsweredRound round={r} /> : !pending && r.answers?.map((a) => <p key={a.id}>{a.id}: {a.text}</p>)}
              {revisable && <ReviseRound round={r} position={position} later={later}
                onRevise={(payload) => props.onCommand({ verb: "requirement-revise", groupId: view.summary.groupId, expectedRevision: revisionOf(view), payload })} />}
              {superseded.map((s) => (
                <details key={s.roundNo} className="requirement-round">
                  <summary>{t("requirements.superseded", { n: s.roundNo })} · {enumText("roundState", s.state)}</summary>
                  {s.state === "answered" && s.result !== null && s.answers !== null ? <AnsweredRound round={s} /> : s.answers?.map((a) => <p key={a.id}>{a.id}: {a.text}</p>)}
                </details>
              ))}
            </details>
          );
        })}
        {!archived && drafting && view.summary.stopState === null && (
          <p role="status">{view.requirement.consensus === null ? t("requirements.draftingRound", { n: (step as Round).roundNo }) : t("requirements.draftingSplit", { n: (step as Draft).draftNo })}
            {view.draftingSince != null && <> <Elapsed since={view.draftingSince} /></>}{" "}
            <button type="button" onClick={() => props.onCommand({ verb: "handoff-stop", groupId, expectedRevision: revisionOf(view), payload: {} })}>{t("requirements.stop")}</button></p>
        )}
        {/* Clarify caps spec §3.3: clarification stopped (the cap, or nothing left to ask); one more round on request. */}
        {!archived && stoppedClarifying && round !== null && (
          <p role="note">{view.clarify?.stoppedAtCap === true ? t("requirements.stoppedAtCap", { n: round.roundNo }) : t("requirements.frontierEmpty")}{" "}
            <button type="button" onClick={() => props.onCommand({ verb: "requirement-clarify-more", groupId, expectedRevision: revisionOf(view), payload: { roundNo: round.roundNo } })}>{t("requirements.clarifyMore")}</button></p>
        )}
        {!archived && view.requirement.consensus === null && round !== null && ["answered", "awaiting-answers", "failed", "interrupted"].includes(round.state) && valid.length > 0 && <Consensus view={view} round={round} onCommand={props.onCommand} />}
      </section>
      <div id={overviewRegionId("requirement", groupId, "draft")} tabIndex={-1} data-overview-region="draft">
      {view.drafts.map((d) => <DraftReview key={d.draftNo} view={view} draft={d} onCommand={props.onCommand} archived={archived} {...editable} />)}
      <section aria-label={t("requirements.document")}>
        {/* Tester #32: while clarifying the document is only the idea's stub, so it folds; from consensus on it is the
            requirement's real product and is open. */}
        <details className="requirement-document" open={view.requirement.consensus !== null}>
          <summary><h4>{t("requirements.document")}</h4></summary>
          <DocumentText text={view.document} />
        </details>
        {/* Dir-requirements spec §9.3: a dir group's document stays in Orca's store, never in the folder. */}
        {view.summary.placement !== undefined
          ? <p>{t("requirements.exportKept")}</p>
          : exportState !== "not-due" && <p>{t("requirements.export", { state: enumText("exportState", exportState) })}{view.requirement.export.commit !== null ? ` · ${t("requirements.exportCommit", { commit: view.requirement.export.commit })}` : ""}</p>}
        {/* Spec §9.3: start is refused until the export is done; this says why before anyone presses Start. */}
        {exportState === "pending" && <p role="status">{EXPORT_PENDING} · {t(`requirements.reason.${EXPORT_PENDING}`, { groupId })}</p>}
      </section>
      </div>
    </article>
  );
}

/**
 * Issue #73: a refusal in the reader's words. A ccloop failure is explained by ccloop's own code with its detail (as
 * RefusalNotice does), and a refused estimator selection adds the words for the ccloop code it names, with the failed
 * probe's ccloop stderr when it had one (src/control/profiles.ts probeFailureDetail). Issues #70, #58: a refusal by
 * Orca's own estimator check is said as that check's, not ccloop's.
 */
function refusalWords(refusal: ControlRefusal): string {
  const check = refusal.code === "agent-selection-rejected" ? explainEstimatorCheck(refusal.message) : null;
  if (check !== null) return check;
  const text = explainRefusal(refusal).text;
  const words = refusal.code === "agent-selection-rejected" ? explainEstimateReason(refusal.message) : null;
  return words === null ? text : `${text} · ${words}`;
}

const LIST_NAME_MAX = 60;
/**
 * Issues #75, #78: a listed requirement is named by its slug, else by the start of its idea on one line (the summary's
 * goal is a clarifying group's idea); null when neither is known, and the group id names it as before.
 */
function listName(group: ControlSummaryV1["groups"][number]): string | null {
  // Tester #1: the id stays (it is the group's key and its work branch); the list names it as the cards do, by the
  // clarify round's short title first (CardGoal), then the slug, then the idea.
  const title = group.requirement?.title?.trim() ?? "";
  if (title !== "") return title;
  const slug = group.requirement?.slug ?? null;
  if (slug !== null) return slug;
  if (group.goal === undefined) return null;
  const chars = Array.from(group.goal.replace(/\s+/g, " ").trim());
  if (chars.length === 0) return null;
  return chars.length > LIST_NAME_MAX ? `${chars.slice(0, LIST_NAME_MAX).join("")}…` : chars.join("");
}

export function RequirementsPanel(props: { focus?: Extract<OverviewTarget, { kind: "requirement" }> | null; config: ControlConfigV1; summary: ControlSummaryV1; views: Record<string, RequirementViewV1>; selected: string | null;
  agents: AgentsViewV1 | null; language: PanelLanguage; onSelect: (groupId: string) => void;
  onPrepare?: (groupId: string) => void;
  onGroupAction?: (groupId: string, verb: "archive-group" | "unarchive-group", repoId: string) => void;
  groupRefusals?: Record<string, ControlRefusal>;
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
  const [showArchived, setShowArchived] = useState(false);
  const listed = props.summary.groups.filter((group) => group.requirement !== undefined && (showArchived || group.archived !== true)
    && (scope === undefined || inScope(scope, group.repoId)));
  const view = props.selected === null ? undefined : props.views[props.selected];
  const refusal = props.refusal ?? null;
  return (
    <section aria-label={t("requirements.title")} className="requirements">
      <h2>{t("requirements.title")}</h2>
      {/* Issue 94 review fix: an unreadable group that holds (or may hold) a requirement is named here too. */}
      {(props.summary.unreadable ?? []).filter((row) => row.requirement !== false).map((row) => (
        <p role="alert" data-tone="warn" key={row.groupId}>{t("control.unreadableGroup", { groupId: row.groupId, reason: row.reason })}</p>
      ))}
      {refusal !== null && <p role="alert">{refusal.code} · {isReason(refusal.code) ? t(`requirements.reason.${refusal.code}`, { groupId: props.selected ?? "" }) : refusalWords(refusal)}</p>}
      <div className="split">
        <nav aria-label={t("requirements.list")}>
          {/* Tester #36: the form to start one sits above the list, not after however many requirements there are. */}
          <NewRequirement config={props.config} agents={props.agents} language={props.language} onCommand={onCommand} repoId={props.repoId} onRepo={props.onRepo}
            scope={scope} targets={props.targets} repoLabel={props.repoLabel} {...editable} />
          <label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.currentTarget.checked)} />{t("requirements.showArchived")}</label>
          {scope?.kind === "unresolved" ? <p role="note">{t("project.listUnavailable")}</p> : listed.length === 0 && <p>{t("requirements.none")}</p>}
          {listed.map((group) => (
            <GroupActionsMenu key={group.groupId} group={group} onOpen={() => props.onSelect(group.groupId)} onAction={props.onGroupAction}
              refusal={group.groupId === props.selected ? null : props.groupRefusals?.[group.groupId]}>{(onContextMenu) => (
            <button type="button" title={listName(group) === null ? undefined : group.groupId} aria-current={group.groupId === props.selected} onClick={() => props.onSelect(group.groupId)} onContextMenu={onContextMenu}>
              {listName(group) ?? group.groupId} · {enumText("groupState", group.state)}
              {scope?.kind === "all" ? ` · ${props.repoLabel?.(group.repoId) ?? group.repoId}` : ""}
            </button>
            )}</GroupActionsMenu>
          ))}
        </nav>
        {view !== undefined && <Detail view={view} onCommand={onCommand} onPrepare={props.onPrepare} {...editable} />}
      </div>
    </section>
  );
}
