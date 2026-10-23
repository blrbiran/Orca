/**
 * Flow engine spec §9.3, §11.2 (plan Task 16): the flow settings of one project or of the global layer, exactly as the
 * server read them (GET /api/control/flows/settings[?repoId=]) -- each field with the layer it came from (project >
 * global > built-in) and "locked" when a global lock binds it; a project value a lock ignores is shown struck through,
 * "overridden by lock". A person who may (human-only verbs) overrides a field in this scope's layer or resets it to the
 * next one, and (global scope) sets the locks: a lock lets a project only tighten. Every write is sent under the
 * revision of the layer it writes (the repository settings' or `@orchestration`'s), read now, and read back.
 *
 * `irreversible: apply-flag` is not offered: phase 1 refuses it from every channel (it needs the person token, §11.2).
 */
import { useCallback, useContext, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { controlGet, nextCommandId, refusalFromAnswer, sendControlCommand } from "./controlApi.js";
import { WEB_FLOW_EFFECT_CLASSES, WEB_FLOW_LOCKABLE_PATHS } from "./controlTypes.js";
import type { FlowEffectClassV1, FlowLevelSettingV1, FlowLockablePathV1, FlowSettingsReadV1, FlowSourcedV1, FlowTemplateParamV1, FlowTemplatesV1 } from "./controlTypes.js";
import { Refusal } from "./Refusal.js";

export type FlowSettingsScope = "global" | { repoId: string };
type Layer = "project" | "global";
type Send = (path: "settings" | "locks", payload: unknown) => void;
const LEVELS: readonly FlowLevelSettingV1[] = ["apply-flag", "confirm", "stage-only", "follow-template"];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const segment = (value: string): string => encodeURIComponent(value);

function Badges(props: { sourced: FlowSourcedV1<unknown> }): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <span className="badge" data-testid="flow-setting-source">{t(`settings.flows.source.${props.sourced.source}`)}</span>
      {props.sourced.lockedBy !== null && <> <span className="badge" data-tone="warn" data-testid="flow-setting-locked">{t("settings.flows.locked")}</span></>}
    </>
  );
}

/** One field: its value and source, and (for a person who may) its editor, Save / Override and Reset to inherited. */
function Field<T>(props: {
  name: string; label: string; sourced: FlowSourcedV1<T>; layer: Layer; may: boolean; send: Send;
  show: (value: T) => string; edit: (draft: T, set: (next: T) => void) => JSX.Element;
  set: (value: T) => Record<string, unknown>; parse?: (draft: T) => T | null;
}): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<T>(props.sourced.value);
  const ours = props.sourced.source === props.layer;
  const ignored = props.sourced.overriddenByLock;
  const parsed = props.parse === undefined ? draft : props.parse(draft);
  return (
    <div className="check-field" data-testid={`flow-setting-${props.name}`}>
      <span>{props.label}: {props.show(props.sourced.value)}</span> <Badges sourced={props.sourced} />
      {ignored !== undefined && <> <s data-testid="flow-setting-overridden">{props.show(ignored)}</s> {t("settings.flows.overriddenByLock")}</>}
      {props.may && (
        <div>
          {props.edit(draft, setDraft)}
          <button type="button" disabled={parsed === null || (ours && same(parsed, props.sourced.value))}
            onClick={() => { if (parsed !== null) props.send("settings", { set: props.set(parsed), clear: [] }); }}>
            {t(ours ? "settings.flows.save" : "settings.flows.override")}
          </button>
          {(ours || ignored !== undefined) && <button type="button" onClick={() => props.send("settings", { set: {}, clear: [props.name] })}>{t("settings.flows.reset")}</button>}
        </div>
      )}
    </div>
  );
}

type Preset = string | number | boolean;
/** A preset's draft as the editor holds it: text for every type but bool (a choice) -- parsed on Save. */
function presetParse(param: FlowTemplateParamV1 | null, draft: string): Preset | null {
  if (param?.type === "bool") return draft === "true" ? true : draft === "false" ? false : null;
  if (param?.type === "int") return /^-?\d+$/.test(draft.trim()) && Number.isSafeInteger(Number(draft.trim())) ? Number(draft.trim()) : null;
  return draft.trim() === "" ? null : draft.trim();
}

/**
 * Gaps spec §8.2, §8.4: one preset `paramDefaults.<template>.<param>` -- its value and layer (presets are never locked;
 * the lock badge shows if a read ever says otherwise), an editor typed by the param (a path field for an `image`), and
 * "Clear this preset", which removes this one entry from this layer only (the server's per-entry clear, Task 9).
 */
function PresetField(props: { template: string; paramId: string; param: FlowTemplateParamV1 | null; sourced: FlowSourcedV1<Preset> | undefined; layer: Layer; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const name = `paramDefaults.${props.template}.${props.paramId}`;
  const [draft, setDraft] = useState(props.sourced === undefined ? (props.param?.type === "bool" ? "true" : "") : String(props.sourced.value));
  const parsed = presetParse(props.param, draft);
  const ours = props.sourced?.source === props.layer;
  const label = t("settings.flows.preset.field", { template: props.template, param: props.paramId });
  const type = props.param?.type;
  return (
    <div className="check-field" data-testid={`flow-setting-${name}`}>
      <span>{label}: {props.sourced === undefined ? t("settings.flows.preset.none") : String(props.sourced.value)}</span>
      {props.sourced !== undefined && <> <Badges sourced={props.sourced} /></>}
      {props.may && (
        <div>
          {type === "bool" || type === "enum" ? (
            <select aria-label={label} value={draft} onChange={(event) => setDraft(event.currentTarget.value)}>
              {(type === "bool" ? ["true", "false"] : props.param!.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : <input type={type === "int" ? "number" : "text"} aria-label={label} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />}
          {type === "image" && <p className="detail-note">{t("settings.flows.preset.imageHint")}</p>}
          <button type="button" disabled={parsed === null || (ours && parsed === props.sourced?.value)}
            onClick={() => { if (parsed !== null) props.send("settings", { set: { paramDefaults: { [props.template]: { [props.paramId]: parsed } } }, clear: [] }); }}>
            {t(ours ? "settings.flows.save" : "settings.flows.override")}
          </button>
          {ours && <button type="button" onClick={() => props.send("settings", { set: {}, clear: [name] })}>{t("settings.flows.preset.clear")}</button>}
        </div>
      )}
    </div>
  );
}

/** Every preset to show: each built-in template's params, then any preset the read names that no listed param has. */
function presetRows(templates: FlowTemplatesV1["templates"], read: FlowSettingsReadV1["paramDefaults"]): Array<{ template: string; paramId: string; param: FlowTemplateParamV1 | null }> {
  const rows: Array<{ template: string; paramId: string; param: FlowTemplateParamV1 | null }> = templates.flatMap((template) => template.params.map((param) => ({ template: template.id, paramId: param.id, param })));
  for (const [template, values] of Object.entries(read)) for (const paramId of Object.keys(values)) {
    if (!rows.some((row) => row.template === template && row.paramId === paramId)) rows.push({ template, paramId, param: null });
  }
  return rows;
}

function Locks(props: { locks: FlowLockablePathV1[]; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const initial = WEB_FLOW_LOCKABLE_PATHS.filter((path) => props.locks.includes(path));
  const [draft, setDraft] = useState<FlowLockablePathV1[]>(initial);
  return (
    <section aria-label={t("settings.flows.locks.title")}>
      <h4>{t("settings.flows.locks.title")}</h4>
      <p>{t("settings.flows.locks.explain")}</p>
      {WEB_FLOW_LOCKABLE_PATHS.map((path) => (
        <label key={path}>
          <input type="checkbox" checked={draft.includes(path)}
            onChange={(event) => { const on = event.currentTarget.checked; setDraft(WEB_FLOW_LOCKABLE_PATHS.filter((other) => (other === path ? on : draft.includes(other)))); }} />
          {path}
        </label>
      ))}
      <button type="button" disabled={same(draft, initial)} onClick={() => props.send("locks", { locks: draft })}>{t("settings.flows.locks.save")}</button>
    </section>
  );
}

export function FlowSettings(props: { scope: FlowSettingsScope; /** Gaps spec §11: a project's name, for the region label. */ projectName?: string }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const scope = props.scope;
  const readPath = scope === "global" ? "/api/control/flows/settings" : `/api/control/flows/settings?repoId=${segment(scope.repoId)}`;
  const [view, setView] = useState<FlowSettingsReadV1 | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [unread, setUnread] = useState(false);
  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await controlGet<FlowSettingsReadV1>(readPath);
      // An answer that is not a flow settings read (an older panel) is "not read", never half-rendered.
      if (typeof next?.effects !== "object" || next.effects === null || typeof next.budgets !== "object") throw new TypeError("flow-settings-shape");
      setView(next); setUnread(false);
    } catch { setUnread(true); }
  }, [readPath]);
  useEffect(() => { void read(); }, [read]);
  // Gaps spec §8.4: the built-in templates' params, for the presets; none listed (an older panel) leaves only the read's.
  const [templates, setTemplates] = useState<FlowTemplatesV1["templates"]>([]);
  useEffect(() => {
    void (async () => {
      try { const answer = await controlGet<FlowTemplatesV1>("/api/control/flows/templates"); setTemplates(Array.isArray(answer?.templates) ? answer.templates : []); }
      catch { setTemplates([]); }
    })();
  }, []);

  const send: Send = (leaf, payload) => {
    void (async () => {
      setRefusal(null);
      let failure: PanelRefusal | null;
      try {
        // The layer's own revision, read now (the CLI's readRevision does the same).
        const revision = scope === "global" || leaf === "locks"
          ? (await controlGet<{ revision: number }>("/api/control/orchestration")).revision
          : (await controlGet<{ revision: number }>(`/api/control/repositories/${segment(scope.repoId)}/workspace`)).revision;
        const path = scope === "global" || leaf === "locks" ? `/api/control/operator/flows/${leaf}` : `/api/control/repositories/${segment(scope.repoId)}/flows/settings`;
        const answer = await sendControlCommand(path, { commandId: nextCommandId(), expectedRevision: revision, payload });
        failure = answer.kind === "uncertain" ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
          : answer.status >= 400 ? refusalFromAnswer(answer) : null;
      } catch {
        failure = { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") };
      }
      await read();
      if (failure !== null) setRefusal(failure);
    })();
  };
  const layer: Layer = scope === "global" ? "global" : "project";
  const levelText = (value: FlowLevelSettingV1): string => t(`settings.flows.level.${value}`);
  const levelEdit = (cls: FlowEffectClassV1) => (draft: FlowLevelSettingV1, set: (next: FlowLevelSettingV1) => void): JSX.Element => (
    <select aria-label={t("settings.flows.effectLabel", { cls })} value={draft} onChange={(event) => set(event.currentTarget.value as FlowLevelSettingV1)}>
      {LEVELS.filter((level) => !(cls === "irreversible" && level === "apply-flag")).map((level) => <option key={level} value={level}>{levelText(level)}</option>)}
    </select>
  );
  const lines = (value: string[] | null): string => (value ?? []).join("\n");
  return (
    <section aria-label={props.projectName === undefined ? t("settings.flows.region") : t("settings.flows.regionFor", { project: props.projectName })}>
      <h3>{t("settings.flows.region")}</h3>
      <p>{t("settings.flows.explain")}</p>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unread && <p data-testid="flow-settings-unread">{t("settings.flows.unread")}</p>}
      {!may && <p role="note">{t("settings.flows.ownerOnly")}</p>}
      {view !== null && (
        <div key={JSON.stringify(view)}>
          <h4>{t("settings.flows.effects")}</h4>
          {WEB_FLOW_EFFECT_CLASSES.map((cls) => (
            <Field key={cls} name={`effects.${cls}`} label={t("settings.flows.effectLabel", { cls })} sourced={view.effects[cls]} layer={layer} may={may} send={send}
              show={levelText} edit={levelEdit(cls)} set={(value) => ({ effects: { [cls]: value } })} />
          ))}
          <p role="note">{t("settings.flows.irreversibleNote")}</p>
          <Field name="rerunReview" label={t("settings.flows.rerunReview")} sourced={view.rerunReview} layer={layer} may={may} send={send}
            show={(value) => t(`settings.flows.review.${value}`)} set={(value) => ({ rerunReview: value })}
            edit={(draft, set) => (
              <select aria-label={t("settings.flows.rerunReview")} value={draft} onChange={(event) => set(event.currentTarget.value as "auto" | "review")}>
                <option value="review">{t("settings.flows.review.review")}</option>
                <option value="auto">{t("settings.flows.review.auto")}</option>
              </select>
            )} />
          <Field name="rerunAskTimeoutSeconds" label={t("settings.flows.rerunAskTimeout")} sourced={view.rerunAskTimeoutSeconds} layer={layer} may={may} send={send}
            show={(value) => t("settings.flows.seconds", { n: value })} set={(value) => ({ rerunAskTimeoutSeconds: value })}
            parse={(draft) => (Number.isInteger(draft) && draft >= 30 && draft <= 86_400 ? draft : null)}
            edit={(draft, set) => <input type="number" min={30} max={86_400} aria-label={t("settings.flows.rerunAskTimeout")} value={draft} onChange={(event) => set(Number(event.currentTarget.value))} />} />
          <Field name="budgets.tokensPerRun" label={t("settings.flows.tokensPerRun")} sourced={view.budgets.tokensPerRun} layer={layer} may={may} send={send}
            show={String} set={(value) => ({ budgets: { tokensPerRun: value } })} parse={(draft) => (Number.isSafeInteger(draft) && draft >= 1 ? draft : null)}
            edit={(draft, set) => <input type="number" min={1} aria-label={t("settings.flows.tokensPerRun")} value={draft} onChange={(event) => set(Number(event.currentTarget.value))} />} />
          <Field<string[] | null> name="allowedSkillSources" label={t("settings.flows.skillSources")} sourced={view.allowedSkillSources} layer={layer} may={may} send={send}
            show={(value) => (value === null ? t("settings.flows.anySource") : value.join(", "))} set={(value) => ({ allowedSkillSources: value ?? [] })}
            edit={(draft, set) => <textarea aria-label={t("settings.flows.skillSources")} value={lines(draft)} onChange={(event) => set(event.currentTarget.value.split("\n").map((s) => s.trim()).filter((s) => s !== ""))} />} />
          <Field<Record<string, { agent: string; model?: string }>> name="roles" label={t("settings.flows.roles")} sourced={view.roles} layer={layer} may={may} send={send}
            show={(value) => (Object.keys(value).length === 0 ? t("settings.flows.noRoles") : JSON.stringify(value))} set={(value) => ({ roles: value })}
            edit={(draft, set) => <RolesEditor value={draft} onChange={set} />} />
          <h4>{t("settings.flows.preset.title")}</h4>
          <p>{t("settings.flows.preset.explain")}</p>
          {presetRows(templates, view.paramDefaults ?? {}).map((row) => (
            <PresetField key={`${row.template}.${row.paramId}`} template={row.template} paramId={row.paramId} param={row.param}
              sourced={view.paramDefaults?.[row.template]?.[row.paramId]} layer={layer} may={may} send={send} />
          ))}
          {scope === "global" && may && <Locks locks={view.locks} send={send} />}
        </div>
      )}
    </section>
  );
}

/** Roles as `role = agent[/model]` lines (the template's role names; §12.3). */
function RolesEditor(props: { value: Record<string, { agent: string; model?: string }>; onChange: (next: Record<string, { agent: string; model?: string }>) => void }): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState(Object.entries(props.value).map(([role, v]) => `${role} = ${v.agent}${v.model === undefined ? "" : `/${v.model}`}`).join("\n"));
  const parse = (raw: string): Record<string, { agent: string; model?: string }> | null => {
    const out: Record<string, { agent: string; model?: string }> = {};
    for (const line of raw.split("\n").filter((l) => l.trim() !== "")) {
      const m = /^\s*([a-z0-9][a-z0-9-]*)\s*=\s*([^/\s]+)(?:\/(\S+))?\s*$/.exec(line);
      if (m === null) return null;
      out[m[1]!] = m[3] === undefined ? { agent: m[2]! } : { agent: m[2]!, model: m[3] };
    }
    return out;
  };
  return <textarea aria-label={t("settings.flows.roles")} value={text} onChange={(event) => { setText(event.currentTarget.value); const next = parse(event.currentTarget.value); if (next !== null) props.onChange(next); }} />;
}
