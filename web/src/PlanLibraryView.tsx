/**
 * Scheduled flows and groups spec 2026-10-24 §13.3, §14: the project's plan library. Entries name their plan, every
 * version's origin and provenance, who uses the plan, and a download of the version's own bytes. An owner may import a
 * file (trusting its tasks, §5.4), archive an entry, import a version into a new group at once, or schedule it -- the
 * schedule form posts exactly one `schedule-set`, never the group page's route. A member reads only; this module words
 * what the server holds.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PanelRefusal } from "./api.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import {
  controlCommandPath, fetchPlanLibrary, fetchPlanLibraryEntry, nextCommandId, planLibraryArchivePath,
  planLibraryImportPath, planLibraryVersionPath, refusalFromAnswer, scheduleIdFor, schedulePath, sendControlCommand,
} from "./controlApi.js";
import type {
  LibraryOriginV1, PlanLibraryEntryV1, PlanLibraryVersionV1, ScheduleStartV1,
} from "./controlTypes.js";
import { Refusal } from "./Refusal.js";
import { errorEntry } from "./i18n.js";

type Send = (path: string, expectedRevision: number, payload: unknown) => boolean;
type Row = { entry: PlanLibraryEntryV1; versions: PlanLibraryVersionV1[] | null };

const short10 = (sha: string): string => sha.slice(0, 10);
const slotText = (at: number): string => new Date(at).toLocaleString();
const positiveInt = (text: string): number | null | "invalid" => {
  const raw = text.trim();
  if (raw === "") return null;
  return /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : "invalid";
};

const originText = (origin: LibraryOriginV1, t: TFunction): string => {
  switch (origin.kind) {
    case "group": return t("settings.schedules.origin.group", { group: origin.groupId });
    case "requirement-draft": return t("settings.schedules.origin.requirementDraft", { draft: origin.draftNo, group: origin.groupId });
    case "import": return t("settings.schedules.origin.import", { file: origin.fileName });
  }
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const fileNameOf = (file: File): string => {
  const base = (file.name.split("/").pop() ?? file.name).replace(/\.json$/i, "").trim().slice(0, 200);
  return base === "" ? "plan" : base;
};

/** §13.3 "Schedule…": one entry, one create, under revision 0 -- the schedule is new, so there is no row to race. */
function ScheduleForm(props: { entry: PlanLibraryEntryV1; repoId: string; busy: boolean; send: Send; onDone: () => void }): JSX.Element {
  const { t } = useTranslation();
  const head = props.entry.head;
  const [name, setName] = useState((props.entry.name || props.entry.entryId).slice(0, 80));
  const [cron, setCron] = useState("");
  const [limit, setLimit] = useState("");
  const limitValue = positiveInt(limit);
  const ready = head !== null && name.trim() !== "" && cron.trim() !== "" && limitValue !== "invalid";
  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    if (!ready || head === null || props.busy) return;
    const start: ScheduleStartV1 = { kind: "group", entryId: props.entry.entryId, sha256: head.sha256, tokenLimit: limitValue, integration: null };
    const dispatched = props.send(schedulePath(scheduleIdFor(name.trim(), `${props.entry.entryId}\0${nextCommandId()}`)), 0,
      { projectId: props.repoId, name: name.trim(), cron: cron.trim(), enabled: true, start });
    if (dispatched) props.onDone();
  };
  return (
    <form data-testid={`plan-library-schedule-form-${props.entry.entryId}`} onSubmit={submit}>
      <label>{t("settings.schedules.name")}<input type="text" aria-label={t("settings.schedules.name")} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label>{t("schedules.cron")}<input type="text" aria-label={t("schedules.cron")} value={cron} onChange={(event) => setCron(event.currentTarget.value)} /></label>
      <label>{t("settings.schedules.tokenLimit")}<input type="number" min={1} aria-label={t("settings.schedules.tokenLimit")} value={limit} onChange={(event) => setLimit(event.currentTarget.value)} /></label>
      <button type="submit" disabled={!ready || props.busy}>{t("settings.schedules.save")}</button>
      <button type="button" onClick={props.onDone}>{t("settings.schedules.cancel")}</button>
    </form>
  );
}

function EntryRow(props: { row: Row; repoId: string; may: boolean; busy: boolean; send: Send }): JSX.Element {
  const { t } = useTranslation();
  const { entry, versions } = props.row;
  const [scheduling, setScheduling] = useState(false);
  const head = entry.head;
  return (
    <li data-testid={`plan-library-entry-${entry.entryId}`}>
      <p><strong>{entry.name}</strong> <code>{entry.entryId}</code></p>
      <p data-testid={`plan-library-in-use-${entry.entryId}`}>{t("planLibrary.inUse", { n: entry.usedBy.length })}</p>
      {versions === null ? <p>{t("settings.schedules.libraryFailed")}</p> : (
        <ul>
          {versions.map((version) => (
            <li key={version.sha256} data-testid={`plan-library-version-${entry.entryId}-${version.version}`}>
              <code>{short10(version.sha256)}</code>{" "}
              <span>
                {t("schedules.versionProvenance", {
                  sha: short10(version.sha256), by: version.by, via: version.via, at: slotText(version.at), origin: originText(version.origin, t),
                })}
              </span>{" "}
              <a href={planLibraryVersionPath(entry.entryId, version.sha256)} download>{t("planLibrary.download")}</a>
            </li>
          ))}
        </ul>
      )}
      {props.may && (
        <p>
          <button type="button" disabled={head === null || props.busy} onClick={() => {
            if (head === null) return;
            const groupId = `group-${nextCommandId()}`;
            const payload = { groupId, repoId: props.repoId, libraryEntry: { entryId: entry.entryId, sha256: head.sha256 } };
            props.send(controlCommandPath({ verb: "import-plan", groupId, expectedRevision: 0, payload }), 0, payload);
          }}>{t("planLibrary.importNow")}</button>{" "}
          <button type="button" disabled={props.busy} onClick={() => props.send(planLibraryArchivePath, 0, { entryId: entry.entryId })}>{t("planLibrary.archive")}</button>{" "}
          <button type="button" disabled={head === null || props.busy} onClick={() => setScheduling(!scheduling)}>{t("planLibrary.schedule")}</button>
        </p>
      )}
      {props.may && scheduling && head !== null && (
        <ScheduleForm entry={entry} repoId={props.repoId} busy={props.busy} send={props.send} onDone={() => setScheduling(false)} />
      )}
    </li>
  );
}

export function PlanLibraryView(props: { scope: { repoId: string } }): JSX.Element {
  const { t } = useTranslation();
  const may = mayHumanOnly(useContext(AccountContext));
  const repoId = props.scope.repoId;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unread, setUnread] = useState(false);
  const [refusal, setRefusal] = useState<PanelRefusal | null>(null);
  const [importInvalid, setImportInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const readSeq = useRef(0);
  const read = useCallback(async (): Promise<void> => {
    const seq = ++readSeq.current;
    try {
      const list = await fetchPlanLibrary(repoId);
      if (!Array.isArray(list?.entries)) throw new TypeError("plan-library-shape");
      const loaded = await Promise.all(list.entries.map(async (entry): Promise<Row> => {
        try {
          const detail = await fetchPlanLibraryEntry(entry.entryId);
          return { entry, versions: Array.isArray(detail?.versions) ? detail.versions : null };
        } catch { return { entry, versions: null }; }
      }));
      if (seq === readSeq.current) { setRows(loaded); setUnread(false); }
    } catch { if (seq === readSeq.current) setUnread(true); }
  }, [repoId]);
  useEffect(() => { void read(); }, [read]);
  const post = async (path: string, expectedRevision: number, payload: unknown): Promise<void> => {
    try {
      setRefusal(null);
      const answer = await sendControlCommand(path, { commandId: nextCommandId(), expectedRevision, payload });
      const failure: PanelRefusal | null = answer.kind === "uncertain"
        ? { status: null, code: "command-outcome-unknown", message: t("panelErrors.noOutcome") }
        : answer.status >= 400 ? refusalFromAnswer(answer) : null;
      await read();
      if (failure !== null) setRefusal(failure);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const send: Send = (path, expectedRevision, payload) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    void post(path, expectedRevision, payload);
    return true;
  };
  const importFile = (file: File): void => {
    if (inFlight.current) return;
    if (file.size > 3 * 1024 * 1024) {
      setRefusal({ status: 413, code: "plan-library-doc-too-large", message: errorEntry("plan-library-doc-too-large") ?? "plan-library-doc-too-large" });
      return;
    }
    setImportInvalid(false);
    inFlight.current = true;
    setBusy(true);
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const doc: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const provenance = { fileName: file.name, fileSha256: await sha256Hex(bytes), format: "orca-plan-v1" as const };
        await post(planLibraryImportPath, 0, { projectId: repoId, name: fileNameOf(file), doc, provenance });
      } catch {
        inFlight.current = false;
        setBusy(false);
        setImportInvalid(true);
      }
    })();
  };
  return (
    <section aria-label={t("planLibrary.title")}>
      <h3>{t("planLibrary.title")}</h3>
      {refusal !== null && <Refusal refusal={refusal} />}
      {unread && <p data-testid="plan-library-unread">{t("settings.schedules.libraryFailed")}</p>}
      {!may && <p role="note">{t("settings.schedules.ownerOnly")}</p>}
      {may && (
        <div>
          <label>{t("planLibrary.import")}
            <input type="file" accept="application/json" aria-label={t("planLibrary.import")} disabled={busy}
              onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file !== undefined) importFile(file); }} />
          </label>
          <p className="detail-note">{t("planLibrary.importNote")}</p>
          {importInvalid && <p role="alert" data-testid="plan-library-import-invalid">{t("planLibrary.importInvalid")}</p>}
        </div>
      )}
      {rows !== null && (rows.length === 0 ? <p>{t("planLibrary.empty")}</p> : (
        <ul>
          {rows.map((row) => <EntryRow key={`${row.entry.entryId}:${row.entry.head?.sha256 ?? ""}`} row={row} repoId={repoId} may={may} busy={busy} send={send} />)}
        </ul>
      ))}
    </section>
  );
}
