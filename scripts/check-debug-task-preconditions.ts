import assert from "node:assert/strict";

/**
 * Correction => debug task plan, precondition gate (Rule 4): every name the plan consumes from the merged decisions
 * plan, pinned by the table in .superpowers/sdd/2026-10-18-correction-debug-task/constraints.md. It stops at the first
 * miss, naming it, and exits non-zero; nothing is invented to make it pass.
 */
const FUNCTIONS: Array<[module: string, names: string[]]> = [
  ["../src/control/ledgerAtRef.js", ["readLedgerAtRef", "ledgerSources", "findDecision", "integrationTargetRef"]],
  ["../src/control/pendingDecisions.js", ["readPendingDecision"]],
  ["../src/control/reportedDecisions.js", ["reportedDecisionsOf"]],
  ["../src/control/runLedger.js", ["writeRunLedger", "normalizeAgentEntry", "runEvidence"]],
  ["../src/control/ledgerTree.js", ["exportLedgerDir", "treeWithLedgerFiles"]],
  ["../src/control/decisionCommands.js", ["prepareRejection", "applyRejectPendingDecision"]],
  ["../src/control/executionDriver.js", ["savedReport"]],
];

const row = {
  id: "c_0", projectKey: "example.invalid/o/r", kind: "wrong", because: "b", at: "2026-10-18T00:00:00.000Z",
  by: "owner@example.invalid",
};

async function main(): Promise<void> {
  for (const [path, names] of FUNCTIONS) {
    const mod = (await import(path)) as Record<string, unknown>;
    for (const name of names) {
      assert.equal(typeof mod[name], "function", `missing function: ${name} (${path})`);
    }
  }

  const { VERB_ACCESS } = await import("../src/panel/humanOnly.js");
  assert.equal(
    (VERB_ACCESS as Record<string, unknown>)["reject-pending-decision"], "human-only",
    'missing: VERB_ACCESS["reject-pending-decision"] === "human-only"',
  );

  const { CORRECTION_FIELDS } = await import("../src/corrections/fields.js");
  for (const field of ["runId", "pendingId"]) {
    assert.ok((CORRECTION_FIELDS as readonly string[]).includes(field), `missing: CORRECTION_FIELDS lacks "${field}"`);
  }

  const { correctionSchema } = await import("../src/corrections/schema.js");
  const pending = correctionSchema.safeParse({ ...row, runId: "run-a", pendingId: "pending-run-a-0" });
  assert.ok(pending.success, "correctionSchema refuses a { runId, pendingId } row with no decisionId");
  const both = correctionSchema.safeParse({ ...row, decisionId: "run-a/agent-0", runId: "run-a", pendingId: "pending-run-a-0" });
  assert.ok(!both.success, "correctionSchema accepts a row with both decisionId and pendingId");

  const { durableCommandErrorStatuses } = await import("../src/control/errors.js");
  assert.notEqual(
    (durableCommandErrorStatuses as Record<string, unknown>)["correction-target-not-a-decision"], undefined,
    "missing: durableCommandErrorStatuses[\"correction-target-not-a-decision\"]",
  );
  const { CorrectRejection } = await import("../src/corrections/rejection.js");
  assert.equal(typeof CorrectRejection, "function", "missing: CorrectRejection (src/corrections/rejection.ts)");
}

main().then(
  () => console.log("debug-task preconditions: all names present"),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
