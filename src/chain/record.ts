import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHAIN_RECORDS_DIR } from "../checkpoint/schema.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { chainGit as git } from "./git.js";
import { chainRecordRelPath } from "./paths.js";
import { type ChainRecord, ChainRecordSchema } from "./recordSchema.js";
import { ChainRejection } from "./rejection.js";

export const commitMessage = (chainId: string, what: string): string => `chore(chain): ${chainId}, ${what}`;

/** Writes the record file only. Parsing first means a record the schema refuses never reaches the disk. */
export async function writeChainRecordFile(repo: string, record: ChainRecord): Promise<string> {
  const text = `${JSON.stringify(ChainRecordSchema.parse(record), null, 2)}\n`;
  const rel = chainRecordRelPath(record.chainId);
  await mkdir(join(repo, CHAIN_RECORDS_DIR), { recursive: true });
  await writeFile(join(repo, rel), text);
  return rel;
}

/**
 * D-launch spec §6.1 (review I2, review 7): `git add` then `git commit --only` of this one path — nothing else in the
 * worktree or the index is taken along, so a dirty-after-session stop still commits its final record and leaves the
 * session's changes where they were for a person to see. The first write needs the add: `--only` alone refuses an
 * untracked path.
 */
export async function commitChainRecord(repo: string, record: ChainRecord, message: string): Promise<void> {
  const rel = await writeChainRecordFile(repo, record);
  try {
    await git(repo, ["add", "--", rel]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "--only", "-m", message, "--", rel]);
  } catch (err) {
    throw new ChainRejection("record-commit-refused", `${rel} is written but git refused to commit it: ${(err as Error).message.trim()}`, 2);
  }
}
