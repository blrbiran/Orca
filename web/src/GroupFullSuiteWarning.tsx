import { useContext, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { checksCommandPath, checksReadPath, controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { ChecksReadV1, GroupAcceptanceV1 } from "./controlTypes.js";
import type { PanelRefusal } from "./api.js";
import { Refusal } from "./Refusal.js";

/**
 * Adopt is the settings page's: it sets the project's integration-check command (`set-check-settings`, human-only), under
 * the revision read just before. Shared by the Problems warning and the confirm view (tester follow-up K, item 2).
 */
function AdoptSuggestion(props: { repoId: string; suggestion: string | null; archived: boolean }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const [state, setState] = useState<"idle" | "sending" | "adopted">("idle");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const { suggestion } = props;
  const adopt = (): void => {
    if (suggestion === null) return;
    setState("sending"); setRefusal(null);
    void (async () => {
      const scope = { repoId: props.repoId };
      try {
        const read = await controlGet<ChecksReadV1>(checksReadPath(scope));
        const answer = await sendControlCommand(checksCommandPath(scope, "set-check-settings"), {
          commandId: nextCommandId(), expectedRevision: read.revision, payload: { kind: "integration-check", set: { command: suggestion }, clear: [] },
        });
        if (answer.kind === "uncertain") { setRefusal({ status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }); setState("idle"); return; }
        if (answer.status >= 400) { setRefusal(refusalFromAnswer(answer)); setState("idle"); return; }
        setState("adopted");
      } catch {
        setRefusal({ status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }); setState("idle");
      }
    })();
  };
  return <>
    {suggestion !== null && <p>{t("control.groupAcceptance.suiteSuggested", { command: suggestion })}</p>}
    {refusal !== null && <Refusal refusal={refusal} />}
    {state === "adopted" ? <p role="status">{t("control.groupAcceptance.adopted")}</p>
      : suggestion !== null && may && !props.archived && (
        <button type="button" disabled={state === "sending"} onClick={adopt}>{t("control.groupAcceptance.adopt", { command: suggestion })}</button>
      )}
  </>;
}

/**
 * Full suite spec 2026-11-12 §3, §5 (#279): the Problems warnings of a group's acceptance about the project's full suite --
 * none was set (with the suggestion Orca detected, which runs only once a person adopts it: 「人采纳才用」), or it was
 * flaky (red once, green on the retry). Neither blocks the group. Tester follow-up K, item 2: a record written before the
 * full suite existed (no `fullSuite`) warns as none set, with no suggestion of its own.
 */
export function GroupFullSuiteWarning(props: { repoId: string; acceptance: GroupAcceptanceV1 | undefined; archived: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const suite = props.acceptance?.fullSuite;
  const warning = props.acceptance?.warning;
  if (warning === undefined || (suite === undefined && warning !== "full-suite-not-set")) return null;
  if (suite !== undefined && suite.command !== null) {
    return <div data-problem-full-suite="flaky"><p data-tone="warn"><code>{warning}</code> {t("control.groupAcceptance.suiteFlaky", { command: suite.command })}</p></div>;
  }
  return (
    <div data-problem-full-suite="not-set">
      <p data-tone="warn"><code>{warning}</code> {t("control.groupAcceptance.suiteNotSet")}</p>
      <AdoptSuggestion repoId={props.repoId} suggestion={suite?.suggestion ?? null} archived={props.archived} />
    </div>
  );
}

/**
 * Tester follow-up K, item 2 (human ruling ①: no suite is run that a person did not set): at confirm, while the project has
 * no full-suite command but Orca detected one, the confirm view says what acceptance will run and offers the same Adopt.
 * Nothing shows while the read is pending, when it fails, or when there is nothing to suggest.
 */
export function ConfirmFullSuiteNote(props: { repoId: string }): JSX.Element | null {
  const { t } = useTranslation();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void controlGet<ChecksReadV1>(checksReadPath({ repoId: props.repoId }))
      .then((read) => { if (live) setSuggestion(typeof read?.suggestedCommand === "string" ? read.suggestedCommand : null); })
      .catch(() => { /* no note: confirm does not depend on it */ });
    return () => { live = false; };
  }, [props.repoId]);
  if (suggestion === null) return null;
  return (
    <div role="note" data-testid="confirm-full-suite">
      <p>{t("control.groupAcceptance.confirmSuiteNotSet")}</p>
      <AdoptSuggestion repoId={props.repoId} suggestion={suggestion} archived={false} />
    </div>
  );
}
