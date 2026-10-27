/**
 * Checks spec 2026-10-22 §4.3, §4.4, §5.4, §7: the check settings of one project or of the global layer, exactly as the
 * server read them (GET /api/control/checks[?repoId=]): each field with the layer it came from (project / global /
 * built-in) and "locked" when a global lock binds it. A person may override a field in this scope's layer or reset it to
 * the next layer, run a check now, resume a paused one, manage the scheduled checks and (global scope) the locks -- every
 * write is a human-only verb sent under the revision the read named, and read back. The next scheduled slots are the
 * server's (its own cron and time zone); the Web keeps no copy of either.
 */
import { useCallback, useContext, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { checksCommandPath, checksReadPath, controlGet, nextCommandId, refusalFromAnswer, sendControlCommand, type ChecksScope } from "./controlApi.js";
import type { CheckConditionV1, CheckKindV1, CheckLockV1, CheckSourcedV1, CheckStateV1, CheckTriggerV1, ChecksReadV1, ScheduledCheckV1 } from "./controlTypes.js";
import { Refusal } from "./Refusal.js";
import { ReviewDetail } from "./ReviewDetail.js";

type CheckVerb = Parameters<typeof checksCommandPath>[1];
type Send = (verb: CheckVerb, payload: unknown) => void;
type Layer = "project" | "global";
const KINDS: readonly CheckKindV1[] = ["integration-check", "model-review"];
/** Spec §2.2: the closed condition set, in the order the form offers it. */
const CONDITION_KINDS: readonly CheckConditionV1["kind"][] = ["landed-groups", "conflict-reconciled", "overlapping-files", "queue-idle", "since-last", "schedule"];
const LOCKABLE: readonly CheckLockV1[] = ["integrationCheck.command", "modelReview.budgetTokens"];
const MINUTE = 60_000;

function defaultCondition(kind: CheckConditionV1["kind"]): CheckConditionV1 {
  switch (kind) {
    case "landed-groups": return { kind, min: 2 };
    case "overlapping-files": return { kind, minGroups: 2 };
    case "since-last": return { kind, ms: 60 * MINUTE };
    case "schedule": return { kind, cron: "0 9 * * 1" };
    default: return { kind };
  }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const shortSha = (sha: string): string => sha.slice(0, 7);

function conditionText(c: CheckConditionV1, t: TFunction): string {
  return t(`settings.checks.describe.${c.kind}` as const, { min: "min" in c ? c.min : "minGroups" in c ? c.minGroups : 0, minutes: "ms" in c ? c.ms / MINUTE : 0, cron: "cron" in c ? c.cron : "" });
}
function triggerText(trigger: CheckTriggerV1, t: TFunction): string {
  return trigger.all.map((clause) => `(${clause.any.map((c) => conditionText(c, t)).join(` ${t("settings.checks.trigger.or")} `)})`).join(` ${t("settings.checks.trigger.and")} `);
}

function SourceBadges(props: { sourced: Pick<CheckSourcedV1<unknown>, "source" | "lockedBy"> }): JSX.Element {
  const { t } = useTranslation();
  const source = props.sourced.source;
  return (
    <>
      {/* Tester #67 (spec §24): the source is muted text, shown only when it is not the built-in default; the lock stays a badge. */}
      {source !== "builtin" && <span className="setting-source" data-testid="check-source">{t(`settings.checks.source.${source}` as const)}</span>}
      {props.sourced.lockedBy !== null && <> <span className="badge" data-tone="warn" data-testid="check-locked">{t("settings.checks.locked")}</span></>}
    </>
  );
}

/** The trigger form, generated from the closed condition set (spec §2.2): an AND of clauses, each an OR of conditions. */
function TriggerEditor(props: { value: CheckTriggerV1; onChange: (next: CheckTriggerV1) => void }): JSX.Element {
  const { t } = useTranslation();
  const all = props.value.all;
  const setClause = (i: number, any: CheckConditionV1[]): void => props.onChange({ all: all.map((clause, k) => (k === i ? { any } : clause)) });
  return (
    <div className="check-trigger">
      {all.map((clause, i) => (
        <fieldset key={i}>
          <legend>{t("settings.checks.trigger.clause", { n: i + 1 })}</legend>
          {clause.any.map((condition, j) => {
            const put = (next: CheckConditionV1): void => setClause(i, clause.any.map((other, k) => (k === j ? next : other)));
            return (
              <div key={j}>
                <select aria-label={t("settings.checks.trigger.condition")} value={condition.kind} onChange={(event) => put(defaultCondition(event.currentTarget.value as CheckConditionV1["kind"]))}>
                  {CONDITION_KINDS.map((kind) => <option key={kind} value={kind}>{t(`settings.checks.condition.${kind}` as const)}</option>)}
                </select>
                {condition.kind === "landed-groups" && <input type="number" min={1} max={50} aria-label={t("settings.checks.param.min")} value={condition.min} onChange={(event) => put({ kind: "landed-groups", min: Number(event.currentTarget.value) })} />}
                {condition.kind === "overlapping-files" && <input type="number" min={2} aria-label={t("settings.checks.param.minGroups")} value={condition.minGroups} onChange={(event) => put({ kind: "overlapping-files", minGroups: Number(event.currentTarget.value) })} />}
                {condition.kind === "since-last" && <input type="number" min={10} aria-label={t("settings.checks.param.minutes")} value={condition.ms / MINUTE} onChange={(event) => put({ kind: "since-last", ms: Math.round(Number(event.currentTarget.value) * MINUTE) })} />}
                {condition.kind === "schedule" && <input type="text" aria-label={t("settings.checks.param.cron")} value={condition.cron} onChange={(event) => put({ kind: "schedule", cron: event.currentTarget.value })} />}
                {clause.any.length > 1 && <button type="button" onClick={() => setClause(i, clause.any.filter((_, k) => k !== j))}>{t("settings.checks.trigger.removeCondition")}</button>}
              </div>
            );
          })}
          <button type="button" onClick={() => setClause(i, [...clause.any, defaultCondition("queue-idle")])}>{t("settings.checks.trigger.addCondition")}</button>
          {all.length > 1 && <button type="button" onClick={() => props.onChange({ all: all.filter((_, k) => k !== i) })}>{t("settings.checks.trigger.removeClause")}</button>}
        </fieldset>
      ))}
      <button type="button" onClick={() => props.onChange({ all: [...all, { any: [defaultCondition("queue-idle")] }] })}>{t("settings.checks.trigger.addClause")}</button>
    </div>
  );
}

type FieldName = "enabled" | "trigger" | "command" | "budgetTokens" | "maxGroupsPerReview";

/** One field: its value and source, and (for a person who may) its editor, Save / Override and Reset to inherited. */
function Field<T>(props: {
  kind: CheckKindV1; name: FieldName; sourced: CheckSourcedV1<T>; layer: Layer; may: boolean; send: Send;
  show: (value: T) => string; edit: (draft: T, setDraft: (next: T) => void) => JSX.Element; normalize?: (draft: T) => T;
}): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<T>(props.sourced.value);
  const ours = props.sourced.source === props.layer;
  // Spec §4.2: this layer's own value a lock ignores -- shown struck through, and it can still be cleared from this layer.
  const ignored = props.sourced.overriddenByLock;
  return (
    <div className="check-field" data-testid={`check-field-${props.kind}-${props.name}`}>
      <span>{t(`settings.checks.field.${props.name}` as const)}: {props.show(props.sourced.value)}</span> <SourceBadges sourced={props.sourced} />
      {ignored !== undefined && <> <s data-testid="check-overridden">{props.show(ignored)}</s> {t("settings.checks.overriddenByLock")}</>}
      {props.may && (
        <div>
          {props.edit(draft, setDraft)}
          {/* Saving the shown value into this layer is an override even when unchanged; in its own layer, only a change. */}
          <button type="button" disabled={ours && same(draft, props.sourced.value)}
            onClick={() => props.send("set-check-settings", { kind: props.kind, set: { [props.name]: props.normalize === undefined ? draft : props.normalize(draft) }, clear: [] })}>
            {t(ours ? "settings.checks.save" : "settings.checks.override")}
          </button>
          {(ours || ignored !== undefined) && <button type="button" onClick={() => props.send("set-check-settings", { kind: props.kind, set: {}, clear: [props.name] })}>{t("settings.checks.reset")}</button>}
        </div>
      )}
    </div>
  );
}

function TargetState(props: { kind: CheckKindV1; target: string; state: CheckStateV1; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [detail, setDetail] = useState(false);
  const { state } = props;
  const last = state.last;
  return (
    <div className="check-state" data-testid={`check-state-${props.kind}-${props.target}`}>
      <p>
        {t("settings.checks.state.target", { target: props.target })}{" · "}
        <span data-testid="check-watermark">{state.watermark === null ? t("settings.checks.state.noWatermark") : t("settings.checks.state.watermark", { sha: shortSha(state.watermark) })}</span>
        {state.rebased ? ` · ${t("settings.checks.state.rebased")}` : ""}
      </p>
      <p data-testid="check-last">
        {last === null ? t("settings.checks.state.lastNone")
          : t("settings.checks.state.last", { state: t(`settings.checks.lastState.${last.state}` as const), at: new Date(last.at).toLocaleString(), detail: last.detail === null ? "" : ` (${last.detail})` })}
        {last !== null && last.debugGroupIds.length > 0 ? ` ${t("settings.checks.state.debugGroups", { groups: last.debugGroupIds.join(", ") })}` : ""}
      </p>
      {/* Spec §6.1: the review runs on a confirmed group's agent profiles; without one there is nothing to run it on. */}
      {props.kind === "model-review" && last?.detail === "no-profiles" && <p role="note" data-testid="check-hint-no-profiles">{t("settings.checks.state.noProfiles")}</p>}
      {last !== null && last.reviewGroupId !== null && (
        <>
          <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)}>{t("settings.checks.state.reviewDetail")}</button>
          {detail && <ReviewDetail reviewGroupId={last.reviewGroupId} />}
        </>
      )}
      {state.pendingRun !== null && <p>{t("settings.checks.state.pendingRun")}</p>}
      {state.paused ? (
        <p>
          <span data-testid="check-paused">{t("settings.checks.state.paused", { count: state.failureStreak })}</span>
          {props.may && <> <button type="button" onClick={() => props.send("resume-check", { kind: props.kind })}>{t("settings.checks.state.resume")}</button></>}
        </p>
      ) : state.failureStreak > 0 && <p>{t("settings.checks.state.streak", { count: state.failureStreak })}</p>}
    </div>
  );
}

function KindSection(props: { kind: CheckKindV1; view: ChecksReadV1; layer: Layer; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const common = { kind: props.kind, layer: props.layer, may: props.may, send: props.send };
  const onOff = (value: boolean): string => t(value ? "settings.checks.value.on" : "settings.checks.value.off");
  const number = (label: string, min: number, max?: number) => (draft: number, set: (next: number) => void): JSX.Element =>
    <input type="number" min={min} {...(max === undefined ? {} : { max })} aria-label={label} value={draft} onChange={(event) => set(Number(event.currentTarget.value))} />;
  const fields = props.view.kinds;
  const states = props.view.state.filter((entry) => entry.kind === props.kind);
  return (
    <section aria-label={t(`settings.checks.kind.${props.kind}` as const)}>
      <h4>{t(`settings.checks.kind.${props.kind}` as const)}</h4>
      <Field {...common} name="enabled" sourced={fields[props.kind].enabled} show={onOff}
        edit={(draft, set) => <input type="checkbox" aria-label={t("settings.checks.field.enabled")} checked={draft} onChange={(event) => set(event.currentTarget.checked)} />} />
      <Field {...common} name="trigger" sourced={fields[props.kind].trigger} show={(value) => triggerText(value, t)}
        edit={(draft, set) => <TriggerEditor value={draft} onChange={set} />} />
      {props.kind === "integration-check" ? (
        <Field {...common} name="command" sourced={fields["integration-check"].command} show={(value) => value ?? t("settings.checks.value.noCommand")} normalize={(value) => value?.trim() ?? null}
          edit={(draft, set) => <input type="text" aria-label={t("settings.checks.field.command")} placeholder={t("settings.checks.commandPlaceholder")} value={draft ?? ""}
            onChange={(event) => set(event.currentTarget.value.trim() === "" ? null : event.currentTarget.value)} />} />
      ) : (
        <>
          <Field {...common} name="budgetTokens" sourced={fields["model-review"].budgetTokens} show={String} edit={number(t("settings.checks.field.budgetTokens"), 1)} />
          <Field {...common} name="maxGroupsPerReview" sourced={fields["model-review"].maxGroupsPerReview} show={String} edit={number(t("settings.checks.field.maxGroupsPerReview"), 1, 50)} />
        </>
      )}
      {props.layer === "project" && props.may && <button type="button" onClick={() => props.send("run-check-now", { kind: props.kind })}>{t("settings.checks.runNow")}</button>}
      {states.map((entry) => <TargetState key={entry.target} kind={props.kind} target={entry.target} state={entry.state} may={props.may} send={props.send} />)}
    </section>
  );
}

function Scheduled(props: { view: ChecksReadV1; layer: Layer; may: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [id, setId] = useState("");
  const [kind, setKind] = useState<CheckKindV1>("model-review");
  const [cron, setCron] = useState("");
  const kindText = (value: CheckKindV1): string => t(`settings.checks.kind.${value}` as const);
  const toggle = (entry: ScheduledCheckV1): void => props.send("set-scheduled-check", { id: entry.id, kind: entry.kind, cron: entry.cron, enabled: !entry.enabled });
  return (
    <section aria-label={t("settings.checks.scheduled.title")}>
      <h4>{t("settings.checks.scheduled.title")}</h4>
      {props.view.scheduled.length === 0 ? <p>{t("settings.checks.scheduled.none")}</p> : (
        <ul>
          {props.view.scheduled.map((entry) => {
            const slots = props.view.nextSlots[entry.value.id] ?? [];
            return (
              <li key={entry.value.id} data-testid={`check-scheduled-${entry.value.id}`}>
                {t("settings.checks.scheduled.entry", { id: entry.value.id, kind: kindText(entry.value.kind), cron: entry.value.cron })} <SourceBadges sourced={entry} />{" "}
                {props.may ? <input type="checkbox" aria-label={t("settings.checks.scheduled.enabled")} checked={entry.value.enabled} onChange={() => toggle(entry.value)} />
                  : <span>{t(entry.value.enabled ? "settings.checks.value.on" : "settings.checks.value.off")}</span>}
                {" "}<span data-testid="check-next">{slots.length === 0 ? t("settings.checks.scheduled.nextNone") : t("settings.checks.scheduled.next", { slots: slots.map((slot) => new Date(slot).toLocaleString()).join(", ") })}</span>
                {props.may && entry.source === props.layer && <> <button type="button" onClick={() => props.send("set-scheduled-check", { id: entry.value.id, remove: true })}>{t("settings.checks.scheduled.remove")}</button></>}
              </li>
            );
          })}
        </ul>
      )}
      {props.may && (
        <div>
          <input type="text" aria-label={t("settings.checks.scheduled.id")} value={id} onChange={(event) => setId(event.currentTarget.value)} />
          <select aria-label={t("settings.checks.scheduled.kind")} value={kind} onChange={(event) => setKind(event.currentTarget.value as CheckKindV1)}>
            {KINDS.map((value) => <option key={value} value={value}>{kindText(value)}</option>)}
          </select>
          <input type="text" aria-label={t("settings.checks.scheduled.cron")} value={cron} onChange={(event) => setCron(event.currentTarget.value)} />
          <button type="button" disabled={id.trim() === "" || cron.trim() === ""}
            onClick={() => props.send("set-scheduled-check", { id: id.trim(), kind, cron: cron.trim(), enabled: true })}>{t("settings.checks.scheduled.add")}</button>
        </div>
      )}
    </section>
  );
}

/** Spec §4.2: the global layer's locks; only the security-class fields are lockable, nothing is locked by default. */
function Locks(props: { locks: CheckLockV1[]; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CheckLockV1[]>(LOCKABLE.filter((path) => props.locks.includes(path)));
  return (
    <section aria-label={t("settings.checks.locks.title")}>
      <h4>{t("settings.checks.locks.title")}</h4>
      <p>{t("settings.checks.locks.explain")}</p>
      {LOCKABLE.map((path) => (
        <label key={path}>
          <input type="checkbox" aria-label={t(`settings.checks.locks.path.${path}` as const)} checked={draft.includes(path)}
            onChange={(event) => { const on = event.currentTarget.checked; setDraft(LOCKABLE.filter((other) => (other === path ? on : draft.includes(other)))); }} />
          {t(`settings.checks.locks.path.${path}` as const)}
        </label>
      ))}
      <button type="button" disabled={same(draft, LOCKABLE.filter((path) => props.locks.includes(path)))} onClick={() => props.send("set-check-locks", { locks: draft })}>{t("settings.checks.locks.save")}</button>
    </section>
  );
}

export function ChecksSettings(props: { scope: ChecksScope }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const scope = props.scope;
  const path = checksReadPath(scope);
  const [view, setView] = useState<ChecksReadV1 | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  // A failed read is not a refusal of anything the person did: a quiet line, never an alert (OrchestrationSettings).
  const [unread, setUnread] = useState(false);
  const read = useCallback(async (): Promise<void> => {
    try { setView(await controlGet<ChecksReadV1>(path)); setUnread(false); } catch { setUnread(true); }
  }, [path]);
  useEffect(() => { void read(); }, [read]);

  const send: Send = (verb, payload) => {
    if (view === null) return;
    void (async () => {
      const answer = await sendControlCommand(checksCommandPath(scope, verb), { commandId: nextCommandId(), expectedRevision: view.revision, payload });
      setRefusal(null);
      const failure = answer.kind === "uncertain" ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
        : answer.status >= 400 ? refusalFromAnswer(answer) : null;
      await read();
      if (failure !== null) setRefusal(failure);
    })();
  };
  const layer: Layer = scope === "global" ? "global" : "project";
  return (
    <section aria-label={t("settings.checks.region")}>
      <h3>{t("settings.checks.region")}</h3>
      <p>{t("settings.checks.explain")}</p>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unread && <p data-testid="checks-unread">{t("settings.checks.unread")}</p>}
      {!may && <p role="note">{t("settings.checks.ownerOnly")}</p>}
      {view !== null && (
        // Keyed by what was read, so every draft starts again from what the server holds after a change.
        <div key={JSON.stringify([view.revision, view.kinds, view.scheduled, view.locks])}>
          {KINDS.map((kind) => <KindSection key={kind} kind={kind} view={view} layer={layer} may={may} send={send} />)}
          <Scheduled view={view} layer={layer} may={may} send={send} />
          {scope === "global" && may && <Locks locks={view.locks} send={send} />}
        </div>
      )}
    </section>
  );
}
