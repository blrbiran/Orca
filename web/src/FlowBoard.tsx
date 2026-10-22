/**
 * Flow engine spec §14.1 (plan Task 16): the board with flow runs on it. Groups come from the summary as before; flow
 * runs come from GET /api/control/flows (their parents are not summary groups, and their hidden `work` children never
 * are), each one card with a template badge that opens the run page here. A person can start a flow from the board
 * (P6: every action in the Web UI): `flow-start` with a built-in template, a folder and the template's parameters.
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { BoardView, type BoardViewProps } from "./BoardView.js";
import { controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { FlowListV1 } from "./controlTypes.js";
import { FlowRunPage } from "./FlowRunPage.js";
import { Refusal } from "./Refusal.js";

function FlowStart(props: { onStarted: (flowRunId: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const [template, setTemplate] = useState("wechat-article");
  const [dir, setDir] = useState("");
  const [params, setParams] = useState("");
  const [unattended, setUnattended] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const parsed = ((): Record<string, string | number | boolean> | null => {
    const out: Record<string, string | number | boolean> = {};
    for (const line of params.split("\n").filter((l) => l.trim() !== "")) {
      const at = line.indexOf("=");
      if (at < 1) return null;
      const raw = line.slice(at + 1).trim();
      out[line.slice(0, at).trim()] = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw;
    }
    return out;
  })();
  const ready = template.trim() !== "" && dir.trim().startsWith("/") && parsed !== null;
  const start = (): void => {
    void (async () => {
      setRefusal(null);
      const answer = await sendControlCommand("/api/control/flows", { commandId: nextCommandId(), expectedRevision: 0, payload: {
        template: template.trim(), dir: dir.trim(), params: parsed ?? {}, ...(unattended ? { unattended: true } : {}),
      } });
      if (answer.kind === "uncertain") { setRefusal({ status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }); return; }
      if (answer.status >= 400) { setRefusal(refusalFromAnswer(answer)); return; }
      const result = (answer.body as { result?: { kind?: string; flowRunId?: string } }).result;
      if (result?.kind === "flow-started" && typeof result.flowRunId === "string") props.onStarted(result.flowRunId);
    })();
  };
  return (
    <details className="flow-start">
      <summary>{t("flow.start.title")}</summary>
      <form aria-label={t("flow.start.title")} onSubmit={(event) => { event.preventDefault(); if (ready) start(); }}>
        {refusal !== null && <Refusal refusal={refusal} />}
        <label>{t("flow.start.template")}<input type="text" value={template} onChange={(event) => setTemplate(event.currentTarget.value)} /></label>
        <label>{t("flow.start.dir")}<input type="text" value={dir} onChange={(event) => setDir(event.currentTarget.value)} /></label>
        <label>{t("flow.start.params")}<textarea value={params} onChange={(event) => setParams(event.currentTarget.value)} /></label>
        <label><input type="checkbox" checked={unattended} onChange={(event) => setUnattended(event.currentTarget.checked)} />{t("flow.start.unattended")}</label>
        <button type="submit" disabled={!ready}>{t("flow.start.send")}</button>
      </form>
    </details>
  );
}

export function FlowBoard(props: BoardViewProps): JSX.Element {
  const [flows, setFlows] = useState<FlowListV1["runs"]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const read = useCallback(async (): Promise<void> => {
    // No flow runs readable (an older panel, a failed read): the board shows its groups alone.
    try { const list = await controlGet<FlowListV1>("/api/control/flows"); setFlows(Array.isArray(list?.runs) ? list.runs : []); } catch { setFlows([]); }
  }, []);
  // Read again whenever the summary moved (the board's own refresh), and when the person comes back from a run.
  const moved = props.groups.map((group) => `${group.groupId}:${group.state}:${group.commandRevision}`).join(",");
  useEffect(() => { void read(); }, [read, moved, open]);
  if (open !== null) return <FlowRunPage flowRunId={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <BoardView {...props} flows={flows} onOpenFlow={setOpen} />
      <FlowStart onStarted={setOpen} />
    </>
  );
}
