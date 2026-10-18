import type { Express, NextFunction, Request, Response } from "express";
import { correctionRowFrom, recordNewCorrection } from "../corrections/record.js";
import type { NewCorrectionInput } from "../corrections/record.js";
import { CorrectRejection } from "../corrections/rejection.js";
import { correctionsFile, withdrawalsFile } from "../corrections/paths.js";
import { namesDecision } from "../corrections/schema.js";
import type { Correction, CorrectionKind } from "../corrections/schema.js";
import {
  CORRECTION_ALREADY_RECORDED,
  CORRECTION_NOT_FOUND,
  CORRECTION_TARGET_NOT_A_DECISION,
  readCorrections,
} from "../corrections/store.js";
import { CORRECTIONS_STORE_BUSY } from "../corrections/storeLock.js";
import {
  CORRECTION_ALREADY_WITHDRAWN,
  CORRECTION_CLOSED,
  CORRECTION_NOT_YOURS,
  CORRECTION_WITHDRAWALS_UNREADABLE,
  readWithdrawals,
  withdrawCorrection,
  withdrawnIds,
} from "../corrections/withdrawals.js";
import { collect } from "../metrics/collect.js";
import { computeMetrics } from "../metrics/compute.js";
import { readCorrectionsLeniently, readWithdrawalsLeniently } from "../metrics/lenientRead.js";
import { MetricsRejection } from "../metrics/rejection.js";
import type { DecisionObservation } from "../metrics/types.js";
import { registerChainRoutes } from "./chains.js";
import { registerMemoryRoutes } from "./memoryApi.js";
import { controlRepoKey } from "./controlOptions.js";
import { registerProjectRoutes } from "./projects.js";
import type { ProjectRegistry } from "./projectRegistry.js";
import { computePanelCoverage, reviewFlags, reviewedKeys, unreviewedHighTier } from "./coverage.js";
import { loadDecisionRow, loadQuestionsOrEmpty } from "./decisionSource.js";
import { DECISION_NOT_FOUND, projectForList } from "./listProjection.js";
import type { DecisionListRow } from "./listProjection.js";
import { PANEL_BAD_REQUEST, PanelRejection } from "./rejection.js";
import { readReviews } from "./reviewsStore.js";
import type { ReviewsWriter } from "./reviewsStore.js";
import { activeReviewers, keyOf, reviewStates } from "./reviewState.js";
import type { PanelOptions } from "./server.js";
import type { StaticFiles } from "./staticFiles.js";
import type { PanelAuth } from "./auth.js";
import { authMiddleware, registerAuthRoutes } from "./authRoutes.js";
import { ensurePanelOperatorId, registerControlReadRoutes, type ControlReadApiDeps } from "./controlApi.js";
import { archiveUnstartedDebugGroups } from "../control/debugGroup.js";
import { principalLabel, type Principal } from "./permissions.js";
import type { PanelCorrections } from "../control/correctionCommands.js";

/**
 * Panel UI redesign spec §4 (ruling U1): one ledger read per repository per request; a
 * repository whose ledger cannot be read gets null summaries, never a failed list.
 */
async function listRows(
  repos: ReadonlyArray<{ projectKey: string; path: string }>,
  decisions: readonly DecisionObservation[],
): Promise<DecisionListRow[]> {
  const byRepo = new Map<string, Map<string, string>>();
  for (const repo of repos) byRepo.set(repo.projectKey, await loadQuestionsOrEmpty(repo.path));
  return decisions.map((d) => projectForList(d, byRepo.get(d.projectKey)?.get(d.id) ?? null));
}

/** Integration-and-panel-fixes spec §9.2(1): the full list's rows, each with `reviewed` and `highTier`. */
async function listRowsWithStatus(
  repos: ReadonlyArray<{ projectKey: string; path: string }>,
  decisions: readonly DecisionObservation[],
  reviews: Parameters<typeof reviewedKeys>[0],
): Promise<Array<DecisionListRow & { reviewed: boolean; highTier: boolean }>> {
  const rows = await listRows(repos, decisions);
  const reviewed = reviewedKeys(reviews);
  return rows.map((row, i) => ({ ...row, ...reviewFlags(decisions[i]!, reviewed) }));
}

export interface ApiDeps {
  opts: PanelOptions;
  reviews: ReviewsWriter;
  statics: StaticFiles;
  control?: ControlReadApiDeps;
  /** Project registry spec §5: null in command-line mode. */
  projects?: ProjectRegistry | null;
  /** Accounts spec §3.3-§3.4: sessions; the /api middleware wants one on every route but POST /api/auth/login. */
  auth: PanelAuth;
}

/**
 * spec section 5: discovery and E2's integrity gate are re-evaluated on EVERY
 * request, not once at startup.
 *
 * E2 section 2.1.1's refusal is evaluated against the store's contents AS THEY
 * ARE, and the panel is the only long-lived consumer: a correction arriving
 * with a projectKey the startup map never had, a --repo path moved out from
 * under it, a new repository appearing under --root -- each of those silently
 * stops the gate from firing, and E2 section 2.1's whole point is that a
 * silently dropped repository makes the correction rate silently higher with
 * nothing to say so. The gate held on the configuration axis and leaked on the
 * time axis. Full scan of 144 ledger lines measured at 2.4 ms; affordable.
 *
 * `now` is the one clock this module reads, and it reads it through
 * `opts.now` rather than the wall clock directly (task 5 ruling G3): a fixed
 * clock lets a criterion build its own expected report with the exact same
 * `collect()` call and deep-equal the whole response.
 */
async function currentMetrics(opts: PanelOptions) {
  const observations = await collect({
    root: opts.root,
    repos: opts.repos,
    correctionsDir: opts.correctionsDir,
    now: () => nowIso(opts),
  });
  return { observations, report: computeMetrics(observations, { bucket: "month" }) };
}

/**
 * task 6 ruling H1, extended by task 7 ruling J2: the ONE clock expression,
 * read through `opts.now`. `panelClock` is the Date-returning form --
 * `correctionRowFrom` (task 7's one construction point) takes exactly this
 * shape -- and `nowIso` below is a thin wrapper over the SAME function, so
 * `currentMetrics`, the `opened`/`reviewed` timestamps and the correction row
 * all derive from one expression, never two copies that could drift.
 */
function panelClock(opts: PanelOptions): () => Date {
  return opts.now ?? (() => new Date());
}

function nowIso(opts: PanelOptions): string {
  return panelClock(opts)().toISOString();
}

/**
 * task 7 ruling J1: the ONE membership rule -- "does the panel's own
 * discovery currently list this exact (projectKey, id) pair" -- shared by
 * `/api/decision` (task 6) and the two POST endpoints below. A correction or
 * review can therefore never be recorded against a decision, or a
 * repository, that `currentMetrics` did not itself discover on THIS request.
 */
function isListedDecision(
  observations: { decisions: DecisionObservation[] },
  projectKey: string,
  decisionId: string,
): boolean {
  return observations.decisions.some((d) => d.projectKey === projectKey && d.id === decisionId);
}

/**
 * Final review I-2 / ruling R65: the one gate a POST body passes before any
 * field is read. Express 5 leaves `req.body` undefined when no parser ran (no
 * JSON content-type), and express.json hands through an array as readily as
 * an object; either used to surface as `500 panel-internal-error` with a
 * TypeError in it, or as a misleading 404 for a decision named "". Answers 400
 * by name and returns undefined when the body is not a plain object.
 */
export function objectBody(req: Request, res: Response): Record<string, unknown> | undefined {
  const body: unknown = req.body;
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  const got = body === undefined ? "no JSON body" : Array.isArray(body) ? "an array" : typeof body;
  res.status(400).json({
    code: PANEL_BAD_REQUEST,
    message: `this endpoint wants a JSON object sent with content-type: application/json, and got ${got}`,
  });
  return undefined;
}

/**
 * express.json's own failures (malformed JSON, too large, bad charset) are
 * http-errors carrying a string `type` and a 4xx `status`. They are the
 * client's mistake, so they answer 400 by name rather than falling through to
 * the 500 arm.
 *
 * *** ERRATUM (final review Minor N-3) *** "answer 400" was the whole of it,
 * and that flattened the parser's own 413 and 415 into 400: a client that sent
 * 70kb was told its request was malformed, while only the message said
 * otherwise. The parser has already decided the status -- the arm below now
 * passes that decision through. The `code` stays `panel-bad-request` for all
 * of them, because what the client does about it does not differ by status and
 * nothing reads a code we would have invented.
 */
function isBodyParserError(err: unknown): err is { message: string; status: number; type: string } {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; type?: unknown };
  return typeof e.type === "string" && typeof e.status === "number" && e.status >= 400 && e.status < 500;
}

/** Decisions review withdraw spec §4.4: the two refusals of POST /api/reviews/withdraw. */
export const REVIEW_NOT_ACTIVE = "review-not-active";
export const REVIEW_HAS_OPEN_CORRECTION = "review-has-open-correction";

type CorrectionState = "open" | "withdrawn" | "closed";

/** Decisions review withdraw spec §4.4 / §5.3 / §7: what GET /api/decision answers beside the decision. */
export interface DecisionReviewState {
  reviewers: Array<{ by: string; at: string }>;
  mine: "reviewed" | "none";
  corrections: Array<{
    id: string;
    kind: CorrectionKind;
    because: string;
    chose_instead?: string;
    by: string;
    at: string;
    state: CorrectionState;
    mine: boolean;
    withdrawable: boolean;
  }>;
}

/** The ids `currentMetrics` saw closed on THIS request: an overturned row in some ledger names them. */
function closedIds(observations: { overturned: ReadonlyArray<{ correctionId: string }> }): Set<string> {
  return new Set(observations.overturned.map((o) => o.correctionId));
}

/**
 * Spec §5.2: withdrawn wins over closed. The accepted window between the ledger scan and the withdrawal append can
 * leave a closed correction marked withdrawn, and readers treat it as withdrawn.
 */
function correctionState(id: string, withdrawn: ReadonlySet<string>, closed: ReadonlySet<string>): CorrectionState {
  if (withdrawn.has(id)) return "withdrawn";
  if (closed.has(id)) return "closed";
  return "open";
}

/**
 * Spec §4.4 / §5.4: is `by`'s state on the decision `reviewed`? The writer's memory answers; only a "no" re-reads the
 * reviews file first. GET /api/decision reads the disk, and a second panel process with the same --by appends without
 * changing the file's identity, so memory alone can say "not reviewed" while the detail offers Withdraw review and
 * disables Agree -- a decision nobody could move until a restart. The success path gains no I/O.
 */
async function isReviewedNow(
  reviews: ReviewsWriter,
  projectKey: string,
  decisionId: string,
  by: string,
): Promise<boolean> {
  if (reviews.stateOf(projectKey, decisionId, by) === "reviewed") return true;
  await reviews.load();
  return reviews.stateOf(projectKey, decisionId, by) === "reviewed";
}

/**
 * Spec §4.4 / §5.4: does `by` still have an open (neither withdrawn nor closed) correction on this decision? Strict
 * reads, because the answer gates a write: an unreadable store refuses rather than reading as "none open".
 */
async function hasOpenCorrection(
  dir: string,
  closed: ReadonlySet<string>,
  by: string,
  projectKey: string,
  decisionId: string,
): Promise<boolean> {
  const withdrawn = withdrawnIds(await readWithdrawals(dir));
  return (await readCorrections(dir)).some(
    (c) =>
      namesDecision(c) &&
      c.projectKey === projectKey &&
      c.decisionId === decisionId &&
      c.by === by &&
      correctionState(c.id, withdrawn, closed) === "open",
  );
}

/**
 * POST /api/corrections/withdraw's precondition (decisions review withdraw spec §5.2): the correction's decision must be
 * one this request's discovery lists (ruling J1's membership rule), and closed-ness is that same scan's (`closedIds`),
 * taken BEFORE the store lock (§5.2's accepted window). A pending-target correction has no decision to check and is
 * left to withdrawCorrection's own refusal. One function for the route and the correction-withdraw verb.
 */
async function withdrawPrecondition(
  opts: PanelOptions,
  correctionId: string,
): Promise<{ kind: "not-listed"; projectKey: string; decisionId: string } | { kind: "ok"; closed: ReadonlySet<string> }> {
  const { observations } = await currentMetrics(opts);
  const target = (await readCorrections(opts.correctionsDir)).find((c) => c.id === correctionId);
  if (target !== undefined && namesDecision(target) && !isListedDecision(observations, target.projectKey, target.decisionId)) {
    return { kind: "not-listed", projectKey: target.projectKey, decisionId: target.decisionId };
  }
  return { kind: "ok", closed: closedIds(observations) };
}

/**
 * Debug task plan Task 11: what the control service's correction verbs take from the panel. The routes below call these
 * same functions, so a correction recorded or withdrawn through a verb leaves the rows these routes leave: the panel's
 * project key, its clock, its withdraw precondition (membership and closed rule) and its review marks.
 */
export function panelCorrections(opts: PanelOptions, reviews: ReviewsWriter): PanelCorrections {
  return {
    projectKeyOf: (repoId) => opts.repos.find((repo) => controlRepoKey(repo.projectKey) === repoId)?.projectKey ?? null,
    now: () => panelClock(opts)(),
    withdrawPrecondition: (correctionId) => withdrawPrecondition(opts, correctionId),
    markReviewed: async ({ projectKey, decisionId, by }) => {
      await reviews.append({ decisionId, projectKey, action: "reviewed", by, at: nowIso(opts) });
    },
    withdrawReview: async ({ projectKey, decisionId, by }, closed) =>
      (await isReviewedNow(reviews, projectKey, decisionId, by)) &&
      !(await hasOpenCorrection(opts.correctionsDir, closed, by, projectKey, decisionId))
        ? await reviews.append({ decisionId, projectKey, action: "withdrawn", by, at: nowIso(opts) })
        : "skipped",
  };
}

/**
 * Spec §4.4 / §5.3 / §7: who has this decision reviewed now, whether the caller does, and every decision-target
 * correction on it in file order. The two corrections files are read leniently, as `currentMetrics` read them on
 * this same request: a read-only view must not lose the decision to one bad line. The withdraw route itself reads
 * strictly and refuses on that line.
 */
async function decisionReviewState(
  dir: string,
  me: string,
  closed: ReadonlySet<string>,
  projectKey: string,
  decisionId: string,
): Promise<DecisionReviewState> {
  const rows = await readReviews(dir);
  const states = reviewStates(rows);
  // File order: the last `reviewed` row of a person is the one their current state rests on.
  const reviewedAt = new Map<string, string>();
  for (const r of rows) {
    if (r.action === "reviewed" && r.projectKey === projectKey && r.decisionId === decisionId) reviewedAt.set(r.by, r.at);
  }
  const reviewers = activeReviewers(states, projectKey, decisionId).map((by) => ({ by, at: reviewedAt.get(by) ?? "" }));
  const mine = states.get(keyOf(projectKey, decisionId))?.get(me) === "reviewed" ? "reviewed" : "none";

  const withdrawn = withdrawnIds((await readWithdrawalsLeniently(withdrawalsFile(dir))).rows);
  const corrections = (await readCorrectionsLeniently(correctionsFile(dir))).rows
    .filter((c) => namesDecision(c) && c.projectKey === projectKey && c.decisionId === decisionId)
    .map((c) => {
      const state = correctionState(c.id, withdrawn, closed);
      const isMine = c.by === me;
      return {
        id: c.id,
        kind: c.kind,
        because: c.because,
        ...(c.chose_instead === undefined ? {} : { chose_instead: c.chose_instead }),
        by: c.by,
        at: c.at,
        state,
        mine: isMine,
        withdrawable: isMine && state === "open",
      };
    });
  return { reviewers, mine, corrections };
}

/**
 * Spec §5.5: the panel's own sentence for each withdrawal refusal (ruling J5's lesson: the CLI's text may name flags
 * a web page does not have). Unknown codes keep the store's own message.
 */
function withdrawRefusalMessage(code: string, storeMessage: string): string {
  switch (code) {
    case CORRECTION_NOT_FOUND:
      return "There is no correction with this id.";
    case CORRECTION_TARGET_NOT_A_DECISION:
      return "This correction names a pending decision of a run, not a recorded decision, and cannot be withdrawn here.";
    case CORRECTION_NOT_YOURS:
      return "This correction was recorded by someone else; only they can withdraw it.";
    case CORRECTION_ALREADY_WITHDRAWN:
      return "This correction has already been withdrawn.";
    case CORRECTION_CLOSED:
      return (
        "This correction is already closed: its fix is in the ledger. To change your mind, record a new correction " +
        "instead."
      );
    case CORRECTION_WITHDRAWALS_UNREADABLE:
      return `The correction withdrawals file cannot be read, so nothing was withdrawn: ${storeMessage}`;
    case CORRECTIONS_STORE_BUSY:
      return "Someone else is writing the corrections store right now; nothing was withdrawn. Try again in a moment.";
    default:
      return storeMessage;
  }
}

export function buildApi(app: Express, deps: ApiDeps): void {
  // 🔴 The static route. Registered BEFORE the /api session middleware, because
  // the browser's very first request -- for the HTML that shows the login form --
  // cannot present one (accounts spec §3.4: static files are served without auth).
  //
  // This whole block is external review seat 1's Critical 2: the first draft
  // constructed `statics`, passed it into ApiDeps, and then no route ever read
  // it. Three things collapsed together and none of them was visible from any
  // single task: spec §2.2's HTTP half had no implementer, spec §7 step 9
  // (`/../../etc/passwd` -> 404) had nothing to run against, and the injected
  // token could never reach a browser. Task 4 unit-tested the LOADER and the
  // Self-Review recorded §2.2 as covered.
  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/")) return next();
    // Exact key only. req.path is never joined to anything, so a traversal has
    // no path to travel: "/" is the sole rewrite, and it is a fixed string.
    const name = req.path === "/" ? "index.html" : req.path.slice(1);
    const asset = deps.statics.get(name);
    if (asset === undefined) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    res.status(200).type(asset.contentType).send(asset.bytes);
  });

  app.use("/api", authMiddleware(deps.auth));
  // Ruling Q8: after the middleware, so every auth route but POST /api/auth/login gets the login, CSRF and
  // password-change checks.
  registerAuthRoutes(app, deps.auth);

  if (deps.control) registerControlReadRoutes(app, deps.control, "web");

  app.get("/api/metrics", (_req, res, next) => {
    void (async () => {
      const { observations, report } = await currentMetrics(deps.opts);
      const reviews = await readReviews(deps.opts.correctionsDir);
      res.json({
        report,
        panel_review_coverage: computePanelCoverage(observations.decisions, reviews),
      });
    })().catch(next);
  });

  /**
   * task 8 ruling K5: spec §4.2's default-view mitigation, served rather than
   * computed in the browser. Same shape as /api/decisions -- discovery and
   * the gate re-run on every request, and listing here records nothing
   * either, for the identical reason (mutation L-3's lesson applies just the
   * same to a to-do list as it does to the full list).
   */
  app.get("/api/todo", (_req, res, next) => {
    void (async () => {
      const { observations } = await currentMetrics(deps.opts);
      const reviews = await readReviews(deps.opts.correctionsDir);
      res.json({ rows: await listRows(observations.repos, unreviewedHighTier(observations.decisions, reviews)) });
    })().catch(next);
  });

  app.get("/api/decisions", (_req, res, next) => {
    void (async () => {
      const { observations } = await currentMetrics(deps.opts);
      // Nothing is recorded here. Listing is not looking (spec section 4.2 /
      // mutation L-3): a browsed list must not itself count as review
      // coverage, or the coverage number would move just because someone
      // opened the panel.
      const reviews = await readReviews(deps.opts.correctionsDir);
      res.json({ rows: await listRowsWithStatus(observations.repos, observations.decisions, reviews) });
    })().catch(next);
  });

  app.get("/api/decision", (req, res, next) => {
    void (async () => {
      // Query string, not path segments: a projectKey is `github.com/biran/orca`
      // and carries two slashes of its own, so any path-shaped route would need
      // a wildcard segment and would still be ambiguous about where the key
      // ends and the decision id begins (task 6 ruling; see listProjection.ts's
      // detailUrl, the one place this URL is spelled).
      const projectKey = String(req.query.projectKey ?? "");
      const decisionId = String(req.query.decisionId ?? "");

      // spec ruling H2: re-runs discovery and E2's gate on every request, same
      // as /api/metrics -- a broken gate answers 409 here too, through the
      // shared error handler below, never a stale or partial detail.
      const { observations } = await currentMetrics(deps.opts);

      // Membership requires BOTH projectKey and id: decision ids repeat across
      // clones and forks (the same lesson computePanelCoverage's join encodes),
      // so id alone would let one repo's request return another repo's row.
      // task 7 ruling J1: the ONE definition, shared with the POST endpoints.
      const known = isListedDecision(observations, projectKey, decisionId);
      // The repo path a browser-supplied projectKey may select is only ever one
      // `currentMetrics` already discovered -- never a filesystem path built
      // from user input.
      const repo = known ? observations.repos.find((r) => r.projectKey === projectKey) : undefined;
      const decision = repo === undefined ? undefined : await loadDecisionRow(repo.path, decisionId);

      if (decision === undefined) {
        res.status(404).json({ code: DECISION_NOT_FOUND, message: `no decision ${decisionId}` });
        return;
      }
      // Decisions review withdraw spec §4.4 / §5.3: the review state rides on the same response.
      const review = await decisionReviewState(
        deps.opts.correctionsDir,
        deps.opts.by,
        closedIds(observations),
        projectKey,
        decisionId,
      );
      res.json({ decision, review });

      // 🔴 spec section 4.3.1: AFTER the response, never before. `opened` is a
      // noise signal; letting it sit on the read path means two browser tabs
      // can make a detail request fail because the system could not record
      // that someone had glanced at it -- the observation mechanism jamming the
      // thing it observes. A failure here is a server-side warning and nothing
      // more.
      //
      // `reviewed` is the opposite and is handled in task 7: it is a deliberate
      // act, so a failure to record it MUST reach the person, or they walk away
      // believing they reviewed something the ledger never heard about.
      void deps.reviews
        .append({
          decisionId,
          projectKey,
          action: "opened",
          by: deps.opts.by,
          at: nowIso(deps.opts),
        })
        .catch((err: unknown) => {
          process.stderr.write(`orca panel: could not record opened for ${decisionId}: ${String(err)}\n`);
        });
    })().catch(next);
  });

  /**
   * task 7: spec §2.1 / §2.3 / §4.4. Records a correction; NEVER closes the
   * loop -- no repo lock, no write into `.decisions/`, no commit in any
   * repository. That closing act stays exclusively `orca correct --close`
   * (A' §4.1: a web application holding commit rights on every repository is
   * the thing being refused).
   */
  app.post("/api/corrections", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const projectKey = String(body.projectKey ?? "");
      const decisionId = String(body.decisionId ?? "");

      // ruling J1: the browser never names a filesystem path. It names a
      // (projectKey, decisionId) pair, checked against THIS request's own
      // discovery -- same as /api/decision, including a broken gate
      // answering 409 through currentMetrics's own MetricsRejection.
      const { observations } = await currentMetrics(deps.opts);
      if (!isListedDecision(observations, projectKey, decisionId)) {
        res.status(404).json({ code: DECISION_NOT_FOUND, message: `no decision ${decisionId} in ${projectKey}` });
        return;
      }

      // ruling J2: the ONE construction point (spec §2.3) and the ONE clock.
      // The panel never builds a `CorrectionRow` literal of its own -- that is
      // exactly the shape fields.ts's comment says makes the "both paths
      // agree" criterion unmutatable.
      const input = {
        projectKey,
        decisionId,
        kind: body.kind,
        // Passed through EXACTLY as sent, empty string included. Coercing ""
        // to absent here would make the seam's named refusal unreachable from
        // the panel and silently drop the field A' §4.3 calls the most
        // valuable in the row -- the precise harm record.ts's comment says it
        // refuses rather than coerces in order to prevent.
        ...(body.chose_instead === undefined ? {} : { chose_instead: body.chose_instead }),
        because: String(body.because ?? ""),
        by: deps.opts.by,
      } as NewCorrectionInput;
      const row = correctionRowFrom(input, panelClock(deps.opts));

      let stored: Correction;
      try {
        stored = await recordNewCorrection(deps.opts.correctionsDir, row, {
          again: body.again === true,
        });
      } catch (err) {
        if (err instanceof CorrectRejection && err.code === CORRECTION_ALREADY_RECORDED) {
          // ruling J5 / mutation C-14: the panel's OWN sentence. The CLI's
          // "Pass --again to record another one on purpose" names a flag that
          // does not exist on a web page.
          res.status(409).json({
            code: err.code,
            message:
              `You already recorded a correction on this decision. If you mean to record a ` +
              `second, separate one, choose "record another" and it will be kept alongside the ` +
              `first rather than replacing it.`,
            retry_field: "again",
          });
          return;
        }
        if (err instanceof CorrectRejection) {
          // Final review M-8 / ruling R65: a busy store is a transient
          // conflict with another writer, not something wrong with this
          // request -- 409, same as the reviews store's own busy refusal.
          const status = err.code === CORRECTIONS_STORE_BUSY ? 409 : 400;
          res.status(status).json({ code: err.code, message: err.message });
          return;
        }
        next(err);
        return;
      }

      // ruling J6: `reviewed` is a deliberate act, unlike the detail
      // endpoint's `opened` -- awaited on purpose, so a failure to record it
      // reaches the person instead of leaving them believing they reviewed
      // something the ledger never heard about. A refused correction (above)
      // never reaches this line, so it never writes `reviewed`.
      try {
        await panelCorrections(deps.opts, deps.reviews).markReviewed({ projectKey, decisionId, by: deps.opts.by });
      } catch (err) {
        const code = err instanceof PanelRejection ? err.code : "panel-internal-error";
        const message = err instanceof Error ? err.message : String(err);
        res.status(409).json({
          code,
          message:
            `the correction was recorded (id ${stored.id}), but the reviewed mark could not be ` +
            `written: ${message}`,
          correction: stored,
        });
        return;
      }
      res.json({ correction: stored });
    })().catch(next);
  });

  /**
   * task 7 ruling J6: the explicit "I reviewed this" act -- the person clicks
   * agreed on a decision without correcting it. Same membership rule, same
   * `reviewed` action; a failed append propagates to the shared error handler
   * below (a `PanelRejection` becomes 409) rather than being caught here,
   * unlike the corrections handler above where the correction already landed
   * and must be reported alongside the failure.
   */
  app.post("/api/reviews", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const projectKey = String(body.projectKey ?? "");
      const decisionId = String(body.decisionId ?? "");

      const { observations } = await currentMetrics(deps.opts);
      if (!isListedDecision(observations, projectKey, decisionId)) {
        res.status(404).json({ code: DECISION_NOT_FOUND, message: `no decision ${decisionId} in ${projectKey}` });
        return;
      }

      const result = await deps.reviews.append({
        decisionId,
        projectKey,
        action: "reviewed",
        by: deps.opts.by,
        at: nowIso(deps.opts),
      });
      res.json({ result });
    })().catch(next);
  });

  /**
   * Decisions review withdraw spec §4.4: withdraws the CALLER's review only. Refused while the caller's state is not
   * `reviewed` (a withdrawn row with nothing behind it is never written, §4.3), and while the caller still has an
   * open correction on the decision: that decision stays reviewed until the correction is withdrawn, which takes the
   * review with it (§5.4).
   */
  app.post("/api/reviews/withdraw", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const projectKey = String(body.projectKey ?? "");
      const decisionId = String(body.decisionId ?? "");

      const { observations } = await currentMetrics(deps.opts);
      if (!isListedDecision(observations, projectKey, decisionId)) {
        res.status(404).json({ code: DECISION_NOT_FOUND, message: `no decision ${decisionId} in ${projectKey}` });
        return;
      }

      if (!(await isReviewedNow(deps.reviews, projectKey, decisionId, deps.opts.by))) {
        res.status(409).json({
          code: REVIEW_NOT_ACTIVE,
          message: "You have not reviewed this decision, so there is no review of yours to withdraw.",
        });
        return;
      }
      const closed = closedIds(observations);
      let open: boolean;
      try {
        open = await hasOpenCorrection(deps.opts.correctionsDir, closed, deps.opts.by, projectKey, decisionId);
      } catch (err) {
        // An unreadable withdrawals file is a refusal the person can act on, not a 500.
        if (err instanceof CorrectRejection && err.code === CORRECTION_WITHDRAWALS_UNREADABLE) {
          res.status(409).json({ code: err.code, message: withdrawRefusalMessage(err.code, err.message) });
          return;
        }
        throw err;
      }
      if (open) {
        res.status(409).json({
          code: REVIEW_HAS_OPEN_CORRECTION,
          message:
            "You have an open correction on this decision. Withdraw the correction first; your review is withdrawn " +
            "with it.",
        });
        return;
      }

      const result = await deps.reviews.append({
        decisionId,
        projectKey,
        action: "withdrawn",
        by: deps.opts.by,
        at: nowIso(deps.opts),
      });
      res.json({ result });
    })().catch(next);
  });

  /**
   * Decisions review withdraw spec §5.2 / §5.4 / §5.5. The body names only the correction; its decision must be one
   * this request's discovery lists (ruling J1's membership rule), checked before the store lock -- withdrawCorrection
   * re-reads the store under the lock and judges there. A pending-target correction has no decision to check and is
   * left to withdrawCorrection's own refusal.
   *
   * Closed-ness comes from the `currentMetrics` scan taken BEFORE the lock (§5.2's accepted window).
   */
  app.post("/api/corrections/withdraw", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const correctionId = String(body.correctionId ?? "");
      const dir = deps.opts.correctionsDir;
      const by = deps.opts.by;

      // Debug task plan Task 11 (fix round 1): the membership guard and the closed set are one helper, shared with the
      // correction-withdraw verb (panelCorrections below), because the closed set is only sound for a listed decision.
      const precondition = await withdrawPrecondition(deps.opts, correctionId);
      if (precondition.kind === "not-listed") {
        res.status(404).json({
          code: DECISION_NOT_FOUND,
          message: `no decision ${precondition.decisionId} in ${precondition.projectKey}`,
        });
        return;
      }

      const { closed } = precondition;
      let withdrawn: Awaited<ReturnType<typeof withdrawCorrection>>;
      try {
        withdrawn = await withdrawCorrection(dir, {
          correctionId,
          by,
          at: nowIso(deps.opts),
          isClosed: (c) => closed.has(c.id),
        });
      } catch (err) {
        if (err instanceof CorrectRejection) {
          res
            .status(err.code === CORRECTION_NOT_FOUND ? 404 : 409)
            .json({ code: err.code, message: withdrawRefusalMessage(err.code, err.message) });
          return;
        }
        next(err);
        return;
      }

      // Debug task plan Task 6 (withdraw Amendment 2): a live debug group of the withdrawn correction that has not started
      // a task run is archived (archive deletes nothing); a started one is left running and named in the answer. Right
      // after the withdrawal, before the review step can answer: a retry is refused as already withdrawn, so this is the
      // one chance. A refused or failed archive leaves the correction withdrawn and is answered beside it (§5.4's shape).
      const principal = res.locals.orcaPrincipal as Principal | undefined;
      let settled: ReturnType<typeof archiveUnstartedDebugGroups> = { debugGroups: [], failure: null };
      if (deps.control?.service !== undefined) {
        try {
          settled = archiveUnstartedDebugGroups({ store: deps.control.store, service: deps.control.service }, withdrawn.correction.id, {
            actorId: ensurePanelOperatorId(deps.control.store), principal: principal === undefined ? "web" : principalLabel(principal),
          });
        } catch (err) {
          settled = { debugGroups: [], failure: { groupId: null, code: "panel-internal-error", message: err instanceof Error ? err.message : String(err) } };
        }
      }
      const { debugGroups, failure } = settled;
      const debugFields = { ...(debugGroups.length === 0 ? {} : { debugGroups }), ...(failure === null ? {} : { debugGroupFailure: failure }) };
      const archiveSentence = failure === null ? "" : `; its debug group ${failure.groupId ?? "(unknown)"} could not be archived: ${failure.message}`;

      // §5.4: the reviewed mark that came with the correction goes too -- only while the caller's state is still
      // `reviewed` and no other open correction of theirs remains on the decision. Written AFTER the withdrawal, so
      // a failure here is reported beside it (like the corrections route's "recorded but reviewed mark not written").
      const { projectKey, decisionId } = withdrawn.correction;
      let review: "written" | "duplicate" | "skipped";
      try {
        review = await panelCorrections(deps.opts, deps.reviews).withdrawReview({ projectKey, decisionId, by }, closed);
      } catch (err) {
        const code =
          err instanceof PanelRejection || err instanceof CorrectRejection ? err.code : "panel-internal-error";
        const message = err instanceof Error ? err.message : String(err);
        res.status(409).json({
          code,
          message:
            `the correction was withdrawn (id ${withdrawn.correction.id}), but your review of the decision could ` +
            `not be withdrawn with it: ${message}${archiveSentence}`,
          withdrawal: withdrawn.withdrawal,
          ...debugFields,
        });
        return;
      }
      if (failure !== null) {
        res.status(409).json({
          code: failure.code,
          message: `the correction was withdrawn (id ${withdrawn.correction.id})${archiveSentence}`,
          withdrawal: withdrawn.withdrawal, review, ...debugFields,
        });
        return;
      }
      res.json({ withdrawal: withdrawn.withdrawal, review, ...debugFields });
    })().catch(next);
  });

  // Memory tab spec §5.1: GET only, above the error handler like every other route.
  registerMemoryRoutes(app, deps.opts);
  registerChainRoutes(app, deps.opts, objectBody);
  // Project switcher spec D1 (§8), project registry §12 C2: the control plane holds exactly the projects in
  // opts.repos (given with --repo, or added to the registry since boot), so the join is computed per request.
  registerProjectRoutes(app, {
    opts: deps.opts,
    registry: deps.projects ?? null,
    controlRepoId: (key) => (deps.control && deps.opts.repos.some((repo) => repo.projectKey === key) ? controlRepoKey(key) : null),
  });

  // Errors last. A gate refusal is a first-class error page, never partial
  // data: relaxing here would void E2's gate entirely.
  //
  // ⚠️ Express matches by registration order. Tasks 6/7 add routes to this
  // function -- always ABOVE this error handler, never below it, or express
  // stops matching them as ordinary routes.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MetricsRejection || err instanceof PanelRejection) {
      res.status(409).json({ code: err.code, message: err.message });
      return;
    }
    if (isBodyParserError(err)) {
      res
        .status(err.status)
        .json({ code: PANEL_BAD_REQUEST, message: `the request body could not be read: ${err.message}` });
      return;
    }
    res.status(500).json({ code: "panel-internal-error", message: err instanceof Error ? err.message : String(err) });
  });
}
