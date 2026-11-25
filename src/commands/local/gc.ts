import { dirname } from "node:path";
import { EntryRejection } from "../../entry/envelope.js";
import { discoverSocketPath } from "../../entry/discovery.js";
import { gcControl, GcRefusal, type GcResult } from "../../control/gc.js";
import { formatBytes } from "../../control/diskUsage.js";
import type { ArtifactReclaimResult } from "../../control/artifactReclaim.js";
import { DISPATCHED_RUN_ENV } from "../../control/commandClient.js";
import { printResponse } from "../output.js";
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Tester #366 follow-up: what the backlog is waiting on, and the one action that clears each reason. */
function nextLines(result: GcResult): string[] {
  const byReason = new Map(result.skippedByReason.map((entry) => [entry.reason, entry] as const));
  const lines: string[] = [];
  const notArchived = byReason.get("group-not-archived");
  if (notArchived !== undefined) {
    lines.push(`  next: ${plural(notArchived.count, "run", "runs")} in ${plural(notArchived.groups, "group", "groups")} ${notArchived.count === 1 ? "is" : "are"} not archived; archive a group first: orca group archive <groupId>`);
  }
  const uncleaned = byReason.get("not-cleaned-up");
  if (uncleaned !== undefined) {
    lines.push(`  next: pass --include-uncleaned to plan the ${plural(uncleaned.count, "run", "runs")} whose driver never finished cleaning`);
  }
  const dirty = byReason.get("worktree-dirty");
  if (dirty !== undefined) {
    lines.push(`  next: ${dirty.count === 1 ? "1 worktree is" : `${dirty.count} worktrees are`} dirty; gc never deletes uncommitted work`);
  }
  return lines;
}

/**
 * Tester #468: the artifacts section -- what would go (or went), and what holds the rest, by reason with the bytes each
 * reason keeps, so a small result reads as "held by unarchived groups", not as "gc does not work".
 */
const ARTIFACT_LINES_SHOWN = 20;
function artifactNext(result: ArtifactReclaimResult): string[] {
  const byReason = new Map(result.skippedByReason.map((entry) => [entry.reason, entry] as const));
  const lines: string[] = [];
  const notArchived = byReason.get("group-not-archived");
  if (notArchived !== undefined) lines.push(`    next: ${formatBytes(notArchived.bytes)} held by ${plural(notArchived.groups, "group", "groups")} not archived; archive them first: orca group archive <groupId>`);
  const recent = [byReason.get("too-recent"), byReason.get("group-archived-recently")].filter((entry) => entry !== undefined);
  if (recent.length > 0) lines.push(`    next: ${formatBytes(recent.reduce((sum, entry) => sum + entry.bytes, 0))} held by runs or archives newer than --older-than; a smaller --older-than plans them`);
  if (byReason.has("not-cleaned-up")) lines.push(`    next: pass --include-uncleaned to retire runs whose driver never finished cleaning`);
  if (byReason.has("published-since-panel-start")) lines.push(`    next: the running panel published (or reused) some of these since it started; a later gc after a panel restart can plan them`);
  if (result.scan.incomplete !== null) lines.push(`    nothing planned: a held artifact could not be read (${result.scan.incomplete}); gc never guesses what it names`);
  return lines;
}

function formatArtifacts(result: ArtifactReclaimResult): string[] {
  const lines: string[] = [];
  const verb = result.dryRun ? "would free" : "freed";
  const items = result.dryRun ? result.planned : result.removed;
  lines.push(`artifacts: ${result.planned.length} planned, ${result.removed.length} removed, ${result.skipped.length} kept; ${verb} ${formatBytes(result.bytes)}; ${formatBytes(result.heldBytes)} kept`);
  if (result.skippedByReason.length > 0) {
    lines.push(`  kept by reason: ${result.skippedByReason.map((entry) => `${entry.reason} ${entry.count} (${formatBytes(entry.bytes)}${entry.groups > 0 ? `, ${plural(entry.groups, "group", "groups")}` : ""})`).join(", ")}`);
    lines.push(...artifactNext(result));
  }
  for (const item of items.slice(0, ARTIFACT_LINES_SHOWN)) lines.push(`  ${result.dryRun ? "would remove" : "removed"} artifact ${item.artifactId} (${formatBytes(item.bytes)}${item.dataMissing === true ? ", data already missing" : ""})`);
  if (items.length > ARTIFACT_LINES_SHOWN) lines.push(`  ... and ${items.length - ARTIFACT_LINES_SHOWN} more (--json lists every id)`);
  if (result.scan.unclassified.length > 0) lines.push(`  note: scanned as global holders (this gc does not know them): ${result.scan.unclassified.join(", ")}`);
  return lines;
}

export function formatGc(result: GcResult & { artifacts?: ArtifactReclaimResult }): string {
  const lines: string[] = [];
  lines.push(result.dryRun ? "orca gc: dry run (nothing removed; pass --apply to delete)" : "orca gc: applied");
  if (result.skippedByReason.length > 0) {
    lines.push(`  skipped by reason: ${result.skippedByReason.map((entry) => `${entry.reason} ${entry.count}`).join(", ")}`);
    lines.push(...nextLines(result));
  }
  for (const item of result.dryRun ? result.planned : result.removed) {
    lines.push(`  ${result.dryRun ? "would remove" : "removed"} ${item.kind} ${item.path} (${formatBytes(item.bytes)}${item.worktree ? ", git worktree" : ""}${item.uncleaned === true ? ", driver cleanup incomplete" : ""})`);
  }
  for (const skip of result.skipped) {
    lines.push(`  skipped ${skip.runId}${skip.path === null ? "" : ` ${skip.path}`}: ${skip.reason}${skip.detail === undefined ? "" : ` (${skip.detail})`}`);
  }
  // Tester #466: attempt worktrees registered in a target repository under the runs root.
  for (const entry of result.dryRun ? result.unregisterPlanned : result.unregistered) {
    lines.push(`  ${result.dryRun ? "would unregister" : "unregistered"} worktree ${entry.path} in ${entry.repo}${entry.orphan ? " (its run directory was already gone)" : ""}`);
  }
  const verb = result.dryRun ? "would free" : "freed";
  const worktrees = result.dryRun ? `${result.unregisterPlanned.length} worktree registrations to unregister` : `${result.unregistered.length} worktree registrations unregistered`;
  lines.push(`${result.planned.length} planned, ${result.removed.length} removed, ${result.skipped.length} skipped; ${verb} ${formatBytes(result.bytes)}; ${worktrees}`);
  if (result.artifacts !== undefined) lines.push(...formatArtifacts(result.artifacts));
  return `${lines.join("\n")}\n`;
}

/** The options both halves read (the runs pass here, the artifacts pass here or in the panel). */
function artifactOptions(args: ParsedArgs): { olderThanDays: number; keepLast: number; includeUncleaned?: true; groupId?: string } {
  return {
    olderThanDays: integer(args, "older-than", 30),
    keepLast: integer(args, "keep-last", 0),
    ...(args.flags["include-uncleaned"] === true ? { includeUncleaned: true as const } : {}),
    ...(typeof args.flags.group === "string" ? { groupId: args.flags.group } : {}),
  };
}

/**
 * Tester #468 (human ruling 2026-11-25): the delete is the panel's. Asked before the runs pass, so a refusal (no panel, a
 * run Orca dispatched, MCP) leaves everything as it was. Returns the panel's answer, or the exit code it printed.
 */
async function applyArtifactsInPanel(args: ParsedArgs, io: CommandIo): Promise<ArtifactReclaimResult | number> {
  if ((io.client ?? "cli").startsWith("mcp")) throw new EntryRejection("gc-artifacts-not-over-mcp", "orca gc --include-artifacts --apply deletes stored evidence and is not available over MCP; a person runs it in a terminal (the dry run is available)");
  if ((io.env[DISPATCHED_RUN_ENV] ?? "") !== "") throw new EntryRejection("control-dispatched-run-refused", "orca gc --include-artifacts --apply is not done by a run Orca dispatched; a person runs it in a terminal they attend");
  const { openSession } = await import("../panelCommand.js");
  const { requestOverSocket } = await import("../../entry/socketClient.js");
  const session = openSession(args, io);
  let answer: { status: number; body: unknown };
  try {
    answer = await requestOverSocket({ socketPath: session.socketPath, method: "POST", path: "gc/artifacts", client: session.client, headers: session.headers, body: artifactOptions(args), timeoutMs: 3_600_000 });
  } catch (error) {
    if (error instanceof EntryRejection && error.code === "panel-not-running") {
      throw new EntryRejection("panel-not-running", `orca gc --include-artifacts --apply asks the panel to delete, and no panel is listening at ${session.socketPath}; nothing was removed. Start the panel (orca panel start), or drop --apply for the dry run`, true);
    }
    throw error;
  }
  if (answer.status < 200 || answer.status >= 300) return printResponse({ schema: "orca-cli-response-v1", status: answer.status, body: answer.body }, { json: args.global.json, quiet: args.global.quiet, format: () => "" }, io);
  const { schema: _schema, ...result } = answer.body as ArtifactReclaimResult & { schema?: string };
  return result;
}

export async function runGc(args: ParsedArgs, io: CommandIo): Promise<number> {
  let stateDir: string;
  try { stateDir = dirname(discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env })); }
  catch (error) { throw new EntryRejection((error as { code?: string }).code ?? "control-state-dir-missing", (error as Error).message); }
  const includeArtifacts = args.flags["include-artifacts"] === true;
  let artifacts: ArtifactReclaimResult | undefined;
  if (includeArtifacts && args.flags.apply === true) {
    const answered = await applyArtifactsInPanel(args, io);
    if (typeof answered === "number") return answered;
    artifacts = answered;
  }
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
    if (includeArtifacts && artifacts === undefined) {
      const { dryRunArtifactsAt } = await import("../../control/artifactReclaim.js");
      artifacts = await dryRunArtifactsAt(stateDir, artifactOptions(args));
    }
  } catch (error) {
    if (error instanceof GcRefusal) throw new EntryRejection(error.code, error.message);
    throw error;
  }
  const body = { schema: "orca-gc-v1", ...result, ...(artifacts === undefined ? {} : { artifacts }) };
  if (args.global.json) io.stdout(`${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body })}\n`);
  else io.stdout(formatGc(body));
  return 0;
}