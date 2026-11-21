import { dirname } from "node:path";
import { EntryRejection } from "../../entry/envelope.js";
import { discoverSocketPath } from "../../entry/discovery.js";
import { gcControl, GcRefusal, type GcResult } from "../../control/gc.js";
import { formatBytes } from "../../control/diskUsage.js";
import { projectsFilePath, readProjectsFile } from "../../panel/projectsFile.js";
import type { CommandIo, ParsedArgs } from "../types.js";

/**
 * Issue #366: `orca gc` is the CLI half of the retention policy -- a local command (it needs no panel answer) that
 * reads the control store READ-ONLY and removes only the two per-run roots, so it works with the panel running. Every
 * path comes from --control-state-dir/ORCA_CONTROL_DIR (Rule 17): the tests run it against a temp state dir.
 */

function repoResolver(io: CommandIo): (repoId: string) => string | null {
  const read = readProjectsFile(projectsFilePath(io.env));
  if (read.kind !== "valid") return () => null;
  const paths = new Map(read.config.projects.map((project) => [project.id, project.path] as const));
  return (repoId) => paths.get(repoId) ?? null;
}

function integer(args: ParsedArgs, name: string, fallback: number): number {
  const value = args.flags[name];
  return typeof value === "number" ? value : fallback;
}

export function formatGc(result: GcResult): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? "orca gc: dry run (nothing removed; pass --apply to delete)" : "orca gc: applied");
  for (const item of result.dryRun ? result.planned : result.removed) {
    lines.push(`  ${result.dryRun ? "would remove" : "removed"} ${item.kind} ${item.path} (${formatBytes(item.bytes)}${item.worktree ? ", git worktree" : ""}${item.uncleaned === true ? ", driver cleanup incomplete" : ""})`);
  }
  for (const skip of result.skipped) {
    lines.push(`  skipped ${skip.runId}${skip.path === null ? "" : ` ${skip.path}`}: ${skip.reason}${skip.detail === undefined ? "" : ` (${skip.detail})`}`);
  }
  const verb = result.dryRun ? "would free" : "freed";
  lines.push(`${result.planned.length} planned, ${result.removed.length} removed, ${result.skipped.length} skipped; ${verb} ${formatBytes(result.bytes)}`);
  return `${lines.join("\n")}\n`;
}

export async function runGc(args: ParsedArgs, io: CommandIo): Promise<number> {
  let stateDir: string;
  try { stateDir = dirname(discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env })); }
  catch (error) { throw new EntryRejection((error as { code?: string }).code ?? "control-state-dir-missing", (error as Error).message); }
  let result: GcResult;
  try {
    result = await gcControl({
      stateDir,
      apply: args.flags.apply === true,
      olderThanDays: integer(args, "older-than", 30),
      keepLast: integer(args, "keep-last", 0),
      ...(args.flags["include-uncleaned"] === true ? { includeUncleaned: true } : {}),
      ...(typeof args.flags.group === "string" ? { groupId: args.flags.group } : {}),
      repoResolver: repoResolver(io),
    });
  } catch (error) {
    if (error instanceof GcRefusal) throw new EntryRejection(error.code, error.message);
    throw error;
  }
  if (args.global.json) io.stdout(`${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-gc-v1", ...result } })}\n`);
  else io.stdout(formatGc(result));
  return 0;
}