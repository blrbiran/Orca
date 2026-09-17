import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Thresholds } from "./trigger.js";

export const LEVEL_CONFIG_PATH = ".orca/level.json";
// CLAUDE.md Rule 6, in context-window occupancy. Changing the cadence is a committed config change, not a judgment call (D spec 4).
export const DEFAULT_THRESHOLDS: Thresholds = { t1: 330_000, t2: 450_000 };

export interface LevelConfig {
  t1: number;
  t2: number;
  windows: Record<string, number>;
}

export class LevelConfigRejection extends Error {}

const ConfigSchema = z
  .object({
    t1: z.number().int().positive().optional(),
    t2: z.number().int().positive().optional(),
    windows: z.record(z.string().min(1), z.number().int().positive()).optional(),
  })
  .strict();

export async function loadLevelConfig(repo: string): Promise<LevelConfig> {
  let text: string;
  try {
    text = await readFile(join(repo, LEVEL_CONFIG_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_THRESHOLDS, windows: {} };
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH} cannot be read: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH} is not JSON`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH}: ${issues}`);
  }
  const t1 = parsed.data.t1 ?? DEFAULT_THRESHOLDS.t1;
  const t2 = parsed.data.t2 ?? DEFAULT_THRESHOLDS.t2;
  if (t1 >= t2) throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH}: t1 (${t1}) must be below t2 (${t2})`);
  return { t1, t2, windows: parsed.data.windows ?? {} };
}
