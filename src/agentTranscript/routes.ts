/**
 * Live transcript spec §10.6.3 / §12.3 "Read endpoints" and "Access": the read routes, keyed by Orca run, beside
 * `/api/control/runs/:runId/evidence` and `/activity`. All three web mounts (flow run page, task detail, group runs
 * table) call the same helpers.
 *
 * - Registered only when `channel === "web"` (v1 has no CLI reader, ruling 3); the socket listener answers
 *   `route-not-found` from its catch-all.
 * - An owner or a member reads; a principal carrying a run Orca dispatched is refused `control-dispatched-run-refused`.
 * - Another store's run is `run-not-found`. Paths resolve only from the stored listing or the archive manifest; no path is
 *   ever sent to the browser.
 * - Without ccloop's `features.transcripts: "v1"` the listing says why and nothing is served (§10.2.4).
 */
import type { Express, Request, Response } from "express";
import type { ExecutionPort } from "../control/executionPort.js";
import type { ControlStore } from "../control/store.js";
import { readRun } from "../control/budget.js";
import { sendControlError, sendMappedControlError } from "../panel/controlErrors.js";
import type { Principal } from "../panel/permissions.js";
import { panelIndexCache, type IndexCache } from "./lineIndex.js";
import { finalNow, findEntry, liveBytes, openEntry, runtimeOf, storedListing, type ListingRow, type StoredListing } from "./listing.js";
import { panelRedactor, type Redactor } from "./redact.js";
import { TranscriptRefusal } from "./refusal.js";
import { expandField, expandOversized, windowAfter, windowBefore, windowTail } from "./window.js";

export interface TranscriptRouteDeps {
  store: ControlStore;
  port?: Pick<ExecutionPort, "readFeatures">;
  /** Test seams; the panel uses its one cache and its environment's redactor. */
  indexCache?: IndexCache;
  redactor?: Redactor;
}

function refused(res: Response): boolean {
  const principal = res.locals.orcaPrincipal as Principal | undefined;
  if (principal?.kind === "agent" && principal.dispatchedRun !== undefined) {
    sendControlError(res, 403, "control-dispatched-run-refused", `a transcript is not read by a run Orca dispatched (${principal.dispatchedRun}); a person reads it, from the Web UI.`);
    return true;
  }
  return false;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof TranscriptRefusal) { sendControlError(res, error.status, error.code, error.message); return; }
  sendMappedControlError(res, error);
}

async function supported(deps: TranscriptRouteDeps): Promise<boolean> {
  return (await deps.port?.readFeatures?.())?.transcripts === "v1";
}

/** The run's stored listing, after the run is known to be this store's (else `run-not-found`). */
function listingOf(store: ControlStore, runId: string): StoredListing | null {
  readRun(store, runId);
  return storedListing(store, runId);
}

const queryKeys = (req: Request, allowed: readonly string[]): boolean => Object.keys(req.query).every((key) => allowed.includes(key) && typeof req.query[key] === "string");
const intParam = (value: unknown): number | null => (typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null);

export function registerTranscriptRoutes(app: Express, deps: TranscriptRouteDeps, channel: "web" | "socket"): void {
  if (channel !== "web") return;
  const cache = (): IndexCache => deps.indexCache ?? panelIndexCache;
  const redactor = (): Redactor => deps.redactor ?? panelRedactor();

  app.get("/api/control/runs/:runId/transcripts", (req, res) => {
    void (async () => {
      if (refused(res)) return;
      const runId = String(req.params.runId);
      if (Object.keys(req.query).length > 0) { sendError(res, new TranscriptRefusal("query-invalid")); return; }
      try {
        const listing = listingOf(deps.store, runId);
        if (!await supported(deps)) { res.json({ schema: "orca-run-transcripts-v1", runId, available: false, reason: "ccloop-transcripts-unsupported", calls: [] }); return; }
        const calls: ListingRow[] = [];
        for (const entry of listing?.entries ?? []) {
          calls.push({ attempt: entry.attempt, phase: entry.phase, seq: entry.seq, runtime: runtimeOf(entry), recorded: entry.path !== null, bytes: await liveBytes(listing!, entry), final: entry.final, truncatedAt: entry.truncatedAt });
        }
        res.json({ schema: "orca-run-transcripts-v1", runId, available: true, calls });
      } catch (error) { sendError(res, error); }
    })();
  });

  const call = async (req: Request) => {
    const runId = String(req.params.runId);
    const attempt = intParam(req.params.attempt), seq = intParam(req.params.seq), phase = String(req.params.phase);
    if (attempt === null || seq === null || !/^[a-z][a-z-]{0,31}$/.test(phase)) throw new TranscriptRefusal("query-invalid");
    const listing = listingOf(deps.store, runId);
    if (!await supported(deps)) throw new TranscriptRefusal("transcript-unsupported");
    if (listing === null) throw new TranscriptRefusal("transcript-not-found");
    const entry = findEntry(listing, attempt, phase, seq);
    if (entry.path === null) throw new TranscriptRefusal("transcript-not-found", "not recorded");
    const runtime = runtimeOf(entry);
    if (runtime === null) throw new TranscriptRefusal("transcript-path-invalid", "shape");
    const resolved = await openEntry(deps.store, runId, listing, entry);
    return { runId, attempt, phase, seq, listing, entry, runtime, resolved };
  };

  app.get("/api/control/runs/:runId/transcripts/:attempt/:phase/:seq", (req, res) => {
    void (async () => {
      if (refused(res)) return;
      let opened: Awaited<ReturnType<typeof call>> | null = null;
      try {
        if (!queryKeys(req, ["tail", "before", "after", "include"])) throw new TranscriptRefusal("query-invalid");
        const { tail, before, after, include } = req.query as Record<string, string | undefined>;
        const asked = [tail !== undefined, before !== undefined, after !== undefined].filter(Boolean).length;
        if (asked !== 1 || (tail !== undefined && tail !== "1") || (include !== undefined && include !== "thinking")) throw new TranscriptRefusal("query-invalid");
        opened = await call(req);
        const { reader, key } = opened.resolved.open;
        const index = await cache().get(key, reader);
        const options = { runtime: opened.runtime, redactor: redactor(), includeThinking: include === "thinking" };
        const offset = before !== undefined ? intParam(before) : after !== undefined ? intParam(after) : 0;
        if (offset === null) throw new TranscriptRefusal("query-invalid");
        const window = tail !== undefined ? await windowTail(index, reader, options) : before !== undefined ? await windowBefore(index, reader, offset, options) : await windowAfter(index, reader, offset, options);
        res.json({
          schema: "orca-transcript-window-v1", runId: opened.runId, attempt: opened.attempt, phase: opened.phase, seq: opened.seq, runtime: opened.runtime,
          source: opened.resolved.source, final: await finalNow(opened.listing, opened.entry, opened.resolved.source), truncatedAt: opened.entry.truncatedAt, ...window,
        });
      } catch (error) { sendError(res, error); }
      finally { await opened?.resolved.open.close(); }
    })();
  });

  app.get("/api/control/runs/:runId/transcripts/:attempt/:phase/:seq/expand", (req, res) => {
    void (async () => {
      if (refused(res)) return;
      let opened: Awaited<ReturnType<typeof call>> | null = null;
      try {
        if (!queryKeys(req, ["at", "i", "field", "page", "include"])) throw new TranscriptRefusal("query-invalid");
        const q = req.query as Record<string, string | undefined>;
        const at = intParam(q.at), page = intParam(q.page ?? "0");
        if (at === null || page === null || (q.include !== undefined && q.include !== "thinking")) throw new TranscriptRefusal("query-invalid");
        opened = await call(req);
        const { reader, key } = opened.resolved.open;
        const index = await cache().get(key, reader);
        let result;
        if (q.field === undefined && q.i === undefined) result = await expandOversized(index, reader, at, page, redactor());
        else {
          const i = intParam(q.i);
          if (i === null || q.field === undefined || !/^[a-z]{1,16}$/i.test(q.field)) throw new TranscriptRefusal("query-invalid");
          result = await expandField(index, reader, at, i, q.field, page, { runtime: opened.runtime, redactor: redactor(), includeThinking: q.include === "thinking" });
        }
        res.json({ schema: "orca-transcript-page-v1", runId: opened.runId, attempt: opened.attempt, phase: opened.phase, seq: opened.seq, at, ...result });
      } catch (error) { sendError(res, error); }
      finally { await opened?.resolved.open.close(); }
    })();
  });
}
