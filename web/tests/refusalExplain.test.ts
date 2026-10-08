import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { explainRefusal, explainRunReason } from "../src/refusalExplain.js";

/**
 * Spec 2026-10-08 §2.2(b): a refused plan's detail is a list, one item per line; the web turns each item into a line a
 * person can act on (anything it has no words for is shown verbatim), in the reader's language. A run's blocked reason is
 * explained by its prefix up to the first ':' (§2.2(a)).
 */
const rejected = (...items: string[]) => ({ status: 422, code: "control-plan-rejected", message: `control-plan-rejected:${items.join("\n")}`, commandRevision: null });

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("explaining a refused plan (spec §2.2(b))", () => {
  it("turns every item kind into its English line, in order, and anything else verbatim", () => {
    const { text, items } = explainRefusal(rejected(
      "missing-target-version:a", "target-repo-mismatch", "missing-goal", "missing-success-conditions", "duplicate-success-condition",
      "duplicate-dependency:b", "dangling-dependency:c", "contract-json:d", "contract-shape:e", "contract-canonical:f",
      "malformed:tasks.0.labels: labels-invalid:Feature", "loop-plan-invalid:g:path-shape",
    ));
    expect(text).toBe("The plan was not imported. Fix each problem below in the plan file, then import it again.");
    expect(items).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "The plan's targetRepo is not this repository.",
      "The plan has no goal.",
      "The plan has no successConditions (at least one).",
      "Two success conditions are identical.",
      "Task b lists a dependency twice.",
      "Task c depends on a task that is not in the plan.",
      "Task d's contract file is not JSON.",
      "Task e's contract file does not match the contract format.",
      "Task f's contract file cannot be canonicalised.",
      "tasks.0.labels: labels-invalid:Feature",
      "loop-plan-invalid:g:path-shape",
    ]);
  });

  it("keeps a malformed item whose message holds commas whole", () => {
    expect(explainRefusal(rejected("malformed:<root>: Unrecognized key(s) in object: 'foo', 'bar'", "malformed:workBranch: String must contain at least 1 character(s)")).items)
      .toEqual(["<root>: Unrecognized key(s) in object: 'foo', 'bar'", "workBranch: String must contain at least 1 character(s)"]);
  });

  it("carries non-ASCII text and commas in a path or message verbatim (an unreadable-source item has no words, so it is shown as sent)", () => {
    expect(explainRefusal(rejected("missing-target-version:a", "unreadable-source:合约,目录/a.json", "malformed:目标.路径: 必须，不能为空")).items).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "unreadable-source:合约,目录/a.json",
      "目标.路径: 必须，不能为空",
    ]);
  });

  it("says the same in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(explainRefusal(rejected("missing-target-version:a", "dangling-dependency:b", "malformed:goal: Required"))).toEqual({
      text: "计划没有导入。请在计划文件里改掉下面每一个问题，然后重新导入。",
      items: ["任务 a 没有 targetVersion。请填一个正整数，通常是 1。", "任务 b 依赖了一个计划里没有的任务。", "goal：Required"],
    });
  });

  it("lists nothing for any other refusal, and explains it by its entry with the detail", () => {
    expect(explainRefusal({ status: 422, code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1", commandRevision: 3 }))
      .toEqual({ text: enErrors["group-reserve-insufficient"]!.replace("{{detail}}", "tokens:1"), items: [] });
    expect(explainRefusal({ status: 422, code: "control-plan-rejected", message: "control-plan-rejected", commandRevision: null }))
      .toEqual({ text: "The plan was not imported: ", items: [] });
  });
});

describe("explaining a blocked run's reason (spec §2.2(a))", () => {
  it("explains it by its prefix up to the first ':', with the rest as the detail", () => {
    expect(explainRunReason("terminal:failed")).toBe("ccloop finished this run without success (outcome failed).");
    expect(explainRunReason("out-of-bounds:a.ts,b.ts")).toBe("The run changed files outside the paths it may change: a.ts,b.ts");
  });

  it("has nothing to say for free text or an Object.prototype name", () => {
    expect(explainRunReason("Error: socket hang up")).toBeNull();
    expect(explainRunReason("toString")).toBeNull();
  });
});
