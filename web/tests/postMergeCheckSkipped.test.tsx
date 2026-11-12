// @vitest-environment jsdom
/** #245: a post-merge check the driver stopped is shown as skipped -- not as passed or failed -- with what happens next. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RunPostMergeCheck } from "../src/RunPostMergeCheck.js";
import i18n from "../src/i18n.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const SKIPPED = { result: "skipped" as const, why: "stopped" as const, attemptSha: "a".repeat(40), mergedSha: "b".repeat(40), oldTip: "c".repeat(40), commands: [] };

describe("a stopped post-merge check reads skipped (#245)", () => {
  it("says it was skipped because Orca stopped, in English and Chinese", async () => {
    const en = render(<RunPostMergeCheck check={SKIPPED} />).container.textContent ?? "";
    expect(en).toContain("Post-merge check skipped: Orca stopped while it ran.");
    expect(en).not.toMatch(/passed|failed/);
    cleanup();
    await i18n.changeLanguage("zh");
    expect(render(<RunPostMergeCheck check={SKIPPED} />).container.textContent).toContain("合并后检查已跳过");
  });
});
