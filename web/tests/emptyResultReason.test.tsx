import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { explainRunReason } from "../src/refusalExplain.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

/**
 * Tester follow-up F §4: a task blocked because its attempt changed nothing showed the bare `empty-result` (the overview)
 * or nothing at all (the run is settled and succeeded, so the runs table gave no reason). Both now say what happened and
 * what the operator can do: nothing in this group; a new group, with the goal decided by command checks if no change was
 * needed.
 */
describe("empty-result is explained (tester follow-up F §4)", () => {
  const empty = () => run({ runId: "run-e", state: "settled-recoverable", outcome: "succeeded", blockedReason: "empty-result" });

  it("the run's reason names it and the way on, in both languages", async () => {
    const en = text(renderToStaticMarkup(<RunReason run={empty()} />));
    // mutation: drop the empty-result branch in RunReason -> no words, red
    expect(en).toContain("The attempt finished without changing any file, so there was nothing to land and the task stays blocked. It cannot be retried or accepted in this group.");
    expect(en).toContain("commandChecksDecideGoal");
    expect(en).toContain("empty-result");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={empty()} />))).toContain("这次尝试跑完了，但没有改动任何文件");
  });

  it("the overview's reason (explainRunReason) has the same words; a landed settled run shows none", () => {
    expect(explainRunReason("empty-result")).toMatch(/^The attempt finished without changing any file/);
    expect(text(renderToStaticMarkup(<RunReason run={run({ runId: "run-l", state: "settled-recoverable", outcome: "succeeded", blockedReason: null })} />))).not.toContain("without changing any file");
  });
});
