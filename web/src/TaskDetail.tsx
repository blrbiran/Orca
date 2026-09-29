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
import { controlFailureFrom, downloadEvidenceArtifact, fetchRunEvidence, type ControlAction } from "./controlApi.js";
import { CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "./controlTypes.js";
import type { EvidenceManifestV1, GroupViewV1, WorkItemProgressV1, WorkItemViewV1 } from "./controlTypes.js";
import { LoopPlanCard } from "./LoopPlanCard.js";

export const labelsDraftKey = (groupId: string, taskId: string): string => `labels:${groupId}:${taskId}`;

/** A system label and a custom one look different (spec §4.2); the class is the whole difference. */
export function LabelChips(props: { labels: string[] | undefined }): JSX.Element {
  const labels = props.labels ?? [];
  if (labels.length === 0) return <>none</>;
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
 * number is annotated, because ccloop reports usage only when a phase ends (finding F10: the panel speaks English).
 */
export function progressText(progress: WorkItemProgressV1 | null | undefined): string {
  if (progress === undefined || progress === null) return "no run";
  const step = progress.step ?? "not reported yet";
  const attempt = progress.attempt === null ? "attempt unknown" : `attempt ${progress.attempt.current}/${progress.attempt.max}`;
  const tokens = progress.tokens === null
    ? "tokens unknown"
    : progress.tokens.grant === 0
      ? `tokens ${progress.tokens.used} of 0`
      : `tokens ${Math.floor((progress.tokens.used * 100) / progress.tokens.grant)}% (reported at phase end)`;
  return `${step} · ${attempt} · ${tokens}`;
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
      <button type="button" onClick={() => void load()}>List evidence of {props.runId}</button>
      {refusal !== null && <span role="alert">{`evidence refused · ${refusal}`}</span>}
      {manifest !== null && (manifest.entries.length === 0 ? <span> no evidence</span> : (
        <ul aria-label={`Evidence of ${props.runId}`}>
          {manifest.entries.map((entry) => (
            <li key={entry.evidenceId}>
              {entry.evidenceId} · {entry.kind} · {entry.byteLength} bytes{" "}
              <button type="button" onClick={() => void download(entry)}>Download {entry.evidenceId}</button>
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
}

export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const { view, item, drafts, onDraft, onCommand } = props;
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
  return (
    <section aria-label={`Task ${item.taskId}`}>
      <h4>Task {item.taskId}</h4>
      <p>
        labels from {item.labelsProvenance ?? "plan"} · version {item.labelsVersion ?? 0}
        {draft !== null ? " · unsaved draft" : ""}
      </p>
      {draft !== null && draft.base !== current && (
        <p role="status">
          labels changed since your draft (v{draft.base} → v{current}) · now: <LabelChips labels={item.labels} />
        </p>
      )}
      <ul aria-label={`Labels of ${item.taskId}`}>
        {labels.map((label) => (
          <li key={label}>
            <LabelChips labels={[label]} />{" "}
            <button type="button" onClick={() => setDraft(labels.filter((other) => other !== label))}>Remove {label}</button>
          </li>
        ))}
      </ul>
      <select aria-label="System label" value={system} onChange={(event) => setSystem(event.target.value)}>
        {WEB_SYSTEM_LABELS.map((word) => <option key={word} value={word}>{word}</option>)}
      </select>
      <button type="button" onClick={() => setDraft([...labels, system])}>Add system label</button>
      <input aria-label="Custom label" value={custom} onChange={(event) => setCustom(event.target.value)} />
      <button type="button" onClick={addCustom}>Add custom label</button>
      <button type="button" disabled={draft === null} onClick={() => draft !== null && send(draft.labels, draft.base)}>Save labels</button>
      <button type="button" disabled={draft === null} onClick={() => onDraft(key, "")}>Discard draft</button>
      <button type="button" onClick={() => send(null, current)}>Restore plan labels</button>
      <p>
        progress: {progressText(item.progress)}
        {item.progress?.lastTransitionAt ? ` · last transition ${item.progress.lastTransitionAt}` : ""}
      </p>
      <LoopPlanCard view={view} item={item} />
      <h5>Runs of {item.taskId}</h5>
      {runs.length === 0 ? <p>none</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {run.phase} · {run.state} <EvidenceList runId={run.runId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
