import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Checks spec 2026-10-22 §6.2: the review's inputs, built by code and frozen as files (they exceed a system debug
 * input's `facts` bound): one JSON per item plus `index.json`, in a directory under Orca's existing runs root (no new
 * out-of-repo path, Rule 17). The directory is created 0700 and each file 0600. An item whose JSON exceeds the bound is
 * cut by the head rule -- its file holds the first bytes as text -- and the cut is recorded in the index.
 */
export const REVIEW_INPUT_ITEM_LIMIT = 64 * 1024;
export interface ReviewInputs {
  range: { target: string; from: string; to: string; groups: Array<{ groupId: string; goal: string; integratedCommit: string; paths: string[]; diffStat: string }> };
  requirements: Record<string, string>;
  decisions: Record<string, unknown[]>;
  conflicts: unknown[];
  instruction: string;
}
const ITEMS = ["range", "requirements", "decisions", "conflicts", "instruction"] as const;

function headOf(text: string, limit: number): string {
  let head = Buffer.from(text, "utf8").subarray(0, limit).toString("utf8");
  // A cut inside a multi-byte character decodes to U+FFFD; drop it so the head is a prefix of the text.
  while (Buffer.byteLength(head) > limit || head.endsWith("�")) head = head.slice(0, -1);
  return head;
}

export async function writeReviewInputs(dir: string, inputs: ReviewInputs): Promise<{ dir: string; sha256: string }> {
  // Explicit modes, never the umask's (Rule 17); a directory that already exists keeps its own.
  if (await mkdir(dir, { recursive: true, mode: 0o700 }) !== undefined) await chmod(dir, 0o700);
  const items: Array<{ file: string; bytes: number; sha256: string; cut: { kept: number } | null }> = [];
  for (const name of ITEMS) {
    const json = JSON.stringify(inputs[name]);
    const bytes = Buffer.byteLength(json);
    const cut = bytes > REVIEW_INPUT_ITEM_LIMIT;
    const text = cut ? JSON.stringify({ truncated: true, bytes, head: headOf(json, REVIEW_INPUT_ITEM_LIMIT) }) : json;
    const file = `${name}.json`;
    await writeFile(join(dir, file), text, { mode: 0o600, flag: "wx" });
    await chmod(join(dir, file), 0o600);
    items.push({ file, bytes, sha256: createHash("sha256").update(text).digest("hex"), cut: cut ? { kept: REVIEW_INPUT_ITEM_LIMIT } : null });
  }
  const index = JSON.stringify({ schema: "orca-model-review-input-v1", items });
  await writeFile(join(dir, "index.json"), index, { mode: 0o600, flag: "wx" });
  await chmod(join(dir, "index.json"), 0o600);
  return { dir, sha256: createHash("sha256").update(index).digest("hex") };
}
