/**
 * Where the panel books a command id: the ledger scopes a request's id lives under (`orca command retry`, and a write's
 * --command-id lookup, issue #149), and the target the panel's route table names for it (controlApi.ts
 * controlCommandRoutes), which commandArgumentsHash covers.
 */
import { EntryRejection } from "../entry/envelope.js";
import type { SentRequest } from "./output.js";
import type { WriteContext } from "./types.js";

const invalid = (message: string) => new EntryRejection("control-cli-argument-invalid", message);

/** The scopes a request's command id is booked under (controlApi.ts controlCommandRoutes). */
export async function scopesOf(request: SentRequest, context: WriteContext): Promise<string[]> {
  const route = request.route;
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  if (route === "groups/import-plan" || route === "requirements") return [String(payload.groupId)];
  const debug = /^corrections\/([^/]+)\/debug-group$/.exec(route);
  if (debug) {
    const base = `debug-${debug[1]}`;
    const groups = ((await context.read("summary")) as { groups: Array<{ groupId: string }> }).groups.map((g) => g.groupId);
    const ids = groups.filter((id) => id === base || id.startsWith(`${base}-`));
    return ids.length === 0 ? [base] : ids;
  }
  if (route.startsWith("corrections")) return ["@corrections"];
  const groupRoute = /^groups\/([^/]+)\//.exec(route);
  if (groupRoute) return [groupRoute[1]!];
  const repository = /^repositories\/([^/]+)\//.exec(route);
  if (repository) return [`@repository:${repository[1]}`];
  if (route === "operator/agent-preferences" || route === "operator/apply-agent-update") {
    return [`@operator:${String(((await context.read("operator/agent-preferences")) as { operatorId: unknown }).operatorId)}`];
  }
  if (["operator/set-spend-cap", "operator/clear-spend-cap", "operator/set-usage-calendar"].includes(route)) return ["@spend"];
  if (route === "operator/set-orchestration-settings") return ["@orchestration"];
  if (route === "recovery/retry") {
    if (payload.scope === "group") return [String(payload.groupId)];
    const { groupOfRunId } = await import("./domains/settings.js");
    return [await groupOfRunId(context, String(payload.runId))];
  }
  throw invalid(`no command scope is known for route ${JSON.stringify(route)}`);
}

/**
 * Issue #149: the target the panel books a request under, for one of scopesOf's scopes -- mirroring controlCommandRoutes
 * for every route scopesOf knows: a scope key names its kind, a group's route names a task (`groups/<g>/tasks/<t>/...`), and
 * recovery-retry of a run names the run. A wrong target only makes the hashes differ, so the request is sent as before.
 */
export function targetOf(route: string, payload: unknown, scope: string): unknown {
  if (scope.startsWith("@repository:")) return { kind: "repository", repoId: scope.slice("@repository:".length) };
  if (scope.startsWith("@operator:")) return { kind: "operator", operatorId: scope.slice("@operator:".length) };
  if (scope === "@spend") return { kind: "spend" };
  if (scope === "@orchestration") return { kind: "orchestration" };
  if (scope === "@corrections") return { kind: "corrections" };
  const task = /^groups\/[^/]+\/tasks\/([^/]+)\//.exec(route);
  if (task) return { kind: "task", groupId: scope, taskId: task[1] };
  const fields = (payload ?? {}) as Record<string, unknown>;
  if (route === "recovery/retry" && fields.scope !== "group") return { kind: "run", groupId: scope, runId: fields.runId };
  return { kind: "group", groupId: scope };
}
