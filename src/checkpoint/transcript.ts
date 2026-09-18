import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CheckpointRejection } from "./schema.js";

/**
 * D-launch spec §3.4 (review M2): where Claude Code keeps transcripts. ORCA_CLAUDE_PROJECTS_DIR is the redirection every
 * criterion uses (Rule 17); CLAUDE_CONFIG_DIR is honoured because the cmux wrapper on this machine changes it.
 */
export function claudeProjectsRoot(env: NodeJS.ProcessEnv): string {
  if (env.ORCA_CLAUDE_PROJECTS_DIR) return env.ORCA_CLAUDE_PROJECTS_DIR;
  if (env.CLAUDE_CONFIG_DIR) return join(env.CLAUDE_CONFIG_DIR, "projects");
  return join(env.HOME || homedir(), ".claude", "projects");
}

/** Exactly by session id: "the newest transcript" picks the wrong session (handoff:4231). Zero or several is refused by name. */
export async function findTranscript(sessionRef: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (!/^[A-Za-z0-9-]+$/.test(sessionRef)) {
    throw new CheckpointRejection("session-ref-unusable", `session ${JSON.stringify(sessionRef)} cannot name a transcript file`);
  }
  const root = claudeProjectsRoot(env);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CheckpointRejection("transcript-not-found", `no transcript for session ${sessionRef}: ${root} does not exist; pass --transcript`);
    }
    throw err;
  }
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, `${sessionRef}.jsonl`);
    if (await stat(candidate).then((s) => s.isFile(), () => false)) hits.push(candidate);
  }
  if (hits.length === 0) {
    throw new CheckpointRejection("transcript-not-found", `no ${sessionRef}.jsonl in any directory under ${root}; pass --transcript`);
  }
  if (hits.length > 1) {
    throw new CheckpointRejection("transcript-ambiguous", `${hits.length} transcripts for session ${sessionRef}: ${hits.sort().join(", ")}; pass --transcript`);
  }
  return hits[0];
}
