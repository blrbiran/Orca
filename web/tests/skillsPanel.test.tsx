// @vitest-environment jsdom
/**
 * Syncskill integration spec §4.6 / §10.8 C19 (plan Task 7): the loop plan card says which skill set a task declared and,
 * once the group is confirmed, the names it froze to; the group view lists, per run, each skill the run was given with
 * the commit it resolved to ("local" when syncskill had none) and the content md5. English and Chinese.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { GroupViewV1, LoopPlanViewV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";
import { PLAN, config, run, view, workItem } from "./fixtures/board.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const card = (loopPlan: LoopPlanViewV1) => {
  const item: WorkItemViewV1 = { ...workItem({}), labels: [], labelsProvenance: "plan", labelsVersion: 0, progress: null, loopPlan, objective: { goal: "g", successCondition: "s" } };
  return render(<TaskDetail view={view([item])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
};
const lock = [
  { name: "alpha", source: { name: "src", type: "git", url: "https://example.invalid/s.git", branch: "main" }, resolved_commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", content_md5: "md5-alpha" },
  { name: "beta", source: null, resolved_commit: null, content_md5: "md5-beta" },
];
const show = (runs: RunViewV1[]) => render(<ControlGroupView view={view([workItem({})], runs) as GroupViewV1} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

describe("the loop plan card's skill set line (C19)", () => {
  it("says none when the task has no skills, not that they are unsupported", () => {
    const text = card(PLAN);
    expect(text).toContain("Skill set: none");
    expect(text).not.toContain("not supported yet");
  });
  it("shows a declared profile before confirm", () => {
    expect(card({ ...PLAN, skills: { profile: "web" } })).toContain("Skill set: profile web");
  });
  it("shows the frozen names next to the profile after confirm", () => {
    expect(card({ ...PLAN, skills: { profile: "web" }, frozenSkillNames: ["alpha", "beta"] })).toContain("Skill set: profile web, frozen to alpha, beta");
  });
  it("shows explicit names", () => {
    expect(card({ ...PLAN, skills: { names: ["alpha", "beta"] }, frozenSkillNames: ["alpha", "beta"] })).toContain("Skill set: alpha, beta");
  });
  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(card(PLAN)).toContain("skill 集：无");
    cleanup();
    expect(card({ ...PLAN, skills: { profile: "web" } })).toContain("skill 集：profile web");
    cleanup();
    expect(card({ ...PLAN, skills: { profile: "web" }, frozenSkillNames: ["alpha"] })).toContain("skill 集：profile web，已冻结为 alpha");
    cleanup();
    expect(card({ ...PLAN, skills: { names: ["alpha", "beta"] } })).toContain("skill 集：alpha, beta");
  });
});

describe("the run's lock (C19)", () => {
  const rowsOf = () => within(screen.getByRole("table", { name: "Skills each run was given" })).getAllByRole("row").slice(1)
    .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
  it("lists each lock entry's name, resolved commit (or local) and content md5, and leaves out runs without skills", () => {
    show([run({ runId: "run-a", skills: { profile: "web", lock } }), run({ runId: "run-b", taskId: "b" })]);
    expect(rowsOf()).toEqual([
      ["a", "run-a", "alpha", "a1b2c3d4e5f6", "md5-alpha"],
      ["a", "run-a", "beta", "local", "md5-beta"],
    ]);
  });
  it("shows no skills section when no run has skills", () => {
    show([run({})]);
    expect(screen.queryByRole("table", { name: "Skills each run was given" })).toBeNull();
  });
  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    show([run({ skills: { profile: null, lock } })]);
    const table = screen.getByRole("table", { name: "各 run 拿到的 skill" });
    expect([...within(table).getAllByRole("row")[2]!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["a", "run-a", "beta", "本地", "md5-beta"]);
  });
});
