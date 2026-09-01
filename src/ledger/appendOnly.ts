export type AppendOnlyResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * spec §3.8 check 6: reject the commit if the diff against .decisions/**
 * contains any non-added line.
 *
 * Only lines starting with - are judged inside a hunk (after an @@ marker).
 * Reason: the file header line `--- a/...` also starts with -, and the naive
 * approach of "skip lines starting with ---" would miss a deleted record
 * whose own content starts with --.
 *
 * A pure rename (no hunk) passes by construction — spec §3.7.1 archiving is
 * just git mv, content unchanged.
 *
 * Exemption: a ledger whose last byte is not a newline is ordinary for a
 * target repo (spec §9.2 — Orca must work against any target repo, not just
 * its own, and today's writer always emits a trailing newline but a
 * hand-written or externally-trimmed ledger need not). Appending to such a
 * file makes git print the old last line as removed (with a
 * "\ No newline at end of file" marker) immediately followed by the same
 * content re-added with a newline now attached. That is not a removal — the
 * bytes of the line are unchanged, only the trailing newline was added — so
 * it must not count as one. The exemption stays exactly this narrow: the
 * `+` line's content must be byte-identical to the `-` line's; any actual
 * content difference is still rejected as a removal.
 */
export function checkAppendOnly(diffText: string): AppendOnlyResult {
  const reasons: string[] = [];
  let inHunk = false;
  const lines = diffText.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("-")) {
      const noNewlineMarker = lines[i + 1];
      const nextLine = lines[i + 2];
      const isNoNewlineAppend =
        noNewlineMarker === "\\ No newline at end of file" &&
        typeof nextLine === "string" &&
        nextLine.startsWith("+") &&
        nextLine.slice(1) === line.slice(1);
      if (isNoNewlineAppend) {
        continue;
      }
      reasons.push(`non-append change to .decisions/**: ${line}`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
