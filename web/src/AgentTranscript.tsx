/**
 * Live transcript spec §1, §6.4, §10.4.4, §12.3: what each agent did in one Orca run -- its ccloop attempts, phases and
 * calls as metadata rows, and one call's events rendered like Claude Code (each event collapsed to its first line,
 * expandable). The same component is mounted by the flow run page, the task detail and the group's runs table.
 *
 * - A collapsed disclosure makes no request; with `active === false` (a hidden pane) nothing is requested and nothing
 *   polls.
 * - The 1 s follow poll runs only while the document is visible, `active` is true, the call is open and not `final`.
 * - One transcript open per tab: a single module-level slot shared by every mount (spec §10.4.4, M9).
 * - At most 200 event rows are mounted (plan D5: a paged view; Earlier/Later move it). Collapsed rows render no body.
 * - Agent text is rendered as React text nodes only; `thinking` is never asked for and never rendered (ruling 2).
 */
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, fetchRunTranscripts, fetchTranscriptPage, fetchTranscriptWindow } from "./controlApi.js";
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

/** One open call: its tail window, then Earlier/Later over what is loaded, and the follow poll while live. */
function CallView(props: { runId: string; call: TranscriptCallV1; active: boolean }): JSX.Element {
  const { t } = useTranslation();
  const visible = useDocumentVisible();
  const [events, setEvents] = useState<TranscriptEventV1[]>([]);
  const [range, setRange] = useState<{ start: number; end: number; final: boolean; source: string } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null); // null: pinned to the newest rows
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = useRef(false);
  const call = { attempt: props.call.attempt, phase: props.call.phase, seq: props.call.seq };

  const take = (window: TranscriptWindowV1, place: "tail" | "before" | "after"): void => {
    const shown = window.events.filter((event) => event.kind !== "thinking");
    setEvents((before) => {
      let next = place === "before" ? [...shown, ...before] : place === "after" ? [...before, ...shown] : shown;
      if (next.length > MAX_KEPT && place !== "before") {
        // Drop the oldest at a line boundary; Earlier reads them back from the kept start.
        const cut = next[next.length - MAX_KEPT]!.at;
        next = next.filter((event) => event.at >= cut);
      }
      return next;
    });
    setRange((before) => {
      const start = place === "after" && before !== null ? before.start : window.start;
      const end = place === "before" && before !== null ? before.end : window.end;
      return { start, end, final: window.final, source: window.source };
    });
  };
  const load = (ask: Parameters<typeof fetchTranscriptWindow>[2], place: "tail" | "before" | "after"): void => {
    if (busy.current) return;
    busy.current = true;
    fetchTranscriptWindow(props.runId, call, ask).then(
      (window) => { busy.current = false; setRefusal(null); take(window, place); },
      (error: unknown) => { busy.current = false; setRefusal(controlFailureFrom(error).code); },
    );
  };

  const rangeRef = useRef(range);
  rangeRef.current = range;
  useEffect(() => {
    if (!props.active || range !== null) return;
    load({ tail: true }, "tail");
  }, [props.active]);
  const live = props.active && visible && range !== null && !range.final;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { if (rangeRef.current !== null) load({ after: rangeRef.current.end }, "after"); }, POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  const first = anchor ?? Math.max(0, events.length - MAX_ROWS);
  const rows = events.slice(first, first + MAX_ROWS);
  const earlier = (): void => {
    if (first > 0) setAnchor(Math.max(0, first - MAX_ROWS / 2));
    else if (range !== null && range.start > 0) { setAnchor(0); load({ before: range.start }, "before"); }
  };
  const later = (): void => {
    const next = first + MAX_ROWS / 2;
    setAnchor(next + MAX_ROWS >= events.length ? null : next);
  };
  return (
    <div className="transcript-call" data-testid="transcript-call">
      {refusal !== null && <p className="detail-note">{t("transcript.refused", { code: refusal })}</p>}
      {range?.source === "archive" && <p className="detail-note">{t("transcript.archived")}</p>}
      <div>
        <button type="button" disabled={first === 0 && (range === null || range.start === 0)} onClick={earlier}>{t("transcript.earlier")}</button>{" "}
        <button type="button" disabled={anchor === null} onClick={later}>{t("transcript.later")}</button>{" "}
        {range !== null && <span>{range.final ? t("transcript.final") : t("transcript.live")}</span>}
      </div>
      <ol className="transcript-events">
        {rows.map((event) => <EventRow key={`${event.at}:${event.i}`} runId={props.runId} call={call} event={event} />)}
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
