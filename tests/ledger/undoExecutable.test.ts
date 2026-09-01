import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../src/ledger/undoExecutable.js";

// Copied verbatim from spec §1.1.1's table. These 6 examples are the entire
// external spec for this predicate.
describe("undoHowIsExecutable — the three legal examples from spec §1.1.1", () => {
  it("git branch -f int/a <ref>", () => {
    expect(undoHowIsExecutable("git branch -f int/a <ref>")).toBe(true);
  });

  it("rm -rf .decisions/run-7c.jsonl && <rerun command>", () => {
    expect(undoHowIsExecutable("rm -rf .decisions/run-7c.jsonl && <重跑命令>")).toBe(true);
  });

  it("reset contract X's targetPaths back to [...] then rerun ccloop run", () => {
    expect(undoHowIsExecutable("把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run")).toBe(true);
  });
});

describe("undoHowIsExecutable — the three illegal examples from spec §1.1.1", () => {
  it("reschedule T7 back into the parallel pool", () => {
    expect(undoHowIsExecutable("把 T7 重新排进并行池")).toBe(false);
  });

  it("vague prose: 'just roll it back a bit'", () => {
    expect(undoHowIsExecutable("回滚一下就好")).toBe(false);
  });

  it("vague prose: 'tweak the config'", () => {
    expect(undoHowIsExecutable("改改配置")).toBe(false);
  });
});

describe("undoHowIsExecutable — exclusivity examples for each clause", () => {
  // These two exist so each clause's mutation has somewhere to go red.
  // Of the 3 legal examples spec gives, the first two are caught by BOTH clauses
  // (int/a and .decisions/... both contain a /) — deleting only the command-shape
  // clause leaves them passing, which is a green suite that proves nothing.
  it("only command-shape can catch this: npm test -- --run (no /, no camelCase)", () => {
    expect(undoHowIsExecutable("npm test -- --run")).toBe(true);
  });

  it("only named-target can catch this: spec §1.1.1's third legal example (no adjacent command-shape pair)", () => {
    expect(undoHowIsExecutable("把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run")).toBe(true);
  });
});

describe("undoHowIsExecutable — English prose should not pass the gate", () => {
  it("just roll it back", () => {
    expect(undoHowIsExecutable("just roll it back")).toBe(false);
  });

  it("empty string", () => {
    expect(undoHowIsExecutable("")).toBe(false);
  });
});
