/**
 * CLI v2 spec §4, §11: running a registry row that reads from, or sends to, the panel over its control socket. The CLI
 * fills ids and pins from reads made in this invocation only (nothing is cached across invocations).
 */
import { dispatchedRunHeaders } from "../control/commandClient.js";
import { discoverSocketPath } from "../entry/discovery.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "../entry/envelope.js";
import { controlGet, controlUpload } from "../entry/operations.js";
import { errorOf, printResponse } from "./output.js";
import { personTokenHeaders } from "./person.js";
import { ProjectNotMounted, resolveId, resolveProject, type ProjectRef } from "./resolve.js";
import type { CommandDef, CommandIo, ParsedArgs, ReadMapping, WriteContext } from "./types.js";

/** A read the panel answered with an error; printed as the panel's answer (exit 2). */
export class PanelAnswer extends Error {
  constructor(readonly response: CliResponseV1) { super(`the panel answered ${response.status}`); }
}

export interface PanelSession {
  socketPath: string;
  client: string;
  /** Sent with every request of this invocation (CLI v2 spec §15.5: the dispatched-run marker from the environment). */
  headers: Record<string, string>;
  /** GET, memoised for this invocation; a non-2xx answer throws PanelAnswer, a local refusal EntryRejection. */
  read(path: string): Promise<unknown>;
  /** GET again, bypassing the memo (spec §14 R1: a retry looks the command up fresh). */
  fresh(path: string): Promise<CliResponseV1>;
  /** Forget what was read, so the next read of a path asks the panel again. */
  forget(): void;
  /** POST raw bytes (gaps spec §4.7: an attachment); a non-2xx answer throws PanelAnswer, a local refusal EntryRejection. */
  upload(path: string, bytes: Buffer): Promise<unknown>;
}

export function openSession(args: ParsedArgs, io: CommandIo): PanelSession {
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  const client = io.client ?? "cli";
  // CLI v2 spec §15.3: the person token only with --as-person (refused here under the dispatched-run marker).
  const headers = { ...dispatchedRunHeaders(io.env), ...(args.global.asPerson ? personTokenHeaders(io.env) : {}) };
  const memo = new Map<string, Promise<unknown>>();
  const fresh = (path: string) => controlGet({ socketPath, client, path, headers });
  return {
    socketPath, client, headers, fresh,
    read(path) {
      let pending = memo.get(path);
      if (pending === undefined) {
        pending = fresh(path).then((response) => {
          if (response.status === 0) {
            const error = (response.body as { error: { code: string; message: string; retryable: boolean } }).error;
            throw new EntryRejection(error.code, error.message, error.retryable);
          }
          if (response.status < 200 || response.status >= 300) throw new PanelAnswer(response);
          return response.body;
        });
        memo.set(path, pending);
      }
      return pending;
    },
    forget() { memo.clear(); },
    async upload(path, bytes) {
      const response = await controlUpload({ socketPath, client, path, bytes, headers });
      if (response.status === 0) {
        const error = (response.body as { error: { code: string; message: string; retryable: boolean } }).error;
        throw new EntryRejection(error.code, error.message, error.retryable);
      }
      if (response.status < 200 || response.status >= 300) throw new PanelAnswer(response);
      return response.body;
    },
  };
}

interface SummaryV1 { groups: Array<{ groupId: string }> }
interface GroupViewLike { workItems?: Array<{ taskId: string }> }

/** Spec §4 "Ids": `group` and `task` positionals accept a unique prefix; the rest are taken as given. */
export async function resolveIds(args: ParsedArgs, session: PanelSession): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, value] of Object.entries(args.positionals)) if (typeof value === "string") ids[name] = value;
  if (ids.group !== undefined) {
    // Tester #497: names only; the summary is a full projection per group. An older panel has no id route.
    let groupIds: string[];
    try {
      groupIds = (await session.read("group-ids") as { groupIds: string[] }).groupIds;
    } catch (error) {
      const e = error as { response?: { body?: { error?: { code?: unknown } } }; code?: unknown };
      if ((e?.response?.body?.error?.code ?? e?.code) !== "route-not-found") throw error;
      groupIds = (await session.read("summary") as SummaryV1).groups.map((group) => group.groupId);
    }
    ids.group = resolveId("group", ids.group, groupIds);
  }
  if (ids.task !== undefined && ids.group !== undefined) {
    const view = await session.read(`groups/${ids.group}`) as GroupViewLike;
    ids.task = resolveId("task", ids.task, (view.workItems ?? []).map((item) => item.taskId));
  }
  return ids;
}

interface ProjectsBody { projects: Array<{ projectKey: string; path: string; controlRepoId: string | null; kind?: "dir" | "multi"; dirs?: Array<{ projectKey: string }> }>; missingPaths?: string[] }

export function contextFor(args: ParsedArgs, io: CommandIo, session: PanelSession, ids: Record<string, string>): WriteContext {
  let project: Promise<ProjectRef> | null = null;
  return {
    args, ids, io, read: (path) => session.read(path), upload: (path, bytes) => session.upload(path, bytes),
    project() {
      project ??= session.read("projects").then((body) => {
        const flag = args.global.project;
        // Project remove spec 2026-11-25 §6.2 b (tester #470): a listed project the control plane does not hold is named as
        // such, with its facts -- not `project-not-found` -- unless the flag also names a held one.
        const listed = body as ProjectsBody;
        const unheld = flag === undefined ? undefined : listed.projects.find((p) => p.controlRepoId === null && p.projectKey === flag);
        if (unheld !== undefined && !listed.projects.some((p) => p.controlRepoId === flag)) {
          const missing = (listed.missingPaths ?? []).some((line) => line.startsWith(`${unheld.projectKey}: `));
          throw new ProjectNotMounted({ projectKey: unheld.projectKey, path: unheld.path, reason: missing ? "folder not found" : "not held by the control plane" });
        }
        const refs = listed.projects
          .filter((p) => p.controlRepoId !== null)
          .map((p) => ({
            repoId: p.controlRepoId!, projectKey: p.projectKey, path: p.path,
            ...(p.kind === undefined ? {} : { kind: p.kind }), ...(p.dirs === undefined ? {} : { dirs: p.dirs.map((d) => d.projectKey) }),
          }));
        return resolveProject(refs, io.cwd, args.global.project);
      });
      return project;
    },
  };
}

async function runRead(def: CommandDef, mapping: ReadMapping, context: WriteContext): Promise<CliResponseV1> {
  const paths = await mapping.paths(context);
  const bodies = await Promise.all(paths.map((path) => context.read(path)));
  const body = mapping.compose === undefined ? bodies[0] : await mapping.compose(bodies, context);
  return { schema: "orca-cli-response-v1", status: 200, body };
}

/** Run one read or verb row; a refusal made here is exit 1, the panel's error answer exit 2 (spec §7). */
export async function runPanelCommand(def: CommandDef, args: ParsedArgs, io: CommandIo): Promise<number> {
  let context: WriteContext | undefined;
  // #246: the hint is worked out before printing (it may read), and only when a person reads the output.
  const print = async (answer: CliResponseV1, request?: Parameters<typeof printResponse>[3]): Promise<number> => {
    // #173: a row may add to a 2xx body under --json what its human text says (only-add).
    const response = args.global.json && def.jsonBody !== undefined && exitCodeFor(answer) === 0 ? { ...answer, body: def.jsonBody(answer.body) } : answer;
    const error = args.global.json || def.hint === undefined || exitCodeFor(response) === 0 ? null : errorOf(response.body);
    let hint: string | undefined;
    if (error !== null) { try { hint = await def.hint!(error, context); } catch { hint = undefined; } }
    // Tester #272 (4): a refusal's next commands, under --json as the body's `next` (only-add) and in human text as lines.
    const refused = def.next === undefined || context === undefined || exitCodeFor(response) === 0 ? null : errorOf(response.body);
    let next: string[] = [];
    if (refused !== null) { try { next = await def.next!(refused, context!) ?? []; } catch { next = []; } }
    const shown = next.length > 0 && args.global.json && typeof response.body === "object" && response.body !== null ? { ...response, body: { ...(response.body as object), next } } : response;
    // Tester #369 (c): a row whose receipt reads the panel after the answer (formatWith), only for human output.
    let formatted: string | undefined;
    if (def.formatWith !== undefined && context !== undefined && !args.global.json && !args.global.quiet && exitCodeFor(shown) === 0) {
      try { formatted = await def.formatWith(shown.body, context); } catch { formatted = undefined; }
    }
    return printResponse(shown, { json: args.global.json, quiet: args.global.quiet, format: formatted === undefined ? def.format : () => formatted!, ...(hint === undefined ? {} : { hint: () => hint }), ...(next.length === 0 ? {} : { next }),
      ...(context?.ids.group === undefined ? {} : { groupId: context.ids.group }) }, io, request);
  };
  try {
    // Spec §6.3: the one command refused without --if-revision, before anything is asked of the panel.
    if (def.mapsTo.kind === "verb" && def.mapsTo.requiresIfRevision && args.global.ifRevision === undefined) {
      throw new EntryRejection("control-cli-argument-invalid", `orca ${def.domain} ${def.action} replaces a whole document: pass --if-revision <n> with the revision you based it on (orca proposal show)`);
    }
    const session = openSession(args, io);
    context = contextFor(args, io, session, await resolveIds(args, session));
    // Issue 152: a --project the row never reads is still checked, so a misspelt one is refused, not silently ignored.
    if (args.global.project !== undefined) {
      try { await context.project(); }
      catch (error) { if (!(error instanceof ProjectNotMounted && def.answersUnmounted === true)) throw error; }
    }
    const mapping = def.mapsTo;
    if (mapping.kind === "read") return print(await runRead(def, mapping, context));
    if (mapping.kind === "verb") {
      const { runWrite } = await import("./write.js");
      const { response, request, replayed } = await runWrite(def, mapping, context, session);
      // Issue #149: stdout is what a fresh answer prints; stderr says the outcome is the booked one, not a new write.
      if (replayed) io.stderr(`orca: replayed: command ${response.commandId} was already applied\n`);
      return print(response, request);
    }
    throw new Error(`orca ${def.domain}: a local row reached the panel runner`);
  } catch (error) {
    if (error instanceof PanelAnswer) return print(error.response);
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
