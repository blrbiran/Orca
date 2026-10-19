import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agentDecisionId,
  ccloopEvidenceString,
  normalizeAgentEntry,
  pendingIdOf,
  runEvidence,
  writeRunLedger,
} from "../../src/control/runLedger.js";

const at = "2026-10-18T00:00:00.000Z";
const run = "run-0c6f1a2b";
const ev = runEvidence(run, "a".repeat(40), "ccloop 0.0.0");
const good = (over: Record<string, unknown> = {}) => ({
  question: "q",
  chose: "c",
  alternatives: [{ option: "o", why_not: "w" }],
  because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" },
  scope: "task",
  kind: "interface",
  ...over,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "orca-runledger-"));
});

async function readLines(d: string, r: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(d, `${r}.jsonl`), "utf8");
  return text.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}
const arr = (...entries: unknown[]) => ({ kind: "array" as const, entries });

describe("writeRunLedger", () => {
  it("writes two agent decisions with Orca's id, at, run and evidence", async () => {
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good(), good({ id: "forged", run: "x", at: "y", evidence: ["z"] })),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    const lines = await readLines(dir, run);
    expect(lines.map((l) => l.id)).toEqual([`${run}/agent-0`, `${run}/agent-1`]); // M2
    expect(lines[0]).toMatchObject({ ev: "decision", run, at, evidence: ev });
    expect(lines[1]).toMatchObject({ run, at, evidence: ev });
    expect(out.writtenIds).toEqual([`${run}/agent-0`, `${run}/agent-1`]);
    expect(out.pending).toEqual([]);
  });

  it("refuses a kind outside the enum by name and still writes the good entry", async () => {
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good({ kind: "opinion" }), good()),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.pending.map((p) => [p.pendingId, p.reason])).toEqual([[`pending-${run}-0`, 'kind-unknown:"opinion"']]); // M1
    expect(out.pending[0]).toMatchObject({ ledgerRun: run, entryIndex: 0, at, evidence: ev });
    expect(out.pending[0]!.entry).toMatchObject({ kind: "opinion" });
    expect((await readLines(dir, run)).map((l) => l.id)).toEqual([`${run}/agent-1`]); // M3
  });

  it("refuses a scope outside the enum by name", async () => {
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good({ scope: "galaxy" })),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.pending.map((p) => p.reason)).toEqual(['scope-unknown:"galaxy"']);
    expect(existsSync(join(dir, `${run}.jsonl`))).toBe(false);
  });

  it("turns a non-executable undo.how into a tier-0 pending item", async () => {
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good({ undo: { how: "revert it", cost: "c", blast_radius: "r" } })),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.pending).toHaveLength(1);
    expect(out.pending[0]!.reason.startsWith("tier-0: undo.how is not executable")).toBe(true);
    expect(existsSync(join(dir, `${run}.jsonl`))).toBe(false);
  });

  it("turns empty alternatives and a missing because into rejected pending items", async () => {
    const noBecause: Record<string, unknown> = good();
    delete noBecause.because;
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good({ alternatives: [] }), noBecause),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.pending.map((p) => p.pendingId)).toEqual([`pending-${run}-0`, `pending-${run}-1`]);
    for (const p of out.pending) expect(p.reason.startsWith("rejected: ")).toBe(true);
    expect(existsSync(join(dir, `${run}.jsonl`))).toBe(false);
  });

  it("turns a batch-level throw into pending items for the whole batch", async () => {
    await writeFile(
      join(dir, `${run}.jsonl`),
      JSON.stringify({ ...good(), ev: "decision", id: `${run}/agent-0`, at, run, evidence: ev }) + "\n",
    );
    const before = await readFile(join(dir, `${run}.jsonl`), "utf8");
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: arr(good(), good()),
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.writtenIds).toEqual([]);
    expect(out.pending.map((p) => p.pendingId)).toEqual([`pending-${run}-0`, `pending-${run}-1`]);
    for (const p of out.pending) {
      expect(p.reason.startsWith('batch-refused: refusing to append: duplicate decision id')).toBe(true); // M4
    }
    expect(await readFile(join(dir, `${run}.jsonl`), "utf8")).toBe(before);
  });

  it("writes nothing for an absent or empty report", async () => {
    for (const reported of [{ kind: "absent" as const }, arr()]) {
      const out = await writeRunLedger(dir, { ledgerRun: run, reported, codeAuthored: [], at, evidence: ev });
      expect(out).toEqual({ writtenIds: [], pending: [] });
    }
    expect(existsSync(join(dir, `${run}.jsonl`))).toBe(false);
  });

  it("names a non-array decisions value as one pending item", async () => {
    const out = await writeRunLedger(dir, {
      ledgerRun: run,
      reported: { kind: "malformed", value: "not a list" },
      codeAuthored: [],
      at,
      evidence: ev,
    });
    expect(out.pending).toHaveLength(1);
    expect(out.pending[0]).toMatchObject({
      pendingId: `pending-${run}-0`,
      entryIndex: 0,
      reason: "decisions-not-array",
      entry: "not a list",
      ledgerRun: run,
      at,
      evidence: ev,
    });
    expect(existsSync(join(dir, `${run}.jsonl`))).toBe(false);
  });

  it("writes code-authored decisions before agent ones", async () => {
    const template = normalizeAgentEntry(good(), { ledgerRun: run, entryIndex: 0, at, evidence: ev });
    if (!template.ok) throw new Error(template.reason);
    const codeAuthored = [{ ...template.event, id: `${run}/1` }];
    const out = await writeRunLedger(dir, { ledgerRun: run, reported: arr(good()), codeAuthored, at, evidence: ev });
    expect((await readLines(dir, run)).map((l) => l.id)).toEqual([`${run}/1`, `${run}/agent-0`]);
    expect(out.writtenIds).toEqual([`${run}/1`, `${run}/agent-0`]);
  });

  it("lets a throw from the code-authored append propagate", async () => {
    const template = normalizeAgentEntry(good(), { ledgerRun: run, entryIndex: 0, at, evidence: ev });
    if (!template.ok) throw new Error(template.reason);
    const bad = { ...template.event, run: "other-run" };
    await expect(
      writeRunLedger(dir, { ledgerRun: run, reported: arr(good()), codeAuthored: [bad], at, evidence: ev }),
    ).rejects.toThrow(/does not match the ledger file/);
  });
});

// Reported-decisions spec 2026-10-20 §6 (criterion 14): the agent's grade is written as it reported it; an entry without
// one writes no grade (it reads as major), and a grade outside the two is refused into pending, never written or hidden.
describe("writeRunLedger and importance", () => {
  it("writes a minor entry with importance minor and an ungraded entry with no importance", async () => {
    const out = await writeRunLedger(dir, { ledgerRun: run, reported: arr(good({ importance: "minor" }), good()), codeAuthored: [], at, evidence: ev });
    const lines = await readLines(dir, run);
    expect(lines.map((l) => [l.id, l.importance])).toEqual([[`${run}/agent-0`, "minor"], [`${run}/agent-1`, undefined]]);
    expect("importance" in lines[1]!).toBe(false);
    expect(out.pending).toEqual([]);
  });
  it("refuses an entry with an unknown grade into pending", async () => {
    const out = await writeRunLedger(dir, { ledgerRun: run, reported: arr(good({ importance: "critical" })), codeAuthored: [], at, evidence: ev });
    expect(out.writtenIds).toEqual([]);
    expect(out.pending.map((p) => [p.entryIndex, p.reason.startsWith("rejected:")])).toEqual([[0, true]]);
  });
});

describe("normalizeAgentEntry", () => {
  const ctx = { ledgerRun: run, entryIndex: 3, at, evidence: ev };
  it("refuses a non-object", () => {
    for (const e of [null, "x", 4, [good()]]) expect(normalizeAgentEntry(e, ctx)).toEqual({ ok: false, reason: "entry-not-object" });
  });
  it("sets undo.how from ctx.undoHow when given", () => {
    const how = `git revert --no-edit ${"c".repeat(40)}`;
    const r = normalizeAgentEntry(good({ undo: { how: "whatever", cost: "c", blast_radius: "r" } }), { ...ctx, undoHow: how });
    expect(r.ok && r.event.undo.how).toBe(how);
    expect(r.ok && r.event.id).toBe(agentDecisionId(run, 3));
    expect(pendingIdOf(run, 3)).toBe(`pending-${run}-3`);
  });
});

describe("runEvidence / ccloopEvidenceString", () => {
  it("lists run, attempt and ccloop strings", () => {
    expect(runEvidence("r1", "abc", "ccloop 1.0.0")).toEqual(["run r1", "attempt abc", "ccloop 1.0.0"]);
  });
  it("falls back to the package.json version, then to unknown, and never throws", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-ccloopev-"));
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "ccloop", version: "1.2.3" }));
    expect(await ccloopEvidenceString(join(root, "dist", "cli.js"))).toBe("ccloop 1.2.3");
    const bare = await mkdtemp(join(tmpdir(), "orca-ccloopev-"));
    expect(await ccloopEvidenceString(join(bare, "cli.js"))).toBe("ccloop unknown");
  });
});
