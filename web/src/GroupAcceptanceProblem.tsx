import { useRegionDraft } from "./regionDraft.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupAcceptanceV1 } from "./controlTypes.js";

/** The server's bound on the note (webProtocol.ts waiveAcceptancePayloadSchema). */
const NOTE_MAX = 2048;

/**
 * Tester follow-up E §5 (#241): the Problems row of a group whose acceptance failed on its final tip -- its code, what
 * failed, the output tail; Recheck for anyone (a flaky check runs again on the same tip), Waive for an owner (accepts the
 * failed tip, with a note saying why). The server refuses both by name for an acceptance that has not failed.
 */
export function GroupAcceptanceProblem(props: { groupId: string; acceptance: GroupAcceptanceV1 | undefined; roles?: readonly Role[]; archived: boolean; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  // Ruling R1 (#219): an unsent waiver note outlives a region switch (regionDraft.ts).
  const [open, setOpen] = useRegionDraft(`waive-open:${props.groupId}`, () => false);
  const [note, setNote] = useRegionDraft(`waive-note:${props.groupId}`, () => "");
  const acceptance = props.acceptance;
  // Tester #278: a work branch that no longer exists is recorded, not retried; a new landing checks it again.
  if (acceptance?.result === "not-run" && acceptance.why === "work-branch-missing") {
    return <p role="note" data-acceptance-branch-missing={props.groupId}>{t("control.groupAcceptance.branchMissing", { branch: `orca/${props.groupId}` })}</p>;
  }
  if (acceptance === undefined || acceptance.result !== "failed") return null;
  const last = acceptance.commands.at(-1);
  const failingComparison = acceptance.identityComparisons?.find((comparison) => comparison.reason !== undefined)
    ?? acceptance.identityComparisons?.find((comparison) => comparison.tipAttempts.some((attempt) => attempt.exit !== "0"));
  const redAttempt = failingComparison?.tipAttempts.filter((attempt) => attempt.exit !== "0").at(-1);
  const failedCommand = failingComparison?.command ?? last?.command ?? "?";
  const failedExit = redAttempt?.exit ?? last?.exit ?? "?";
  const shortfall = acceptance.evidence?.shortfall;
  const diagnostics: string[] = [];
  for (const comparison of acceptance.identityComparisons ?? []) {
    if (comparison.reason !== undefined) diagnostics.push(t(`control.groupAcceptance.diagnostics.reason.${comparison.reason}` as const, { command: comparison.command }));
    if (comparison.tipAttempts.length > 1) {
      const red = comparison.tipAttempts.filter((attempt) => attempt.exit !== "0");
      const details = red.map((attempt) => attempt.reportedFailures === undefined || attempt.reportedFailures === null
        ? t("control.groupAcceptance.diagnostics.retryUnparsed")
        : t("control.groupAcceptance.diagnostics.retryFailure", { failures: attempt.reportedFailures, blocks: attempt.blockCount ?? 0 }));
      diagnostics.push(t("control.groupAcceptance.diagnostics.retry", { command: comparison.command,
        exits: comparison.tipAttempts.map((attempt) => attempt.exit).join(", "), details: details.join("; ") }));
    }
  }
  const count = acceptance.evidence?.baselineCount ?? acceptance.fullSuite?.baselineCount;
  if (count?.state === "unavailable") diagnostics.push(t("control.groupAcceptance.diagnostics.countUnavailable"));
  else if (count?.state === "counted" && count.tests !== null) {
    const tipTests = acceptance.evidence?.tests ?? acceptance.fullSuite?.tests;
    if (tipTests !== undefined && tipTests !== null) diagnostics.push(t("control.groupAcceptance.diagnostics.counts", { tip: tipTests, base: count.tests }));
  }
  if (shortfall !== undefined) {
    diagnostics.push(t("control.groupAcceptance.diagnostics.shortfall", { tip: shortfall.tests, base: shortfall.baselineTests }));
    diagnostics.push(t("control.groupAcceptance.diagnostics.waiverBlocked"));
  }
  const sendable = note.trim() !== "" && note.length <= NOTE_MAX;
  const send = (): void => {
    if (!sendable) return;
    props.onCommand({ verb: "waive-acceptance", groupId: props.groupId, expectedRevision: props.revision, payload: { note } });
    setOpen(false); setNote("");
  };
  return (
    <div data-problem-acceptance={props.groupId}>
      <p data-tone="danger"><code>{acceptance.problem ?? ""}</code></p>
      <p>{t("control.groupAcceptance.failed", { command: failedCommand, exit: failedExit, tip: (acceptance.tip ?? "").slice(0, 12) })}</p>
      {diagnostics.length > 0 && <ul data-testid="group-acceptance-diagnostics">{diagnostics.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      {acceptance.tail !== undefined && <pre className="whitespace-pre-wrap">{acceptance.tail}</pre>}
      {!props.archived && (
        <>
          <button type="button" onClick={() => props.onCommand({ verb: "recheck-acceptance", groupId: props.groupId, expectedRevision: props.revision, payload: {} })}>
            {t("control.groupAcceptance.recheck")}
          </button>
          {props.roles?.includes("owner") === true && shortfall === undefined && (!open ? <button type="button" onClick={() => setOpen(true)}>{t("control.groupAcceptance.waive")}</button> : (
            <div role="group" aria-label={t("control.groupAcceptance.waive")}>
              <p>{t("control.groupAcceptance.waiveExplain")}</p>
              <label>
                {t("control.groupAcceptance.note")}
                <textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button type="button" disabled={!sendable} onClick={send}>{t("control.groupAcceptance.send")}</button>
              <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setNote(""); }}>{t("control.groupAcceptance.cancel")}</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
