import type { Express, NextFunction, Request, Response } from "express";
import { collect } from "../metrics/collect.js";
import { computeMetrics } from "../metrics/compute.js";
import { MetricsRejection } from "../metrics/rejection.js";
import { computePanelCoverage } from "./coverage.js";
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
    now: () => (opts.now ?? (() => new Date()))().toISOString(),
  });
  return { observations, report: computeMetrics(observations, { bucket: "month" }) };
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
