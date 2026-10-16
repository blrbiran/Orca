import { describe, expect, it } from "vitest";
import { classifyEstimateOutput } from "../../src/control/estimator.js";
import { PLACEHOLDER_RATIONALES, capProblems, problemsFromRefusal, repairEstimateOutput } from "../../src/control/estimateRepair.js";

const PLAN_HASH = "a".repeat(64);
const AMOUNT = { tokens: 1000, activeMs: 2000, attempts: 1, sessions: 1 };
const entry = (taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId, complexity: "S", confidence: "high", work: AMOUNT, handoff: AMOUNT, rationale: `real ${taskId}`, assumptions: ["it is small"], ...extra,
});
const answer = (taskIds: string[]) => ({
  schema: "budget-estimate-v1", planHash: PLAN_HASH, tasks: taskIds.map(id => entry(id)), goalReviewReserve: AMOUNT, groupRationale: "small",
});
const ctx = (taskIds: string[], instructionVersion = "1") => ({ planHash: PLAN_HASH, taskIds, instructionVersion });
const judged = (r: ReturnType<typeof repairEstimateOutput>, taskIds: string[]) =>
  r.ok && classifyEstimateOutput(r.output, PLAN_HASH, taskIds).ok;

describe("repairEstimateOutput: one code per defect", () => {
  it("answer-v2-converted: a keyed v2 answer becomes the v1 array in plan order", () => {
    const { taskId: _a, ...a } = entry("a"), { taskId: _b, ...b } = entry("b");
    const raw = { schema: "budget-estimate-answer-v2", tasks: { b, a }, goalReviewReserve: AMOUNT, groupRationale: "small" };
    const r = repairEstimateOutput(raw, ctx(["a", "b"], "2"));
    expect(r).toEqual({ ok: true, output: answer(["a", "b"]), repairs: ["answer-v2-converted"] });
    expect(judged(r, ["a", "b"])).toBe(true);
  });
  it("schema-name-set", () => {
    const r = repairEstimateOutput({ ...answer(["a"]), schema: "oops" }, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: answer(["a"]), repairs: ["schema-name-set"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("plan-hash-copied", () => {
    const { planHash: _p, ...rest } = answer(["a"]);
    const r = repairEstimateOutput(rest, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: answer(["a"]), repairs: ["plan-hash-copied"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("assumptions-normalized: trims, drops empties and exact duplicates", () => {
    const raw = { ...answer(["a"]), tasks: [entry("a", { assumptions: [" x ", "x", ""] })] };
    const r = repairEstimateOutput(raw, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: { ...answer(["a"]), tasks: [entry("a", { assumptions: ["x"] })] }, repairs: ["assumptions-normalized:a"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("unknown-task-dropped", () => {
    const raw = { ...answer(["a"]), tasks: [entry("a"), entry("zz")] };
    const r = repairEstimateOutput(raw, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: answer(["a"]), repairs: ["unknown-task-dropped:zz"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("duplicate-task-dropped: the evidence shape (real first, placeholder second)", () => {
    const raw = { ...answer(["a"]), tasks: [entry("a"), entry("a", { rationale: "placeholder" })] };
    const r = repairEstimateOutput(raw, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: answer(["a"]), repairs: ["duplicate-task-dropped:a"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("duplicate-task-dropped: placeholder first keeps the real one", () => {
    const raw = { ...answer(["a"]), tasks: [entry("a", { rationale: " TODO " }), entry("a")] };
    const r = repairEstimateOutput(raw, ctx(["a"]));
    expect(r).toEqual({ ok: true, output: answer(["a"]), repairs: ["duplicate-task-dropped:a"] });
    expect(judged(r, ["a"])).toBe(true);
  });
  it("tasks-reordered", () => {
    const raw = { ...answer(["a", "b"]), tasks: [entry("b"), entry("a")] };
    const r = repairEstimateOutput(raw, ctx(["a", "b"]));
    expect(r).toEqual({ ok: true, output: answer(["a", "b"]), repairs: ["tasks-reordered"] });
    expect(judged(r, ["a", "b"])).toBe(true);
  });
  it("an already-valid v1 answer needs no repair", () => {
    const raw = answer(["a", "b"]);
    const r = repairEstimateOutput(raw, ctx(["a", "b"]));
    expect(r).toEqual({ ok: true, output: raw, repairs: [] });
  });
});

describe("repairEstimateOutput: unrepairable answers collect every problem", () => {
  it("a missing task and a placeholder together, sorted", () => {
    const raw = { ...answer(["a"]), tasks: [entry("a", { rationale: "placeholder" })] };
    expect(repairEstimateOutput(raw, ctx(["a", "b"]))).toEqual({ ok: false, problems: ["placeholder-entry:a", "task-missing:b"] });
  });
  it.each([[null], [[]], ["text"]])("%j is not an object", raw => {
    expect(repairEstimateOutput(raw, ctx(["a"]))).toEqual({ ok: false, problems: ["not-an-object"] });
  });
  it("a task missing a field", () => {
    const { work: _w, ...bad } = entry("a");
    const r = repairEstimateOutput({ ...answer(["a"]), tasks: [bad] }, ctx(["a"]));
    expect(r.ok === false && r.problems).toContain("task-invalid:a:work");
  });
  it("all assumptions empty leaves the entry unusable", () => {
    const r = repairEstimateOutput({ ...answer(["a"]), tasks: [entry("a", { assumptions: [" ", ""] })] }, ctx(["a"]));
    expect(r.ok === false && r.problems).toContain("task-invalid:a:assumptions");
  });
  it("a bad top-level field and an extra key are field-invalid", () => {
    const r = repairEstimateOutput({ ...answer(["a"]), groupRationale: "", extra: 1 }, ctx(["a"]));
    expect(r).toEqual({ ok: false, problems: ["field-invalid:extra", "field-invalid:groupRationale"] });
  });
});

describe("repairEstimateOutput: v2 keyed-answer traps", () => {
  it("prototype-name and all-digit ids: only own keys count, plan order wins", () => {
    const { taskId: _t, ...ten } = entry("10");
    const raw = { schema: "budget-estimate-answer-v2", tasks: { "10": ten }, goalReviewReserve: AMOUNT, groupRationale: "small" };
    expect(repairEstimateOutput(raw, ctx(["10", "constructor"], "2"))).toEqual({ ok: false, problems: ["task-missing:constructor"] });
  });
  it("conversion follows the plan's ids, not Object.keys order", () => {
    const mk = (id: string) => { const { taskId: _t, ...rest } = entry(id); return rest; };
    // JSON.parse puts all-digit keys first: "10" precedes "2" and "a" regardless of written order.
    const tasks = JSON.parse(`{"a":${JSON.stringify(mk("a"))},"2":${JSON.stringify(mk("2"))},"10":${JSON.stringify(mk("10"))}}`);
    const plan = ["10", "2", "a"];
    const r = repairEstimateOutput({ schema: "budget-estimate-answer-v2", tasks, goalReviewReserve: AMOUNT, groupRationale: "small" }, ctx(plan, "2"));
    expect(r.ok && (r.output as { tasks: { taskId: string }[] }).tasks.map(t => t.taskId)).toEqual(plan);
    expect(r.ok && r.repairs).toEqual(["answer-v2-converted"]);
  });
  it("a keyed answer under contract 1 is not converted", () => {
    const { taskId: _t, ...a } = entry("a");
    const r = repairEstimateOutput({ schema: "budget-estimate-answer-v2", tasks: { a }, goalReviewReserve: AMOUNT, groupRationale: "small" }, ctx(["a"], "1"));
    expect(r.ok === false && r.problems.some(p => p.startsWith("field-invalid:tasks"))).toBe(true);
  });
});

describe("problem caps and pins", () => {
  it("30 broken tasks with 300-char ids: at most 20 problems of at most 200 chars", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, "0")}${"z".repeat(298)}`);
    const r = repairEstimateOutput({ ...answer([]), tasks: [] }, ctx(ids));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toHaveLength(20);
      expect(r.problems.every(p => p.length <= 200)).toBe(true);
    }
  });
  it("capProblems and problemsFromRefusal", () => {
    expect(capProblems(Array.from({ length: 25 }, () => "y".repeat(300)))).toHaveLength(20);
    expect(problemsFromRefusal([{ path: ["tasks", 0, "work"], message: "bad" }], true)).toEqual(["field-invalid:tasks.0.work:bad", "output-not-canonical"]);
    expect(problemsFromRefusal([], true)).toEqual(["output-not-canonical"]);
  });
  it("PLACEHOLDER_RATIONALES is the exact list", () => {
    expect(PLACEHOLDER_RATIONALES).toEqual(["placeholder", "todo", "tbd", "x", "n/a", "...", "-"]);
  });
});
