import type { Express, NextFunction, Request, Response } from "express";
import { lookupCommandResult } from "../control/commandLedger.js";
import { ControlError } from "../control/errors.js";
import { readVersions } from "../control/queries.js";
import { controlConfigSchema } from "../control/webProtocol.js";
import type { ControlStore } from "../control/store.js";
import type { TrustedControlConfig } from "./controlConfig.js";
import { controlErrorCatalog, sendControlError, sendMappedControlError } from "./controlErrors.js";
import { readControlGroup, readControlRecovery, readControlSummary, readRunEvidence } from "./controlViews.js";

export interface ControlReadApiDeps {
  store: ControlStore;
  epoch: string;
  config: Pick<TrustedControlConfig, "readView">;
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction): void => { void Promise.resolve(handler(req, res)).catch(next); };
}

function sinceChangeSeq(req: Request): number | null {
  const keys = Object.keys(req.query);
  if (keys.length === 0) return null;
  if (keys.length !== 1 || keys[0] !== "sinceChangeSeq") throw new ControlError("query-invalid");
  const raw = req.query.sinceChangeSeq;
  if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new ControlError("query-invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ControlError("query-invalid");
  return value;
}

export function registerControlReadRoutes(app: Express, deps: ControlReadApiDeps): void {
  app.get("/api/control/config", asyncRoute(async (_req, res) => {
    const base = await deps.config.readView();
    res.json(controlConfigSchema.parse({ ...base, epoch: deps.epoch, errorCatalog: controlErrorCatalog() }));
  }));

  app.get("/api/control/summary", asyncRoute((req, res) => {
    let since: number | null;
    try { since = sinceChangeSeq(req); }
    catch {
      sendControlError(res, 400, "query-invalid", "sinceChangeSeq must be a canonical decimal safe integer");
      return;
    }
    res.json(readControlSummary(deps.store, deps.epoch, since));
  }));

  app.get("/api/control/groups", (_req, res) => {
    res.json(readControlSummary(deps.store, deps.epoch, null, true));
  });

  app.get("/api/control/groups/:groupId", (req, res, next) => {
    try { res.json(readControlGroup(deps.store, deps.epoch, String(req.params.groupId))); }
    catch (error) {
      if (error instanceof ControlError && error.code === "group-not-found") {
        sendControlError(res, 404, error.code, "No control group was found.");
        return;
      }
      next(error);
    }
  });

  app.get("/api/control/groups/:groupId/commands/:commandId", (req, res, next) => {
    try {
      const groupId = String(req.params.groupId), commandId = String(req.params.commandId);
      const versions = readVersions(deps.store, groupId);
      const result = lookupCommandResult(deps.store, groupId, commandId);
      if (!result) {
        sendControlError(res, 404, "command-result-not-found", "No retained command result was found.", { commandRevision: versions.commandRevision });
        return;
      }
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/control/recovery", (_req, res) => {
    res.json(readControlRecovery(deps.store, deps.epoch));
  });

  app.get("/api/control/runs/:runId/evidence", asyncRoute(async (req, res) => {
    res.json(await readRunEvidence(deps.store, String(req.params.runId)));
  }));

  app.use("/api/control", (_req, res) => {
    sendControlError(res, 404, "route-not-found", "No control route matches this request.");
  });

  app.use("/api/control", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    sendMappedControlError(res, error);
  });
}
