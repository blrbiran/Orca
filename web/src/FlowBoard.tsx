/**
 * Flow engine spec §14.1 (plan Task 16): the board with flow runs on it. Groups come from the summary as before; flow
 * runs come from GET /api/control/flows (their parents are not summary groups, and their hidden `work` children never
 * are), each one card with a template badge that opens the run page here. A person can start a flow from the board
 * (P6: every action in the Web UI): `flow-start` with a built-in template, a folder and the template's parameters --
 * from a dialog the board's top-left button opens (plan Task 10-B).
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { BoardView, type BoardViewProps } from "./BoardView.js";
import { controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import type { FlowListV1, FlowSettingsReadV1, FlowTemplateParamV1, FlowTemplatesV1 } from "./controlTypes.js";
import { FolderImagePicker } from "./FolderImagePicker.js";
import { currentLanguage } from "./i18n.js";
import { FlowRunPage } from "./FlowRunPage.js";
import { Refusal } from "./Refusal.js";

type ParamValue = string | number | boolean;
type Template = FlowTemplatesV1["templates"][number];
/** Where a param's value comes from when the start gives none (gaps spec §8.2): a preset, else the template. */
type EffectiveDefault = { value: ParamValue; source: "project" | "global" } | { value: ParamValue | null; source: "template"; derive?: string } | null;

function effectiveDefault(param: FlowTemplateParamV1, presets: Record<string, { value: ParamValue; source: "project" | "global" | "builtin" }> | undefined): EffectiveDefault {
  const preset = presets?.[param.id];
  if (preset !== undefined && preset.source !== "builtin") return { value: preset.value, source: preset.source };
  if (param.derive !== undefined) return { value: null, source: "template", derive: param.derive };
  return param.default === undefined ? null : { value: param.default, source: "template" };
}

/**
 * One field per template param, typed by the param (gaps spec §8.4; the human's request, plan Task 10-B): a checkbox for
 * a bool, a number for an int, a choice for an enum, a text area for long text, a path field (and, for an image, the
 * folder's picker) for a path. A field the person has not touched sends nothing, so the server resolves it exactly as
 * the line under it says: a preset, else the template's default.
 */
function ParamField(props: { param: FlowTemplateParamV1; value: ParamValue | undefined; fallback: EffectiveDefault; dir: string; template: string; onChange: (value: ParamValue | undefined) => void }): JSX.Element {
  const { t } = useTranslation();
  const { param, fallback } = props;
  const label = param.required ? t("flow.start.required", { param: param.id }) : param.id;
  const text = typeof props.value === "string" ? props.value : props.value === undefined ? "" : String(props.value);
  const set = (raw: string): void => props.onChange(raw === "" ? undefined : raw);
  const field = ((): JSX.Element => {
    switch (param.type) {
      case "bool": {
        const checked = props.value === undefined ? fallback?.value === true : props.value === true;
        return <label><input type="checkbox" checked={checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />{label}</label>;
      }
      case "enum":
        return <label>{label}<select value={text} onChange={(event) => set(event.currentTarget.value)}>
          <option value="">{t("flow.start.useDefault")}</option>
          {(param.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select></label>;
      case "longtext": return <label>{label}<textarea value={text} onChange={(event) => set(event.currentTarget.value)} /></label>;
      case "int": return <label>{label}<input type="number" value={text} onChange={(event) => set(event.currentTarget.value)} /></label>;
      case "image": case "path":
        return <label>{t("flow.start.path", { param: label })}<input type="text" value={text} onChange={(event) => set(event.currentTarget.value)} /></label>;
      default: return <label>{label}<input type="text" value={text} onChange={(event) => set(event.currentTarget.value)} /></label>;
    }
  })();
  const derived = fallback?.source === "template" && fallback.value === null ? fallback.derive : undefined;
  const shown = fallback === null ? null : fallback.value !== null ? String(fallback.value)
    : derived === "slug-of-idea" ? t("flow.start.derive.slug-of-idea") : derived === "today" ? t("flow.start.derive.today") : null;
  return (
    <div className="check-field" data-testid={`flow-start-param-${param.id}`}>
      {field}
      {param.type === "image" && <FolderImagePicker dir={props.dir} template={props.template} paramId={param.id} value={text} onPick={set} />}
      {fallback !== null && shown !== null && <p className="detail-note" data-testid="flow-start-default">{t("flow.start.default", { value: shown, source: t(`flow.start.source.${fallback.source}`) })}</p>}
    </div>
  );
}

/** A touched param as the start sends it; null when its text is not a value of its type (an int that is not one). */
function typed(param: FlowTemplateParamV1, value: ParamValue): ParamValue | null {
  if (param.type === "bool") return value === true;
  if (param.type === "int") return /^-?\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(String(value).trim())) ? Number(String(value).trim()) : null;
  const raw = String(value);
  if (raw.trim() === "") return null;
  return param.type === "longtext" ? raw : raw.trim();
}

/**
 * The human's request (plan Task 10-B: "放到左上角，作为一个按钮，点开后弹框填写"): the start form is a dialog opened from
 * the board's top-left button. A built-in template is chosen, not typed; its params are one field each; the folder is
 * absolute. Start sends `flow-start` and, on success, opens the new run; a refusal stays in the dialog. Cancel and Escape
 * close it and send nothing.
 */
function FlowStartDialog(props: { onStarted: (flowRunId: string) => void; onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<Template[] | null | "failed">(null);
  const [presets, setPresets] = useState<FlowSettingsReadV1["paramDefaults"]>({});
  const [templateId, setTemplateId] = useState("");
  const [dir, setDir] = useState("");
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [unattended, setUnattended] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [sending, setSending] = useState(false);
  const { onClose } = props;
  useEffect(() => {
    void (async () => {
      try {
        const answer = await controlGet<FlowTemplatesV1>("/api/control/flows/templates");
        if (!Array.isArray(answer?.templates)) throw new TypeError("flow-templates-shape");
        setTemplates(answer.templates);
        setTemplateId((current) => current !== "" ? current : answer.templates[0]?.id ?? "");
      } catch { setTemplates("failed"); }
    })();
    // A start names no project, so its presets are the global layer's (kernel.ts startFlowRun, flowLayers(store, null)).
    void (async () => {
      try { const read = await controlGet<FlowSettingsReadV1>("/api/control/flows/settings"); setPresets(typeof read?.paramDefaults === "object" && read.paramDefaults !== null ? read.paramDefaults : {}); }
      catch { setPresets({}); }
    })();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const template = Array.isArray(templates) ? templates.find((entry) => entry.id === templateId) ?? null : null;
  const params: Record<string, ParamValue> = {};
  let paramsOk = true;
  for (const param of template?.params ?? []) {
    const value = values[param.id];
    if (value === undefined) {
      if (param.required && effectiveDefault(param, presets[template!.id]) === null) paramsOk = false;
      continue;
    }
    const sent = typed(param, value);
    if (sent === null) { paramsOk = false; continue; }
    params[param.id] = sent;
  }
  const ready = template !== null && dir.trim().startsWith("/") && paramsOk && !sending;
  const start = (): void => {
    void (async () => {
      setRefusal(null); setSending(true);
      try {
        const answer = await sendControlCommand("/api/control/flows", { commandId: nextCommandId(), expectedRevision: 0, payload: {
          template: template!.id, dir: dir.trim(), params, ...(unattended ? { unattended: true } : {}),
        } });
        if (answer.kind === "uncertain") { setRefusal({ status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }); return; }
        if (answer.status >= 400) { setRefusal(refusalFromAnswer(answer)); return; }
        const result = (answer.body as { result?: { kind?: string; flowRunId?: string } }).result;
        if (result?.kind === "flow-started" && typeof result.flowRunId === "string") props.onStarted(result.flowRunId);
      } finally { setSending(false); }
    })();
  };
  const title = (entry: Template): string => entry.title?.[currentLanguage()] ?? entry.title?.en ?? entry.id;
  return (
    <div role="dialog" aria-label={t("flow.start.title")} className="flow-start-dialog">
      <form aria-label={t("flow.start.title")} onSubmit={(event) => { event.preventDefault(); if (ready) start(); }}>
        <h3>{t("flow.start.title")}</h3>
        {refusal !== null && <Refusal refusal={refusal} />}
        {templates === null && <p role="status">{t("flow.start.templatesReading")}</p>}
        {templates === "failed" && <p role="status">{t("flow.start.templatesFailed")}</p>}
        {Array.isArray(templates) && (
          <label>{t("flow.start.template")}
            <select autoFocus value={templateId} onChange={(event) => { setTemplateId(event.currentTarget.value); setValues({}); }}>
              {templates.map((entry) => <option key={entry.id} value={entry.id}>{title(entry)}</option>)}
            </select>
          </label>
        )}
        <label>{t("flow.start.dir")}<input type="text" value={dir} onChange={(event) => setDir(event.currentTarget.value)} /></label>
        {template !== null && template.params.length > 0 && (
          <fieldset>
            <legend>{t("flow.start.params")}</legend>
            {template.params.map((param) => (
              <ParamField key={`${template.id}.${param.id}`} param={param} value={values[param.id]} fallback={effectiveDefault(param, presets[template.id])} dir={dir} template={template.id}
                onChange={(value) => setValues((current) => { const next = { ...current }; if (value === undefined) delete next[param.id]; else next[param.id] = value; return next; })} />
            ))}
          </fieldset>
        )}
        <label><input type="checkbox" checked={unattended} onChange={(event) => setUnattended(event.currentTarget.checked)} />{t("flow.start.unattended")}</label>
        <button type="submit" className="btn-primary" disabled={!ready}>{t("flow.start.send")}</button>{" "}
        <button type="button" onClick={props.onClose}>{t("flow.start.cancel")}</button>
      </form>
    </div>
  );
}

export function FlowBoard(props: BoardViewProps): JSX.Element {
  const [flows, setFlows] = useState<FlowListV1["runs"]>([]);
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const read = useCallback(async (): Promise<void> => {
    // No flow runs readable (an older panel, a failed read): the board shows its groups alone.
    try { const list = await controlGet<FlowListV1>("/api/control/flows"); setFlows(Array.isArray(list?.runs) ? list.runs : []); } catch { setFlows([]); }
  }, []);
  // Read again whenever the summary moved (the board's own refresh), and when the person comes back from a run.
  const moved = props.groups.map((group) => `${group.groupId}:${group.state}:${group.commandRevision}`).join(",");
  useEffect(() => { void read(); }, [read, moved, open]);
  const closeStart = useCallback(() => setStarting(false), []);
  if (open !== null) return <FlowRunPage flowRunId={open} onBack={() => setOpen(null)} />;
  // The human's request: the start is a top-left button on the board that opens the start dialog. While the dialog is
  // open its Start is the view's one primary button (web/DESIGN.md).
  const toolbar = (
    <>
      <button type="button" className={starting ? undefined : "btn-primary"} aria-haspopup="dialog" aria-expanded={starting} onClick={() => setStarting(true)}>{t("flow.start.title")}</button>
      {starting && <FlowStartDialog onStarted={(flowRunId) => { setStarting(false); setOpen(flowRunId); }} onClose={closeStart} />}
    </>
  );
  return <BoardView {...props} flows={flows} onOpenFlow={setOpen} toolbar={toolbar} />;
}
