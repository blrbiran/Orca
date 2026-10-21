/**
 * CLI v2 spec §4, §11: running a registry row that reads from, or sends to, the panel over its control socket. The CLI
 * fills ids and pins from reads made in this invocation only (nothing is cached across invocations).
 */
import { discoverSocketPath } from "../entry/discovery.js";
import { EntryRejection, localError, type CliResponseV1 } from "../entry/envelope.js";
import { controlGet } from "../entry/operations.js";
import { printResponse } from "./output.js";
import { resolveId, resolveProject, type ProjectRef } from "./resolve.js";
import type { CommandDef, CommandIo, ParsedArgs, ReadMapping, WriteContext } from "./types.js";

/** A read the panel answered with an error; printed as the panel's answer (exit 2). */
export class PanelAnswer extends Error {
  constructor(readonly response: CliResponseV1) { super(`the panel answered ${response.status}`); }
}

export interface PanelSession {
  socketPath: string;
  client: string;
  /** GET, memoised for this invocation; a non-2xx answer throws PanelAnswer, a local refusal EntryRejection. */
  read(path: string): Promise<unknown>;
  /** GET again, bypassing the memo (spec §14 R1: a retry looks the command up fresh). */
  fresh(path: string): Promise<CliResponseV1>;
  /** Forget what was read, so the next read of a path asks the panel again. */
  forget(): void;
}

export function openSession(args: ParsedArgs, io: CommandIo): PanelSession {
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  const client = "cli";
  const memo = new Map<string, Promise<unknown>>();
  const fresh = (path: string) => controlGet({ socketPath, client, path });
  return {
    socketPath, client, fresh,
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
  };
}

interface SummaryV1 { groups: Array<{ groupId: string }> }
interface GroupViewLike { workItems?: Array<{ taskId: string }> }

/** Spec §4 "Ids": `group` and `task` positionals accept a unique prefix; the rest are taken as given. */
export async function resolveIds(args: ParsedArgs, session: PanelSession): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, value] of Object.entries(args.positionals)) if (typeof value === "string") ids[name] = value;
  if (ids.group !== undefined) {
    const summary = await session.read("summary") as SummaryV1;
    ids.group = resolveId("group", ids.group, summary.groups.map((g) => g.groupId));
  }
  if (ids.task !== undefined && ids.group !== undefined) {
    const view = await session.read(`groups/${ids.group}`) as GroupViewLike;
    ids.task = resolveId("task", ids.task, (view.workItems ?? []).map((item) => item.taskId));
  }
  return ids;
}

interface ProjectsBody { projects: Array<{ projectKey: string; path: string; controlRepoId: string | null }> }

export function contextFor(args: ParsedArgs, io: CommandIo, session: PanelSession, ids: Record<string, string>): WriteContext {
  let project: Promise<ProjectRef> | null = null;
  return {
    args, ids, io, read: (path) => session.read(path),
    project() {
      project ??= session.read("projects").then((body) => {
        const refs = (body as ProjectsBody).projects
          .filter((p) => p.controlRepoId !== null)
          .map((p) => ({ repoId: p.controlRepoId!, projectKey: p.projectKey, path: p.path }));
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
  const print = (response: CliResponseV1, request?: Parameters<typeof printResponse>[3]): number =>
    printResponse(response, { json: args.global.json, quiet: args.global.quiet, format: def.format }, io, request);
  try {
    // Spec §6.3: the one command refused without --if-revision, before anything is asked of the panel.
    if (def.mapsTo.kind === "verb" && def.mapsTo.requiresIfRevision && args.global.ifRevision === undefined) {
      throw new EntryRejection("control-cli-argument-invalid", `orca ${def.domain} ${def.action} replaces a whole document: pass --if-revision <n> with the revision you based it on (orca proposal show)`);
    }
    const session = openSession(args, io);
    const context = contextFor(args, io, session, await resolveIds(args, session));
    const mapping = def.mapsTo;
    if (mapping.kind === "read") return print(await runRead(def, mapping, context));
    if (mapping.kind === "verb") {
      const { runWrite } = await import("./write.js");
      const { response, request } = await runWrite(def, mapping, context, session);
      return print(response, request);
    }
    throw new Error(`orca ${def.domain}: a local row reached the panel runner`);
  } catch (error) {
    if (error instanceof PanelAnswer) return print(error.response);
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
