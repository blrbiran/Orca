export type NotJudgedReason = "repo-not-discovered" | "ledger-has-malformed-lines" | "decision-not-found";
export type LedgerView =
  | { judged: true; topLevelIds: ReadonlySet<string>; archivedIds: ReadonlySet<string> }
  | { judged: false; reason: "ledger-has-malformed-lines" };
export type LineClass =
  | { kind: "unreadable" }
  | { kind: "not-judged"; reason: NotJudgedReason; projectKey: string; decisionId: string }
  | { kind: "duplicate" }
  | { kind: "orphan" }
  | { kind: "kept" };
export type LineKind = LineClass["kind"];
export interface ClassifiedLine {
  text: string;
  cls: LineClass;
}
export interface Classification {
  lines: ClassifiedLine[];
  liveText: string;
  orphanLines: string[];
  counts: Record<LineKind, number>;
}

// U+001F, built rather than written as an escape (a raw control byte in a
// source file has made git treat it as binary here before). Same separator
// reviewsStore.ts uses for its own dedupe key.
const UNIT_SEPARATOR = String.fromCharCode(0x1f);

interface RowKeyFields {
  projectKey: string;
  decisionId: string;
  by: string;
  action: string;
}

export function parseRow(text: string): RowKeyFields | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  for (const name of ["projectKey", "decisionId", "by", "action"] as const) {
    if (typeof fields[name] !== "string") return undefined;
  }
  return fields as unknown as RowKeyFields;
}

const notJudged = (reason: NotJudgedReason, row: RowKeyFields): LineClass => ({
  kind: "not-judged",
  reason,
  projectKey: row.projectKey,
  decisionId: row.decisionId,
});

/**
 * spec section 3.1, in the table's order: unreadable, not judged, duplicate,
 * orphan, kept. A not-judged row takes no part in dedupe (ruling R-B: a
 * repository that is not here is not touched at all).
 */
function classifyLine(part: string, views: ReadonlyMap<string, LedgerView>, seen: Set<string>): LineClass {
  const row = parseRow(part);
  if (row === undefined) return { kind: "unreadable" };
  const view = views.get(row.projectKey);
  if (view === undefined) return notJudged("repo-not-discovered", row);
  if (!view.judged) return notJudged(view.reason, row);
  const atTopLevel = view.topLevelIds.has(row.decisionId);
  // ruling R-E: absence from the top level is not evidence -- a branch switch
  // produces it too. Only the archive says the decision really left.
  if (!atTopLevel && !view.archivedIds.has(row.decisionId)) return notJudged("decision-not-found", row);
  const rowKey = [row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);
  if (seen.has(rowKey)) return { kind: "duplicate" };
  seen.add(rowKey);
  return atTopLevel ? { kind: "kept" } : { kind: "orphan" };
}

export function classifyReviews(text: string, views: ReadonlyMap<string, LedgerView>): Classification {
  const endsWithNewline = text.endsWith("\n");
  const parts = text.length === 0 ? [] : text.split("\n");
  if (endsWithNewline) parts.pop();

  const seen = new Set<string>();
  const counts: Record<LineKind, number> = { kept: 0, duplicate: 0, orphan: 0, unreadable: 0, "not-judged": 0 };
  const lines: ClassifiedLine[] = parts.map((part) => {
    const cls = classifyLine(part, views, seen);
    counts[cls.kind] += 1;
    return { text: part, cls };
  });

  // Every surviving line gets its newline back, except a torn last line that
  // never had one: those bytes may be a row still being written.
  const lastIndex = parts.length - 1;
  const survivors = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.cls.kind !== "duplicate" && l.cls.kind !== "orphan");
  const liveText = survivors.map(({ l, i }) => (i === lastIndex && !endsWithNewline ? l.text : `${l.text}\n`)).join("");
  const orphanLines = lines.filter((l) => l.cls.kind === "orphan").map((l) => l.text);

  return { lines, liveText, orphanLines, counts };
}
