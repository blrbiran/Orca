/**
 * Tester #391 (human ruling: 「统一到验收的『base 也红』口径，再把两侧 not ok 行的摘要交给审阅员作参考」): a small reader of
 * node:test output, so the review can show which tests failed on the tip and at the group's base instead of only exit
 * codes. It is a reader of the output Orca already records -- no new run, no new dependency, no model (Rule 5).
 *
 * Two reporters are understood, because node:test prints the first as TAP and the default spec reporter as lines:
 * `not ok 2 - name` and `✖ name (1.2ms)`. Counts come from `# fail 2` / `ℹ fail 2` (and the same for tests, pass and
 * duration_ms). Text outside these shapes is ignored; a runner that prints none of them yields no names, and the caller
 * says so rather than inventing identities.
 */

export interface FailureSummary {
  /** The failing tests the output names, in print order, without duplicates. */
  failures: string[];
  /** The runner's own failure count (`# fail N`), null when the output does not say. */
  failCount: number | null;
  passCount: number | null;
  tests: number | null;
  durationMs: number | null;
}

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const TAP_FAILURE = /^\s*not ok\b(?:\s+\d+)?\s*(?:-\s*)?(.*)$/;
const SPEC_FAILURE = /^\s*(?:✖|×)\s+(.*?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/u;
/** The spec reporter's own `✖ failing tests:` header, which names no test. */
const SPEC_HEADER = /^failing tests:\s*$/;

/** A structured reading of one recorded output tail (or whole output). */
export function parseFailureSummary(text: string): FailureSummary {
  const failures: string[] = [];
  let failCount: number | null = null, passCount: number | null = null, tests: number | null = null, durationMs: number | null = null;
  for (const raw of text.replace(ANSI, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const tap = TAP_FAILURE.exec(line);
    const spec = tap === null ? SPEC_FAILURE.exec(line) : null;
    const name = (tap?.[1] ?? spec?.[1] ?? "").trim();
    if (name !== "" && !SPEC_HEADER.test(name) && (tap !== null || spec !== null) && !failures.includes(name)) failures.push(name);
    const count = /^(?:#|ℹ)\s*(tests|pass|fail|duration_ms)\s+(\d+(?:\.\d+)?)$/u.exec(line.trim());
    if (count === null) continue;
    const value = Number(count[2]);
    if (count[1] === "tests") tests = value;
    else if (count[1] === "pass") passCount = value;
    else if (count[1] === "fail") failCount = value;
    else durationMs = value;
  }
  return { failures, failCount, passCount, tests, durationMs };
}

/**
 * One line for a prompt or a fact list: the failing names the output gives, or an explicit statement that it gives none
 * (with the runner's count when it printed one). `text` is the tail Orca records -- at most 2 KB, so a runner that printed
 * the failure names above that cut shows none here, and the line says exactly that instead of guessing.
 */
export function failureNamesLine(text: string | undefined, limit = 20): string {
  if (text === undefined || text.trim() === "") return "the recorded output names no failing test (no output was recorded)";
  const summary = parseFailureSummary(text), total = Math.max(summary.failCount ?? 0, summary.failures.length);
  if (summary.failures.length === 0)
    return summary.failCount === null
      ? "the recorded output names no failing test (its last 2 KB holds no \"not ok\" line and no failure count)"
      : `the recorded output names no failing test (its summary reports ${summary.failCount} failing; the last 2 KB holds no \"not ok\" line)`;
  const shown = summary.failures.slice(0, limit);
  const partial = total > summary.failures.length
    ? ` (only ${summary.failures.length} name${summary.failures.length === 1 ? "" : "s"} in the recorded 2 KB)`
    : "";
  return `${total} failing test${total === 1 ? "" : "s"}${partial}: ${shown.join("; ")}${summary.failures.length > limit ? ` (+${summary.failures.length - limit} more named)` : ""}`;
}
