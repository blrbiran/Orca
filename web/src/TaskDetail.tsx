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
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, downloadEvidenceArtifact, fetchRunEvidence, type ControlAction } from "./controlApi.js";
import { CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "./controlTypes.js";
import type { EvidenceManifestV1, GroupViewV1, WorkItemProgressV1, WorkItemViewV1 } from "./controlTypes.js";
import { LoopPlanCard } from "./LoopPlanCard.js";
import { RunReason } from "./RunReason.js";
import { isTerminalFailure, retryTaskOpen, taskRunNumber } from "./runFacts.js";
import i18n, { enumText } from "./i18n.js";

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
    : progress.tokens.grant === 0
      ? i18n.t("control.progress.tokensOfZero", { used: progress.tokens.used })
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

export interface TaskDetailProps {
  view: GroupViewV1;
  item: WorkItemViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /** Board spec 2026-10-03 D7: the repository's workspace mode for the loop plan card's git line. */
  workspaceMode?: "worktree" | "clone" | null;
  /** Issue-fixes spec §6.3: an archived group refuses every command but the unarchive, so no editor is offered (read-only). */
  archived?: boolean;
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
    <section aria-label={t("control.task.region", { taskId: item.taskId })}>
      <h4>{t("control.task.region", { taskId: item.taskId })}</h4>
      <p>
        {t("control.task.labelsFrom", { source: labelSourceText(item.labelsProvenance ?? "plan"), version: item.labelsVersion ?? 0 })}
        {draft !== null ? t("control.task.unsavedDraft") : ""}
      </p>
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
      <h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>
      {/* Issue fixes spec §4.2(2): the run number counts the runs that reached the provider. */}
      {runNumber > 0 && <p>{t("control.task.runNumber", { n: runNumber })}</p>}
      {runs.length === 0 ? <p>{t("common.none")}</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)}<RunReason run={run} /> <EvidenceList runId={run.runId} />
              {isTerminalFailure(run) && retryTaskOpen(view) && !archived && (
                <button type="button" onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: item.taskId } })}>
                  {t("control.group.retryTask", { taskId: item.taskId })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
