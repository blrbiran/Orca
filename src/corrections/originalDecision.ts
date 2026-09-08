import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decisionEventSchema } from "../ledger/schema.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { CorrectRejection } from "./rejection.js";

export const DECISION_NOT_FOUND = "original-decision-not-found";

/**
 * spec §5: reject a decision id that is not there, HERE — not by letting
 * appendEvents' check 5 catch it later. Check 5's message is about a reference
 * that would not resolve; the actual cause is that the person mistyped
 * `--decision`, and a message four layers from the cause is the shape §12
 * finding 2 and §14.13 keep killing.
 */
export async function readOriginalDecision(
  decisionsDir: string,
  decisionId: string,
): Promise<DecisionEvent> {
  const names = await readdir(decisionsDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const text = await readFile(join(decisionsDir, name), "utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // Someone else's malformed line is `orca validate`'s problem.
      }
      const candidate = (parsed as { ev?: unknown; id?: unknown });
      if (candidate.ev === "decision" && candidate.id === decisionId) {
        return decisionEventSchema.parse(parsed);
      }
    }
  }

  throw new CorrectRejection(
    DECISION_NOT_FOUND,
    `no decision with id ${JSON.stringify(decisionId)} in ${decisionsDir} — check the --decision argument`,
  );
}
