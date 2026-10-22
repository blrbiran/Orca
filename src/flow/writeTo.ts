/**
 * Flow engine spec §4.4 [BC-B8]: an ask's answer lands in the workspace through a deterministic target from a closed
 * set -- `{file, frontmatter: <field>}` or `{file, json: <pointer>}` -- written by code, never by a model. Only that field
 * changes: a frontmatter field's lines are replaced in place, a JSON value is set and the file re-serialised with the
 * indentation it had. The result is a vault commit on the workspace commit (the ask step's output, §5.3), `unchanged`
 * when the field already holds the value, or the red flag `writeTo-missing` -- for a missing file or field, or a path
 * that would leave the workspace (Review Focus 2) -- with nothing written.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { isInsidePath } from "./template/checklist.js";
import type { ParamValue } from "./template/when.js";
import { vaultGit, vaultGitBytes, type Vault } from "./vault/vault.js";

export type WriteTarget = { file: string; frontmatter: string } | { file: string; json: string };
export type WriteResult = { commit: string } | { unchanged: true } | { flag: "writeTo-missing" };

const MISSING = { flag: "writeTo-missing" } as const;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The frontmatter block of a Markdown file: its text and where it sits; null when the file has none. */
function frontmatterOf(text: string): { start: number; end: number; body: string } | null {
  if (!text.startsWith("---\n")) return null;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return null;
  const after = text.slice(close + 4);
  if (after !== "" && !after.startsWith("\n")) return null;
  return { start: 4, end: close + 1, body: text.slice(4, close + 1) };
}

function setFrontmatter(text: string, field: string, value: ParamValue): string | null | "same" {
  const fm = frontmatterOf(text);
  if (fm === null) return null;
  let data: unknown;
  try { data = parse(fm.body); } catch { return null; }
  if (typeof data !== "object" || data === null || !Object.prototype.hasOwnProperty.call(data, field)) return null;
  if (same((data as Record<string, unknown>)[field], value)) return "same";
  const lines = fm.body.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${field}:`));
  if (at === -1) return null;
  // The field's own line and its indented continuation lines (a block scalar or a nested value) are replaced; nothing else.
  let end = at + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end]!)) end += 1;
  const replaced = [...lines.slice(0, at), `${field}: ${stringify(value).trimEnd()}`, ...lines.slice(end)].join("\n");
  return text.slice(0, fm.start) + replaced + text.slice(fm.end);
}

/** RFC 6901 tokens. */
const tokensOf = (pointer: string): string[] | null =>
  pointer === "" ? [] : pointer.startsWith("/") ? pointer.slice(1).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~")) : null;

function setJson(text: string, pointer: string, value: ParamValue): string | null | "same" {
  const tokens = tokensOf(pointer);
  if (tokens === null || tokens.length === 0) return null;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  let parent: unknown = data;
  for (const token of tokens.slice(0, -1)) {
    if (typeof parent !== "object" || parent === null || !Object.prototype.hasOwnProperty.call(parent, token)) return null;
    parent = (parent as Record<string, unknown>)[token];
  }
  const last = tokens.at(-1)!;
  if (typeof parent !== "object" || parent === null || !Object.prototype.hasOwnProperty.call(parent, last)) return null;
  if (same((parent as Record<string, unknown>)[last], value)) return "same";
  (parent as Record<string, unknown>)[last] = value;
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
  return JSON.stringify(data, null, indent) + (text.endsWith("\n") ? "\n" : "");
}

export async function writeAnswer(vault: Vault, workspaceCommit: string, target: WriteTarget, value: ParamValue, by: string): Promise<WriteResult> {
  if (!isInsidePath(target.file)) return MISSING;
  let entry: string;
  try { entry = (await vaultGit(vault, ["ls-tree", workspaceCommit, "--", target.file])).trim(); } catch { return MISSING; }
  const match = /^(100644|100755) blob ([0-9a-f]+)\t/.exec(entry);
  if (match === null) return MISSING;
  const text = (await vaultGitBytes(vault, ["cat-file", "blob", match[2]!])).toString("utf8");
  const next = "frontmatter" in target ? setFrontmatter(text, target.frontmatter, value) : setJson(text, target.json, value);
  if (next === null) return MISSING;
  if (next === "same") return { unchanged: true };
  const dir = await mkdtemp(join(tmpdir(), "orca-flow-write-"));
  try {
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    await vaultGit(vault, ["read-tree", workspaceCommit], { env });
    const blob = (await vaultGit(vault, ["hash-object", "-w", "--stdin"], { input: next })).trim();
    await vaultGit(vault, ["update-index", "--cacheinfo", `${match[1]},${blob},${target.file}`], { env });
    const tree = (await vaultGit(vault, ["write-tree"], { env })).trim();
    const commit = (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", workspaceCommit, "-m", `orca: answer written to ${target.file} for ${by}`])).trim();
    return { commit };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
