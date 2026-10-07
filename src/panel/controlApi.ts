import type { Express, NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { canonicalBytes } from "../control/canonicalJson.js";
import { readArtifact } from "../control/archive.js";
import { ZodError } from "zod";
import { lookupCommandResult } from "../control/commandLedger.js";
import { ControlError } from "../control/errors.js";
import { withCommandContext } from "../control/commandClient.js";
import { permissionRefusal, principalLabel, type Principal } from "./permissions.js";
import { readVersions } from "../control/queries.js";
import { readAgentPreferences } from "../control/agentPreferences.js";
import { resolveSelection, slotLayers, type PartialSelection } from "../control/agentSelection.js";
import { idSchema } from "../control/schema.js";
import { agentPreferencesViewSchema, agentsViewSchema, recoveryRetryPayloadSchema, usageViewSchema, commandEnvelopeSchema, controlConfigSchema, rawAuthorityCommandSchema, repositoryWorkspaceSchema, type CommandTargetV1, type CommandVerbV1, type RawAuthorityCommandV1 } from "../control/webProtocol.js";
import { parseUsageScope, readUsageView, type UsageGroupBy, type UsageQuery } from "../control/usageQuery.js";
import { readWorkspaceSetting } from "../control/workspaceSettings.js";
import { AgentCeilingRefusal } from "../control/spendCaps.js";
import type { WebControlService } from "../control/webService.js";
import type { ExecutionPort } from "../control/executionPort.js";
import type { ControlStore } from "../control/store.js";
import type { TrustedControlConfig } from "./controlConfig.js";
import { controlErrorCatalog, sendControlError, sendMappedControlError } from "./controlErrors.js";
import { readControlGroup, readControlRecovery, readControlSummary, readRequirementView, readRunEvidence, readSelectionPreview } from "./controlViews.js";

export interface ControlReadApiDeps {
  store: ControlStore;
  epoch: string;
  config: Pick<TrustedControlConfig, "readView">;
  service?: WebControlService;
  /** Agent selection spec §6.8 (W6-10): the reads that ask ccloop about agents. Absent, those routes 404. */
  port?: Pick<ExecutionPort, "listAgents" | "resolveAgent">;
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction): void => { void Promise.resolve(handler(req, res)).catch(next); };
}

/** Validate control JSON before the parser discards duplicate object keys. */
export function verifyControlJsonBody(req: { url?: string; method?: string }, _res: unknown, bytes: Buffer): void {
  if (req.method !== "POST" || !req.url?.startsWith("/api/control/")) return;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  const stack: Array<Set<string> | null> = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)) {
    const token = match[0];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && /^\s*:/.test(text.slice(match.index! + token.length))) {
      const keys = stack[stack.length - 1], key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new ControlError("control-non-canonical-json");
      keys.add(key);
    }
  }
  canonicalBytes(parsed);
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

const USAGE_GROUPS: readonly UsageGroupBy[] = ["model", "repo", "day", "week", "month"];

/** Accounts spec §5.3: `scope` is required; `from`/`to` are canonical decimal safe integers with from < to; no other key. */
function usageQuery(req: Request): UsageQuery {
  const bad = () => new ControlError("usage-query-invalid");
  const text = (key: string): string | undefined => {
    const raw = req.query[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "string") throw bad();
    return raw;
  };
  if (Object.keys(req.query).some((key) => !["scope", "from", "to", "groupBy"].includes(key))) throw bad();
  const scope = parseUsageScope(text("scope") ?? "");
  if (scope === null) throw bad();
  const bound = (key: string): number | null => {
    const raw = text(key);
    if (raw === undefined) return null;
    if (!/^(?:0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw bad();
    return Number(raw);
  };
  const from = bound("from"), to = bound("to");
  if (from !== null && to !== null && from >= to) throw bad();
  const groupBy = text("groupBy") ?? "model";
  if (!USAGE_GROUPS.includes(groupBy as UsageGroupBy)) throw bad();
  return { scope, from, to, groupBy: groupBy as UsageGroupBy };
}

function readErrorContext(store: ControlStore, groupId: string): { commandRevision: number | null; evidenceIds: string[] } {
  const group = store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId);
  if (!group) return { commandRevision: null, evidenceIds: [] };
  const evidenceIds = new Set<string>();
  for (const row of store.db.prepare("SELECT body FROM recovery_blockers WHERE group_id=?").all(groupId)) {
    try {
      const parsed = JSON.parse(String(row.body)) as { evidenceIds?: unknown };
      if (Array.isArray(parsed.evidenceIds)) for (const value of parsed.evidenceIds) if (idSchema.safeParse(value).success) evidenceIds.add(String(value));
    } catch { /* best-effort context must not mask the primary read failure */ }
  }
  return { commandRevision: Number(group.revision), evidenceIds: [...evidenceIds].sort() };
}

/**
 * Agent selection spec §6.4 last paragraph (W5-M14): the panel's profile display is the one place that probes the
 * operator's default rather than a frozen selection -- the panel operator's worker slot with no group or task layer.
 * No operator yet, or none that chose an agent, asks `{}`, which ccloop refuses: shown as the probe's failure code.
 */
function operatorDefaultSelection(store: ControlStore): PartialSelection {
  const row = store.db.prepare("SELECT value FROM meta WHERE key='panelOperatorId'").get();
  if (!row) return {};
  const prefs = readAgentPreferences(store, String(row.value)).preferences;
  try { return resolveSelection(slotLayers("worker", prefs, {}), prefs.perAgent).partial; }
  catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return {};
    throw error;
  }
}

/** The one operator this panel acts as (meta.panelOperatorId): minted on first use, then read. */
export function ensurePanelOperatorId(store: ControlStore): string {
  return store.transaction(() => {
    const prior = store.db.prepare("SELECT value FROM meta WHERE key='panelOperatorId'").get();
    if (prior) {
      if (!/^operator-[0-9a-f-]{36}$/.test(String(prior.value))) throw new ControlError("recovery-blocked");
      return String(prior.value);
    }
    const value = `operator-${randomUUID()}`;
    store.db.prepare("INSERT INTO meta(key,value) VALUES ('panelOperatorId',?)").run(value);
    return value;
  });
}

/** Agent entry spec §3, §6: which listener a request arrived on. "socket" records its agent's client; "web" records "web". */
export type ControlChannel = "web" | "socket";

export function registerControlReadRoutes(app: Express, deps: ControlReadApiDeps, channel: ControlChannel): void {
  if (deps.service) registerControlMutationRoutes(app, deps.store, deps.service, channel);
  app.get("/api/control/config", asyncRoute(async (_req, res) => {
    const base = await deps.config.readView(operatorDefaultSelection(deps.store));
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

  // Accounts spec §5.3: every principal reads usage (the permission table's reading is open to every row).
  app.get("/api/control/usage", (req, res) => {
    try { res.json(usageViewSchema.parse(readUsageView(deps.store, usageQuery(req), Date.now()))); }
    catch (error) {
      if (error instanceof ControlError && error.code === "usage-query-invalid") { sendControlError(res, 400, error.code, "The usage query is not valid."); return; }
      sendMappedControlError(res, error);
    }
  });

  app.get("/api/control/groups", (_req, res) => {
    res.json(readControlSummary(deps.store, deps.epoch, null, true));
  });

  // N1 spec §11.2: a requirement's details; its group view is refused while it is clarifying (DR25).
  app.get("/api/control/groups/:groupId/requirement", (req, res) => {
    const groupId = String(req.params.groupId);
    try { res.json(readRequirementView(deps.store, deps.epoch, groupId)); }
    catch (error) {
      if (error instanceof ControlError && error.code === "group-not-found") { sendControlError(res, 404, error.code, "No control group was found."); return; }
      sendMappedControlError(res, error, readErrorContext(deps.store, groupId));
    }
  });

  app.get("/api/control/groups/:groupId", (req, res) => {
    const groupId = String(req.params.groupId);
    try { res.json(readControlGroup(deps.store, deps.epoch, groupId)); }
    catch (error) {
      if (error instanceof ControlError && error.code === "group-not-found") {
        sendControlError(res, 404, error.code, "No control group was found.");
        return;
      }
      sendMappedControlError(res, error, readErrorContext(deps.store, groupId));
    }
  });

  app.get("/api/control/groups/:groupId/commands/:commandId", (req, res, next) => {
    try {
      const groupId = String(req.params.groupId), commandId = String(req.params.commandId);
      // A repository-scope result (`@repository:<id>`) has no group row, so versions are read only on a miss.
      const result = lookupCommandResult(deps.store, groupId, commandId);
      if (!result) {
        // A scope key (`@spend`, `@repository:<id>`, `@operator:<id>`) has no group row and no group revision to name.
        const commandRevision = groupId.startsWith("@") ? null : readVersions(deps.store, groupId).commandRevision;
        sendControlError(res, 404, "command-result-not-found", "No retained command result was found.", { commandRevision });
        return;
      }
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get("/api/control/recovery", (_req, res) => {
    res.json(readControlRecovery(deps.store, deps.epoch));
  });

  app.get("/api/control/repositories/:repoId/workspace", (req, res) => {
    const repoId = String(req.params.repoId);
    if (!idSchema.safeParse(repoId).success || !deps.service?.repositoryKnown(repoId)) {
      sendControlError(res, 404, "control-target-not-allowed", "No trusted repository has this id.");
      return;
    }
    res.json(repositoryWorkspaceSchema.parse({ schema: "orca-repository-workspace-v1", repoId, ...readWorkspaceSetting(deps.store, repoId) }));
  });

  // Agent selection spec §6.8 (plan T14). The operator is the one the mutation routes act as, so only a panel that
  // can command has one; the agents view and the preview also ask ccloop, so they need the port as well.
  if (deps.service) {
    const operatorId = ensurePanelOperatorId(deps.store);
    app.get("/api/control/operator/agent-preferences", (_req, res) => {
      try {
        res.json(agentPreferencesViewSchema.parse({ schema: "orca-agent-preferences-v1", operatorId, ...readAgentPreferences(deps.store, operatorId) }));
      } catch (error) { sendMappedControlError(res, error); }
    });
    if (deps.port) {
      const port = deps.port;
      app.get("/api/control/agents", asyncRoute(async (_req, res) => {
        try {
          const listed = await port.listAgents();
          const installations = [...listed.installations].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
          res.json(agentsViewSchema.parse({ schema: "orca-agents-view-v1", installations }));
        } catch (error) { sendMappedControlError(res, error); }
      }));
      app.get("/api/control/groups/:groupId/agent-preview", asyncRoute(async (req, res) => {
        const groupId = String(req.params.groupId);
        try { res.json(await readSelectionPreview(deps.store, port, operatorId, groupId)); }
        catch (error) {
          if (error instanceof ControlError && error.code === "group-not-found") {
            sendControlError(res, 404, error.code, "No control group was found.");
            return;
          }
          sendMappedControlError(res, error, readErrorContext(deps.store, groupId));
        }
      }));
    }
  }

  app.get("/api/control/runs/:runId/evidence", asyncRoute(async (req, res) => {
    const runId = String(req.params.runId);
    try { res.json(await readRunEvidence(deps.store, runId)); }
    catch (error) {
      const run = deps.store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
      sendMappedControlError(res, error, run ? readErrorContext(deps.store, String(run.group_id)) : undefined);
    }
  }));

  // The manifest hands the browser these URLs, so the bytes behind one have to be served by the
  // same store-verified path: the reference list is re-walked, and only a listed hash is read.
  app.get("/api/control/runs/:runId/evidence/:artifactId", asyncRoute(async (req, res) => {
    const runId = String(req.params.runId);
    const artifactId = String(req.params.artifactId);
    try {
      const manifest = await readRunEvidence(deps.store, runId);
      const entry = manifest.entries.find((row) => row.evidenceId === artifactId);
      if (!entry) throw new ControlError("recovery-blocked", "evidence-reference-unknown");
      const bytes = await readArtifact(deps.store, { artifactId: entry.evidenceId, hash: entry.sha256 });
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "default-src 'none'");
      res.setHeader("content-disposition", `attachment; filename="${entry.sha256}"`);
      res.send(bytes);
    } catch (error) {
      const run = deps.store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
      sendMappedControlError(res, error, run ? readErrorContext(deps.store, String(run.group_id)) : undefined);
    }
  }));

  app.use("/api/control", (_req, res) => {
    sendControlError(res, 404, "route-not-found", "No control route matches this request.");
  });

  app.use("/api/control", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError || (typeof error === "object" && error !== null && "type" in error && ["entity.parse.failed", "entity.verify.failed"].includes(String(error.type)))) {
      sendControlError(res, 400, "control-non-json-payload", "The command body is not valid V1 JSON.");
    } else sendMappedControlError(res, error);
  });
}

/** Resolve the command target and the ledger scope a route names; `recovery-retry` carries no group in its path. */
type RouteTarget = (params: Request["params"], payload: unknown, store: ControlStore) => { groupId: string; target: CommandTargetV1 };
const payloadFields = (payload: unknown): Record<string, unknown> =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
const scoped = (groupId: string) => ({ groupId, target: { kind: "group" as const, groupId } });
const fromParams: RouteTarget = (params) => scoped(idSchema.parse(params.groupId));
const spendScoped: RouteTarget = () => ({ groupId: "@spend", target: { kind: "spend" } });

/** Every command route and its verb; exported so the permission criterion can walk them against VERB_ACCESS (accounts spec §3.5). */
export function controlCommandRoutes(actorId: string): Array<{ path: string; verb: CommandVerbV1; target: RouteTarget }> {
  return [
    { path: "/api/control/groups/import-plan", verb: "import-plan", target: (_params, payload) => scoped(idSchema.parse(payloadFields(payload).groupId)) },
    { path: "/api/control/groups/:groupId/proposal/edit", verb: "proposal-edit", target: fromParams },
    { path: "/api/control/groups/:groupId/estimates", verb: "estimate", target: fromParams },
    { path: "/api/control/groups/:groupId/confirm", verb: "confirm", target: fromParams },
    { path: "/api/control/groups/:groupId/set-limit", verb: "set-limit", target: fromParams },
    { path: "/api/control/groups/:groupId/start", verb: "start", target: fromParams },
    { path: "/api/control/groups/:groupId/pause-dispatch", verb: "pause-dispatch", target: fromParams },
    { path: "/api/control/groups/:groupId/handoff-stop", verb: "handoff-stop", target: fromParams },
    { path: "/api/control/groups/:groupId/resume-dispatch", verb: "resume-dispatch", target: fromParams },
    { path: "/api/control/groups/:groupId/resume-from-handoff", verb: "resume-from-handoff", target: fromParams },
    {
      path: "/api/control/groups/:groupId/tasks/:taskId/continue",
      verb: "continue-task",
      target: (params) => {
        const groupId = idSchema.parse(params.groupId);
        return { groupId, target: { kind: "task", groupId, taskId: idSchema.parse(params.taskId) } };
      },
    },
    {
      path: "/api/control/recovery/retry",
      verb: "recovery-retry",
      target: (_params, payload, store) => {
        const retry = recoveryRetryPayloadSchema.parse(payload);
        if (retry.scope === "group") return scoped(retry.groupId);
        const row = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(retry.runId);
        if (!row) throw new ControlError("run-not-found");
        const groupId = idSchema.parse(String(row.group_id));
        return { groupId, target: { kind: "run", groupId, runId: retry.runId } };
      },
    },
    {
      path: "/api/control/repositories/:repoId/workspace-mode",
      verb: "set-workspace-mode",
      // The ledger key is the repository scope's, so the retained result is looked up under it.
      target: (params) => {
        const repoId = idSchema.parse(params.repoId);
        return { groupId: `@repository:${repoId}`, target: { kind: "repository", repoId } };
      },
    },
    {
      path: "/api/control/operator/agent-preferences",
      verb: "set-agent-preferences",
      // W6-4: the ledger key is the operator scope's, so the retained result is looked up under it.
      target: () => ({ groupId: `@operator:${actorId}`, target: { kind: "operator", operatorId: actorId } }),
    },
    // Accounts spec §6.1, D5: the spend scope's verbs; the ledger key is `@spend`, so the retained result is looked up under it.
    { path: "/api/control/operator/set-spend-cap", verb: "set-spend-cap", target: spendScoped },
    { path: "/api/control/operator/clear-spend-cap", verb: "clear-spend-cap", target: spendScoped },
    { path: "/api/control/operator/set-usage-calendar", verb: "set-usage-calendar", target: spendScoped },
    { path: "/api/control/groups/:groupId/proposal/agent", verb: "proposal-set-agent", target: fromParams },
    // N1 spec §11.1: the requirement commands; open names its group in the payload, as import-plan does.
    { path: "/api/control/requirements", verb: "requirement-open", target: (_params, payload) => scoped(idSchema.parse(payloadFields(payload).groupId)) },
    { path: "/api/control/groups/:groupId/requirement/answer", verb: "requirement-answer", target: fromParams },
    { path: "/api/control/groups/:groupId/requirement/consensus", verb: "requirement-consensus", target: fromParams },
    { path: "/api/control/groups/:groupId/requirement/feedback", verb: "requirement-draft-feedback", target: fromParams },
    { path: "/api/control/groups/:groupId/requirement/accept", verb: "requirement-draft-accept", target: fromParams },
    // Labels and progress spec §8 R9: the one new route; the ledger key is the group's, as for continue-task.
    {
      path: "/api/control/groups/:groupId/tasks/:taskId/labels",
      verb: "set-task-labels",
      target: (params) => {
        const groupId = idSchema.parse(params.groupId);
        return { groupId, target: { kind: "task", groupId, taskId: idSchema.parse(params.taskId) } };
      },
    },
    // Loop plans spec §5.2: the ledger key is the group's, as for set-task-labels.
    {
      path: "/api/control/groups/:groupId/tasks/:taskId/loop",
      verb: "set-task-loop",
      target: (params) => {
        const groupId = idSchema.parse(params.groupId);
        return { groupId, target: { kind: "task", groupId, taskId: idSchema.parse(params.taskId) } };
      },
    },
  ];
}

export function registerControlMutationRoutes(app: Express, store: ControlStore, service: WebControlService, channel: ControlChannel): void {
  const actorId = ensurePanelOperatorId(store);
  for (const route of controlCommandRoutes(actorId)) app.post(route.path, asyncRoute(async (req, res) => {
    let id: string | null = null;
    try {
      // Accounts spec §3.5: who sent it, set only by the listener's gate (the login middleware, the socket's header
      // gate). Mounted without that gate, fail loud rather than book a command nobody can be named for.
      const principal = res.locals.orcaPrincipal as Principal | undefined;
      if (principal === undefined) throw new Error("control request carries no principal (res.locals.orcaPrincipal)");
      // Agent entry spec §6: the client rides beside the command, in neither hash; the Web channel is always "web".
      const client = channel === "web" ? "web" : principal.kind === "agent" ? principal.client : undefined;
      if (client === undefined) throw new Error("socket channel request carries no agent principal");
      // The human-only surface is refused by name before anything is parsed further or booked: an agent or a member.
      const refusal = permissionRefusal(principal, route.verb, (req.body as { payload?: unknown } | undefined)?.payload);
      if (refusal !== null) { sendControlError(res, 403, refusal.code, refusal.message); return; }
      const envelope = commandEnvelopeSchema.parse(req.body);
      const resolved = route.target(req.params, envelope.payload, store);
      id = resolved.groupId;
      const command = rawAuthorityCommandSchema.parse({ schema: "orca-raw-command-v1", ...envelope, actorId, verb: route.verb, target: resolved.target }) as RawAuthorityCommandV1;
      await withCommandContext(command.commandId, { client, principal: principalLabel(principal) }, async () => {
        switch (command.verb) {
          case "import-plan": await service.importPlan(command); break;
          case "proposal-edit": service.editProposal(command); break;
          case "estimate": await service.createEstimate(command); break;
          case "confirm": await service.confirm(command); break;
          case "set-limit": service.setLimit(command); break;
          case "start": await service.start(command); break;
          case "pause-dispatch": await service.pauseDispatch(command); break;
          case "handoff-stop": await service.handoffStop(command); break;
          case "resume-dispatch": await service.resumeDispatch(command); break;
          case "resume-from-handoff": await service.resumeFromHandoff(command); break;
          case "continue-task": await service.continueTask(command); break;
          case "recovery-retry": await service.recoveryRetry(command); break;
          case "set-workspace-mode": await service.setWorkspaceMode(command); break;
          case "set-agent-preferences": await service.setAgentPreferences(command); break;
          case "proposal-set-agent": await service.proposalSetAgent(command); break;
          case "set-task-labels": service.setTaskLabels(command); break;
          case "set-task-loop": await service.setTaskLoop(command); break;
          case "requirement-open": await service.openRequirement(command); break;
          case "requirement-answer": service.answerRequirement(command); break;
          case "requirement-consensus": service.requirementConsensus(command); break;
          case "requirement-draft-feedback": service.requirementDraftFeedback(command); break;
          case "requirement-draft-accept": await service.acceptRequirementDraft(command); break;
          case "set-spend-cap": service.setSpendCap(command); break;
          case "clear-spend-cap": service.clearSpendCap(command); break;
          case "set-usage-calendar": service.setUsageCalendar(command); break;
          default: throw new ControlError("route-not-found");
        }
      });
      const result = lookupCommandResult(store, id, command.commandId);
      if (!result) throw new ControlError("control-command-result-invalid");
      res.status(result.originalStatus).json(result.body);
    } catch (error) {
      // Accounts spec §6.3.2, D10: the agent ceiling rolled the command back and booked nothing, so the id is not burned.
      if (error instanceof AgentCeilingRefusal) {
        sendControlError(res, 403, "control-limit-over-cap-headroom", `the import's limit of ${error.limitTokens} tokens exceeds the ${error.cap.scope} ${error.cap.period} cap's headroom of ${error.cap.headroom}; a person can import it from the Web UI or raise the cap`);
        return;
      }
      const context = id === null ? undefined : readErrorContext(store, id);
      if (error instanceof ZodError) sendControlError(res, 400, "control-non-json-payload", "The command body does not match the closed V1 schema.", context);
      else sendMappedControlError(res, error, context);
    }
  }));
}
