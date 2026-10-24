/**
 * Scheduled flows and groups spec 2026-10-24 §13.3, §14: a project's schedules beside its checks -- the list with the
 * next three slots and the last fire, the enabled switch, Paused + Resume, "a newer version" + Repin, Edit and Remove;
 * the flow and group add forms (the flow's params are the start dialog's own form); and, on a row's Fires button, the
 * schedule's fire list. Every write is sent under the revision the read named and read back; a member reads only.
 * The server owns the cron, the slots, the fire outcome and the confirm mode; this module words them.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import {
  controlGet, fetchPlanLibrary, fetchPlanLibraryEntry, fetchSchedules, nextCommandId, refusalFromAnswer,
  scheduleCommandPath, scheduleIdFor, schedulePath, sendControlCommand,
} from "./controlApi.js";
import type {
  ControlConfigV1, FlowSettingsReadV1, FlowTemplateParamV1, FlowTemplatesV1, IntegrationSchemeV1, LibraryOriginV1,
  PlanLibraryEntryV1, PlanLibraryEntryViewV1, PlanLibraryVersionV1, ScheduleFireViewV1, ScheduleStartV1, ScheduleViewV1,
  SchedulesViewV1,
} from "./controlTypes.js";
import { effectiveDefault, ParamField, typed, type ParamValue, type Template } from "./FlowBoard.js";
import { currentLanguage } from "./i18n.js";
import { Refusal } from "./Refusal.js";
import { ScheduleDetail } from "./ScheduleDetail.js";
import { formatRoute } from "./sections.js";

type Send = (path: string, expectedRevision: number, payload: unknown) => void;

const short7 = (sha: string): string => sha.slice(0, 7);
const slotText = (at: number): string => new Date(at).toLocaleString();
const durationText = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
const positiveInt = (text: string): number | null | "invalid" => {
  const raw = text.trim();
  if (raw === "") return null;
  return /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : "invalid";
};
const deliveryText = (scheme: IntegrationSchemeV1, t: TFunction): string => t(`control.integration.deliveries.${scheme.delivery}`);

/** The library version's origin as the server sends it (a `LibraryOrigin` object), in the reader's words. */
const originText = (origin: LibraryOriginV1, t: TFunction): string => {
  if (origin.kind === "group") return t("settings.schedules.origin.group", { group: origin.groupId });
  if (origin.kind === "requirement-draft") return t("settings.schedules.origin.requirementDraft", { draft: origin.draftNo, group: origin.groupId });
  if (origin.kind === "import") return t("settings.schedules.origin.import", { file: origin.fileName });
  // A version written by a newer panel may name an origin this build has no words for.
  return String((origin as { kind?: unknown }).kind ?? origin);
};

/** §13.3: the hash route to a fire's run (a flow run on the board) or its group (the tasks list); null when neither. */
const fireHref = (fire: ScheduleFireViewV1): string | null =>
  fire.flowRunId !== null
    ? formatRoute({ kind: "flow-run", section: "board", flowRunId: fire.flowRunId })
    : fire.groupId !== null
      ? formatRoute({ kind: "group", section: "tasks", groupId: fire.groupId, region: null, taskId: null })
      : null;

/** §13.3: the last fire in the list -- the outcome's copy, late/missed, and who is credited. */
function LastFire(props: { scheduleId: string; fire: ScheduleFireViewV1 }): JSX.Element {
  const { t } = useTranslation();
  const { fire } = props;
  const slot = slotText(fire.slot);
  const target = fire.flowRunId ?? fire.groupId ?? "";
  const href = fireHref(fire);
  const line = fire.outcome === "waiting" ? t("schedules.lastFire.waiting", { target, slot, reason: fire.reason ?? "" })
    : fire.outcome === "skipped" ? t("schedules.lastFire.skipped", { slot, id: (fire.reason ?? "").replace(/^previous-active:/, "") })
    : fire.outcome === "failed" ? t("schedules.lastFire.failed", { slot, reason: fire.reason ?? "" })
    : fire.outcome === "starting" ? t("settings.schedules.starting")
    : t("schedules.lastFire.started", { target, slot });
  return (
    <div data-testid={`schedule-last-fire-${props.scheduleId}`}>
      <p>{line}</p>
      {href !== null && (
        <p><a data-testid={`schedule-last-fire-link-${props.scheduleId}`} href={href}>{t("settings.schedules.openTarget", { id: target })}</a></p>
      )}
      {fire.lateMs !== null && fire.lateMs > 0 && <p>{t("schedules.lastFire.late", { duration: durationText(fire.lateMs), missed: fire.missed })}</p>}
      <p data-testid={`schedule-fire-by-${props.scheduleId}`}>
        {fire.by === "orca-auto" ? t("schedules.creditedTo", { id: props.scheduleId, person: fire.creditedTo ?? fire.by }) : `${fire.by} ${fire.via}`}
      </p>
    </div>
  );
}

/** §13.3: "a newer version available" -- the pinned version's successor, its provenance, and Repin. */
function NewerVersion(props: { schedule: ScheduleViewV1; may: boolean; send: Send }): JSX.Element | null {
  const { t } = useTranslation();
  const entryId = props.schedule.start.kind === "group" ? props.schedule.start.entryId : null;
  const newer = props.schedule.newerVersion;
  const [version, setVersion] = useState<PlanLibraryVersionV1 | null>(null);
  useEffect(() => {
    if (entryId === null || newer === null) return undefined;
    let live = true;
    void (async () => {
      try {
        const entry = await fetchPlanLibraryEntry(entryId);
        const found = Array.isArray(entry?.versions) ? entry.versions.find((candidate) => candidate.sha256 === newer) ?? null : null;
        if (live) setVersion(found);
      } catch { if (live) setVersion(null); }
    })();
    return () => { live = false; };
  }, [entryId, newer]);
  if (newer === null || props.schedule.start.kind !== "group") return null;
  const repin = (): void => props.send(schedulePath(props.schedule.id), props.schedule.revision, { set: { start: { ...props.schedule.start, sha256: newer } } });
  return (
    <div data-testid={`schedule-newer-${props.schedule.id}`}>
      <p>{t("schedules.newerVersion")}</p>
      {version !== null && (
        <p data-testid={`schedule-provenance-${props.schedule.id}`}>
          {t("schedules.versionProvenance", {
            sha: short7(version.sha256), by: version.by, via: version.via, at: slotText(version.at), origin: originText(version.origin, t),
          })}
        </p>
      )}
      {props.may && <button type="button" onClick={repin}>{t("schedules.repin")}</button>}
    </div>
  );
}

function ScheduleEdit(props: { schedule: ScheduleViewV1; onSave: (set: { name: string; cron: string; start?: ScheduleStartV1 }) => void; onCancel: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { schedule } = props;
  const start = schedule.start;
  const [name, setName] = useState(schedule.name);
  const [cron, setCron] = useState(schedule.cron);
  const [limit, setLimit] = useState(start.kind === "group" ? String(start.tokenLimit ?? "") : "");
  const [pool, setPool] = useState(start.kind === "flow" ? String(start.pool ?? "") : "");
  const limitValue = start.kind === "group" ? positiveInt(limit) : null;
  const poolValue = start.kind === "flow" ? positiveInt(pool) : null;
  // The start the form would send; null when every start field is the schedule's own (or a number is invalid).
  const editedStart = ((): ScheduleStartV1 | null => {
    if (start.kind === "group") {
      return limitValue !== "invalid" && limitValue !== start.tokenLimit ? { ...start, tokenLimit: limitValue } : null;
    }
    if (poolValue === "invalid") return null;
    const { pool: _pool, ...rest } = start;
    const next = poolValue ?? undefined;
    // An empty pool field clears the pool: the start is sent without one, rather than keeping the old value.
    return next === start.pool ? null : { ...rest, ...(next === undefined ? {} : { pool: next }) };
  })();
  const unchanged = name.trim() === schedule.name && cron.trim() === schedule.cron && editedStart === null;
  const ready = name.trim() !== "" && cron.trim() !== "" && limitValue !== "invalid" && poolValue !== "invalid" && !unchanged;
  const save = (): void => {
    const set: { name: string; cron: string; start?: ScheduleStartV1 } = { name: name.trim(), cron: cron.trim() };
    if (editedStart !== null) set.start = editedStart;
    props.onSave(set);
  };
  return (
    <div className="check-field">
      <label>{t("settings.schedules.name")}<input type="text" aria-label={t("settings.schedules.name")} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label>{t("schedules.cron")}<input type="text" aria-label={t("schedules.cron")} value={cron} onChange={(event) => setCron(event.currentTarget.value)} /></label>
      {start.kind === "group" && (
        <label>{t("settings.schedules.tokenLimit")}<input type="number" min={1} aria-label={t("settings.schedules.tokenLimit")} value={limit} onChange={(event) => setLimit(event.currentTarget.value)} /></label>
      )}
      {start.kind === "flow" && (
        <label>{t("settings.schedules.pool")}<input type="number" min={1} aria-label={t("settings.schedules.pool")} value={pool} onChange={(event) => setPool(event.currentTarget.value)} /></label>
      )}
      <button type="button" disabled={!ready} onClick={save}>{t("settings.schedules.save")}</button>
      <button type="button" onClick={props.onCancel}>{t("settings.schedules.cancel")}</button>
    </div>
  );
}

function ScheduleRow(props: { schedule: ScheduleViewV1; may: boolean; send: Send; onFires: (scheduleId: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const { schedule } = props;
  const [editing, setEditing] = useState(false);
  const toggle = (): void => props.send(scheduleCommandPath(schedule.id, "enable"), schedule.revision, { enabled: !schedule.enabled });
  return (
    <li data-testid={`schedule-${schedule.id}`}>
      <p>
        <strong>{schedule.name}</strong> <span className="badge">{schedule.kind}</span> <code>{schedule.cron}</code>
      </p>
      <p data-testid={`schedule-next-${schedule.id}`}>{t("schedules.nextSlots", { slots: schedule.nextSlots.map(slotText).join(", "), zone: schedule.tz ?? "" })}</p>
      {props.may
        ? <label><input type="checkbox" aria-label={t("settings.schedules.enabled")} checked={schedule.enabled} onChange={toggle} />{t("settings.schedules.enabled")}</label>
        : <span>{t(schedule.enabled ? "settings.checks.value.on" : "settings.checks.value.off")}</span>}
      {schedule.lastFire !== null && <LastFire scheduleId={schedule.id} fire={schedule.lastFire} />}
      {schedule.paused ? (
        <p data-testid={`schedule-paused-${schedule.id}`}>
          <span>{t("schedules.paused", { reason: schedule.pausedReason ?? "" })}</span>
          {props.may && <> <button type="button" onClick={() => props.send(scheduleCommandPath(schedule.id, "resume"), schedule.revision, {})}>{t("schedules.resume")}</button></>}
        </p>
      ) : schedule.failureStreak > 0 ? <p>{t("settings.schedules.failureStreak", { count: schedule.failureStreak })}</p> : null}
      <NewerVersion schedule={schedule} may={props.may} send={props.send} />
      <button type="button" onClick={() => props.onFires(schedule.id)}>{t("settings.schedules.fires")}</button>
      {props.may && (
        <>
          {" "}<button type="button" onClick={() => setEditing(!editing)}>{t("settings.schedules.edit")}</button>
          {" "}<button type="button" onClick={() => props.send(scheduleCommandPath(schedule.id, "remove"), schedule.revision, {})}>{t("settings.schedules.remove")}</button>
        </>
      )}
      {props.may && editing && (
        <ScheduleEdit schedule={schedule} onCancel={() => setEditing(false)}
          onSave={(set) => { props.send(schedulePath(schedule.id), schedule.revision, { set }); setEditing(false); }} />
      )}
    </li>
  );
}

/** §13.3: "Add flow schedule" -- a built-in template at its shipped version, the start dialog's params, cron, flags. */
function FlowScheduleForm(props: { repoId: string; dirPath: string | null; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<Template[] | null | "failed">(null);
  const [presets, setPresets] = useState<FlowSettingsReadV1["paramDefaults"] | "unread">({});
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [clarifySkip, setClarifySkip] = useState(false);
  const [unattended, setUnattended] = useState(false);
  const [pool, setPool] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const answer = await controlGet<FlowTemplatesV1>("/api/control/flows/templates");
        if (!Array.isArray(answer?.templates)) throw new TypeError("flow-templates-shape");
        setTemplates(answer.templates);
        setTemplateId((current) => (current !== "" ? current : answer.templates[0]?.id ?? ""));
      } catch { setTemplates("failed"); }
    })();
  }, []);
  // Gaps spec §8.2: the folder's dir project presets over the global ones, read with `?dir=` -- a required param a
  // preset satisfies must not disable the form. A failed read may hide a preset, so every default says it is unread.
  useEffect(() => {
    let live = true;
    const dir = props.dirPath ?? "";
    const path = dir !== "" ? `/api/control/flows/settings?dir=${encodeURIComponent(dir)}` : "/api/control/flows/settings";
    void (async () => {
      try {
        const read = await controlGet<FlowSettingsReadV1>(path);
        if (typeof read?.paramDefaults !== "object" || read.paramDefaults === null) throw new TypeError("flow-settings-shape");
        if (live) setPresets(read.paramDefaults);
      } catch { if (live) setPresets("unread"); }
    })();
    return () => { live = false; };
  }, [props.dirPath]);
  const template = Array.isArray(templates) ? templates.find((entry) => entry.id === templateId) ?? null : null;
  const paramDefault = (param: FlowTemplateParamV1): ReturnType<typeof effectiveDefault> =>
    effectiveDefault(param, presets === "unread" ? "unread" : presets[template!.id]);
  const params: Record<string, ParamValue> = {};
  let paramsOk = true;
  for (const param of template?.params ?? []) {
    const value = values[param.id];
    if (value === undefined) {
      const fallback = paramDefault(param);
      if (param.required && (fallback === null || (fallback.source === "unread" && !fallback.templateHas))) paramsOk = false;
      continue;
    }
    const sent = typed(param, value);
    if (sent === null) { paramsOk = false; continue; }
    params[param.id] = sent;
  }
  const poolValue = positiveInt(pool);
  const ready = template !== null && name.trim() !== "" && cron.trim() !== "" && paramsOk && poolValue !== "invalid";
  const templateRef = template === null ? "" : `builtin/${template.id}${template.version === null ? "" : `@${template.version}`}`;
  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (!ready || template === null) return;
    const start: ScheduleStartV1 = {
      kind: "flow", template: templateRef, params,
      ...(clarifySkip ? { clarify: "skip" as const } : {}), ...(unattended ? { unattended: true } : {}),
      ...(typeof poolValue === "number" ? { pool: poolValue } : {}),
    };
    props.send(schedulePath(scheduleIdFor(name.trim())), 0, { projectId: props.repoId, name: name.trim(), cron: cron.trim(), enabled: true, start });
  };
  const title = (entry: Template): string => entry.title?.[currentLanguage()] ?? entry.title?.en ?? entry.id;
  return (
    <section aria-label={t("schedules.addFlow")}>
      <h4>{t("schedules.addFlow")}</h4>
      {templates === "failed" && <p role="status">{t("settings.schedules.templatesFailed")}</p>}
      <form onSubmit={submit}>
        <label>{t("settings.schedules.name")}<input type="text" aria-label={t("settings.schedules.name")} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
        <label>{t("settings.schedules.template")}
          <select aria-label={t("settings.schedules.template")} value={templateId} onChange={(event) => { setTemplateId(event.currentTarget.value); setValues({}); }}>
            {(Array.isArray(templates) ? templates : []).map((entry) => <option key={entry.id} value={entry.id}>{title(entry)}</option>)}
          </select>
        </label>
        <label>{t("schedules.cron")}<input type="text" aria-label={t("schedules.cron")} value={cron} onChange={(event) => setCron(event.currentTarget.value)} /></label>
        {template !== null && template.params.length > 0 && (
          <fieldset>
            <legend>{t("settings.schedules.params")}</legend>
            {template.params.map((param) => (
              <ParamField key={`${template.id}.${param.id}`} param={param} value={values[param.id]} fallback={paramDefault(param)} dir={props.dirPath ?? ""} template={template.id}
                onChange={(value) => setValues((current) => { const next = { ...current }; if (value === undefined) delete next[param.id]; else next[param.id] = value; return next; })} />
            ))}
          </fieldset>
        )}
        <label><input type="checkbox" checked={clarifySkip} onChange={(event) => setClarifySkip(event.currentTarget.checked)} />{t("settings.schedules.clarifySkip")}</label>
        <label><input type="checkbox" checked={unattended} onChange={(event) => setUnattended(event.currentTarget.checked)} />{t("settings.schedules.unattended")}</label>
        <label>{t("settings.schedules.pool")}<input type="number" min={1} aria-label={t("settings.schedules.pool")} value={pool} onChange={(event) => setPool(event.currentTarget.value)} /></label>
        <button type="submit" disabled={!ready}>{t("schedules.addFlow")}</button>
      </form>
    </section>
  );
}

/** §13.3: "Add group schedule" -- a library entry at an explicit version, cron, token limit or unlimited, delivery. */
function GroupScheduleForm(props: { repoId: string; defaultIntegration: IntegrationSchemeV1 | null; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PlanLibraryEntryV1[] | null | "failed">(null);
  const [entryId, setEntryId] = useState("");
  const [entry, setEntry] = useState<PlanLibraryEntryViewV1 | null>(null);
  const [sha256, setSha256] = useState("");
  const [name, setName] = useState("");
  const [cron, setCron] = useState("");
  const [limit, setLimit] = useState("");
  const [delivery, setDelivery] = useState<"own" | "project">("own");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await fetchPlanLibrary(props.repoId);
        if (!Array.isArray(answer?.entries)) throw new TypeError("plan-library-shape");
        const active = answer.entries.filter((candidate) => candidate.state === "active");
        if (live) {
          setEntries(active);
          setEntryId((current) => (current !== "" ? current : active[0]?.entryId ?? ""));
        }
      } catch { if (live) setEntries("failed"); }
    })();
    return () => { live = false; };
  }, [props.repoId]);
  useEffect(() => {
    if (entryId === "") return undefined;
    let live = true;
    void (async () => {
      try {
        const answer = await fetchPlanLibraryEntry(entryId);
        if (!Array.isArray(answer?.versions)) throw new TypeError("plan-library-entry-shape");
        if (live) { setEntry(answer); setSha256(answer.versions[answer.versions.length - 1]?.sha256 ?? ""); }
      } catch {
        // A failed read is not an entry with no versions: show no provenance and send nothing.
        if (live) { setEntry(null); setSha256(""); }
      }
    })();
    return () => { live = false; };
  }, [entryId]);
  const pinned = props.defaultIntegration !== null && props.defaultIntegration.delivery !== "keep";
  const integration = delivery === "project" && pinned ? props.defaultIntegration : null;
  const limitValue = positiveInt(limit);
  const version = entry?.versions.find((candidate) => candidate.sha256 === sha256) ?? null;
  const mode = integration !== null ? t("schedules.groupConfirmMode.delivery", { delivery: deliveryText(integration, t) })
    : limitValue !== null && limitValue !== "invalid" ? t("schedules.groupConfirmMode.limited")
    : t("schedules.groupConfirmMode.auto");
  const ready = name.trim() !== "" && cron.trim() !== "" && entryId !== ""
    && entry !== null && entry.versions.some((candidate) => candidate.sha256 === sha256) && limitValue !== "invalid";
  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (!ready) return;
    const start: ScheduleStartV1 = { kind: "group", entryId, sha256, tokenLimit: limitValue, integration };
    props.send(schedulePath(scheduleIdFor(name.trim())), 0, { projectId: props.repoId, name: name.trim(), cron: cron.trim(), enabled: true, start });
  };
  return (
    <section aria-label={t("schedules.addGroup")}>
      <h4>{t("schedules.addGroup")}</h4>
      {entries === "failed" && <p>{t("settings.schedules.libraryFailed")}</p>}
      {Array.isArray(entries) && entries.length === 0 && <p>{t("settings.schedules.noEntries")}</p>}
      {Array.isArray(entries) && (
        <form onSubmit={submit}>
          <label>{t("settings.schedules.name")}<input type="text" aria-label={t("settings.schedules.name")} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
          <label>{t("settings.schedules.entry")}
            <select aria-label={t("settings.schedules.entry")} value={entryId}
              onChange={(event) => { setEntry(null); setSha256(""); setEntryId(event.currentTarget.value); }}>
              {entries.map((candidate) => <option key={candidate.entryId} value={candidate.entryId}>{candidate.name}</option>)}
            </select>
          </label>
          <label>{t("settings.schedules.version")}
            <select aria-label={t("settings.schedules.version")} value={sha256} onChange={(event) => setSha256(event.currentTarget.value)}>
              {(entry?.versions ?? []).map((candidate) => <option key={candidate.sha256} value={candidate.sha256}>{candidate.version} · {short7(candidate.sha256)}</option>)}
            </select>
          </label>
          {version !== null && (
            <p data-testid="group-version-provenance">
              {t("schedules.versionProvenance", {
                sha: short7(version.sha256), by: version.by, via: version.via, at: slotText(version.at), origin: originText(version.origin, t),
              })}
            </p>
          )}
          <label>{t("schedules.cron")}<input type="text" aria-label={t("schedules.cron")} value={cron} onChange={(event) => setCron(event.currentTarget.value)} /></label>
          <label>{t("settings.schedules.tokenLimit")}<input type="number" min={1} aria-label={t("settings.schedules.tokenLimit")} value={limit} onChange={(event) => setLimit(event.currentTarget.value)} /></label>
          <label>{t("settings.schedules.delivery")}
            <select aria-label={t("settings.schedules.delivery")} value={delivery} onChange={(event) => setDelivery(event.currentTarget.value as "own" | "project")}>
              <option value="own">{t("settings.schedules.deliveryOwn")}</option>
              {pinned && <option value="project">{t("settings.schedules.deliveryPinned", { delivery: deliveryText(props.defaultIntegration!, t) })}</option>}
            </select>
          </label>
          <p data-testid="group-confirm-mode">{mode}</p>
          <button type="submit" disabled={!ready}>{t("schedules.addGroup")}</button>
        </form>
      )}
    </section>
  );
}

export function ScheduleSettings(props: {
  scope: { repoId: string };
  /** A folder project's schedules start flows; a repository project's start library groups (§13.3). */
  dir?: boolean;
  /** A folder project's path: the dir project whose presets and image folder a flow start uses. */
  dirPath?: string | null;
  defaultIntegration?: IntegrationSchemeV1 | null;
}): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const repoId = props.scope.repoId;
  const [view, setView] = useState<SchedulesViewV1 | null>(null);
  const [unread, setUnread] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [noPump, setNoPump] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchSchedules(repoId);
      // An answer that is not a schedules read (an older panel) is "not read", never half-rendered.
      if (!Array.isArray(next?.schedules)) throw new TypeError("schedules-shape");
      setView(next); setUnread(false);
    } catch { setUnread(true); }
  }, [repoId]);
  useEffect(() => { void read(); }, [read]);
  // §13.3 "No pump": a panel without an execution port never fires. A failed config read says nothing (never blocks the list).
  useEffect(() => {
    void (async () => {
      try { setNoPump((await controlGet<ControlConfigV1>("/api/control/config")).executionPort === "unconfigured"); } catch { setNoPump(false); }
    })();
  }, []);
  const send: Send = (path, expectedRevision, payload) => {
    // One write at a time: a double-click's second command would carry the same read revision and be refused (or
    // worse, duplicate a create). The read that follows a write clears the guard.
    if (inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      try {
        setRefusal(null);
        const answer = await sendControlCommand(path, { commandId: nextCommandId(), expectedRevision, payload });
        const failure: PanelRefusal | null = answer.kind === "uncertain"
          ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
          : answer.status >= 400 ? refusalFromAnswer(answer) : null;
        await read();
        if (failure !== null) setRefusal(failure);
      } finally { inFlight.current = false; }
    })();
  };
  return (
    <section aria-label={t("settings.schedules.region")}>
      <h3>{t("schedules.title")}</h3>
      {refusal !== null && <Refusal refusal={refusal} />}
      {noPump && <p role="note" data-testid="schedules-no-pump">{t("schedules.noPump")}</p>}
      {unread && <p data-testid="schedules-unread">{t("settings.schedules.unread")}</p>}
      {!may && <p role="note">{t("settings.schedules.ownerOnly")}</p>}
      {view !== null && (view.schedules.length === 0 ? <p>{t("settings.schedules.none")}</p> : (
        // Keyed by the revision, so an edit or an add starts again from what the server holds after a change.
        <ul key={view.schedules.map((schedule) => `${schedule.id}:${schedule.revision}`).join(",")}>
          {view.schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} may={may} send={send} onFires={setDetailId} />)}
        </ul>
      ))}
      {may && view !== null && (props.dir === true
        ? <FlowScheduleForm repoId={repoId} dirPath={props.dirPath ?? null} send={send} />
        : <GroupScheduleForm repoId={repoId} defaultIntegration={props.defaultIntegration ?? null} send={send} />)}
      {detailId !== null && (
        <div>
          <button type="button" onClick={() => setDetailId(null)}>{t("settings.schedules.close")}</button>
          <ScheduleDetail key={detailId} scheduleId={detailId} />
        </div>
      )}
    </section>
  );
}
