/**
 * Labels and progress spec §4.2: one task, opened from the group's work item table -- its labels and an editor for them,
 * its progress, and every run it had with that run's evidence, piece by piece.
 *
 * Tester #114: the editor has no draft. Adding or removing a label sends set-task-labels at once, with the labelsVersion
 * on screen as its base, so a change made from a stale view is refused as labels-version-conflict instead of overwriting
 * someone else's; a refusal is shown by its code like every other refusal and the chips stay what the server holds.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { labelCustomClass, labelEditor, labelRemove, labelRestore, labelRow, labelSystemClass, labelWithRemove, taskDetail } from "./ui/classes.js";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, fetchSavedResultEligibility, downloadEvidenceArtifact, fetchRunActivity, fetchRunEvidence, type ControlAction } from "./controlApi.js";
import { CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "./controlTypes.js";
import { CorrectRunButton } from "./CoarseCorrection.js";
import type { SavedResultEligibilityV1, ActivityEntryV1, EvidenceManifestV1, GroupDecisionsViewV1, GroupViewV1, WorkItemProgressV1, WorkItemViewV1 } from "./controlTypes.js";
import { TaskResults } from "./TaskResults.js";
import { RunDecisions } from "./RunDecisions.js";
import { LoopPlanCard } from "./LoopPlanCard.js";
import { RunReason, type LadderSkipReason } from "./RunReason.js";
import { explainRunReason } from "./refusalExplain.js";
import { explainBesideCode } from "./ccloopCodes.js";
import { hasFailureOutcome, reasonCode, retryRunOpen, savedResultSourceRunId, taskRunNumber } from "./runFacts.js";
import i18n, { enumText } from "./i18n.js";
import { shortTokens } from "./TokenInput.js";
import { usedRatio } from "../../src/control/budgetSuggestions.js";
import { UsageSettlement } from "./UsageSettlement.js";
import { AcceptAttempt } from "./AcceptAttempt.js";
import { NoChangeRecord } from "./NoChange.js";
import { UsagePause } from "./UsagePause.js";
import { RunTranscript } from "./AgentTranscript.js";
import { ObservedPathRetry } from "./ObservedPathRetry.js";
import type { Role } from "./auth.js";

/** A system label and a custom one look different (spec §4.2); the class is the whole difference. */
export function LabelChips(props: { labels: string[] | undefined }): JSX.Element {
  const { t } = useTranslation();
  const labels = props.labels ?? [];
  if (labels.length === 0) return <>{t("common.none")}</>;
  return (
    <>
      {labels.map((label) => (
        <span key={label} className={label.startsWith(CUSTOM_LABEL_PREFIX) ? labelCustomClass : labelSystemClass}>{label}</span>
      ))}
    </>
  );
}

/**
 * Spec §4.1/§4.2 (§8 R11, R18): step · attempt n/max · tokens. Unknown usage says "unknown", never a percentage; a known
 * number is annotated, because ccloop reports usage only when a phase ends (panel i18n spec §3.3: in the reader's language).
 */
export function progressText(progress: WorkItemProgressV1 | null | undefined): string {
  if (progress === undefined || progress === null) return i18n.t("control.progress.noRun");
  const step = progress.step === null ? i18n.t("control.progress.notReported") : enumText("progressStep", progress.step);
  const attempt = progress.attempt === null
    ? i18n.t("control.progress.attemptUnknown")
    : i18n.t("control.progress.attempt", { current: progress.attempt.current, max: progress.attempt.max });
  const tokens = progress.tokens === null
    ? i18n.t("control.progress.tokensUnknown")
    : progress.tokens.grant===null?i18n.t("control.progress.tokensUnlimited",{used:shortTokens(progress.tokens.used)})
    : progress.tokens.grant === 0
      ? i18n.t("control.progress.tokensOfZero", { used: shortTokens(progress.tokens.used) })
      : i18n.t("control.progress.tokensPercent", { percent: Math.floor((progress.tokens.used * 100) / progress.tokens.grant) });
  return i18n.t("control.progress.line", { step, attempt, tokens });
}

/**
 * Budget defaults spec 2026-11-11 §7 item 4: an estimate's work tokens as an expectation (a group with no token limit), and
 * once there is usage, how far it went: "expected 1.5M · used 4.8M (×3.2)", or "used unknown". Shown, never enforced.
 */
export function expectedText(expected: { tokens: number; usedTokens: number | null; stale?: boolean }): string {
  const base = i18n.t("control.progress.expected", { expected: shortTokens(expected.tokens) }) + (expected.stale === true ? i18n.t("control.progress.expectedStale") : "");
  if (expected.usedTokens === 0) return base;
  const ratio = usedRatio({ tokens: expected.tokens, usedTokens: expected.usedTokens });
  return expected.usedTokens === null || ratio === null
    ? i18n.t("control.progress.expectedUsedUnknown", { base })
    : i18n.t("control.progress.expectedUsed", { base, used: shortTokens(expected.usedTokens), ratio });
}

/** Spec §3.5, as enumText: where the labels came from in words; a source this panel has no words for is shown as sent. */
function labelSourceText(source: string): string {
  const key = `control.task.labelSource.${source}`;
  return i18n.exists(key) ? (i18n.t(key as never) as string) : source;
}

/** One run's evidence manifest, listed on demand; each piece is downloaded through the token-carrying client. */
export function EvidenceList(props: { runId: string }): JSX.Element {
  const { t } = useTranslation();
  const [manifest, setManifest] = useState<EvidenceManifestV1 | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const load = async (): Promise<void> => {
    setRefusal(null);
    try { setManifest(await fetchRunEvidence(props.runId)); } catch (err) { setRefusal(controlFailureFrom(err).code); }
  };
  const download = async (entry: EvidenceManifestV1["entries"][number]): Promise<void> => {
    setRefusal(null);
    try { await downloadEvidenceArtifact(entry); } catch (err) { setRefusal(controlFailureFrom(err).code); }
  };
  return (
    <>
      <button type="button" onClick={() => void load()}>{t("control.evidence.list", { runId: props.runId })}</button>
      {refusal !== null && <span role="alert">{t("control.evidence.refused", { code: refusal })}</span>}
      {manifest !== null && (manifest.entries.length === 0 ? <span>{t("control.evidence.none")}</span> : (
        <ul aria-label={t("control.evidence.region", { runId: props.runId })}>
          {manifest.entries.map((entry) => (
            <li key={entry.evidenceId}>
              {t("control.evidence.entry", { id: entry.evidenceId, kind: entry.kind, bytes: entry.byteLength })}{" "}
              <button type="button" onClick={() => void download(entry)}>{t("control.evidence.download", { id: entry.evidenceId })}</button>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

/** ccloop's own step words (a phase row keeps them raw) onto the panel's step words; a word with no entry shows as sent. */
const CCLOOP_STEP: Record<string, string> = { planning: "plan", executing: "execute", verifying: "verify" };

/** One activity row in words: its kind, and for a phase, a block or a settle what it said. */
function activityText(entry: ActivityEntryV1): string {
  const kind = enumText("activityKind", entry.kind);
  const body = entry.body;
  const unmetered = body.method === "owner-acknowledged-unmetered";
  if (entry.kind === "usage-settled" && (body.method === "remaining-grant" || unmetered) && typeof body.charged === "object" && body.charged !== null) {
    const charged = body.charged as Record<string, unknown>;
    const buckets = (["work", "handoff"] as const).flatMap(bucket => {
      const amount = charged[bucket];
      if (typeof amount !== "object" || amount === null) return [];
      const fields = amount as Record<string, unknown>;
      // Only an unmetered release's work tokens may be null; they are named as not metered, never dropped or shown as 0.
      const tokensUnmetered = unmetered && bucket === "work" && fields.tokens === null;
      if (!["activeMs", "attempts", "sessions"].every(dimension => typeof fields[dimension] === "number") || (!tokensUnmetered && typeof fields.tokens !== "number")) return [];
      if (tokensUnmetered) return [i18n.t("control.settlement.activityChargeUnmetered", { bucket: i18n.t(`control.settlement.${bucket}`), activeMs: fields.activeMs as number, attempts: fields.attempts as number, sessions: fields.sessions as number })];
      return [i18n.t("control.settlement.activityCharge", { bucket: i18n.t(`control.settlement.${bucket}`), tokens: fields.tokens as number, activeMs: fields.activeMs as number, attempts: fields.attempts as number, sessions: fields.sessions as number })];
    });
    return `${kind} · ${i18n.t(unmetered ? "control.settlement.methodUnmetered" : "control.settlement.method")} · ${buckets.join(" · ")}`;
  }
  // Tester follow-up F §2 (#116): a person's or agent's explicit observed floor.
  if (entry.kind === "usage-settled" && body.method === "observed-floor") return `${kind} · ${i18n.t("control.settlement.methodObserved")}${typeof body.floorTokens === "number" ? ` · ${body.floorTokens}` : ""}`;
  if (entry.kind === "usage-settled" && body.method === "approximate-floor") return `${kind} · ${i18n.t("control.settlement.methodApproximate")}${typeof body.floorTokens === "number" ? ` · ${body.floorTokens}` : ""}`;
  if (entry.kind === "phase" && typeof body.step === "string") {
    const step = enumText("progressStep", CCLOOP_STEP[body.step] ?? body.step);
    return `${kind} · ${typeof body.attempt === "number" ? i18n.t("control.activity.phase", { step, attempt: body.attempt }) : step}`;
  }
  if (entry.kind === "run-blocked" && typeof body.reason === "string") {
    const code = reasonCode(body.reason);
    return `${kind} · ${explainRunReason(code) ?? body.reason}`;
  }
  if (entry.kind === "run-settled" && typeof body.state === "string") return `${kind} · ${enumText("runState", body.state)}`;
  // Task setup and check retry spec 2026-11-04 §4.7: why the ladder left the run out; an unknown reason shows the bare kind.
  // Final-review fix wave (minor 5): the sentence already says "not retried", so the kind is not put before it; (I4) the
  // failing command, when the row names one, follows it.
  const skipped = ladderSkipOf(entry);
  if (skipped !== null) {
    // Tester follow-up B T2 (#234): the attempt-cost skip names the fresh grant and one attempt's cost its reason carries.
    const cost = skipped === "retry-funding-below-attempt-cost" ? /^retry-funding-below-attempt-cost:(\d+)\/(\d+)$/.exec(String(body.reason)) : null;
    return `${i18n.t(`control.ladder.skipped.${skipped}`)}${skipped === "could-not-run" && typeof body.command === "string" && body.command !== "" ? ` · ${body.command}` : ""}${cost === null ? "" : ` · ${i18n.t("control.ladder.attemptCost", { fresh: cost[1], perAttempt: cost[2] })}`}`;
  }
  return kind;
}

/** A `ladder-skipped` row's reason, when it is one this panel words; null for any other row. */
function ladderSkipOf(entry: ActivityEntryV1): LadderSkipReason | null {
  if (entry.kind !== "ladder-skipped") return null;
  const reason = entry.body.reason;
  if (typeof reason === "string" && reason.startsWith("retry-funding-below-attempt-cost:")) return "retry-funding-below-attempt-cost";
  return reason === "setup-failed" || reason === "could-not-run" || reason === "authored-budget-exhausted" || reason === "retry-funding-missing" ? reason : null;
}

/**
 * Issue-fixes spec §6.5: the current run's recent activity, read when the detail opens and again whenever the group's
 * projection moves (changeSeq). A refusal is named in place; the rest of the detail does not wait on it. Read-only
 * information, so it stays on an archived group.
 * The caller keys it by run id, so a new run mounts empty (never a frame of the previous run's rows); a projection move
 * (changeSeq) keeps the rows on screen until the fresh answer replaces them.
 */
export function RunActivity(props: { runId: string; changeSeq: number; onLadderSkipped?: (runId: string, reason: LadderSkipReason | null) => void }): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntryV1[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchRunActivity(props.runId).then(
      (answer) => {
        if (!live) return;
        setEntries(answer.entries); setRefusal(null);
        // Final-review fix wave (minor 1): the run's reason line must not promise an escalation the ladder left out.
        props.onLadderSkipped?.(props.runId, answer.entries.map(ladderSkipOf).find((reason) => reason !== null) ?? null);
      },
      (err: unknown) => { if (live) setRefusal(controlFailureFrom(err).code); },
    );
    return () => { live = false; };
  }, [props.runId, props.changeSeq]);
  return (
    <section aria-label={t("control.activity.region", { runId: props.runId })}>
      <h5>{t("control.activity.heading")}</h5>
      {refusal !== null && <p className="detail-note">{t("control.activity.refused", { code: refusal })}</p>}
      {refusal === null && entries !== null && (entries.length === 0 ? <p>{t("control.activity.none")}</p> : (
        <ol>
          {[...entries].reverse().map((entry) => <li key={entry.seq}>{new Date(entry.at).toISOString()} · {activityText(entry)}</li>)}
        </ol>
      ))}
    </section>
  );
}

export interface TaskDetailProps {
  /** Live transcript spec §12.3: false while the group's pane is hidden -- the run transcripts then ask nothing and stop polling. */
  active?: boolean;
  resultsActive?: boolean;
  resultsScope?: string;
  view: GroupViewV1;
  item: WorkItemViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  /** Answers with the new revision, or null when the command did not succeed, once the group has been read again. */
  onCommand: (action: ControlAction) => void | Promise<number | null>;
  /** Board spec 2026-10-03 D7: the repository's workspace mode for the loop plan card's git line. */
  workspaceMode?: "worktree" | "clone" | null;
  /** Issue-fixes spec §6.3: an archived group refuses every command but the unarchive, so no editor is offered (read-only). */
  archived?: boolean;
  /** Spec 2026-10-13-unmetered-usage-settlement §B.1: who may settle the unknown usage that hides Retry here. */
  roles?: readonly Role[];
  /** Control run decisions plan Task 11: the group's decisions as last read; absent or null shows no decisions section. */
  decisions?: GroupDecisionsViewV1 | null;
  /** Fix round 1 (Rule 12): the code the group's decisions read failed with; said in place of its decisions. */
  decisionsFailed?: string | null;
  onCorrectDecision?: (projectKey: string, decisionId: string, origin?: { groupId: string; taskId: string | null; runId: string }) => void;
  /** Tester #293: the open task's visible close control; absent, none is shown. */
  onClose?: () => void;
}

export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const { view, item, drafts, onDraft, onCommand } = props;
  const archived = props.archived === true;
  const { t } = useTranslation();
  const groupId = view.summary.groupId;
  const current = item.labelsVersion ?? 0;
  const labels = item.labels ?? [];
  // Ruling R1 (#219): the label being typed is unsent input, so it lives in Task control's draft store and outlives
  // leaving the section (the pane unmounts); the answer's clear reads what is typed by then.
  const wordKey = JSON.stringify(["task-label", groupId, item.taskId]);
  const word = drafts[wordKey] ?? "";
  const setWord = (text: string): void => onDraft(wordKey, text);
  const wordNow = useRef(word);
  wordNow.current = word;
  const suggestions = useId();
  // One change at a time: a second sent before the first's answer would carry the same base version and be refused.
  // The ref guards synchronously; the state says so on screen (session 43913afc) instead of ignoring a change silently.
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const change = (next: string[] | null, accepted?: () => void): void => {
    if (sending.current) return;
    const answer = onCommand({
      verb: "set-task-labels", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision,
      payload: { labels: next, baseLabelsVersion: current },
    });
    if (answer === undefined) { accepted?.(); return; }
    sending.current = true; setSaving(true);
    void answer.then((revision) => { if (revision !== null) accepted?.(); }).finally(() => { sending.current = false; setSaving(false); });
  };
  const add = (): void => {
    const text = word.trim();
    if (text === "") return;
    // A refused label stays in the field to fix or send again; what was typed meanwhile is not this label.
    const clear = (): void => { if (wordNow.current.trim() === text) setWord(""); };
    const label = (WEB_SYSTEM_LABELS as readonly string[]).includes(text) || text.startsWith(CUSTOM_LABEL_PREFIX) ? text : `${CUSTOM_LABEL_PREFIX}${text}`;
    // Sorted by code unit like the server (spec §8 R15), so what is sent is what will be shown back.
    if (labels.includes(label)) clear(); else change([...labels, label].sort(), clear);
  };
  const runs = view.runs.filter((run) => run.taskId === item.taskId);
  const [ladderSkip, setLadderSkip] = useState<{ runId: string; reason: LadderSkipReason | null } | null>(null);
  const runNumber = taskRunNumber(view, item.taskId);
  return (
    // Tester #21: the open task is set apart from the table and graph around it by an accent edge (ui/classes.ts taskDetail).
    <section tabIndex={-1} className={`task-detail ${taskDetail}`} data-task-id={item.taskId} aria-label={t("control.task.region", { taskId: item.taskId })}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="mt-0">{t("control.task.region", { taskId: item.taskId })}</h4>
        {props.onClose !== undefined && (
          <button type="button" className="btn-quiet" aria-label={t("control.task.closeLabel", { taskId: item.taskId })} onClick={props.onClose}>{t("control.task.close")}</button>
        )}
      </div>
      <p>
        {t("control.task.labelsFrom", { source: labelSourceText(item.labelsProvenance ?? "plan"), version: item.labelsVersion ?? 0 })}
      </p>
      <TaskResults view={view} item={item} active={props.resultsActive === true} scope={props.resultsScope ?? ""} />
      <UsagePause groupId={groupId} revision={view.summary.commandRevision} item={item} onCommand={onCommand} archived={archived} />
      {props.decisionsFailed != null && <p data-testid="decisions-read-failed">{t("control.decisions.readFailed", { code: props.decisionsFailed })}</p>}
      {props.decisions?.tasks.find((task) => task.taskId === item.taskId)?.runs.map((run) => (
        <RunDecisions key={run.runId} groupId={groupId} revision={view.summary.commandRevision} run={run} projectKey={props.decisions?.projectKey ?? null}
          onCommand={onCommand} onCorrect={props.onCorrectDecision && ((projectKey, decisionId) => props.onCorrectDecision?.(projectKey, decisionId, { groupId, taskId: item.taskId, runId: run.runId }))} archived={archived} />
      ))}
      <div className={labelEditor} aria-busy={saving}>
        <ul className={labelRow} aria-label={t("control.task.labelsOf", { taskId: item.taskId })}>
          {labels.map((label) => (
            <li key={label}>
              <span className={`${label.startsWith(CUSTOM_LABEL_PREFIX) ? labelCustomClass : labelSystemClass} ${labelWithRemove}`}>
                {label}
                {!archived && <button type="button" className={labelRemove} aria-label={t("control.task.remove", { label })} disabled={saving} onClick={() => change(labels.filter((other) => other !== label))}>×</button>}
              </span>
            </li>
          ))}
        </ul>
        {!archived && (
          <>
            <input aria-label={t("control.task.addLabel")} placeholder={t("control.task.addLabel")} list={suggestions} value={word}
              onChange={(event) => setWord(event.target.value)}
              // Enter that ends an IME composition picks the characters; it does not add the label yet.
              onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
            <datalist id={suggestions}>{WEB_SYSTEM_LABELS.map((system) => <option key={system} value={system} />)}</datalist>
            {(item.labelsProvenance ?? "plan") !== "plan" && <button type="button" className={labelRestore} disabled={saving} onClick={() => change(null)}>{t("control.task.restore")}</button>}
            {saving && <span role="status">{t("control.task.savingLabels")}</span>}
          </>
        )}
      </div>
      <p className="num">
        {t("control.task.progress", { progress: progressText(item.progress) })}
        {item.progress?.lastTransitionAt ? t("control.task.lastTransition", { at: item.progress.lastTransitionAt }) : ""}
      </p>
      <LoopPlanCard view={view} item={item} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={props.workspaceMode} archived={archived} />
      {item.currentRunId !== null && <RunActivity key={item.currentRunId} runId={item.currentRunId} changeSeq={view.changeSeq} onLadderSkipped={(runId, reason) => setLadderSkip({ runId, reason })} />}
      <SavedResultEntry view={view} item={item} onCommand={onCommand} archived={archived} />
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {/* Issue fixes spec §4.2(2): the run number counts the runs that reached the provider. */}
      {runNumber > 0 && <p>{t("control.task.runNumber", { n: runNumber })}</p>}
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)}<RunReason run={run} ladderSkipped={ladderSkip?.runId === run.runId ? ladderSkip.reason ?? undefined : undefined} /> <EvidenceList runId={run.runId} />
              <RunTranscript runId={run.runId} active={props.active !== false} autoOpen={run.runId === item.currentRunId} />
              {/* Flow engine spec §13.3 (W-COR): a finished run may be corrected as a whole, in one sentence. */}
              {run.phase === "work" && run.outcome === "succeeded" && <CorrectRunButton repoId={view.summary.repoId} runId={run.runId} />}
              {retryRunOpen(view, run) && !archived && (
                <>
                  {/* Issue #57: `r` sends this button's retry for the open task's current run (ControlGroupView); say so here. */}
                  <button type="button" aria-keyshortcuts={run.runId === item.currentRunId ? "r" : undefined}
                    onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: item.taskId, runId: run.runId } })}>
                    {t("control.group.retryTask", { taskId: item.taskId })}
                  </button>
                  {run.runId === item.currentRunId && <span className="kbd-hint">{t("control.task.retryKey")}</span>}
                  <p>{t("control.group.retryKeepsPaths")}</p>
                  <ObservedPathRetry view={view} run={run} onCommand={onCommand} />
                </>
              )}
              {/* Retry is hidden while usage is unknown (runFacts.ts retryRunOpen): show the way forward instead of nothing.
                  A handoff stop with unknown usage ends settled-unrecoverable with no failure (spec 2026-10-14-handoff-stop-unknown-usage-design.md). */}
              {(hasFailureOutcome(run) || run.state === "blocked" || run.state === "settled-unrecoverable") && run.unknownUsageSettlement !== undefined && run.unknownUsageSettlement.settlement === undefined && (
                <UsageSettlement key={JSON.stringify([view.summary.commandRevision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles}
                  archived={archived} groupId={groupId} revision={view.summary.commandRevision} onCommand={onCommand} />
              )}
              {/* Reviewed acceptance (spec 2026-11-11 §7, #227): an owner may land this failed attempt after its checks. */}
              <AcceptAttempt run={run} item={item} roles={props.roles} archived={archived}
                groupId={groupId} revision={view.summary.commandRevision} onCommand={onCommand} />
              {/* Tester follow-up G spec §1.2, §1.4, §10.1: the no-change record and its revoke / accept actions. */}
              <NoChangeRecord run={run} item={item} archived={archived} groupId={groupId} revision={view.summary.commandRevision} onCommand={onCommand} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The task's saved-result verification behind its one gate (runFacts.ts savedResultSourceRunId), wherever it is offered.
 * `active === false` (a hidden pane) renders nothing, so no eligibility read -- a ccloop child per GET -- is made for it.
 */
export function SavedResultEntry(props:{view:GroupViewV1;item:WorkItemViewV1;onCommand:(action:ControlAction)=>void;archived:boolean;active?:boolean}):JSX.Element|null {
  const {view,item}=props;const runId=savedResultSourceRunId(view,item);
  return runId===null||props.active===false?null:<SavedResultAction key={`verify-${item.currentRunId}`} runId={runId} groupId={view.summary.groupId} taskId={item.taskId} revision={view.summary.commandRevision} changeSeq={view.changeSeq} onCommand={props.onCommand} disabled={props.archived||view.summary.stopMode!==null}/>;
}

/** Source availability is read-only; an explicit click submits the frozen tuple under the visible revision. */
export function SavedResultAction(props:{runId:string;groupId:string;taskId:string;revision:number;changeSeq:number;onCommand:(action:ControlAction)=>void;disabled?:boolean}):JSX.Element {
 const {t}=useTranslation();const [answer,setAnswer]=useState<SavedResultEligibilityV1|null>(null);
 useEffect(()=>{let live=true;setAnswer(null);fetchSavedResultEligibility(props.runId).then(value=>{if(live)setAnswer(value);},error=>{if(live)setAnswer({status:"unavailable",reason:controlFailureFrom(error).code});});return()=>{live=false;};},[props.runId,props.changeSeq,props.revision]);
 if(answer===null)return <></>;
 // ccloop error codes spec (2026-10-15) §4.6: a known code is explained beside it; an unknown one (generic text = the code) is not repeated.
 if(answer.status==="unavailable"){const words=explainBesideCode(answer.reason);return <p className="detail-note">{t("control.savedResult.unavailable")} <code>{answer.reason}</code>{words!==null?` ${words}`:""}</p>;}
 const source=answer.recoveryOf;
 return <div><button type="button" disabled={props.disabled} onClick={()=>props.onCommand({verb:"verify-saved-result",groupId:props.groupId,taskId:props.taskId,expectedRevision:props.revision,payload:{sourceRunId:source.sourceRunId,sourceAttempt:source.sourceAttempt,capsuleHash:source.capsuleHash}})}>{t("control.savedResult.verify")}</button><p className="detail-note">{t("control.savedResult.cost")}</p></div>;
}
