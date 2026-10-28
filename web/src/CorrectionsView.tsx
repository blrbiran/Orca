/**
 * Debug task plan Task 13 (controller ruling C12): the Corrections tab of the Decisions page. Every recorded correction
 * as GET /api/control/corrections reads it (Task 10), with what a person may do about it: open its debug group (Task 6,
 * expected revision 0), reopen one once the newest is stopped or archived, close it by hand (Task 11, `correction-close`)
 * or withdraw it (the panel route the decision detail already uses, ruling 8). A withdrawn or closed correction offers
 * none of these.
 *
 * Ruling 3: a command whose answer was lost (`uncertain`) is retried under the SAME id, so the ledger replays it rather
 * than doing it twice; a command the ledger answered with a refusal is booked under its id and would replay that refusal
 * forever, so its Retry is a new command with a new id (retryCommandId).
 */
import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchProjects, withdrawCorrection } from "./api.js";
import { CoarseCorrectionForm } from "./CoarseCorrection.js";
import { projectName } from "./project.js";
import { commandEnvelope, controlCommandPath, controlFailureFrom, nextCommandId, readCorrections, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { ControlAction } from "./controlApi.js";
import type { CommandSuccessV1, CorrectionListItemV1, DebugClosingV1 } from "./controlTypes.js";
import type { ControlRefusal } from "./controlState.js";
import i18n, { enumText, refusalDetail } from "./i18n.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { actionsBox, detailHelp, sectionHead, sectionLede } from "./ui/classes.js";

type CorrectionAction = Extract<ControlAction, { verb: "correction-debug-open" | "correction-close" }>;
/** One sent command and what came of it; `uncertain` is a lost answer (sendControlCommand), `refused` a booked one. */
export type CorrectionAttempt = {
  action: CorrectionAction;
  commandId: string;
  outcome: { kind: "pending" } | { kind: "done"; result: CommandSuccessV1["result"] } | { kind: "refused" | "uncertain"; refusal: ControlRefusal };
};

/** Ruling 3: the same id only when the outcome is unknown; after a booked refusal (or anything else) a fresh one. */
export function retryCommandId(attempt: Pick<CorrectionAttempt, "commandId" | "outcome">): string {
  return attempt.outcome.kind === "uncertain" ? attempt.commandId : nextCommandId();
}

/** Send one correction command under `commandId` and say what came of it. Never throws. */
export async function sendCorrectionCommand(action: CorrectionAction, commandId: string): Promise<CorrectionAttempt> {
  const answer = await sendControlCommand(controlCommandPath(action), commandEnvelope(commandId, action));
  if (answer.kind === "uncertain") return { action, commandId, outcome: { kind: "uncertain", refusal: answer.refusal } };
  if (answer.status >= 400) return { action, commandId, outcome: { kind: "refused", refusal: refusalFromAnswer(answer) } };
  return { action, commandId, outcome: { kind: "done", result: (answer.body as CommandSuccessV1).result } };
}

/** The open of one correction's debug group (expected revision 0: the group it creates is new). */
export const debugOpenAction = (correctionId: string, extra: { reopen?: boolean; checks?: string[] } = {}): CorrectionAction => ({
  verb: "correction-debug-open", groupId: "@corrections", expectedRevision: 0, payload: { correctionId, ...extra },
});

/**
 * What one attempt shows: in flight, done, or its refusal with Retry. A refused open that needs checks (Task 7 ruling,
 * `debug-checks-required`) asks for them instead and resends the open with them, under a new id. `hint` is shown under a
 * refusal (the stop-first hint of a refused close).
 */
export function AttemptNotice(props: {
  attempt: CorrectionAttempt;
  onResend: (action: CorrectionAction, commandId: string) => void;
  hint?: (refusal: ControlRefusal) => ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const [checks, setChecks] = useState("");
  const { attempt } = props;
  const outcome = attempt.outcome;
  if (outcome.kind === "pending") return <p data-testid="attempt-pending">{t("corrections.sending")}</p>;
  if (outcome.kind === "done") return <p data-tone="ok" data-testid="attempt-done">{doneText(outcome.result)}</p>;
  const named = checks.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const needsChecks = outcome.kind === "refused" && outcome.refusal.code === "debug-checks-required" && attempt.action.verb === "correction-debug-open";
  return (
    <div data-testid="attempt-failed">
      <RefusalNotice refusal={outcome.refusal} testId="correction-refusal" />
      {outcome.kind === "uncertain" && <p>{t("corrections.uncertain")}</p>}
      {props.hint?.(outcome.refusal)}
      {needsChecks ? (
        <form
          className="checks-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (named.length === 0 || attempt.action.verb !== "correction-debug-open") return;
            props.onResend({ ...attempt.action, payload: { ...attempt.action.payload, checks: named } }, nextCommandId());
          }}
        >
          <label>
            {t("corrections.checksTitle")}
            <textarea name="checks" required value={checks} onChange={(event) => setChecks(event.currentTarget.value)} />
          </label>
          <p className={`detail-help ${detailHelp}`}>{t("corrections.checksHelp")}</p>
          <button type="submit" disabled={named.length === 0}>{t("corrections.openWithChecks")}</button>
        </form>
      ) : (
        <button type="button" data-testid="attempt-retry" onClick={() => props.onResend(attempt.action, retryCommandId(attempt))}>
          {t("corrections.retry")}
        </button>
      )}
    </div>
  );
}

function doneText(result: CommandSuccessV1["result"]): string {
  const t = i18n.t;
  if (result.kind === "debug-group-opened") return result.created ? t("corrections.opened", { groupId: result.groupId }) : t("corrections.alreadyOpen", { groupId: result.groupId });
  if (result.kind === "correction-closed") return result.alreadyClosed ? t("corrections.alreadyClosed", { relPath: result.relPath }) : t("corrections.closedByHand", { relPath: result.relPath });
  return result.kind;
}

/** A debug landing's closing record in words (Task 9), in the current language; shared with the group view. */
export function closingText(closing: DebugClosingV1): string {
  const t = i18n.t;
  switch (closing.state) {
    case "written": return t("corrections.closing.written", { relPath: closing.relPath });
    case "refused": return t("corrections.closing.refused", { reason: closing.reason });
    case "chose-instead-missing": return t("corrections.closing.chose-instead-missing");
    case "closed-by-human-first": return t("corrections.closing.closed-by-human-first", { commit: closing.commit });
  }
}

type CloseForm = { undoHow: string; choseInstead: string; undoCost: string; undoBlastRadius: string };
const EMPTY_CLOSE: CloseForm = { undoHow: "", choseInstead: "", undoCost: "", undoBlastRadius: "" };

/** Ruling 7: the close-by-hand form; an optional box left blank is omitted (the server's schema refuses an empty one). */
function CloseByHand(props: { onClose: (form: CloseForm) => void; onCancel: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [form, setForm] = useState<CloseForm>(EMPTY_CLOSE);
  const box = (name: keyof CloseForm, label: string, required = false): JSX.Element => (
    <label>
      {label}
      <input name={name} type="text" required={required} value={form[name]} onChange={(event) => { const value = event.currentTarget.value; setForm((all) => ({ ...all, [name]: value })); }} />
    </label>
  );
  return (
    <form className="close-form" onSubmit={(event) => { event.preventDefault(); if (form.undoHow.trim() !== "") props.onClose(form); }}>
      {box("undoHow", t("corrections.undoHow"), true)}
      {box("choseInstead", t("corrections.choseInstead"))}
      {box("undoCost", t("corrections.undoCost"))}
      {box("undoBlastRadius", t("corrections.undoBlastRadius"))}
      <button type="submit">{t("corrections.close")}</button>
      <button type="button" onClick={props.onCancel}>{t("corrections.cancel")}</button>
    </form>
  );
}

const optional = (value: string): string | undefined => (value.trim() === "" ? undefined : value);

function CorrectionRow(props: {
  item: CorrectionListItemV1;
  attempt: CorrectionAttempt | null;
  withdrawal: { pending: boolean; refusal: ControlRefusal | null; done: boolean };
  onSend: (action: CorrectionAction, commandId: string) => void;
  onWithdraw: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const { item } = props;
  const { correction } = item;
  const newest = item.debugGroups.at(-1);
  const settled = item.withdrawn !== null || item.closed.state === "closed";
  const busy = props.attempt?.outcome.kind === "pending";
  const liveGroups = item.debugGroups.filter((group) => group.live).map((group) => group.groupId);
  const state = item.withdrawn !== null ? t("corrections.stateWithdrawn", { by: item.withdrawn.by, at: item.withdrawn.at })
    : item.closed.state === "closed" ? t("corrections.stateClosed", { ref: item.closed.ref, via: t(`corrections.via.${item.closed.via}`) })
    : t("corrections.stateOpen");
  return (
    <li
      data-correction-id={correction.id}
      className={item.withdrawn !== null ? "correction-withdrawn line-through" : undefined}
      data-tone={item.withdrawn === null && item.closed.state === "closed" ? "ok" : undefined}
    >
      <p>
        <code>{correction.id}</code> · {enumText("correctionKind", correction.kind)} · {correction.because} · {correction.by} · <time dateTime={correction.at}>{correction.at}</time>
      </p>
      <p>
        {correction.decisionId !== undefined
          ? t("corrections.targetDecision", { id: correction.decisionId })
          : correction.pendingId !== undefined
            ? t("corrections.targetPending", { pendingId: correction.pendingId, runId: correction.runId ?? "" })
            // Flow engine spec §13.1 (W-COR): a bare run, or the repository only.
            : correction.runId !== undefined
              ? t("corrections.targetRun", { runId: correction.runId })
              : t("corrections.targetRepository", { projectKey: correction.projectKey })}
      </p>
      <p className="correction-state" data-testid="correction-state">{state}</p>
      {item.debugGroups.length === 0 ? <p>{t("corrections.noGroup")}</p> : (
        <div>
          <h3>{t("corrections.groupsTitle")}</h3>
          <ul>
            {item.debugGroups.map((group) => (
              <li key={group.groupId} data-group-id={group.groupId}>
                {t("corrections.groupLine", { groupId: group.groupId, state: enumText("groupState", group.state), live: t(group.live ? "corrections.live" : "corrections.stopped") })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.closing !== null && <p data-testid="correction-closing">{closingText(item.closing)}</p>}
      {!settled && !props.withdrawal.done && (
        <div className={`actions ${actionsBox}`}>
          {item.debugGroups.length === 0 && (
            <button type="button" disabled={busy} onClick={() => props.onSend(debugOpenAction(correction.id), nextCommandId())}>{t("corrections.open")}</button>
          )}
          {newest !== undefined && !newest.live && (
            <button type="button" disabled={busy} onClick={() => props.onSend(debugOpenAction(correction.id, { reopen: true }), nextCommandId())}>{t("corrections.reopen")}</button>
          )}
          {!closing && <button type="button" disabled={busy} onClick={() => setClosing(true)}>{t("corrections.close")}</button>}
          <button type="button" disabled={props.withdrawal.pending} onClick={props.onWithdraw}>{t("corrections.withdraw")}</button>
        </div>
      )}
      {closing && !settled && (
        <CloseByHand
          onCancel={() => setClosing(false)}
          onClose={(form) => {
            setClosing(false);
            const choseInstead = optional(form.choseInstead), undoCost = optional(form.undoCost), undoBlastRadius = optional(form.undoBlastRadius);
            props.onSend({
              verb: "correction-close", groupId: "@corrections", expectedRevision: 0,
              payload: {
                correctionId: correction.id, undoHow: form.undoHow,
                ...(choseInstead === undefined ? {} : { choseInstead }),
                ...(undoCost === undefined ? {} : { undoCost }),
                ...(undoBlastRadius === undefined ? {} : { undoBlastRadius }),
              },
            }, nextCommandId());
          }}
        />
      )}
      {props.attempt !== null && (
        <AttemptNotice
          attempt={props.attempt}
          onResend={props.onSend}
          // The live groups as this list last read them; when it read none live (it is older than the server's view), the
          // groups the refusal names.
          hint={(refusal) => refusal.code === "debug-group-active"
            ? <p role="note" data-tone="warn" data-testid="stop-first-hint">{t("corrections.stopFirst", { groups: liveGroups.join(", ") || refusalDetail(refusal) })}</p>
            : null}
        />
      )}
      {props.withdrawal.done && <p data-tone="ok">{t("corrections.withdrawnDone")}</p>}
      {props.withdrawal.refusal !== null && <RefusalNotice refusal={props.withdrawal.refusal} testId="withdraw-refusal" />}
    </li>
  );
}

/** The tab itself: reads the list when shown, and again after each command that succeeded. */
export function CorrectionsView(props: { active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [items, setItems] = useState<CorrectionListItemV1[] | null>(null);
  const [failure, setFailure] = useState<ControlRefusal | null>(null);
  const [attempts, setAttempts] = useState<Record<string, CorrectionAttempt>>({});
  const [withdrawals, setWithdrawals] = useState<Record<string, { pending: boolean; refusal: ControlRefusal | null; done: boolean }>>({});
  const load = async (): Promise<void> => {
    try { setItems((await readCorrections()).corrections); setFailure(null); }
    catch (err) { setFailure(controlFailureFrom(err)); }
  };
  useEffect(() => { if (props.active) void load(); }, [props.active]);
  // Flow engine spec §13.2 (W-COR): "Correct…" -- the repository and one sentence; the projects the control plane holds.
  const [correcting, setCorrecting] = useState(false);
  const [repositories, setRepositories] = useState<Array<{ repoId: string; name: string }> | null>(null);
  const startCorrecting = async (): Promise<void> => {
    setCorrecting(true);
    try {
      const answer = await fetchProjects();
      setRepositories(answer.projects.flatMap((project) => project.controlRepoId === null ? [] : [{ repoId: project.controlRepoId, name: projectName(project) }]));
    } catch (err) { setRepositories([]); setFailure(controlFailureFrom(err)); }
  };
  const send = async (action: CorrectionAction, commandId: string): Promise<void> => {
    const id = action.payload.correctionId;
    setAttempts((all) => ({ ...all, [id]: { action, commandId, outcome: { kind: "pending" } } }));
    const attempt = await sendCorrectionCommand(action, commandId);
    setAttempts((all) => ({ ...all, [id]: attempt }));
    if (attempt.outcome.kind === "done") await load();
  };
  const withdraw = async (correctionId: string): Promise<void> => {
    setWithdrawals((all) => ({ ...all, [correctionId]: { pending: true, refusal: null, done: false } }));
    try {
      const result = await withdrawCorrection(correctionId);
      const refusal = result.ok ? null : { status: result.status, code: result.code, message: result.message, commandRevision: null };
      setWithdrawals((all) => ({ ...all, [correctionId]: { pending: false, refusal, done: result.ok } }));
    } catch (err) {
      setWithdrawals((all) => ({ ...all, [correctionId]: { pending: false, refusal: controlFailureFrom(err), done: false } }));
    }
    await load();
  };
  return (
    <div className="corrections m-0 pl-4.5 [&_li]:wrap-anywhere" data-testid="corrections-view">
      <div className={sectionHead}><h1>{t("corrections.title")}</h1></div>
      <p className={`section-lede ${sectionLede}`}>{t("corrections.lede")}</p>
      {!correcting && <button type="button" onClick={() => { void startCorrecting(); }}>{t("corrections.coarse.correct")}</button>}
      {correcting && repositories !== null && (
        repositories.length === 0 ? <p className="empty">{t("corrections.coarse.noRepository")}</p>
          : <CoarseCorrectionForm repositories={repositories} onRecorded={() => { void load(); }} onCancel={() => setCorrecting(false)} />
      )}
      {failure !== null && <RefusalNotice refusal={failure} testId="corrections-read-refusal" />}
      {items === null ? (failure === null && <p className="empty">{t("corrections.loading")}</p>)
        : items.length === 0 ? <p className="empty">{t("corrections.empty")}</p>
        : (
          <ul className="corrections-list">
            {items.map((item) => (
              <CorrectionRow
                key={item.correction.id}
                item={item}
                attempt={attempts[item.correction.id] ?? null}
                withdrawal={withdrawals[item.correction.id] ?? { pending: false, refusal: null, done: false }}
                onSend={(action, commandId) => { void send(action, commandId); }}
                onWithdraw={() => { void withdraw(item.correction.id); }}
              />
            ))}
          </ul>
        )}
    </div>
  );
}
