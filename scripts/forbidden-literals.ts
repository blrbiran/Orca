import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * D-launch spec §8.2-9 and §6.3: a mechanical scan of string literals. It is not a parser — it strips comments and
 * reads quoted text — which is why tests/chain/scan.test.ts pins it with must-catch and must-not-catch samples.
 */
export interface ForbiddenRule {
  exact: ReadonlySet<string>;
  patterns: readonly RegExp[];
}
/** Spec §2.2-3: the supervisor's own code never pushes, merges, deletes a branch or removes a worktree. */
export const TIER0_RULE: ForbiddenRule = {
  exact: new Set(["push", "merge", "pull", "rebase", "branch", "worktree", "update-ref", "gh"]),
  patterns: [/\bgit\s+(push|merge|pull|rebase)\b(?!-)/, /\bbranch\s+(-d|-D|--delete)\b/, /\bworktree\s+(remove|prune)\b/, /\bgh\s+(pr|repo|api)\b/],
};
/** Spec §6.3 / panel spec §2.1: the panel process itself never commits. */
export const PANEL_COMMIT_RULE: ForbiddenRule = { exact: new Set(["commit"]), patterns: [/\bgit\s+commit\b/] };

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function stringLiterals(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)) out.push(m[2]);
  return out;
}

export function offending(src: string, rule: ForbiddenRule): string[] {
  return stringLiterals(src).filter((s) => rule.exact.has(s) || rule.patterns.some((p) => p.test(s)));
}

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

export async function scanTree(root: string, dir: string, rule: ForbiddenRule): Promise<Array<{ file: string; literal: string }>> {
  const found: Array<{ file: string; literal: string }> = [];
  for (const path of await tsFiles(join(root, dir))) {
    for (const literal of offending(await readFile(path, "utf8"), rule)) found.push({ file: relative(root, path), literal });
  }
  return found;
}

/** Spec §2 (review 1): the supervisor loads every module at start-up; an `import(` would read a worktree a session changed. */
export function dynamicImports(src: string): number {
  const code = stripComments(src).replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, '""');
  return (code.match(/\bimport\s*\(/g) ?? []).length;
}

export async function dynamicImportFiles(root: string, dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const path of await tsFiles(join(root, dir))) if (dynamicImports(await readFile(path, "utf8")) > 0) found.push(relative(root, path));
  return found;
}
