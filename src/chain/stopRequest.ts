import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CHAIN_ID_PATTERN, stopRequestPath } from "./paths.js";
import { readChainRecord } from "./recordSchema.js";
import { ChainRejection } from "./rejection.js";

/**
 * D-launch spec §2 (review I10), shared by `orca chain stop` and the panel: the id must have the chain shape (it
 * becomes a path) and name a running chain's record. The request lives in the git dir; the supervisor latches it.
 */
export async function requestStop(repo: string, chainId: string): Promise<string> {
  if (!CHAIN_ID_PATTERN.test(chainId)) throw new ChainRejection("chain-id-invalid", `${JSON.stringify(chainId)} is not a chain id (chain-<8 hex>)`);
  const record = await readChainRecord(repo, chainId);
  if (record.state !== "running") throw new ChainRejection("chain-not-running", `chain ${chainId} already stopped (${record.stop?.reason})`);
  const path = await stopRequestPath(repo, chainId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `requested ${new Date().toISOString()}\n`, { mode: 0o600 });
  return path;
}

export async function stopRequested(repo: string, chainId: string): Promise<boolean> {
  return stat(await stopRequestPath(repo, chainId)).then(() => true, () => false);
}
