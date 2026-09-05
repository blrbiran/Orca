import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFERENCE_EVENT_TYPES } from "../../src/ledger/schema.js";
import { DECISION_KINDS } from "../../src/ledger/types.js";
import { validateLine } from "../../src/ledger/validateLine.js";

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id: "run-7c/3",
    at: "2026-08-29T10:04:11.482Z",
    run: "run-7c",
    question: "任务 T4 与 T7 能否并行",
    chose: "串行，T7 等 T4",
    alternatives: [
      {
        option: "并行开两个 worktree",
        why_not: "两者 targetPaths 都含 src/persistence/fileStore.ts，合并必冲突",
      },
    ],
    because: "写集相交（§5.1 判据）",
    undo: {
      how: "git branch -f int/a <ref>",
      cost: "浪费 T4 已跑的 attempt",
      blast_radius: "仅本仓库调度",
    },
    scope: "repo",
    kind: "scheduling",
    ...overrides,
  };
}

const line = (obj: unknown) => JSON.stringify(obj);

describe("validateLine — check 1: all required fields present", () => {
  it("accepts the complete decision example from spec §3.4", () => {
    expect(validateLine(line(validDecision()))).toEqual({ verdict: "ok" });
  });

  // Delete each of the 11 required fields one at a time; each must be rejected on its own.
  // Deliberately not using expect.soft in a for loop — we want one independently
  // failing assertion per field.
  for (const field of [
    "id", "at", "run", "question", "chose", "alternatives", "because", "undo", "scope", "kind",
  ]) {
    it(`rejects when ${field} is missing`, () => {
      const obj = validDecision() as Record<string, unknown>;
      delete obj[field];
      const result = validateLine(line(obj));
      expect(result.verdict).toBe("rejected");
    });
  }

  it("rejects invalid JSON without throwing", () => {
    expect(validateLine("{不是 json").verdict).toBe("rejected");
  });

  it("rejects unknown ev", () => {
    expect(validateLine(line({ ev: "note", id: "run-7c/3" })).verdict).toBe("rejected");
  });
});

describe("validateLine — check 2: alternatives is non-empty and each entry has option and why_not", () => {
  it("rejects when alternatives is an empty array (spec §3.5: not a decision)", () => {
    const result = validateLine(line(validDecision({ alternatives: [] })));
    expect(result.verdict).toBe("rejected");
  });

  it("rejects when an alternatives entry is missing why_not", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行开两个 worktree" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });

  it("rejects when an alternatives entry's why_not is an empty string", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行", why_not: "" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });
});

describe("validateLine — check 4: kind and scope whitelists", () => {
  // Derived from DECISION_KINDS, not spelled out: a hard-coded list here would
  // silently stop covering a newly added kind — green, and empty. That is the
  // shape this repo has been bitten by before.
  for (const kind of DECISION_KINDS) {
    it(`accepts whitelisted kind=${kind}`, () => {
      expect(validateLine(line(validDecision({ kind }))).verdict).toBe("ok");
    });
  }

  it("DECISION_KINDS has exactly the seven kinds the ledger recognises", () => {
    // Counting is the only way this task's mutations are visible: dropping a
    // kind, or reverting the loop above to a hard-coded list, makes the derived
    // loop run one fewer case — and a suite that runs one fewer case is green,
    // not red. vitest has no opinion about a test that stopped existing.
    expect([...DECISION_KINDS]).toEqual([
      "dependency", "interface", "scheduling", "abandon", "criteria", "boundary", "reconcile",
    ]);
  });

  it("rejects kind outside the whitelist", () => {
    expect(validateLine(line(validDecision({ kind: "naming" }))).verdict).toBe("rejected");
  });

  for (const scope of ["file", "task", "repo", "cross-repo"]) {
    it(`accepts whitelisted scope=${scope}`, () => {
      expect(validateLine(line(validDecision({ scope }))).verdict).toBe("ok");
    });
  }

  it("rejects scope outside the whitelist", () => {
    expect(validateLine(line(validDecision({ scope: "global" }))).verdict).toBe("rejected");
  });

  it("rejects unknown fields on decision (matches ccloop's .strict() shape)", () => {
    expect(validateLine(line(validDecision({ confidence: 0.9 }))).verdict).toBe("rejected");
  });
});

describe("validateLine — decision /5: reference events require only ev and id", () => {
  it("downgrades the bound example given verbatim in spec §3.3, which predates the attribution fields", () => {
    // Rewritten by P1 Task 2. The spec's own example carries only ev / id /
    // note, so requiring taskId and runId on bound makes that example no
    // longer valid — deliberately, and by the same reasoning as the seven
    // real bound lines in this repository's first ledger: the example was
    // written before the fields existed. It is downgraded rather than
    // rejected, which is exactly the distinction being claimed: the record is
    // well formed, it just cannot say which task implemented the decision.
    // Extra fields still pass through (the note survives), so the only thing
    // this criterion gave up is the verdict word.
    const result = validateLine(line({ ev: "bound", id: "run-7c/3", note: "落地于本笔提交" }));
    expect(result.verdict).toBe("downgraded");
    expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("taskId");
    expect(
      validateLine(line({ ev: "bound", id: "run-7c/3", note: "落地于本笔提交", taskId: "t-1", runId: "run-7c" })),
    ).toEqual({ verdict: "ok" });
  });

  it("accepts superseded with only ev and id", () => {
    expect(validateLine(line({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
  });

  // Encodes ruling orca-dev-c1c3c2ec/5: a panel correction is overturned's
  // only legal source, so correctionId is required and "only ev and id" is no
  // longer a legal record. The original criterion encoded this one's
  // predecessor (decision orca-dev-09cc3ea1/5, reference events pin only ev
  // and id). This is a tightening, not a loosening. The full six-field
  // criteria live in tests/ledger/overturnedEvent.test.ts.
  it("rejects overturned with only ev and id — it now carries four more required fields", () => {
    expect(validateLine(line({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("rejected");
  });

  it("rejects a reference event missing id", () => {
    expect(validateLine(line({ ev: "bound" })).verdict).toBe("rejected");
  });
});

describe("validateLine — regression: every real line in this repo's own ledger validates", () => {
  it("has at least one line in the ledger fixture (guards against a wrong/empty path)", () => {
    const ledgerPath = fileURLToPath(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
    );
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("accepts every decision line in .decisions/orca-dev-09cc3ea1.jsonl, and downgrades the seven bound lines that predate the attribution fields", () => {
    // Rewritten by P1 Task 2 (human ruling 2026-09-03). The original asserted
    // every line validates ok. That stopped being true the moment bound began
    // requiring taskId/runId, and it stopped being true *correctly*: those
    // seven lines predate the fields and, the ledger being append-only, can
    // never acquire them. Asserting the new fact keeps this criterion doing
    // its original job — running the validator against real data rather than
    // hand-made fixtures, the gap that once let .strict() reject all seven
    // real decisions while 34 criteria stayed green — and additionally pins
    // the new requirement against real history.
    const ledgerPath = fileURLToPath(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
    );
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim().length > 0);

    const results = lines.map((raw) => ({ ev: JSON.parse(raw).ev, result: validateLine(raw) }));
    const decisions = results.filter((r) => r.ev === "decision");
    const bounds = results.filter((r) => r.ev === "bound");

    expect(decisions.length).toBe(7);
    expect(bounds.length).toBe(7);
    expect(decisions.length + bounds.length).toBe(results.length);

    for (const { result } of decisions) {
      expect(result.verdict).toBe("ok");
    }
    for (const { result } of bounds) {
      expect(result.verdict).toBe("downgraded");
      expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("taskId");
    }
  });
});

describe("validateLine — check 3: an unexecutable undo.how downgrades to Tier 0, it is not rejected", () => {
  it("downgrades when undo.how is prose", () => {
    const result = validateLine(
      line(validDecision({
        undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result.verdict).toBe("downgraded");
    if (result.verdict === "downgraded") {
      expect(result.tier).toBe(0);
    }
  });

  it("downgrade does not swallow rejection: when kind is also invalid, the result is rejected, not downgraded", () => {
    const result = validateLine(
      line(validDecision({
        kind: "naming",
        undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result.verdict).toBe("rejected");
  });

  it("still ok when undo.how is executable", () => {
    const result = validateLine(
      line(validDecision({
        undo: { how: "git branch -f int/a <ref>", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result).toEqual({ verdict: "ok" });
  });
});

describe("validateLine routes every reference event name from the single source", () => {
  // Iterating the constant rather than listing names is the whole point: a
  // fourth hard-coded copy of this list used to live in validateLine's router,
  // which meant a name could be in REFERENCE_EVENT_TYPES and still fall
  // through to "unknown ev". A test that spelled the three names out would
  // have stayed green through exactly that bug.
  // The minimal *valid* record differs by name since P1 Task 2 — bound also
  // needs its two attribution fields. What is under test here is the routing,
  // so each name gets the record that is valid for it.
  // overturned joined bound in needing more than ev+id (ruling
  // orca-dev-c1c3c2ec/5). Only the fixture moved — what this criterion
  // measures is still the routing, not the shapes.
  const minimalRecord = (ev: string) => {
    if (ev === "bound") return { ev, id: "run-7c/3", taskId: "t-4", runId: "orca-dev-abc123" };
    if (ev === "overturned") {
      return {
        ev,
        id: "run-7c/3",
        correctionId: "c_01J9X",
        replacedBy: "run-9d/2",
        at: "2026-09-05T18:04:11Z",
        run: "run-9d",
      };
    }
    return { ev, id: "run-7c/3" };
  };

  for (const ev of REFERENCE_EVENT_TYPES) {
    it(`accepts a minimal ${ev} record`, () => {
      expect(validateLine(JSON.stringify(minimalRecord(ev))).verdict).toBe("ok");
    });
  }

  it("an ev outside REFERENCE_EVENT_TYPES is rejected by the router, not by the reference schema", () => {
    // The pre-existing "rejects unknown ev" criterion asserts only the verdict,
    // and referenceEventSchema's own z.enum rejects a stray name as well — so a
    // predicate that answered true for every input left the whole suite green
    // (measured: 104/104 passed with `return true` in isReferenceEventName).
    // Pinning the reason is what makes that mutation visible.
    const result = validateLine(JSON.stringify({ ev: "note", id: "run-7c/3" }));
    expect(result.verdict).toBe("rejected");
    expect(result.verdict === "rejected" ? result.reasons.join(" ") : "").toContain("unknown ev");
  });

  it("every name in REFERENCE_EVENT_TYPES is routed away from the unknown-ev branch", () => {
    for (const ev of REFERENCE_EVENT_TYPES) {
      const result = validateLine(JSON.stringify({ ev }));
      // Missing id, so this must be rejected — but rejected by the reference
      // schema for the missing field, never by the router for an unknown ev.
      expect(result.verdict).toBe("rejected");
      expect(result.verdict === "rejected" ? result.reasons.join(" ") : "").not.toContain("unknown ev");
    }
  });
});

describe("bound events must name the task and run that implemented them", () => {
  // Why the fields exist at all: `git blame` on a bound line answers "which
  // commit implemented this", and a squash merge destroys that answer while
  // keeping the line. taskId/runId answer the question people actually ask —
  // "which task implemented this" — with an identifier no history rewrite can
  // touch. They are required now because a ledger is append-only: a field the
  // format never had cannot be backfilled onto lines already written.
  it("accepts a bound carrying taskId and runId", () => {
    const result = validateLine(JSON.stringify({
      ev: "bound", id: "run-7c/3", taskId: "t-4", runId: "orca-dev-abc123",
    }));
    expect(result.verdict).toBe("ok");
  });

  it("downgrades a bound whose only problem is a missing taskId", () => {
    // Downgraded, not rejected: such a line is not malformed, it just cannot
    // say which task implemented the decision, so nothing may act on its
    // attribution automatically. Every bound written before the field existed
    // has exactly this shape and can never be repaired — the ledger is
    // append-only. The writer still refuses to append one (it throws on
    // downgraded as well as on rejected), so this loosens reading history
    // without loosening anything about writing.
    const result = validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", runId: "orca-dev-abc123" }));
    expect(result.verdict).toBe("downgraded");
    expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("taskId");
  });

  it("downgrades a bound whose only problem is a missing runId", () => {
    const result = validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", taskId: "t-4" }));
    expect(result.verdict).toBe("downgraded");
    expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("runId");
  });

  it("rejects — does not downgrade — a bound that is broken in any other way", () => {
    // The downgrade is narrow on purpose. A bound with no id is malformed, not
    // merely unattributable, and widening the downgrade to every bound problem
    // would quietly turn a hard rejection into a warning.
    expect(validateLine(JSON.stringify({ ev: "bound", taskId: "t-4", runId: "r-1" })).verdict).toBe("rejected");
    expect(validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", taskId: 4, runId: "r-1" })).verdict).toBe("rejected");
    expect(validateLine(JSON.stringify({ ev: "bound", id: "", taskId: "t-4" })).verdict).toBe("rejected");
  });

  it("still accepts superseded without those fields", () => {
    // superseded still pins only ev and id. The original criterion paired
    // overturned with it, on the grounds that "requiring the fields everywhere
    // would be scope this plan has no authority to take" — that boundary was
    // P1's. Ruling orca-dev-c1c3c2ec/5 crossed it, but for overturned only;
    // superseded was not touched this round, so this half stands unchanged.
    expect(validateLine(JSON.stringify({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
  });
});
