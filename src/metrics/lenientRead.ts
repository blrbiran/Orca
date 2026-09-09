import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { correctionSchema } from "../corrections/schema.js";
import type { Correction } from "../corrections/schema.js";
import { overturnedEventSchema } from "../ledger/schema.js";
import type { OverturnedEvent } from "../ledger/schema.js";
import type { LenientRead, MalformedLine } from "./types.js";

/**
 * 🔴 NEW, and for the READ SIDE ONLY. src/corrections/store.ts's
 * readCorrections stays strict and is not touched (spec §0, §5.3).
 *
 * Why not loosen the existing one: readCorrections is called from inside the
 * store lock by recordCorrection and loadCorrection. A lenient reader there
 * would let the duplicate check skip a torn last line and then append after
 * it — spec §1.7's measured shape, made permanent. A locked writer must not
 * tolerate a tear; a read-only report must not die of one.
 */
type Outcome<T> = { ok: true; row: T } | { ok: false; reason: string } | { skip: true };

async function readLines(
  file: string,
): Promise<{ lines: string[]; endsWithNewline: boolean } | undefined> {
  const text = await readFile(file, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return undefined;
  return { lines: text.split("\n"), endsWithNewline: text.endsWith("\n") };
}

function readLeniently<T>(
  file: string,
  raw: { lines: string[]; endsWithNewline: boolean } | undefined,
  parse: (value: unknown, line: string) => Outcome<T>,
): LenientRead<T> {
  if (raw === undefined) return { rows: [], malformed: [] };

  const rows: T[] = [];
  const malformed: MalformedLine[] = [];
  // split("\n") ends in "" when the file ends with a newline. Any other final
  // element is a line nobody terminated — a write in flight.
  const lastIndex = raw.lines.length - 1;

  for (let i = 0; i < raw.lines.length; i += 1) {
    const line = raw.lines[i];
    if (line.trim().length === 0) continue;
    const torn = i === lastIndex && !raw.endsWithNewline;

    const bad = (reason: string): void => {
      malformed.push({
        file,
        line: i + 1,
        bytes: Buffer.byteLength(line, "utf8"),
        reason: torn ? `unterminated last line, still being written: ${reason}` : reason,
        torn,
      });
    };

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      bad(`not valid JSON: ${(error as Error).message}`);
      continue;
    }

    const parsed = parse(value, line);
    if ("skip" in parsed) continue;
    if (parsed.ok) rows.push(parsed.row);
    else bad(parsed.reason);
  }

  return { rows, malformed };
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
}

export async function readCorrectionsLeniently(file: string): Promise<LenientRead<Correction>> {
  return readLeniently<Correction>(file, await readLines(file), (value) => {
    const result = correctionSchema.safeParse(value);
    return result.success
      ? { ok: true, row: result.data }
      : { ok: false, reason: issuesOf(result.error) };
  });
}

/**
 * 🔴 A `decision` line is recognised by its `ev` and handed through UNJUDGED,
 * with its raw text. The verdict belongs to validateLine, which is the only
 * thing that can tell A' §1.1's three states apart: a `rejected` decision is
 * not a legal record and stays out of the denominator, a `downgraded` one IS
 * legal and goes in, and neither is a MALFORMED LINE.
 *
 * Judging with decisionEventSchema here would collapse "rejected" into
 * "malformed": collect's rejected branch could never be reached, spec §8's
 * mutation 3 would have nowhere to land, and §7's fixture — which is required
 * to hold a rejected decision AND exit 0 — would exit 6 instead.
 *
 * `bound` and `superseded` are legal lines carrying neither number: skipped,
 * and NOT reported as malformed, or every ledger here would report seven bad
 * lines.
 */
export type LedgerRow =
  | { kind: "decision"; raw: string; value: unknown }
  | { kind: "overturned"; row: OverturnedEvent };

export async function readLedgerLeniently(file: string): Promise<LenientRead<LedgerRow>> {
  return readLeniently<LedgerRow>(file, await readLines(file), (value, line) => {
    // A line of `null` would make the property read below throw a TypeError and
    // take the whole command down, while §5.2 requires EVERY bad line to be
    // excluded and named. Shape copied from src/ledger/validateLine.ts.
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: "line is not a JSON object" };
    }
    const ev = (value as { ev?: unknown }).ev;
    if (ev === "decision") return { ok: true, row: { kind: "decision", raw: line, value } };
    if (ev === "overturned") {
      const result = overturnedEventSchema.safeParse(value);
      return result.success
        ? { ok: true, row: { kind: "overturned", row: result.data } }
        : { ok: false, reason: issuesOf(result.error) };
    }
    if (ev === "bound" || ev === "superseded") return { skip: true };
    return { ok: false, reason: `unknown ev: ${JSON.stringify(ev)}` };
  });
}
