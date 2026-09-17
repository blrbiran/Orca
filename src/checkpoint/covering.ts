import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Covering } from "../level/trigger.js";
import { CHECKPOINT_DIR, CheckpointSchema } from "./schema.js";

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
