import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(join(decisionsDir, `${runId}.jsonl`), `${line}\n`);
}
