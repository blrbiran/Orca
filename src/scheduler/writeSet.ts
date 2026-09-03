import { posix } from "node:path";

/**
 * A claimed path as a task declares it (its raw string), plus the same claim
 * normalized to a directory prefix for comparison. Keeping `declared`
 * alongside `normalized` is spec 3.3's own requirement: without it, a task
 * that claimed "src/a.ts" is reported as claiming "src/a.ts/**", a directory
 * that does not exist, and every diagnosis built on top of intersect() reads
 * as a tool bug rather than a real conflict.
 */
export interface ClaimedPath {
  normalized: string;
  declared: string;
}

/**
 * Spec 3.3: a claim collapses to the path prefix it actually restricts.
 * "src/**" claims the src/ directory, not a literal path ending in "**", so
 * it normalizes to "src/". A bare "**" claims the repository root — every
 * path is inside the root — so it normalizes to the empty prefix, which
 * pathTrie's segment comparison already treats as containing everything, for
 * free. An empty-string claim is the same repository-root case (a task that
 * declares no restriction at all), so it also normalizes to the empty
 * prefix. Anything else (no glob suffix) is already a prefix in its own
 * right and is kept whole.
 *
 * Both root cases are handled before path.posix.normalize runs, not after:
 * normalize("") returns ".", which would turn "claims the whole repository"
 * into "claims a directory literally named .". contains() would then answer
 * false where it used to answer true (the ** claim would stop swallowing
 * everything) — the unsafe direction spec 3.1 warns against — so the empty
 * prefix must never reach normalize().
 *
 * pathTrie's `contains` compares path segments verbatim; it does not resolve
 * "." or "..". Without resolving them here, "src/foo/../bar/x.ts" and
 * "src/bar/x.ts" name the same file but produce different segment lists, so
 * intersect() would answer "disjoint" for a genuinely overlapping pair —
 * the unsafe direction. path.posix.normalize also strips a leading "./" for
 * free, so "./src/**" and "src/**" normalize identically.
 */
export function normalizeClaim(declared: string): ClaimedPath {
  if (declared === "**" || declared === "") {
    return { normalized: "", declared };
  }
  const prefix = declared.endsWith("**") ? declared.slice(0, -2) : declared;
  return { normalized: posix.normalize(prefix), declared };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Spec 3.1: a task's write set is its targetPaths union its allowlistPaths —
 * not targetPaths alone. Prior-art research on this contract found that
 * ccloop's own evaluatePathPolicy never reads targetPaths and only checks
 * allowlistPaths after the fact; a scheduler that trusted targetPaths alone
 * would be less careful than the tool it schedules for. The contract is read
 * as an opaque unknown — no schema for it exists in this codebase yet — so
 * every field access is defensive and a missing field degrades to no claims
 * from that field, rather than throwing.
 */
export function writeSetOf(contract: unknown): ClaimedPath[] {
  const c = contract as { context?: { targetPaths?: unknown }; safetyPolicy?: { allowlistPaths?: unknown } } | null | undefined;
  const targetPaths = asStringArray(c?.context?.targetPaths);
  const allowlistPaths = asStringArray(c?.safetyPolicy?.allowlistPaths);
  return [...targetPaths, ...allowlistPaths].map(normalizeClaim);
}
