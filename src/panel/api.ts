import type { Express, NextFunction, Request, Response } from "express";
import { correctionRowFrom, recordNewCorrection } from "../corrections/record.js";
import type { NewCorrectionInput } from "../corrections/record.js";
import { CorrectRejection } from "../corrections/rejection.js";
import type { Correction } from "../corrections/schema.js";
import { CORRECTION_ALREADY_RECORDED } from "../corrections/store.js";
import { collect } from "../metrics/collect.js";
import { computeMetrics } from "../metrics/compute.js";
import { MetricsRejection } from "../metrics/rejection.js";
import type { DecisionObservation } from "../metrics/types.js";
import { computePanelCoverage } from "./coverage.js";
import { loadDecisionRow } from "./decisionSource.js";
import { DECISION_NOT_FOUND, projectForList } from "./listProjection.js";
import { PanelRejection, TOKEN_REQUIRED } from "./rejection.js";
import { readReviews } from "./reviewsStore.js";
import type { ReviewsWriter } from "./reviewsStore.js";
import type { PanelOptions } from "./server.js";
import type { StaticFiles } from "./staticFiles.js";
import { tokenMatches } from "./token.js";

export interface ApiDeps {
  opts: PanelOptions;
  token: string;
  reviews: ReviewsWriter;
  statics: StaticFiles;
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

export function buildApi(app: Express, deps: ApiDeps): void {
  // 🔴 The static route. Registered BEFORE the /api token middleware, because
  // the browser's very first request -- for the HTML that CARRIES the token --
  // cannot present one.
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

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const given = req.header("x-orca-token") ?? undefined;
    if (!tokenMatches(deps.token, given)) {
      res.status(401).json({ code: TOKEN_REQUIRED, message: "this panel needs its one-time token" });
      return;
    }
    next();
  });

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

  app.get("/api/decisions", (_req, res, next) => {
    void (async () => {
      const { observations } = await currentMetrics(deps.opts);
      // Nothing is recorded here. Listing is not looking (spec section 4.2 /
      // mutation L-3): a browsed list must not itself count as review
      // coverage, or the coverage number would move just because someone
      // opened the panel.
      res.json({ rows: observations.decisions.map(projectForList) });
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
      res.json({ decision });

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
      const body = req.body as Record<string, unknown>;
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
          res.status(400).json({ code: err.code, message: err.message });
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
        await deps.reviews.append({
          decisionId,
          projectKey,
          action: "reviewed",
          by: deps.opts.by,
          at: nowIso(deps.opts),
        });
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
      const body = req.body as Record<string, unknown>;
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
    res.status(500).json({ code: "panel-internal-error", message: String(err) });
  });
}
