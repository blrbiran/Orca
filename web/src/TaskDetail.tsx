/**
 * Labels and progress spec §4.2: one task, opened from the group's work item table -- its labels and an editor for them,
 * its progress, and every run it had with that run's evidence, piece by piece.
 *
 * The editor keeps what the person chose as a draft (the page's `drafts`, one key per task) together with the
 * labelsVersion the draft started from, and sends that version -- never the one the latest poll read -- so a draft
 * begun before someone else's change is refused as labels-version-conflict instead of overwriting it (final review
 * finding 1). The draft is the person's own data: the page clears it only when the command succeeded (App.tsx, plan
 * finding F11) or when the person discards it, so a refusal -- shown by its code like every other refusal -- leaves it.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, fetchSavedResultEligibility, downloadEvidenceArtifact, fetchRunActivity, fetchRunEvidence, type ControlAction } from "./controlApi.js";
import { CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "./controlTypes.js";
import { CorrectRunButton } from "./CoarseCorrection.js";
import type { SavedResultEligibilityV1, ActivityEntryV1, EvidenceManifestV1, GroupDecisionsViewV1, GroupViewV1, WorkItemProgressV1, WorkItemViewV1 } from "./controlTypes.js";
import { TaskResults } from "./TaskResults.js";
import { RunDecisions } from "./RunDecisions.js";
import { LoopPlanCard } from "./LoopPlanCard.js";
import { RunReason } from "./RunReason.js";
import { explainRunReason } from "./refusalExplain.js";
import { explainBesideCode } from "./ccloopCodes.js";
import { hasFailureOutcome, reasonCode, retryRunOpen, savedResultSourceRunId, taskRunNumber } from "./runFacts.js";
import i18n, { enumText } from "./i18n.js";
import { shortTokens } from "./TokenInput.js";
import { UsageSettlement } from "./UsageSettlement.js";
import { RunTranscript } from "./AgentTranscript.js";
import type { Role } from "./auth.js";

export const labelsDraftKey = (groupId: string, taskId: string): string => `labels:${groupId}:${taskId}`;

/** A system label and a custom one look different (spec §4.2); the class is the whole difference. */
export function LabelChips(props: { labels: string[] | undefined }): JSX.Element {
  const { t } = useTranslation();
  const labels = props.labels ?? [];
  if (labels.length === 0) return <>{t("common.none")}</>;
  return (
    <>
      {labels.map((label) => (
        <span key={label} className={label.startsWith(CUSTOM_LABEL_PREFIX) ? "label label-custom" : "label label-system"}>{label}</span>
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

/** Spec §3.5, as enumText: where the labels came from in words; a source this panel has no words for is shown as sent. */
function labelSourceText(source: string): string {
  const key = `control.task.labelSource.${source}`;
  return i18n.exists(key) ? (i18n.t(key as never) as string) : source;
}

/** A label draft: the labels the person chose and the labelsVersion shown when they started choosing. */
interface LabelsDraft { base: number; labels: string[] }

/** Anything else under the key -- including the earlier bare-array form, which carries no base -- is no draft. */
function readDraft(drafts: Record<string, string>, key: string): LabelsDraft | null {
  const raw = drafts[key];
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { base, labels } = parsed as Record<string, unknown>;
    if (!Number.isSafeInteger(base) || (base as number) < 0) return null;
    if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) return null;
    return { base: base as number, labels };
  } catch {
    return null;
  }
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
  if (entry.kind === "phase" && typeof body.step === "string") {
    const step = enumText("progressStep", CCLOOP_STEP[body.step] ?? body.step);
    return `${kind} · ${typeof body.attempt === "number" ? i18n.t("control.activity.phase", { step, attempt: body.attempt }) : step}`;
  }
  if (entry.kind === "run-blocked" && typeof body.reason === "string") {
    const code = reasonCode(body.reason);
    return `${kind} · ${explainRunReason(code) ?? body.reason}`;
  }
  if (entry.kind === "run-settled" && typeof body.state === "string") return `${kind} · ${enumText("runState", body.state)}`;
  return kind;
}

/**
 * Issue-fixes spec §6.5: the current run's recent activity, read when the detail opens and again whenever the group's
 * projection moves (changeSeq). A refusal is named in place; the rest of the detail does not wait on it. Read-only
 * information, so it stays on an archived group.
 * The caller keys it by run id, so a new run mounts empty (never a frame of the previous run's rows); a projection move
 * (changeSeq) keeps the rows on screen until the fresh answer replaces them.
 */
export function RunActivity(props: { runId: string; changeSeq: number }): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntryV1[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchRunActivity(props.runId).then(
      (answer) => { if (live) { setEntries(answer.entries); setRefusal(null); } },
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
  onCommand: (action: ControlAction) => void;
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
}

export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const { view, item, drafts, onDraft, onCommand } = props;
  const archived = props.archived === true;
  const { t } = useTranslation();
  const groupId = view.summary.groupId;
  const key = labelsDraftKey(groupId, item.taskId);
  const draft = readDraft(drafts, key);
  const current = item.labelsVersion ?? 0;
  const labels = draft?.labels ?? item.labels ?? [];
  const [system, setSystem] = useState<string>(WEB_SYSTEM_LABELS[0]);
  const [custom, setCustom] = useState("");
  // Sorted by code unit like the server (spec §8 R15), so what is sent is what will be shown back.
  // A draft keeps the version it started from through every later edit.
  const setDraft = (next: string[]): void => onDraft(key, JSON.stringify({ base: draft?.base ?? current, labels: [...new Set(next)].sort() }));
  const send = (next: string[] | null, base: number): void => onCommand({
    verb: "set-task-labels", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision,
    payload: { labels: next, baseLabelsVersion: base },
  });
  const addCustom = (): void => {
    const text = custom.trim();
    if (text === "") return;
    setDraft([...labels, text.startsWith(CUSTOM_LABEL_PREFIX) ? text : `${CUSTOM_LABEL_PREFIX}${text}`]);
    setCustom("");
  };
  const runs = view.runs.filter((run) => run.taskId === item.taskId);
  const runNumber = taskRunNumber(view, item.taskId);
  return (
    <section tabIndex={-1} data-task-id={item.taskId} aria-label={t("control.task.region", { taskId: item.taskId })}>
      <h4>{t("control.task.region", { taskId: item.taskId })}</h4>
      <p>
        {t("control.task.labelsFrom", { source: labelSourceText(item.labelsProvenance ?? "plan"), version: item.labelsVersion ?? 0 })}
        {draft !== null ? t("control.task.unsavedDraft") : ""}
      </p>
      <TaskResults view={view} item={item} active={props.resultsActive === true} scope={props.resultsScope ?? ""} />
      {props.decisionsFailed != null && <p data-testid="decisions-read-failed">{t("control.decisions.readFailed", { code: props.decisionsFailed })}</p>}
      {props.decisions?.tasks.find((task) => task.taskId === item.taskId)?.runs.map((run) => (
        <RunDecisions key={run.runId} groupId={groupId} revision={view.summary.commandRevision} run={run} projectKey={props.decisions?.projectKey ?? null}
          onCommand={onCommand} onCorrect={props.onCorrectDecision && ((projectKey, decisionId) => props.onCorrectDecision?.(projectKey, decisionId, { groupId, taskId: item.taskId, runId: run.runId }))} archived={archived} />
      ))}
      {draft !== null && draft.base !== current && (
        <p role="status">
          {t("control.task.labelsChanged", { base: draft.base, current })}<LabelChips labels={item.labels} />
        </p>
      )}
      <ul aria-label={t("control.task.labelsOf", { taskId: item.taskId })}>
        {labels.map((label) => (
          <li key={label}>
            <LabelChips labels={[label]} />{" "}
            {!archived && <button type="button" onClick={() => setDraft(labels.filter((other) => other !== label))}>{t("control.task.remove", { label })}</button>}
          </li>
        ))}
      </ul>
      {!archived && (
        <>
      <select aria-label={t("control.task.systemLabel")} value={system} onChange={(event) => setSystem(event.target.value)}>
        {WEB_SYSTEM_LABELS.map((word) => <option key={word} value={word}>{word}</option>)}
      </select>
      <button type="button" onClick={() => setDraft([...labels, system])}>{t("control.task.addSystem")}</button>
      <input aria-label={t("control.task.customLabel")} value={custom} onChange={(event) => setCustom(event.target.value)} />
      <button type="button" onClick={addCustom}>{t("control.task.addCustom")}</button>
      <button type="button" disabled={draft === null} onClick={() => draft !== null && send(draft.labels, draft.base)}>{t("control.task.save")}</button>
      <button type="button" disabled={draft === null} onClick={() => onDraft(key, "")}>{t("control.task.discard")}</button>
      <button type="button" onClick={() => send(null, current)}>{t("control.task.restore")}</button>
        </>
      )}
      <p>
        {t("control.task.progress", { progress: progressText(item.progress) })}
        {item.progress?.lastTransitionAt ? t("control.task.lastTransition", { at: item.progress.lastTransitionAt }) : ""}
      </p>
      <LoopPlanCard view={view} item={item} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={props.workspaceMode} archived={archived} />
      {item.currentRunId !== null && <RunActivity key={item.currentRunId} runId={item.currentRunId} changeSeq={view.changeSeq} />}
      <SavedResultEntry view={view} item={item} onCommand={onCommand} archived={archived} />
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {/* Issue fixes spec §4.2(2): the run number counts the runs that reached the provider. */}
      {runNumber > 0 && <p>{t("control.task.runNumber", { n: runNumber })}</p>}
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)}<RunReason run={run} /> <EvidenceList runId={run.runId} />
              <RunTranscript runId={run.runId} active={props.active !== false} />
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
                </>
              )}
              {/* Retry is hidden while usage is unknown (runFacts.ts retryRunOpen): show the way forward instead of nothing.
                  A handoff stop with unknown usage ends settled-unrecoverable with no failure (spec 2026-10-14-handoff-stop-unknown-usage-design.md). */}
              {(hasFailureOutcome(run) || run.state === "blocked" || run.state === "settled-unrecoverable") && run.unknownUsageSettlement !== undefined && run.unknownUsageSettlement.settlement === undefined && (
                <UsageSettlement key={JSON.stringify([view.summary.commandRevision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles}
                  archived={archived} groupId={groupId} revision={view.summary.commandRevision} onCommand={onCommand} />
              )}
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
