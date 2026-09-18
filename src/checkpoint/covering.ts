import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Covering } from "../level/trigger.js";
import { git } from "../scheduler/gitExec.js";
import { CHECKPOINT_DIR, type ChainMark, type Checkpoint, CheckpointSchema, runIdFor } from "./schema.js";

/**
 * D spec 9 item 10. Decided from the checkpoint files themselves, not from a separate debounce state.
 * A checkpoint that cannot be read is reported, never silently treated as absent.
 */
export async function findCovering(
  repo: string,
  sessionRef: string,
): Promise<{ covering: Covering | null; problems: string[] }> {
  const dir = join(repo, CHECKPOINT_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { covering: null, problems: [] };
    throw err;
  }
  let covering: Covering | null = null;
  const problems: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    let parsed;
    try {
      parsed = CheckpointSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    } catch (err) {
      problems.push(`${path}: ${(err as Error).message}`);
      continue;
    }
    if (!parsed.success) {
      problems.push(`${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
      continue;
    }
    const { sessionRef: owner, level } = parsed.data;
    if (owner !== sessionRef || level.kind !== "reading") continue;
    const band = level.band;
    if (band === 0) continue;
    if (covering === null || band > covering.band) covering = { path, band };
  }
  return { covering, problems };
}

export type ExitCheckpointLookup =
  | { kind: "found"; relPath: string; checkpoint: Checkpoint & { chain: ChainMark } }
  | { kind: "absent"; reason: string };

/**
 * D-launch spec §3.2 / §3.5: a session's exit checkpoint is the file its run id names AT HEAD, carrying `chain` and
 * naming this session. Read from the commit, never the worktree, so an uncommitted edit is not one; a mid-session
 * checkpoint without `chain` is not one either (review I9). Anything unreadable is "absent" with the reason.
 */
export async function exitCheckpointAtHead(repo: string, sessionRef: string): Promise<ExitCheckpointLookup> {
  const runId = runIdFor(sessionRef);
  if (runId === null) return { kind: "absent", reason: `session ${sessionRef} cannot name a run` };
  const relPath = `${CHECKPOINT_DIR}/${runId}.json`;
  let text: string;
  try {
    text = await git(repo, ["show", `HEAD:${relPath}`]);
  } catch {
    return { kind: "absent", reason: `HEAD has no ${relPath}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { kind: "absent", reason: `${relPath} at HEAD is not JSON: ${(err as Error).message}` };
  }
  const parsed = CheckpointSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "absent", reason: `${relPath} at HEAD is not a checkpoint: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` };
  }
  if (parsed.data.sessionRef !== sessionRef) return { kind: "absent", reason: `${relPath} at HEAD belongs to session ${parsed.data.sessionRef}` };
  const chain = parsed.data.chain;
  if (chain === undefined) return { kind: "absent", reason: `${relPath} at HEAD has no chain field` };
  return { kind: "found", relPath, checkpoint: { ...parsed.data, chain } };
}
