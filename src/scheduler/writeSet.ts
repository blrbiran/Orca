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

/**
 * Spec §5.3 / §9.1(6): the set union of two contracts' `verification.
 * requiredChecks` — an intersecting pair whose union is empty would "pass"
 * reconciliation by having nothing to check, which is a green that means
 * nothing. This lives next to writeSetOf because both read the same kind of
 * opaque, unvalidated contract JSON (no schema for it exists in this
 * codebase — see writeSetOf's own comment) rather than because it is about
 * write sets.
 *
 * ccloop's own contract schema requires `requiredChecks: z.array(z.string())
 * .min(1)` (ccloop/src/contract/schema.ts), so a contract ccloop itself would
 * accept can never contribute an empty array. The empty-union case is still
 * reachable here: subsystem C reads contract files as opaque JSON and never
 * validates them against ccloop's schema (fix round 1, finding 2), so a
 * malformed contract with `requiredChecks: []` reaches the planner fine and
 * would only be caught later, at spawn — which is exactly why catching it at
 * plan time (Task 5's `orca plan`) is worth doing.
 *
 * Task 11's synthesizeReconcileContract / planReconciliation (spec's own
 * `requiredChecksUnion(a, b)` interface) must import this function rather
 * than define a second one — two independent readers of the same contract
 * field is exactly the drift a later reader should not "helpfully"
 * reintroduce.
 */
export function requiredChecksUnion(a: unknown, b: unknown): string[] {
  function checksOf(contract: unknown): string[] {
    const c = contract as { verification?: { requiredChecks?: unknown } } | null | undefined;
    return asStringArray(c?.verification?.requiredChecks);
  }
  return [...new Set([...checksOf(a), ...checksOf(b)])];
}
