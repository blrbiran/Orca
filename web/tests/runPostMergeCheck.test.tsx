// @vitest-environment jsdom
/**
 * Tester follow-up E §4 (#245): the run detail says in one line what the landing's post-merge check did -- passed (how
 * many commands, how long), not needed (why), or failed (the command, its exit and its output tail).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunPostMergeCheck } from "../src/RunPostMergeCheck.js";
import i18n from "../src/i18n.js";
import type { PostMergeCheckV1 } from "../src/controlTypes.js";

const BASE = { attemptSha: "a".repeat(40), mergedSha: "b".repeat(40), oldTip: "c".repeat(40) };
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const shown = (check: PostMergeCheckV1 | undefined): string => {
  const { container } = render(<RunPostMergeCheck check={check} />);
  return container.textContent ?? "";
};

describe("the run detail's post-merge check line (tester follow-up E §4)", () => {
  it("a passed check: its command count and total seconds", () => {
    expect(shown({ ...BASE, result: "passed", commands: [{ command: "npm ci", exit: "0", ms: 30_400 }, { command: "npm test", exit: "0", ms: 10_700 }] }))
      .toBe("Post-merge check passed (2 commands, 41 s)");
    cleanup();
    expect(shown({ ...BASE, result: "passed", commands: [{ command: "npm test", exit: "0", ms: 900 }] })).toBe("Post-merge check passed (1 command, 1 s)");
  });

  it("a check that was not needed: why", () => {
    expect(shown({ ...BASE, result: "not-needed", why: "fast-forward", commands: [] })).toBe("Post-merge check not needed (the tip was the attempt's base)");
  });

  it("a failed check: the command and its exit, then its output tail", () => {
    const { container } = render(<RunPostMergeCheck check={{ ...BASE, result: "failed", commands: [{ command: "npm test", exit: "1", ms: 1_000 }], tail: "FAIL a.test.ts" }} />);
    expect(container.querySelector("[data-tone='danger']")?.textContent).toBe("Post-merge check failed: npm test exited 1");
    expect(container.querySelector("pre")?.textContent).toBe("FAIL a.test.ts");
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(shown({ ...BASE, result: "passed", commands: [{ command: "npm test", exit: "0", ms: 2_000 }] })).toBe("合并后检查通过（1 条命令，2 秒）");
    cleanup();
    expect(shown({ ...BASE, result: "not-needed", why: "tree-equal", commands: [] })).toBe("无需合并后检查（合并后的树与测过的树相同）");
  });

  it("shows nothing for a run with no record", () => {
    expect(shown(undefined)).toBe("");
  });
});
