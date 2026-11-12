import { useContext, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { checksCommandPath, checksReadPath, controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { ChecksReadV1, GroupAcceptanceV1 } from "./controlTypes.js";
import type { PanelRefusal } from "./api.js";
import { Refusal } from "./Refusal.js";

/**
 * Full suite spec 2026-11-12 §3, §5 (#279): the Problems warnings of a group's acceptance about the project's full suite --
 * none was set (with the suggestion Orca detected, which runs only once a person adopts it: 「人采纳才用」), or it was
 * flaky (red once, green on the retry). Neither blocks the group. Adopt is the settings page's: it sets the project's
 * integration-check command (`set-check-settings`, human-only), under the revision read just before.
 */
export function GroupFullSuiteWarning(props: { repoId: string; acceptance: GroupAcceptanceV1 | undefined; archived: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const [state, setState] = useState<"idle" | "sending" | "adopted">("idle");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const suite = props.acceptance?.fullSuite;
  const warning = props.acceptance?.warning;
  if (suite === undefined || warning === undefined) return null;
  if (suite.command !== null) {
    return <div data-problem-full-suite="flaky"><p data-tone="warn"><code>{warning}</code> {t("control.groupAcceptance.suiteFlaky", { command: suite.command })}</p></div>;
  }
  const suggestion = suite.suggestion;
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
  return (
    <div data-problem-full-suite="not-set">
      <p data-tone="warn"><code>{warning}</code> {t("control.groupAcceptance.suiteNotSet")}</p>
      {suggestion !== null && <p>{t("control.groupAcceptance.suiteSuggested", { command: suggestion })}</p>}
      {refusal !== null && <Refusal refusal={refusal} />}
      {state === "adopted" ? <p role="status">{t("control.groupAcceptance.adopted")}</p>
        : suggestion !== null && may && !props.archived && (
          <button type="button" disabled={state === "sending"} onClick={adopt}>{t("control.groupAcceptance.adopt", { command: suggestion })}</button>
        )}
    </div>
  );
}
