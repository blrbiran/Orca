import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, ROUND_TWO } from "./fixtures/requirementOutputs.js";

/**
 * Flow engine spec §10.1, criterion C7: the dev flow's clarify prompt is unchanged by the flow work (the storage re-key,
 * the clarify host, W-76). The golden was captured from the code before any of that work (plan Task 4 step 1): round 1's
 * prompt and round 2's -- the second carries round 1's questions, the person's answers (one recommended, one typed) and
 * the accepted proposals, which is what a later change to round storage could alter.
 *
 * The repository commit and the delimiter nonce are normalised (they move with the clock); nothing else is.
 * Regenerate only from unchanged code: ORCA_WRITE_GOLDEN=1 writes the file instead of comparing (never in a criterion run).
 */
const GOLDEN = join(import.meta.dirname, "fixtures", "clarifyPromptGolden.txt");
const SEPARATOR = "\n----- ORCA C7 GOLDEN: next clarify prompt -----\n";

describe("the dev clarify prompt bytes (C7)", () => {
  it("rounds 1 and 2 of a fixed requirement equal the golden captured before the flow work", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const result = x.round(1).result!;
      const [first, second] = result.questions;
      expect(x.service.answerRequirement(x.command("requirement-answer", {
        roundNo: 1,
        answers: [{ id: first!.id, kind: "recommended" }, { id: second!.id, kind: "text", text: "Inline as data URIs" }],
        glossaryDecisions: result.glossary.map((entry) => ({ id: entry.id, accept: true })),
        adrDecisions: result.adrs.map((adr) => ({ id: adr.id, accept: false })),
      }))).toMatchObject({ result: { nextRoundNo: 2 } });
      await x.until(() => x.round(2).state === "awaiting-answers");
      // One accept per call (a retry would re-send the same run's envelope): the prompts in the order they were sent.
      const prompts = [...new Map(x.fake.calls.accept.map((envelope) => [envelope.claim.runId, (envelope.work as { prompt: string }).prompt])).values()];
      expect(prompts).toHaveLength(2);
      // The fixture repository's commit (and the delimiter nonce, a prefix of the overview's hash) change with the clock;
      // every other byte is pinned.
      const nonce = /<<<ORCA-DATA idea ([0-9a-f]{16})\n/.exec(prompts[0]!)![1]!;
      const text = prompts.join(SEPARATOR).replaceAll(x.head(), "<HEAD>").replaceAll(nonce, "<NONCE>");
      expect(text).not.toMatch(/[0-9a-f]{40}/);
      if (process.env.ORCA_WRITE_GOLDEN === "1") {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(GOLDEN, text);
      }
      expect(text).toBe(readFileSync(GOLDEN, "utf8"));
    } finally { await x.dispose(); }
  });
});
