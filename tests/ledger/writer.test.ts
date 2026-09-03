import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent } from "../../src/ledger/writer.js";
import { validateFile } from "../../src/ledger/validateFile.js";

function validDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id,
    at: "2026-08-29T00:00:00.000Z",
    // A decision id is "<run>/<n>", and since P1 Task 3 the writer refuses a
    // decision whose run field disagrees with the ledger file it lands in. The
    // default derives run from the id so the fixture is self-consistent for
    // whichever run a criterion happens to use; the override still lets a
    // criterion make them disagree on purpose.
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

// bound records carry taskId/runId since P1 Task 2. Criteria that only need
// "a second event after the decision" use this, so the attribution fields stay
// out of what they are actually measuring.
function boundFor(id: string, overrides: Record<string, unknown> = {}) {
  return { ev: "bound", id, taskId: "t-1", runId: "fx", ...overrides };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "orca-writer-"));
}

describe("appendEvent — on-disk shape", () => {
  it("writes to <dir>/<runId>.jsonl, one line per event, trailing newline", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "fx", validDecision("fx/1"));
    await appendEvent(dir, "fx", boundFor("fx/1"));

    const text = await readFile(join(dir, "fx.jsonl"), "utf8");
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0]).id).toBe("fx/1");
    expect(JSON.parse(lines[1]).ev).toBe("bound");
  });

  it("creates the directory automatically when it does not exist", async () => {
    const dir = join(await tempDir(), "nested", ".decisions");
    await appendEvent(dir, "fx", validDecision("fx/1"));
    const text = await readFile(join(dir, "fx.jsonl"), "utf8");
    expect(text).toContain("fx/1");
  });
});

describe("appendEvent — fail closed", () => {
  it("throws when the validator rejects, and writes not one byte", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(dir, "fx", validDecision("fx/1", { alternatives: [] })),
    ).rejects.toThrow(/rejected/);
    await expect(readFile(join(dir, "fx.jsonl"), "utf8")).rejects.toThrow();
  });

  it("throws when the validator downgrades, and writes not one byte", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(
        dir,
        "fx",
        validDecision("fx/1", { undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" } }),
      ),
    ).rejects.toThrow(/downgraded/);
    await expect(readFile(join(dir, "fx.jsonl"), "utf8")).rejects.toThrow();
  });
});

describe("appendEvent — run-id path safety", () => {
  for (const bad of ["../escape", "a/b", ".hidden", "", "with space"]) {
    it(`rejects an invalid run id: ${JSON.stringify(bad)}`, async () => {
      const dir = await tempDir();
      await expect(appendEvent(dir, bad, validDecision("fx/1"))).rejects.toThrow(/run id/);
    });
  }

  it("accepts a valid run id: orca-dev-09cc3ea1", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "orca-dev-09cc3ea1", validDecision("orca-dev-09cc3ea1/1"));
    const text = await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8");
    expect(text).toContain("orca-dev-09cc3ea1/1");
  });
});

describe("appendEvent — check 5: a reference event's id must exist as a decision", () => {
  it("throws when a bound references an id with no matching decision in the file (a typo, not fixable in place)", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(dir, "probe", boundFor("probe/999", { note: "typo" })),
    ).rejects.toThrow(/rejected/);
    await expect(readFile(join(dir, "probe.jsonl"), "utf8")).rejects.toThrow();
  });

  it("passes once the referenced decision has actually been appended first", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "probe", validDecision("probe/1"));
    await appendEvent(dir, "probe", boundFor("probe/1"));
    const text = await readFile(join(dir, "probe.jsonl"), "utf8");
    expect(text.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
  });

  // Pins the documented narrowing: appendEvent cannot see a decision that has
  // not been written yet, so a bound written before its decision throws here —
  // while validateFile, reading the same two lines in that same order after
  // the fact, still returns ok (spec §3.8 check 5 asks for existence, not
  // order). One test, both halves, so the asymmetry is an assertion, not a
  // comment.
  it("writing a bound before its decision throws, even though validateFile accepts that same order", async () => {
    const dir = await tempDir();
    await expect(appendEvent(dir, "probe", boundFor("probe/1"))).rejects.toThrow(
      /rejected/,
    );
    await expect(readFile(join(dir, "probe.jsonl"), "utf8")).rejects.toThrow();

    const result = validateFile([
      JSON.stringify(boundFor("probe/1")),
      JSON.stringify(validDecision("probe/1")),
    ]);
    expect(result.verdict).toBe("ok");
  });
});

describe("appendEvent — a missing trailing newline must not corrupt the append (scoped re-review finding)", () => {
  // Seeds the file directly with writeFile, not through appendEvent, so its
  // last byte is genuinely not "\n" — the shape Fix 2 (appendOnly.ts)
  // establishes as ordinary for a hand-written or externally-trimmed ledger.
  // Before this fix, appendFile would glue the new record onto the end of
  // this line, and the check-5 step would have validated a set of lines
  // (built from `existingText.split("\n")`) that never actually existed on
  // disk — reporting success for bytes that were never going to be written.
  it("inserts a separating newline so the appended record lands on its own line, and what is on disk validates ok", async () => {
    const dir = await tempDir();
    const filePath = join(dir, "probe.jsonl");
    const seed = JSON.stringify(validDecision("probe/1"));
    await writeFile(filePath, seed); // deliberately no trailing newline

    await appendEvent(dir, "probe", boundFor("probe/1"));

    // Assert on what is actually on disk, not on what was passed in to
    // appendEvent or to writeFile — that distinction is the whole finding.
    const onDisk = await readFile(filePath, "utf8");
    const physicalLines = onDisk.split("\n").filter((l) => l.length > 0);
    expect(physicalLines).toHaveLength(2);
    expect(() => JSON.parse(physicalLines[0])).not.toThrow();
    expect(() => JSON.parse(physicalLines[1])).not.toThrow();
    expect(JSON.parse(physicalLines[0]).id).toBe("probe/1");
    expect(JSON.parse(physicalLines[1]).ev).toBe("bound");

    const result = validateFile(onDisk.split("\n"));
    expect(result.verdict).toBe("ok");
  });

  it("does not insert a separator when the existing file already ends with a newline (normal, sequential appends are untouched)", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "probe", validDecision("probe/1"));
    await appendEvent(dir, "probe", boundFor("probe/1"));

    const onDisk = await readFile(join(dir, "probe.jsonl"), "utf8");
    // No blank line was introduced between the two records.
    expect(onDisk).not.toContain("\n\n");
    expect(onDisk.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
  });
});

describe("appendEvent can reproduce this repo's own hand-written ledger", () => {
  // Task 1's 8 lines were hand-written (the writer did not exist yet). This
  // assertion proves: the same objects fed through the writer produce bytes
  // identical, character for character, to what is on disk in the repo.
  it("feeding each decision line through appendEvent reproduces them byte for byte, and the first bound line is refused", async () => {
    // Rewritten by P1 Task 2 (human ruling 2026-09-03). The original replayed
    // all fourteen lines. Seven of them are bound records written before bound
    // required taskId/runId, and the writer now refuses them — correctly:
    // today's writer could not have produced them, and the ledger being
    // append-only they can never be repaired. Narrowing the replay to the
    // decision lines keeps the original job (real data through the real
    // writer, compared byte for byte), and the refusal of a real historical
    // bound is asserted rather than skipped, so the new requirement is pinned
    // against real history and not only against fixtures.
    const real = await readFile(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
      "utf8",
    );
    const lines = real.split("\n").filter((l) => l.trim().length > 0);
    const decisions = lines.filter((l) => JSON.parse(l).ev === "decision");
    const bounds = lines.filter((l) => JSON.parse(l).ev === "bound");
    expect(decisions).toHaveLength(7);
    expect(bounds).toHaveLength(7);

    const dir = await tempDir();
    for (const line of decisions) {
      await appendEvent(dir, "orca-dev-09cc3ea1", JSON.parse(line));
    }
    const written = await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8");
    expect(written).toBe(`${decisions.join("\n")}\n`);

    await expect(
      appendEvent(dir, "orca-dev-09cc3ea1", JSON.parse(bounds[0])),
    ).rejects.toThrow(/taskId/);
    // Read the disk after the refusal rather than trusting the throw.
    expect(await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8")).toBe(written);
  });
});

describe("appendEvent refuses a bound that cannot say which task implemented it", () => {
  it("throws and writes not one byte", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "fx", validDecision("fx/1"));
    const before = await readFile(join(dir, "fx.jsonl"), "utf8");

    // The verdict for this shape is `downgraded`, not `rejected` — and the
    // writer throws on both. That is the point: reading old history got
    // gentler, writing new history did not. Matching on the reason text rather
    // than the verdict word keeps this criterion pinned to the requirement
    // instead of to which of the two refusal paths carries it.
    await expect(
      appendEvent(dir, "fx", { ev: "bound", id: "fx/1" }),
    ).rejects.toThrow(/taskId/);

    // Measure the bytes directly rather than trusting the throw: a writer that
    // threw after appending would still satisfy `rejects.toThrow`.
    expect(await readFile(join(dir, "fx.jsonl"), "utf8")).toBe(before);
  });
});

describe("appendEvent — the run field must match the file it lands in", () => {
  it("throws when a decision's run field names a different run than the file", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(dir, "run-a", validDecision("run-a/1", { run: "run-b" })),
    ).rejects.toThrow(/run/);
    // The file must not even have been created.
    await expect(readFile(join(dir, "run-a.jsonl"), "utf8")).rejects.toThrow();
  });

  it("accepts a decision whose run field matches", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", validDecision("run-a/1"));
    expect(await readFile(join(dir, "run-a.jsonl"), "utf8")).toContain("run-a");
  });

  it("does not apply the check to reference events, which carry no run field", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", validDecision("run-a/1"));
    await appendEvent(dir, "run-a", {
      ev: "bound", id: "run-a/1", taskId: "t-1", runId: "run-a",
    });
    const text = await readFile(join(dir, "run-a.jsonl"), "utf8");
    expect(text.split("\n").filter(Boolean).length).toBe(2);
  });
});

describe("appendEvent — a decision id must be unique within its file", () => {
  it("throws on a second decision with an id already in the file, and writes not one byte", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", validDecision("run-a/1"));
    const before = await readFile(join(dir, "run-a.jsonl"), "utf8");

    await expect(
      appendEvent(dir, "run-a", validDecision("run-a/1", { question: "a different question" })),
    ).rejects.toThrow(/duplicate/);

    // Read the disk after the refusal: a writer that threw after appending
    // would still satisfy rejects.toThrow.
    expect(await readFile(join(dir, "run-a.jsonl"), "utf8")).toBe(before);
  });

  it("allows two decisions with different ids", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", validDecision("run-a/1"));
    await appendEvent(dir, "run-a", validDecision("run-a/2"));
    expect((await readFile(join(dir, "run-a.jsonl"), "utf8")).split("\n").filter(Boolean).length).toBe(2);
  });
});
