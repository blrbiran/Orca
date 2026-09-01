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
 */
export function checkAppendOnly(diffText: string): AppendOnlyResult {
  const reasons: string[] = [];
  let inHunk = false;

  for (const line of diffText.split("\n")) {
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
      reasons.push(`non-append change to .decisions/**: ${line}`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
