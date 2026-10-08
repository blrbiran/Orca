/**
 * Accounts spec §5.3, §6, §7: the Metrics section's Usage panel. It shows what `GET /api/control/usage` answers --
 * headline totals, tokens per model, the rows that could not be attributed or did not reconcile, and the caps that
 * apply with what they leave -- and computes nothing of its own. An owner sets and clears caps and the usage calendar
 * in place; those are human-only commands under the `@spend` scope, sent at the view's `spendRevision`, and whatever
 * the server answers is read back. A member sees the same numbers read-only (the server refuses them anyway).
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import {
  controlFailureFrom, fetchUsageView, nextCommandId, recoverUncertainCommand, refusalFromAnswer, sendControlCommand,
} from "./controlApi.js";
import type {
  ClearSpendCapPayloadV1, CommandErrorV1, SetSpendCapPayloadV1, SetUsageCalendarPayloadV1, SpendPeriodV1, UsageViewV1,
} from "./controlTypes.js";
import i18n from "./i18n.js";
import { TokenInput } from "./TokenInput.js";
import { Refusal } from "./Refusal.js";

const SPEND_SCOPE = "@spend";
const SPEND_PATHS = {
  set: "/api/control/operator/set-spend-cap",
  clear: "/api/control/operator/clear-spend-cap",
  calendar: "/api/control/operator/set-usage-calendar",
} as const;
const PERIODS = ["all", "day", "week", "month", "custom"] as const;
type PeriodChoice = (typeof PERIODS)[number];
const CAP_PERIODS: readonly SpendPeriodV1[] = ["total", "week", "month"];
/** weekStart 1 = Monday .. 7 = Sunday (spec §5.2). */
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** A `datetime-local` value (the browser's local time) as epoch ms, or null when it is empty or not a time. */
export function localTimeMs(value: string): number | null {
  if (value.trim() === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The query the pickers name: day/week/month group the whole range; a custom range is grouped by model. */
export function usageQueryString(scope: string, period: PeriodChoice, from: string, to: string): string {
  const parts = [`scope=${scope}`];
  if (period === "custom") {
    const fromMs = localTimeMs(from), toMs = localTimeMs(to);
    if (fromMs !== null) parts.push(`from=${fromMs}`);
    if (toMs !== null) parts.push(`to=${toMs}`);
  }
  parts.push(`groupBy=${period === "day" || period === "week" || period === "month" ? period : "model"}`);
  return parts.join("&");
}

export function UsagePanel({ project, active = true }: { project: string | null; active?: boolean }): JSX.Element {
  const { t } = useTranslation();
  const owner = mayHumanOnly(useContext(AccountContext));
  const [scopeKind, setScopeKind] = useState<"all" | "project">("all");
  const [period, setPeriod] = useState<PeriodChoice>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<UsageViewV1 | null>(null);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  // A spend command whose outcome could not be looked up yet: its id is kept, so the lookup can be asked again.
  const [unresolved, setUnresolved] = useState<string | null>(null);
  const readSeq = useRef(0);
  const scope = scopeKind === "project" && project !== null ? `repo:${project}` : "all";
  const query = usageQueryString(scope, period, from, to);

  /** Only the newest read is shown: an older answer arriving late would put numbers under the wrong pickers. */
  const read = useCallback(async (): Promise<void> => {
    const seq = ++readSeq.current;
    try {
      const answer = await fetchUsageView(query);
      if (seq !== readSeq.current) return;
      setView(answer);
      setRefusal(null);
    } catch (err) {
      if (seq === readSeq.current) setRefusal(controlFailureFrom(err));
    }
  }, [query]);
  useEffect(() => { if (active) void read(); }, [active, read]);

  /** One spend command at the revision this view was read at; an unknown outcome is looked up under `@spend` once. */
  const send = async (path: string, payload: SetSpendCapPayloadV1 | ClearSpendCapPayloadV1 | SetUsageCalendarPayloadV1): Promise<void> => {
    if (view === null) return;
    const commandId = nextCommandId();
    const answer = await sendControlCommand(path, { commandId, expectedRevision: view.spendRevision, payload });
    const failure = answer.kind === "uncertain" ? await lookUp(commandId) : answer.status >= 400 ? refusalFromAnswer(answer) : null;
    await read();
    // A refused command's reason stays on screen; a successful one leaves whatever the re-read said.
    if (failure !== null) setRefusal(failure);
  };

  /**
   * The retained outcome of a command whose answer was lost. `absent` (command-result-not-found) means it never landed,
   * so a new attempt is safe; `unresolved` keeps the id for another lookup, since a new attempt could apply it twice.
   */
  const lookUp = async (commandId: string): Promise<PanelRefusal | null> => {
    const recovery = await recoverUncertainCommand(SPEND_SCOPE, commandId);
    setUnresolved(recovery.kind === "unresolved" ? commandId : null);
    if (recovery.kind === "absent") return { ...recovery.refusal, message: t("usage.notApplied") };
    if (recovery.kind !== "found") return recovery.refusal;
    if (recovery.lookup.originalStatus < 400) return null;
    const error = (recovery.lookup.body as { error?: CommandErrorV1 }).error;
    return { status: recovery.lookup.originalStatus, code: error?.code ?? "command-result-invalid", message: error?.message ?? t("panelErrors.noOutcome") };
  };
  const lookUpAgain = async (commandId: string): Promise<void> => {
    const failure = await lookUp(commandId);
    await read();
    if (failure !== null) setRefusal(failure);
  };

  return (
    <section className="usage-panel" aria-label={t("usage.title")}>
      <h2>{t("usage.title")}</h2>
      <div className="usage-pickers">
        <label>
          {t("usage.scope")}
          <select value={project === null ? "all" : scopeKind} onChange={(e) => setScopeKind(e.currentTarget.value as "all" | "project")}>
            <option value="all">{t("usage.scopeAll")}</option>
            {project !== null && <option value="project">{t("usage.scopeProject", { id: project })}</option>}
          </select>
        </label>
        <label>
          {t("usage.period")}
          <select value={period} onChange={(e) => setPeriod(e.currentTarget.value as PeriodChoice)}>
            {PERIODS.map((choice) => <option key={choice} value={choice}>{t(`usage.periodChoice.${choice}` as const)}</option>)}
          </select>
        </label>
        {period === "custom" && (
          <>
            <label>{t("usage.from")}<input type="datetime-local" value={from} onChange={(e) => setFrom(e.currentTarget.value)} /></label>
            <label>{t("usage.to")}<input type="datetime-local" value={to} onChange={(e) => setTo(e.currentTarget.value)} /></label>
          </>
        )}
      </div>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unresolved !== null && (
        <p role="status">
          {t("usage.unresolved", { id: unresolved })}{" "}
          <button type="button" onClick={() => void lookUpAgain(unresolved)}>{t("usage.lookUpAgain")}</button>
        </p>
      )}
      {view === null ? <p>{t("usage.loading")}</p> : <UsageBody view={view} grouped={period === "day" || period === "week" || period === "month"} owner={owner} project={project} onSend={(path, payload) => void send(path, payload)} />}
    </section>
  );
}

type Send = (path: string, payload: SetSpendCapPayloadV1 | ClearSpendCapPayloadV1 | SetUsageCalendarPayloadV1) => void;

function UsageBody(props: { view: UsageViewV1; grouped: boolean; owner: boolean; project: string | null; onSend: Send }): JSX.Element {
  const { view, grouped, owner, project, onSend } = props;
  const { t } = useTranslation();
  const label = (key: string | null): string => key ?? t("usage.unattributed");
  return (
    <>
      <dl className="usage-headline">
        <div><dt>{t("usage.headline.total")}</dt><dd data-testid="usage-total">{view.headline.total}</dd></div>
        <div><dt>{t("usage.headline.week")}</dt><dd data-testid="usage-week">{view.headline.week}</dd></div>
        <div><dt>{t("usage.headline.month")}</dt><dd data-testid="usage-month">{view.headline.month}</dd></div>
      </dl>
      <p data-testid="usage-range">{t("usage.rangeTokens", { n: view.range.tokens })}</p>
      {/* Spec §14: pre-ledger rows count in the total and in all-time caps but in no range, so with no range bounds the
          difference between the two is exactly them; named here so the page does not look as if tokens were lost. */}
      {view.from === null && view.to === null && view.headline.total - view.range.tokens > 0 && (
        <p data-testid="usage-pre-ledger">{t("usage.preLedger", { n: view.headline.total - view.range.tokens })}</p>
      )}

      <h3>{t("usage.byModel")}</h3>
      <table>
        <thead>
          <tr>
            <th>{t("usage.th.model")}</th><th>{t("usage.th.input")}</th><th>{t("usage.th.output")}</th>
            <th>{t("usage.th.cacheRead")}</th><th>{t("usage.th.cacheWrite")}</th><th>{t("usage.th.total")}</th>
          </tr>
        </thead>
        <tbody>
          {view.range.byModel.map((entry) => (
            <tr key={entry.model ?? "\u0000unattributed"}>
              <td>{label(entry.model)}</td><td>{entry.input}</td><td>{entry.output}</td>
              <td>{entry.cacheRead}</td><td>{entry.cacheWrite}</td><td>{entry.tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {grouped && (
        <table data-testid="usage-groups">
          <thead><tr><th>{t("usage.th.group")}</th><th>{t("usage.th.total")}</th></tr></thead>
          <tbody>
            {view.range.groups.map((group) => <tr key={group.key ?? "\u0000unattributed"}><td>{label(group.key)}</td><td>{group.tokens}</td></tr>)}
          </tbody>
        </table>
      )}
      <ul className="caveats">
        <li data-testid="usage-unattributed">{t("usage.counts.unattributed", { n: view.counts.unattributedRows })}</li>
        <li data-testid="usage-mismatch">{t("usage.counts.mismatch", { n: view.counts.breakdownMismatchRows })}</li>
        <li data-testid="usage-unknown">{t("usage.counts.unknownRuns", { n: view.counts.unknownUsageRuns })}</li>
      </ul>

      <Caps view={view} owner={owner} project={project} onSend={onSend} />
      {/* Re-seeded from the server's values whenever they (or the spend revision) change, so a refused or overtaken
          edit never stays on screen as if it were the calendar. */}
      <Calendar key={`${view.calendar.timeZone}/${view.calendar.weekStart}/${view.spendRevision}`} view={view} owner={owner} onSend={onSend} />
    </>
  );
}

/** A cap's scope in words: all projects, or the project's control repository. */
export function capScopeText(scope: string): string {
  return scope === "all" ? i18n.t("usage.capScopeAll") : i18n.t("usage.capScopeRepo", { id: scope.replace(/^repo:/, "") });
}

function Caps({ view, owner, project, onSend }: { view: UsageViewV1; owner: boolean; project: string | null; onSend: Send }): JSX.Element {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [newScope, setNewScope] = useState("all");
  const [newPeriod, setNewPeriod] = useState<SpendPeriodV1>("week");
  const [newTokens, setNewTokens] = useState<number | null>(null);
  return (
    <>
      <h3>{t("usage.caps")}</h3>
      {view.caps.length === 0 ? (
        <p data-testid="usage-no-caps">{t("usage.noCaps")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("usage.th.scope")}</th><th>{t("usage.th.capPeriod")}</th><th>{t("usage.th.cap")}</th>
              <th>{t("usage.th.used")}</th><th>{t("usage.th.committed")}</th><th>{t("usage.th.headroom")}</th>
              {owner && <th>{t("usage.th.change")}</th>}
            </tr>
          </thead>
          <tbody>
            {view.caps.map((cap) => {
              const key = `${cap.scope}/${cap.period}`;
              const tokens = drafts[key] === undefined ? cap.tokens : drafts[key]!;
              return (
                <tr key={key} data-testid={`cap-${key}`}>
                  <td>{capScopeText(cap.scope)}</td><td>{t(`usage.capPeriod.${cap.period}` as const)}</td><td>{cap.tokens}</td>
                  <td>{cap.used}</td><td>{cap.committed}</td><td>{cap.headroom}</td>
                  {owner && (
                    <td>
                      <TokenInput
                        aria-label={t("usage.capTokens", { scope: capScopeText(cap.scope), period: t(`usage.capPeriod.${cap.period}` as const) })}
                        min={1} value={tokens} onChange={(n) => setDrafts({ ...drafts, [key]: n })} onInvalid={() => setDrafts({ ...drafts, [key]: null })}
                      />
                      <button type="button" disabled={tokens === null} onClick={() => tokens !== null && onSend(SPEND_PATHS.set, { scope: cap.scope, period: cap.period, tokens })}>
                        {t("usage.set")}
                      </button>
                      <button type="button" onClick={() => onSend(SPEND_PATHS.clear, { scope: cap.scope, period: cap.period })}>{t("usage.clear")}</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {owner && (
        <form
          className="usage-new-cap" aria-label={t("usage.newCap")}
          onSubmit={(event) => {
            event.preventDefault();
            if (newTokens !== null) onSend(SPEND_PATHS.set, { scope: newScope, period: newPeriod, tokens: newTokens });
          }}
        >
          <label>
            {t("usage.scope")}
            <select value={newScope} onChange={(e) => setNewScope(e.currentTarget.value)}>
              <option value="all">{t("usage.capScopeAll")}</option>
              {project !== null && <option value={`repo:${project}`}>{capScopeText(`repo:${project}`)}</option>}
            </select>
          </label>
          <label>
            {t("usage.th.capPeriod")}
            <select value={newPeriod} onChange={(e) => setNewPeriod(e.currentTarget.value as SpendPeriodV1)}>
              {CAP_PERIODS.map((choice) => <option key={choice} value={choice}>{t(`usage.capPeriod.${choice}` as const)}</option>)}
            </select>
          </label>
          <TokenInput label={t("usage.th.cap")} aria-label={t("usage.th.cap")} min={1} value={newTokens} onChange={setNewTokens} onInvalid={() => setNewTokens(null)} />
          <button type="submit" disabled={newTokens === null}>{t("usage.addCap")}</button>
        </form>
      )}
    </>
  );
}

function Calendar({ view, owner, onSend }: { view: UsageViewV1; owner: boolean; onSend: Send }): JSX.Element {
  const { t } = useTranslation();
  const [timeZone, setTimeZone] = useState(view.calendar.timeZone);
  const [weekStart, setWeekStart] = useState(view.calendar.weekStart);
  const day = (n: number): string => {
    const name = WEEKDAYS[n - 1];
    return name === undefined ? String(n) : t(`usage.weekday.${name}` as const);
  };
  if (!owner) {
    return <p data-testid="usage-calendar">{t("usage.calendarLine", { timeZone: view.calendar.timeZone, weekStart: day(view.calendar.weekStart) })}</p>;
  }
  return (
    <form
      className="usage-calendar" aria-label={t("usage.calendar")}
      onSubmit={(event) => { event.preventDefault(); onSend(SPEND_PATHS.calendar, { timeZone: timeZone.trim(), weekStart }); }}
    >
      <label>{t("usage.timeZone")}<input value={timeZone} onChange={(e) => setTimeZone(e.currentTarget.value)} /></label>
      <label>
        {t("usage.weekStart")}
        <select value={weekStart} onChange={(e) => setWeekStart(Number(e.currentTarget.value))}>
          {WEEKDAYS.map((name, index) => <option key={name} value={index + 1}>{day(index + 1)}</option>)}
        </select>
      </label>
      <button type="submit">{t("usage.saveCalendar")}</button>
    </form>
  );
}
