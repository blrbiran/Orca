/**
 * Flow engine spec §12.1 variables and §3.2 `derive`. Code only (Rule 5).
 *
 * Variables: `{{param.<id>}}`, `{{run.id}}`, `{{workspace}}` (the attempt worktree, never the person's folder),
 * `{{skill.<name>.dir}}` (the injected copy), `{{effect.recordId}}`, and in commands only `{{base:<path>}}` (resolved by
 * the caller to a read-only temp copy of `<path>` at the execution's base). Innermost first, so `{{base:{{param.slug}}.md}}`
 * expands its path before the base is resolved. Anything else is unknown and throws: no variable is ever left in a
 * prompt or a command. Commands quote nothing here; templates quote.
 */
import { createHash } from "node:crypto";
import type { ParamValue } from "./when.js";

export type VarWhere = "prompt" | "command";
export interface VarScope {
  params: Readonly<Record<string, ParamValue>>;
  runId: string;
  workspace: string;
  skillDirs: Readonly<Record<string, string>>;
  effectRecordId?: string;
  base?: (path: string) => string;
}

/** One variable reference: the text between the braces, innermost references already replaced. */
export type VarRef =
  | { kind: "param"; id: string }
  | { kind: "run.id" }
  | { kind: "workspace" }
  | { kind: "skill"; name: string }
  | { kind: "effect.recordId" }
  | { kind: "base"; path: string }
  | { kind: "unknown"; text: string };

const INNERMOST = /\{\{([^{}]*)\}\}/;

export function classifyVar(name: string): VarRef {
  let m: RegExpExecArray | null;
  if ((m = /^param\.([a-zA-Z][a-zA-Z0-9_]*)$/.exec(name))) return { kind: "param", id: m[1]! };
  if (name === "run.id") return { kind: "run.id" };
  if (name === "workspace") return { kind: "workspace" };
  if ((m = /^skill\.([^.\s{}]+)\.dir$/.exec(name))) return { kind: "skill", name: m[1]! };
  if (name === "effect.recordId") return { kind: "effect.recordId" };
  if ((m = /^base:(\S+)$/.exec(name))) return { kind: "base", path: m[1]! };
  return { kind: "unknown", text: name };
}

/**
 * Every reference in `text`, innermost first (a nested reference is listed before the one that holds it). The
 * checklist uses this to resolve references without values; `resolve` returns what replaces each one.
 */
function walk(text: string, resolve: (ref: VarRef) => string): string {
  let out = text;
  for (let m = INNERMOST.exec(out); m !== null; m = INNERMOST.exec(out)) {
    out = out.slice(0, m.index) + resolve(classifyVar(m[1]!)) + out.slice(m.index + m[0].length);
  }
  return out;
}

export function varRefs(text: string): VarRef[] {
  const refs: VarRef[] = [];
  // A neutral stand-in keeps an outer `{{base:...}}` well formed after its inner reference is taken out.
  walk(text, (ref) => { refs.push(ref); return "x"; });
  return refs;
}

export function expandVars(text: string, scope: VarScope, where: VarWhere): string {
  return walk(text, (ref) => {
    switch (ref.kind) {
      case "param": {
        const value = scope.params[ref.id];
        if (value !== undefined) return String(value);
        break;
      }
      case "run.id": return scope.runId;
      case "workspace": return scope.workspace;
      case "skill": {
        const dir = scope.skillDirs[ref.name];
        if (dir !== undefined) return dir;
        break;
      }
      case "effect.recordId":
        if (scope.effectRecordId !== undefined) return scope.effectRecordId;
        break;
      case "base":
        if (where === "command" && scope.base !== undefined) return scope.base(ref.path);
        break;
    }
    throw new Error(`unknown variable {{${ref.kind === "unknown" ? ref.text : describe(ref)}}} in a ${where}`);
  });
}

const describe = (ref: Exclude<VarRef, { kind: "unknown" }>): string =>
  ref.kind === "param" ? `param.${ref.id}` : ref.kind === "skill" ? `skill.${ref.name}.dir` : ref.kind === "base" ? `base:${ref.path}` : ref.kind;

/**
 * §3.2 `derive`, code-evaluated. `slug-of-idea`: lowercase ASCII `[a-z0-9-]`, at most 64, from `params.idea`; an idea
 * with no ASCII letter or digit (a CJK-only idea) becomes `article-<first 8 hex of sha256(idea)>`. `today`: the UTC
 * date of `now`, `YYYY-MM-DD`.
 */
export function deriveParam(kind: "slug-of-idea" | "today", params: Readonly<Record<string, ParamValue | undefined>>, now: Date): string {
  if (kind === "today") return now.toISOString().slice(0, 10);
  const idea = String(params.idea ?? "");
  const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64).replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : `article-${createHash("sha256").update(idea).digest("hex").slice(0, 8)}`;
}
