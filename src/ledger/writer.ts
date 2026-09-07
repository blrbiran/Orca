import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateFile } from "./validateFile.js";
import { validateLine } from "./validateLine.js";

/**
 * The caller supplies run-id; the writer never invents one — decision
 * orca-dev-09cc3ea1/7. spec §3.0 leaves allocation to subsystem C; here we
 * only block the shapes that would escape .decisions/.
 *
 * Exported so subsystem C's allocator (src/scheduler/runId.ts) can check a
 * taskId against the exact same constraint before it ever reaches this
 * validator, instead of hand-copying the pattern — a duplicate that could
 * silently drift out of sync with nothing going red (P2 task 7, fix round 1).
 */
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function appendEvents(
  decisionsDir: string,
  runId: string,
  events: unknown[],
): Promise<void> {
  // spec §14.1: an empty batch's payload would be nothing but the separator,
  // which appends a lone newline to a file that had none. Refusing is not
  // defensive programming — it is the only shape of this call that can
  // corrupt a ledger while reporting success.
  if (events.length === 0) {
    throw new Error("refusing to append: empty batch");
  }

  if (!RUN_ID.test(runId)) {
    throw new Error(`invalid run id: ${JSON.stringify(runId)}`);
  }

  const lines: string[] = [];
  for (const event of events) {
    // Check A: a decision's run field must name the file it lands in.
    // C writes several ledgers, in several repositories, in the same process;
    // a run field that disagrees with the filename makes every downstream
    // attribution wrong while every existing check stays green.
    // overturned is included because run is half of its attribution (at is the
    // other half) -- ruling orca-dev-c1c3c2ec/5.
    const evName = (event as { ev?: unknown }).ev;
    const run = (event as { run?: unknown }).run;
    if ((evName === "decision" || evName === "overturned") && run !== runId) {
      throw new Error(
        `refusing to append: run field ${JSON.stringify(run)} does not match the ledger file for run ${JSON.stringify(runId)}`,
      );
    }

    // Validate before writing. A bad line can't be fixed afterward —
    // spec §3.3 is append-only semantics. In a batch this runs once per event,
    // before any of them is written, so a bad line anywhere in the batch still
    // leaves nothing on disk.
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
    lines.push(line);
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
  //
  // For a batch, "the new record" above means the whole batch: every line in
  // it is validated together with what is already on disk, in one pass.
  const filePath = join(decisionsDir, `${runId}.jsonl`);
  const existingText = await readFile(filePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  // Check B: a decision id must be unique within its file. The ledger is
  // append-only, so a duplicate can never be removed — and the panel (E)
  // resolves decisions by id, which a duplicate makes ambiguous forever.
  //
  // The throw sits outside the try on purpose: inside it, its own catch would
  // swallow it and every criterion here could still pass.
  //
  // Now over two scopes rather than one: the batch against the file, AND the
  // batch against itself. The second scope is new and has no product caller
  // (registered, spec §14.19 item 18) — it exists because a batch is written
  // in one appendFile, so a duplicate inside it could never be caught by the
  // file-scoped pass that runs before the write.
  const fileDecisionIds = new Set<string>();
  for (const existing of existingText.split("\n")) {
    if (existing.trim().length === 0) continue;
    try {
      const parsedExisting = JSON.parse(existing) as { ev?: unknown; id?: unknown };
      if (parsedExisting.ev === "decision" && typeof parsedExisting.id === "string") {
        fileDecisionIds.add(parsedExisting.id);
      }
    } catch {
      // A line that does not parse is validateFile's problem, not this
      // check's; the prospective validation below rejects it anyway.
      continue;
    }
  }
  const batchDecisionIds = new Set<string>();
  for (const event of events) {
    if ((event as { ev?: unknown }).ev !== "decision") continue;
    const id = (event as { id?: unknown }).id;
    if (fileDecisionIds.has(id as string) || batchDecisionIds.has(id as string)) {
      throw new Error(`refusing to append: duplicate decision id ${JSON.stringify(id)}`);
    }
    batchDecisionIds.add(id as string);
  }

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
  //
  // The separator is added once, in front of the whole batch, not once per
  // event: inside the batch, `lines` are already joined by a newline below,
  // so this remains the one place a separator can be missing.
  const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
  const payload = `${separator}${lines.join("\n")}\n`;

  // Build the cross-file resolution scope on EVERY append, whatever event this
  // one happens to be.
  //
  // There was going to be an optimisation here that only scanned the directory
  // when the event being appended was an overturned or a superseded. It is
  // wrong: the prospective check below revalidates the WHOLE file, so once a
  // cross-file overturned is on disk, any later append -- an ordinary decision,
  // say -- would re-judge it as unresolvable and throw. What decides is what
  // the file contains, not what is being added to it. Ruling
  // orca-dev-c1c3c2ec/9; pinned by writer.test.ts's "still accepts a later,
  // unrelated append".
  const externalDecisionIds = new Set<string>();
  const siblings = await readdir(decisionsDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });
  for (const name of siblings) {
    if (!name.endsWith(".jsonl") || name === `${runId}.jsonl`) continue;
    const siblingText = await readFile(join(decisionsDir, name), "utf8");
    for (const raw of siblingText.split("\n")) {
      if (raw.trim().length === 0) continue;
      try {
        const parsedSibling = JSON.parse(raw) as { ev?: unknown; id?: unknown };
        if (parsedSibling.ev === "decision" && typeof parsedSibling.id === "string") {
          externalDecisionIds.add(parsedSibling.id);
        }
      } catch {
        // An unparseable line in someone else's ledger is not this append's problem.
      }
    }
  }

  const prospective = validateFile((existingText + payload).split("\n"), { externalDecisionIds });
  if (prospective.verdict !== "ok") {
    const reasons = prospective.lines
      .filter((l) => l.result.verdict !== "ok")
      .flatMap((l) => (l.result.verdict === "ok" ? [] : l.result.reasons));
    throw new Error(`refusing to append: ${prospective.verdict}: ${reasons.join("; ")}`);
  }

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(filePath, payload);
}

/**
 * The single-event entry point, kept as a one-line wrapper rather than a
 * parallel implementation: a hand-copied second copy of the checks above is
 * exactly the drift this repository has already paid for once (see RUN_ID's
 * comment). Measured before the refactor and again after: every criterion in
 * tests/ledger/writer.test.ts observes this path unchanged, and a
 * single-element batch produces byte-identical payload bytes.
 */
export async function appendEvent(
  decisionsDir: string,
  runId: string,
  event: unknown,
): Promise<void> {
  await appendEvents(decisionsDir, runId, [event]);
}
