import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readClaudeCodeTranscript } from "../level/claudeCode.js";
import { LevelConfigRejection, loadLevelConfig } from "../level/config.js";
import { ChainRejection } from "./rejection.js";

export const CHAIN_CONFIG_PATH = ".orca/chain.json";
/** Spec §1 R5: a backstop, not a pace. */
export const DEFAULT_SESSION_TIMEOUT_MIN = 360;
const ChainConfigSchema = z.object({ model: z.string().min(1), sessionTimeoutMin: z.number().positive().finite().optional() }).strict();
export interface ChainConfig {
  model: string;
  sessionTimeoutMin: number;
}

export async function loadChainConfig(repo: string): Promise<ChainConfig> {
  let text: string;
  try {
    text = await readFile(join(repo, CHAIN_CONFIG_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ChainRejection("chain-config-missing", `${CHAIN_CONFIG_PATH} is missing in ${repo}: it names the model every session runs, e.g. {"model": "claude-opus-5[1m]"}`);
    }
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ChainRejection("chain-config-invalid", `${CHAIN_CONFIG_PATH} is not JSON`);
  }
  const parsed = ChainConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ChainRejection("chain-config-invalid", `${CHAIN_CONFIG_PATH}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return { model: parsed.data.model, sessionTimeoutMin: parsed.data.sessionTimeoutMin ?? DEFAULT_SESSION_TIMEOUT_MIN };
}

/**
 * Spec §5.1-5 / §3.2 (review M9): the model must give `orca level` a window, or every hook call in the chain says
 * "no reading" and no session ever hands off before its timeout. Asked of the real reader (src/level/claudeCode.ts)
 * with a two-line transcript, so this check and the hook cannot disagree.
 */
export async function modelWindowKnown(repo: string, model: string): Promise<boolean> {
  let windows: Record<string, number>;
  try {
    windows = (await loadLevelConfig(repo)).windows;
  } catch (err) {
    if (err instanceof LevelConfigRejection) throw new ChainRejection("level-config-invalid", err.message);
    throw err;
  }
  const probe = [
    JSON.stringify({ type: "attachment", attachment: { type: "model", identity: { modelId: model } } }),
    JSON.stringify({
      type: "assistant",
      timestamp: "1970-01-01T00:00:00.000Z",
      message: { model: "probe", usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } },
    }),
  ];
  return readClaudeCodeTranscript(`${probe.join("\n")}\n`, "orca-chain-probe", windows).kind === "reading";
}
