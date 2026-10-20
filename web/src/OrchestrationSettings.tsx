/**
 * Kanban spec 2026-10-20 §3.2: the running-group cap (how many confirmed groups run at once; the human asked for it for
 * CPU load and the chance of conflicts). One owner-only command under the `@orchestration` revision, read from
 * GET /api/control/orchestration; a refusal stays on screen, as the spend settings do (UsagePanel.tsx).
 */
import { useCallback, useContext, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { controlFailureFrom, controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { OrchestrationViewV1 } from "./controlTypes.js";
import { Refusal } from "./Refusal.js";

export function OrchestrationSettings(): JSX.Element {
  const { t } = useTranslation();
  const account = useContext(AccountContext);
  const [view, setView] = useState<OrchestrationViewV1 | null>(null);
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);

  const read = useCallback(async (): Promise<void> => {
    try {
      const answer = await controlGet<OrchestrationViewV1>("/api/control/orchestration");
      setView(answer);
      setDraft(String(answer.maxRunningGroups));
      setRefusal(null);
    } catch (err) { setRefusal(controlFailureFrom(err)); }
  }, []);
  useEffect(() => { void read(); }, [read]);

  const value = Number(draft);
  const valid = Number.isSafeInteger(value) && value >= 1 && value <= 64;
  const save = async (): Promise<void> => {
    if (view === null || !valid) return;
    const answer = await sendControlCommand("/api/control/operator/set-orchestration-settings", { commandId: nextCommandId(), expectedRevision: view.revision, payload: { maxRunningGroups: value } });
    const failure = answer.kind === "uncertain" ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
      : answer.status >= 400 ? refusalFromAnswer(answer) : null;
    await read();
    if (failure !== null) setRefusal(failure);
  };

  return (
    <section aria-label={t("settings.orchestration.title")}>
      <h3>{t("settings.orchestration.title")}</h3>
      {refusal !== null && <Refusal refusal={refusal} />}
      {view !== null && <p>{t("settings.orchestration.running", { running: view.runningGroups, cap: view.maxRunningGroups })}</p>}
      <label>
        {t("settings.orchestration.cap")}
        <input type="number" min={1} max={64} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} disabled={view === null || !mayHumanOnly(account)} />
      </label>
      <button type="button" disabled={view === null || !valid || value === view.maxRunningGroups || !mayHumanOnly(account)} onClick={() => void save()}>{t("settings.orchestration.save")}</button>
    </section>
  );
}
