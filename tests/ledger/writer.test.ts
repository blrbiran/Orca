import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent } from "../../src/ledger/writer.js";

function validDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id,
    at: "2026-08-29T00:00:00.000Z",
    run: "fx",
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

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "orca-writer-"));
}

describe("appendEvent — on-disk shape", () => {
  it("writes to <dir>/<runId>.jsonl, one line per event, trailing newline", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "fx", validDecision("fx/1"));
    await appendEvent(dir, "fx", { ev: "bound", id: "fx/1" });

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

describe("appendEvent can reproduce this repo's own hand-written ledger", () => {
  // Task 1's 8 lines were hand-written (the writer did not exist yet). This
  // assertion proves: the same objects fed through the writer produce bytes
  // identical, character for character, to what is on disk in the repo.
  it("feeding each line through appendEvent reproduces .decisions/orca-dev-09cc3ea1.jsonl byte for byte", async () => {
    const real = await readFile(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
      "utf8",
    );
    const dir = await tempDir();
    for (const line of real.split("\n")) {
      if (line.trim().length === 0) continue;
      await appendEvent(dir, "orca-dev-09cc3ea1", JSON.parse(line));
    }
    const written = await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8");
    expect(written).toBe(real);
  });
});
