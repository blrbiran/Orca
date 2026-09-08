import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, appendEvents } from "../../src/ledger/writer.js";
import { deriveRows } from "../../src/corrections/derive.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import type { Correction } from "../../src/corrections/schema.js";

const original: DecisionEvent = {
  ev: "decision",
  id: "orca-dev-1/1",
  at: "2026-09-01T00:00:00.000Z",
  run: "orca-dev-1",
  question: "用哪种锁",
  chose: "进程内互斥",
  alternatives: [{ option: "文件租约", why_not: "当时觉得太重" }],
  because: "实现最快",
  undo: { how: "git revert <ref>", cost: "要回滚三个仓库的 W 分支", blast_radius: "三个仓库" },
  scope: "repo",
  kind: "interface",
};

const correction: Correction = {
  id: "c_1111111111111111",
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "not_my_taste",
  chose_instead: "改用文件租约",
  because: "进程内互斥跨进程无效",
  at: "2026-09-05T00:00:00.000Z",
  by: "amy",
};

const input = {
  correction,
  original,
  choseInstead: "改用文件租约",
  undo: { how: "删掉 src/scheduler/pool.ts 里的进程内互斥" },
  at: "2026-09-07T12:00:00.000Z",
  runId: "orca-fix-abcd1234",
};

describe("derived rows (spec §5 as revised by §14.2 / §14.5 / §14.22)", () => {
  // 🔴 E13. Both rows deep-equal, not just the decision: overturned's schema
  // is a `.passthrough()` extension, so an extra or misspelled field on THAT
  // row is accepted by zod — and `correctionId`, the join key A' §4.4's fix
  // rate is computed on, lives exactly there. Nothing but deep equality holds
  // that line.
  it("derives both rows field by field", () => {
    const { decision, overturned } = deriveRows(input);

    expect(decision).toEqual({
      ev: "decision",
      id: "orca-fix-abcd1234/1",
      at: "2026-09-07T12:00:00.000Z",
      run: "orca-fix-abcd1234",
      question: "用哪种锁",
      chose: "改用文件租约",
      alternatives: [
        { option: "进程内互斥", why_not: "人在 correction c_1111111111111111 里推翻了它：进程内互斥跨进程无效" },
      ],
      because: "进程内互斥跨进程无效",
      undo: {
        how: "删掉 src/scheduler/pool.ts 里的进程内互斥",
        cost: "要回滚三个仓库的 W 分支（继承自 orca-dev-1/1）",
        blast_radius: "三个仓库（继承自 orca-dev-1/1）",
      },
      scope: "repo",
      kind: "interface",
      evidence: ["correction c_1111111111111111", "overturns orca-dev-1/1"],
    });

    expect(overturned).toEqual({
      ev: "overturned",
      id: "orca-dev-1/1",
      correctionId: "c_1111111111111111",
      replacedBy: "orca-fix-abcd1234/1",
      at: "2026-09-07T12:00:00.000Z",
      run: "orca-fix-abcd1234",
    });
  });

  // E16 (unit half; the command-level half is Task 9). §14.5 overturned §5's
  // "back-fill the correction's at" wholesale: upstream defines overturned.at
  // as the moment it was written, and back-filling silently changed the
  // MEANING of an append-only field. It also bought nothing — the correction's
  // own `at` is reachable through correctionId.
  it("stamps both rows with the injected write moment, not the correction's", () => {
    const { decision, overturned } = deriveRows(input);
    expect(decision.at).toBe("2026-09-07T12:00:00.000Z");
    expect(overturned.at).toBe("2026-09-07T12:00:00.000Z");
    expect(decision.at).not.toBe(correction.at);
  });

  // 🔴 E21 (§14.22): the two overrides exist because an inherited undo.cost can
  // be an outright lie — "roll back three repositories" attached to a choice
  // that touches one file — and the ledger is append-only, so "we can add a
  // flag later" is never true for a row already written.
  it("uses the human's undo cost and blast radius when given, with no inheritance note", () => {
    const { decision } = deriveRows({
      ...input,
      undo: { how: "删掉那处互斥", cost: "改一个文件", blastRadius: "仅本仓库" },
    });
    expect(decision.undo.cost).toBe("改一个文件");
    expect(decision.undo.blast_radius).toBe("仅本仓库");
    expect(decision.undo.cost).not.toContain("继承自");
    expect(decision.undo.blast_radius).not.toContain("继承自");
  });

  // E12: the derived undo.how is the human's, so a non-executable one is
  // refused by the ledger writer's check 3 instead of landing as a Tier 0
  // downgraded row. This is what makes ruling 4 (undo.how is the human's to
  // fill) a gate rather than a decoration.
  //
  // Fix round 1 finding: the original version of this criterion used a bare
  // mkdtemp directory, so overturned.id ("orca-dev-1/1") resolved to nothing
  // and check 5 (unknown decision id) rejected the batch regardless of
  // undo.how — the criterion had never actually observed a write succeed or
  // fail on the thing it's named for. Seeding `original` on disk in its own
  // run file first makes the non-executable undo.how the ONLY thing standing
  // between this batch and success.
  it("fails the append instead of writing a downgraded row when undo.how is prose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-derive-"));
    await appendEvent(dir, "orca-dev-1", original);
    const { decision, overturned } = deriveRows({ ...input, undo: { how: "改一下" } });
    await expect(appendEvents(dir, "orca-fix-abcd1234", [decision, overturned])).rejects.toThrow(
      /downgraded to tier 0/,
    );
    // The "rather than writing a downgraded row" half: nothing pinned this
    // before. A rejected append must leave no ledger file for the run behind.
    expect(existsSync(join(dir, "orca-fix-abcd1234.jsonl"))).toBe(false);
  });
});
