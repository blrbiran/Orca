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
  // lines plus the new one together, before writing anything.
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
  const existingLines = existingText.length === 0 ? [] : existingText.split("\n");
  const prospective = validateFile([...existingLines, line]);
  if (prospective.verdict !== "ok") {
    const reasons = prospective.lines
      .filter((l) => l.result.verdict !== "ok")
      .flatMap((l) => (l.result.verdict === "ok" ? [] : l.result.reasons));
    throw new Error(`refusing to append: ${prospective.verdict}: ${reasons.join("; ")}`);
  }

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(filePath, `${line}\n`);
}
