import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateFile } from "./validateFile.js";
import { validateLine } from "./validateLine.js";

/**
 * The caller supplies run-id; the writer never invents one — decision
 * orca-dev-09cc3ea1/7. spec §3.0 leaves allocation to subsystem C; here we
 * only block the shapes that would escape .decisions/.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function appendEvent(
  decisionsDir: string,
  runId: string,
  event: unknown,
): Promise<void> {
  if (!RUN_ID.test(runId)) {
    throw new Error(`invalid run id: ${JSON.stringify(runId)}`);
  }

  // Validate before writing. A bad line can't be fixed afterward —
  // spec §3.3 is append-only semantics.
  const line = JSON.stringify(event);
  const result = validateLine(line);
  if (result.verdict === "rejected") {
    throw new Error(`refusing to append: rejected: ${result.reasons.join("; ")}`);
  }
  if (result.verdict === "downgraded") {
    throw new Error(
      `refusing to append: downgraded to tier 0, this decision is not the agent's to make: ${result.reasons.join("; ")}`,
    );
  }

  // Widen the screen to check 5 (a bound/superseded/overturned must reference
  // an id that exists as a decision) — validateLine alone only covers checks
  // 1/2/3/4. Check 5 needs the whole prospective file, so read what is
  // already on disk (a missing file counts as empty) and validate existing
  // bytes plus the new record together, before writing anything.
  //
  // This is stricter than validateFile alone for one specific shape: a
  // reference event that names a decision which has not been written yet.
  // validateFile only requires the referenced id to exist somewhere in the
  // file, not before the reference (spec §3.8 check 5 asks for existence,
  // not order) — but a streaming writer cannot see lines not yet appended,
  // so writing a bound before its decision throws here even though
  // validateFile would accept those same two lines in that order.
  const filePath = join(decisionsDir, `${runId}.jsonl`);
  const existingText = await readFile(filePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  // A ledger with no trailing newline is ordinary for a target repo (Fix 2,
  // spec §9.2) — but `appendFile` only concatenates bytes, it does not insert
  // a separator. Without one, appending onto such a file glues the new record
  // onto the end of the last line, producing unparseable JSON on disk even
  // though this function reported success. So: only when existing bytes are
  // non-empty and do not already end in a newline do we prepend one ourselves.
  //
  // Critically, `payload` below is both (a) what check 5 is validated
  // against and (b) what actually gets written — by construction, not by
  // convention, so the guarantee describes the exact bytes that land on
  // disk in every case: an empty/absent file (separator ""), a file already
  // ending in a newline (separator ""), and a file that does not
  // (separator is a single newline).
  const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
  const payload = `${separator}${line}\n`;

  const prospective = validateFile((existingText + payload).split("\n"));
  if (prospective.verdict !== "ok") {
    const reasons = prospective.lines
      .filter((l) => l.result.verdict !== "ok")
      .flatMap((l) => (l.result.verdict === "ok" ? [] : l.result.reasons));
    throw new Error(`refusing to append: ${prospective.verdict}: ${reasons.join("; ")}`);
  }

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(filePath, payload);
}
