/**
 * Live transcript spec §1, §6.4, §10.4.4, §12.3: what each agent did in one Orca run -- its ccloop attempts, phases and
 * calls as metadata rows, and one call's events rendered like Claude Code (each event collapsed to its first line,
 * expandable). The same component is mounted by the flow run page, the task detail and the group's runs table.
 *
 * - A collapsed disclosure makes no request; with `active === false` (a hidden pane) nothing is requested and nothing
 *   polls.
 * - The 1 s follow poll runs only while the document is visible, `active` is true, the call is open and not `final`, and
 *   the view is pinned to the newest rows (Later at the end pins it again).
 * - One transcript open per tab: a single module-level slot shared by every mount (spec §10.4.4, M9).
 * - At most 200 event rows are mounted (plan D5: a paged view; Earlier/Later move it). Collapsed rows render no body.
 * - Agent text is rendered as React text nodes only; `thinking` is never asked for and never rendered (ruling 2).
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, fetchRunTranscripts, fetchTranscriptPage, fetchTranscriptWindow, type TranscriptWindowAsk } from "./controlApi.js";
import type { RunTranscriptsV1, TranscriptCallV1, TranscriptEventV1, TranscriptWindowV1 } from "./controlTypes.js";

/** Spec §6.5 / §10.7 T8: the most event rows the list keeps mounted. */
export const MAX_ROWS = 200;
/** Events kept in page memory for one open call; older ones are dropped at a line boundary and re-read on Earlier. */
export const MAX_KEPT = 2000;
export const POLL_MS = 1000;

type CallKey = { attempt: number; phase: string; seq: number };
const sameCall = (a: CallKey | null, b: CallKey): boolean => a !== null && a.attempt === b.attempt && a.phase === b.phase && a.seq === b.seq;

// The one open transcript of this tab (spec §10.4.4): opening a call anywhere closes the one open elsewhere.
let slot: { owner: symbol; close: () => void } | null = null;
function claimSlot(owner: symbol, close: () => void): void {
  if (slot !== null && slot.owner !== owner) slot.close();
  slot = { owner, close };
}
function releaseSlot(owner: symbol): void { if (slot?.owner === owner) slot = null; }

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

const firstLine = (text: string | undefined): string => {
  if (text === undefined) return "";
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
};

function summary(event: TranscriptEventV1, t: TFunction): string {
  const f = event.fields ?? {};
  const meta = event.meta ?? {};
  switch (event.kind) {
    case "message": return `${meta.role ?? ""}: ${firstLine(f.text?.text)}`;
    case "tool_call": return `${meta.name ?? ""} ${firstLine(f.input?.text)}`;
    case "tool_result": return `${event.flag?.error === true ? t("transcript.toolError") : t("transcript.toolDone")} ${firstLine(f.output?.text)}`;
    case "file_change": return `${meta.change ?? ""} ${f.path?.text ?? ""}`;
    case "result": return firstLine(f.text?.text);
    case "notice":
      if (meta.notice === "oversized") return t("transcript.oversized", { bytes: event.num?.bytes ?? 0, type: meta.type ?? "?" });
      if (meta.notice === "truncated") return t("transcript.truncatedAt", { bytes: event.num?.atBytes ?? 0 });
      if (meta.notice === "line-dropped") return t("transcript.lineDropped", { bytes: event.num?.bytes ?? 0 });
      return meta.notice ?? "";
    default: return firstLine(f.raw?.text);
  }
}

/** One event: its first line; expanded, every field's head, and more pages on request. */
function EventRow(props: { runId: string; call: CallKey; event: TranscriptEventV1 }): JSX.Element {
  const { t } = useTranslation();
  const { event } = props;
  const [expanded, setExpanded] = useState(false);
  const [extra, setExtra] = useState<Record<string, { text: string; next: number; pages: number }>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const oversized = event.kind === "notice" && event.meta?.notice === "oversized";
  const more = (name: string | null): void => {
    const key = name ?? "";
    // Page 0 replaces the head (both start at 0); later pages append.
    const next = extra[key]?.next ?? 0;
    void fetchTranscriptPage(props.runId, props.call, event.at, next, name === null ? undefined : { i: event.i, name }).then(
      (page) => setExtra((before) => ({ ...before, [key]: { text: (before[key]?.text ?? "") + page.text, next: page.page + 1, pages: page.pages } })),
      (error: unknown) => setRefusal(controlFailureFrom(error).code),
    );
  };
  return (
    <li className={`transcript-event transcript-${event.kind}`} data-testid="transcript-event">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span className="transcript-kind">{t(`transcript.kind.${event.kind}`)}</span> {summary(event, t)}
      </button>
      {expanded && (
        <div className="transcript-body">
          {Object.entries(event.fields ?? {}).map(([name, field]) => {
            const loaded = extra[name];
            return (
              <div key={name}>
                <pre>{loaded === undefined ? field.text : loaded.text}</pre>
                {field.more && (loaded === undefined || loaded.next < loaded.pages) && (
                  <button type="button" onClick={() => more(name)}>{t("transcript.more", { name })}</button>
                )}
              </div>
            );
          })}
          {oversized && (
            <div>
              {extra[""] !== undefined && <pre>{extra[""].text}</pre>}
              {(extra[""] === undefined || extra[""].next < extra[""].pages) && <button type="button" onClick={() => more(null)}>{t("transcript.more", { name: "line" })}</button>}
            </div>
          )}
          {refusal !== null && <p className="detail-note">{t("transcript.refused", { code: refusal })}</p>}
        </div>
      )}
    </li>
  );
}

/** What one open call holds: a contiguous run of lines [start, end), and the newest end any window reported. */
export interface Loaded { events: TranscriptEventV1[]; start: number; end: number; final: boolean; source: string; latest: number }
type Place = "tail" | "before" | "after";
const keyOf = (event: TranscriptEventV1): string => `${event.at}:${event.i}`;

/**
 * A window merged into what is loaded, kept to MAX_KEPT events at a line boundary. Review 7753e97d: a follow (`after`)
 * drops the oldest and moves `start` up to the cut, so Earlier re-reads exactly what was dropped; an Earlier (`before`)
 * drops the newest and moves `end` back, so Later re-reads them (`end < latest`).
 */
export function mergeWindow(before: Loaded | null, window: TranscriptWindowV1, place: Place): Loaded {
  const shown = window.events.filter((event) => event.kind !== "thinking");
  const latest = Math.max(before?.latest ?? 0, window.indexedEnd, window.end);
  const base = { final: window.final, source: window.source, latest };
  if (before === null || place === "tail") return { ...base, events: shown, start: window.start, end: window.end };
  if (place === "after") {
    let events = [...before.events, ...shown];
    let start = before.start;
    if (events.length > MAX_KEPT) {
      const cut = events[events.length - MAX_KEPT]!.at;
      if (cut > events[0]!.at) { events = events.filter((event) => event.at >= cut); start = cut; }
    }
    return { ...base, events, start, end: window.end };
  }
  let events = [...shown, ...before.events];
  let end = before.end;
  if (events.length > MAX_KEPT) {
    const cut = events[MAX_KEPT]!.at;
    if (cut > events[0]!.at) { events = events.filter((event) => event.at < cut); end = cut; }
  }
  return { ...base, events, start: window.start, end };
}

/**
 * One open call: its tail window, then Earlier/Later over what is loaded, and the follow poll while live and pinned to
 * the newest rows. The view is anchored by an event's key, not an index, so loads that add or drop events do not move
 * it (review 7753e97d). A request asked while another is in flight is queued, not dropped (a poll never displaces a
 * queued Earlier or Later); its offset is read when it runs.
 */
function CallView(props: { runId: string; call: TranscriptCallV1; active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const visible = useDocumentVisible();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null); // null: pinned to the newest rows
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = useRef(false);
  const queued = useRef<{ run: () => void; poll: boolean } | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const call = { attempt: props.call.attempt, phase: props.call.phase, seq: props.call.seq };

  const load = (ask: (now: Loaded | null) => TranscriptWindowAsk | null, place: Place, then?: (next: Loaded) => void, poll = false): void => {
    if (busy.current) {
      if (!poll || queued.current === null) queued.current = { run: () => load(ask, place, then, poll), poll };
      return;
    }
    const wanted = ask(loadedRef.current);
    if (wanted === null) return;
    busy.current = true;
    fetchTranscriptWindow(props.runId, call, wanted).then(
      (window) => {
        const next = mergeWindow(loadedRef.current, window, place);
        loadedRef.current = next;
        setLoaded(next);
        setRefusal(null);
        then?.(next);
      },
      (error: unknown) => setRefusal(controlFailureFrom(error).code),
    ).finally(() => {
      busy.current = false;
      const next = queued.current;
      queued.current = null;
      next?.run();
    });
  };

  useEffect(() => {
    if (!props.active || loaded !== null) return;
    load(() => ({ tail: true }), "tail");
  }, [props.active]);
  const live = props.active && visible && loaded !== null && !loaded.final && anchor === null;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => load((now) => (now === null ? null : { after: now.end }), "after", undefined, true), POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  const events = loaded?.events ?? [];
  const anchored = anchor === null ? -1 : events.findIndex((event) => keyOf(event) === anchor);
  const first = anchor === null ? Math.max(0, events.length - MAX_ROWS) : Math.max(0, anchored);
  const rows = events.slice(first, first + MAX_ROWS);
  const earlier = (): void => {
    if (first > 0) { setAnchor(keyOf(events[Math.max(0, first - MAX_ROWS / 2)]!)); return; }
    if (loaded === null || loaded.start === 0) return;
    const oldFirst = events[0] === undefined ? null : keyOf(events[0]);
    setAnchor(oldFirst);
    load((now) => (now === null || now.start === 0 ? null : { before: now.start }), "before", (next) => {
      const at = next.events.findIndex((event) => keyOf(event) === oldFirst);
      const target = next.events[Math.max(0, (at === -1 ? 0 : at) - MAX_ROWS / 2)];
      setAnchor(target === undefined ? null : keyOf(target));
    });
  };
  const later = (): void => {
    const next = first + MAX_ROWS / 2;
    if (next + MAX_ROWS < events.length) { setAnchor(keyOf(events[next]!)); return; }
    if (loaded !== null && loaded.end < loaded.latest) {
      // Newer lines were dropped by an Earlier: read them back, keeping the view where it is.
      const kept = events[Math.min(next, events.length - 1)];
      if (kept !== undefined) setAnchor(keyOf(kept));
      load((now) => (now === null ? null : { after: now.end }), "after");
      return;
    }
    setAnchor(null);
  };
  return (
    <div className="transcript-call" data-testid="transcript-call">
      {refusal !== null && <p className="detail-note">{t("transcript.refused", { code: refusal })}</p>}
      {loaded?.source === "archive" && <p className="detail-note">{t("transcript.archived")}</p>}
      <div>
        <button type="button" disabled={first === 0 && (loaded === null || loaded.start === 0)} onClick={earlier}>{t("transcript.earlier")}</button>{" "}
        <button type="button" disabled={anchor === null} onClick={later}>{t("transcript.later")}</button>{" "}
        {loaded !== null && <span>{loaded.final ? t("transcript.final") : t("transcript.live")}</span>}
      </div>
      <ol className="transcript-events">
        {rows.map((event) => <EventRow key={keyOf(event)} runId={props.runId} call={call} event={event} />)}
      </ol>
    </div>
  );
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** The disclosure for one Orca run: collapsed, nothing is asked; opened, the listing as metadata rows. */
export function RunTranscript(props: { runId: string; active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [listing, setListing] = useState<RunTranscriptsV1 | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<CallKey | null>(null);
  const owner = useRef(Symbol("transcript"));
  useEffect(() => () => releaseSlot(owner.current), []);
  useEffect(() => {
    if (!expanded || !props.active) return;
    let live = true;
    fetchRunTranscripts(props.runId).then(
      (answer) => { if (live) { setListing(answer); setRefusal(null); } },
      (error: unknown) => { if (live) setRefusal(controlFailureFrom(error).code); },
    );
    return () => { live = false; };
  }, [expanded, props.active, props.runId]);
  const toggleCall = (call: TranscriptCallV1): void => {
    if (sameCall(openCall, call)) { setOpenCall(null); releaseSlot(owner.current); return; }
    claimSlot(owner.current, () => setOpenCall(null));
    setOpenCall({ attempt: call.attempt, phase: call.phase, seq: call.seq });
  };
  const attempts = [...new Set((listing?.calls ?? []).map((call) => call.attempt))];
  return (
    <section className="run-transcript" aria-label={t("transcript.region", { runId: props.runId })}>
      <button type="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (expanded) { setOpenCall(null); releaseSlot(owner.current); } }}>
        {t("transcript.disclosure")}
      </button>
      {expanded && (
        <div>
          {refusal !== null && <p className="detail-note">{t("transcript.refused", { code: refusal })}</p>}
          {listing !== null && !listing.available && <p className="detail-note">{t("transcript.unsupported")}</p>}
          {listing !== null && listing.available && listing.calls.length === 0 && <p>{t("transcript.none")}</p>}
          {listing !== null && listing.available && attempts.map((attempt) => (
            <div key={attempt}>
              <h6>{t("transcript.attempt", { attempt })}</h6>
              <ul>
                {listing.calls.filter((call) => call.attempt === attempt).map((call) => (
                  <li key={`${call.phase}:${call.seq}`}>
                    <button type="button" disabled={!call.recorded} aria-expanded={sameCall(openCall, call)} onClick={() => toggleCall(call)}>
                      {t("transcript.callLine", { phase: call.phase, seq: call.seq, runtime: call.runtime ?? t("transcript.notRecorded"), size: sizeText(call.bytes) })}
                    </button>{" "}
                    <span>{call.final ? t("transcript.final") : t("transcript.live")}</span>
                    {call.truncatedAt !== null && <> · <span>{t("transcript.truncatedAt", { bytes: call.truncatedAt })}</span></>}
                    {sameCall(openCall, call) && <CallView runId={props.runId} call={call} active={props.active} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
