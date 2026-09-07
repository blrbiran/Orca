import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvents } from "../../src/ledger/writer.js";

function validDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id,
    at: "2026-09-07T00:00:00.000Z",
    run: id.split("/")[0],
    question: "用哪种锁",
    chose: "文件租约",
    alternatives: [{ option: "进程内互斥", why_not: "跨进程无效" }],
    because: "跨进程",
    undo: { how: "git revert <ref>", cost: "一次重跑", blast_radius: "仅本仓库" },
    scope: "repo",
    kind: "interface",
    ...overrides,
  };
}

function overturnedFor(id: string, replacedBy: string, run: string) {
  return {
    ev: "overturned",
    id,
    correctionId: "c_deadbeefdeadbeef",
    replacedBy,
    at: "2026-09-07T00:00:00.000Z",
    run,
  };
}

const tempDir = () => mkdtemp(join(tmpdir(), "orca-batch-"));

describe("appendEvents (spec §14.1)", () => {
  // The positive observation the two "nothing happened" criteria below need:
  // without it, deleting the whole function would leave them both green.
  it("lands a decision and the overturned that replaces it in one file, in order", async () => {
    const dir = await tempDir();
    await appendEvents(dir, "fx", [validDecision("fx/1"), overturnedFor("fx/1", "fx/1", "fx")]);

    const lines = (await readFile(join(dir, "fx.jsonl"), "utf8")).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).ev).toBe("decision");
    expect(JSON.parse(lines[1]).ev).toBe("overturned");
    expect(lines[2]).toBe("");
  });

  // E9b — interface-contract criterion (registered §14.19 item 18: no product
  // caller can produce an empty batch, so this does NOT count as coverage of
  // C1/I8/I9). An empty batch's payload would be nothing but the separator,
  // which appends a lone "\n" to a file with no trailing newline.
  it("refuses an empty batch", async () => {
    const dir = await tempDir();
    await expect(appendEvents(dir, "fx", [])).rejects.toThrow(/empty batch/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E18b — interface-contract criterion (same registration).
  it("refuses a batch that carries the same decision id twice", async () => {
    const dir = await tempDir();
    await expect(
      appendEvents(dir, "fx", [validDecision("fx/1"), validDecision("fx/1", { question: "别的" })]),
    ).rejects.toThrow(/duplicate decision id "fx\/1"/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E18 — THE central claim of §14.1: there is no state in which the decision
  // was written and the overturned was not. The second event is rejected
  // (replacedBy resolves to nothing), so the file must not exist at all.
  it("writes nothing when the second event of the batch is rejected", async () => {
    const dir = await tempDir();
    await expect(
      appendEvents(dir, "fx", [validDecision("fx/1"), overturnedFor("fx/1", "fx/999", "fx")]),
    ).rejects.toThrow(/replacedBy/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E9 (ledger half): a target repo's ledger legitimately has no trailing
  // newline (spec §9.2 Fix 2). appendFile only concatenates bytes.
  it("does not glue the batch onto a file that has no trailing newline", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "fx.jsonl"), JSON.stringify(validDecision("fx/1")));

    await appendEvents(dir, "fx", [validDecision("fx/2"), overturnedFor("fx/1", "fx/2", "fx")]);

    const lines = (await readFile(join(dir, "fx.jsonl"), "utf8")).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
