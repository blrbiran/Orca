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

describe("undoHowIsExecutable — isArgShaped sub-branches each have a mutation-killing input", () => {
  // CLAUDE.md Rule 9: a criterion never seen red is not a criterion. Each of
  // isArgShaped's includes("="), includes("*"), and FILE_NAME.test(token)
  // clauses can be deleted with the suite staying green unless something
  // reaches it exclusively. Each input below reaches exactly one of the
  // three clauses (verified by hand against both isArgShaped and
  // hasNamedTarget: none of them contains camelCase, snake_case, or a "/",
  // so hasNamedTarget cannot catch any of them either) — see the mutation
  // proof in the final fix report for the actual red run of each.

  // Reaches isArgShaped via token.includes("=") only: "target=foo" has no
  // "-" prefix, no "/", no "*", isn't <...>, and FILE_NAME needs a dot after
  // the whole token (it has none). Deleting the "=" clause makes this false.
  it("command-shape via a '=' argument: make target=foo", () => {
    expect(undoHowIsExecutable("make target=foo")).toBe(true);
  });

  // Reaches isArgShaped via token.includes("*") only: "*.tmp" starts with
  // "*" not "-", has no "/", isn't <...>, and FILE_NAME's first character
  // class excludes "*" so it never matches. Deleting the "*" clause makes
  // this false.
  it("command-shape via a '*' argument: rm *.tmp", () => {
    expect(undoHowIsExecutable("rm *.tmp")).toBe(true);
  });

  // Reaches isArgShaped via FILE_NAME.test(token) only: "build.mjs" has no
  // "-" prefix, no "/", no "=", no "*", and isn't <...>. Deleting the
  // FILE_NAME clause makes this false.
  it("command-shape via a FILE_NAME argument: node build.mjs", () => {
    expect(undoHowIsExecutable("node build.mjs")).toBe(true);
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
