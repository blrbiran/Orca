/**
 * Flow engine spec §6.4 (`fp1`) and §7 (C2, plan Task 7): code bounds what may re-run, the model may only propose
 * removals, the person decides, code executes in template order. Table-driven over a five-step run
 * `draft -> voice -> cover -> article -> publish`. Everything here is pure: the kernel hands in what it measured.
 * A step about to re-run counts as changed for every later step (unknown => include), so a later step names each
 * earlier candidate it depends on: after a re-run, the cutoff can then drop exactly the reasons that went away.
 */
import { describe, expect, it } from "vitest";
import {
  candidates, chosenPlan, reusable, type Execution, type Journal, type FlowMessage, type WorkspaceState,
} from "../../src/flow/journal/candidates.js";
import { afterExecution } from "../../src/flow/journal/cutoff.js";
import { definitionHash, fingerprint, outputHashOfCommit, outputHashOfRecord, ranOn } from "../../src/flow/journal/fingerprint.js";
import { validateProposal } from "../../src/flow/journal/proposal.js";

const STEPS = ["draft", "voice", "cover", "article", "publish"];
const template = { steps: STEPS.map((id) => ({ id })) };
const out = (key: string, n = 1): string => `out-${key}-${n}`;

/** A journal where every step ran once and is done; each execution recorded the outputs it ran on. */
function settled(over: Partial<Record<string, Partial<Execution>>> = {}): Journal {
  const executions: Execution[] = STEPS.map((stepKey, i) => ({
    stepKey, seq: 1, state: "done", definitionHash: `def-${stepKey}`, fingerprint: `fp-${stepKey}`,
    ranOnInputs: { start: "import-1", params: "params-1", earlier: STEPS.slice(0, i).map((k) => ({ stepKey: k, outputHash: out(k), projection: null })) },
    outputHash: out(stepKey), projection: null, readSet: null, ...over[stepKey],
  }));
  return { executions, heads: Object.fromEntries(STEPS.map((k) => [k, 1])) };
}
const ws = (over: Partial<WorkspaceState> = {}): WorkspaceState => ({
  definitionHashes: Object.fromEntries(STEPS.map((k) => [k, `def-${k}`])), start: "import-1", params: "params-1",
  whenFalse: new Set(), composeConflicts: new Set(), ...over,
});
/** Append a later execution of `stepKey` and make it the active one. */
function moved(journal: Journal, stepKey: string, exec: Partial<Execution>): Journal {
  const prior = journal.executions.filter((e) => e.stepKey === stepKey);
  const seq = Math.max(0, ...prior.map((e) => e.seq)) + 1;
  const base = prior.find((e) => e.seq === journal.heads[stepKey]) ?? journal.executions.find((e) => e.stepKey === stepKey)!;
  return { executions: [...journal.executions, { ...base, seq, ...exec }], heads: { ...journal.heads, [stepKey]: seq } };
}
const feedback = (stepKey: string): FlowMessage => ({ kind: "feedback", target: { kind: "step", stepKey } });
const edit = (stepKey: string): FlowMessage => ({ kind: "edit", target: { kind: "step", stepKey } });
const show = (list: ReturnType<typeof candidates>): string[] => list.map((c) => `${c.stepKey}: ${c.reasons.join(" ")}`);

describe("candidates (§7.2, C2)", () => {
  it.each<[string, () => { journal: Journal; messages?: FlowMessage[]; state?: Partial<WorkspaceState> }, string[]]>([
    ["a fresh run: every step never succeeded", () => ({ journal: { executions: [], heads: {} } }),
      STEPS.map((k) => `${k}: never-succeeded`)],
    ["a settled run with nothing changed: none", () => ({ journal: settled() }), []],
    ["the definition of voice changed: voice, and every later step through it", () => ({ journal: settled(), state: { definitionHashes: { ...ws().definitionHashes, voice: "def-voice-2" } } }),
      ["voice: definition-changed", "cover: upstream-changed:voice", "article: upstream-changed:voice upstream-changed:cover", "publish: upstream-changed:voice upstream-changed:cover upstream-changed:article"]],
    ["feedback on voice: voice, and every later step through it (unknown reads count)", () => ({ journal: settled(), messages: [feedback("voice")] }),
      ["voice: feedback", "cover: upstream-changed:voice", "article: upstream-changed:voice upstream-changed:cover", "publish: upstream-changed:voice upstream-changed:cover upstream-changed:article"]],
    ["feedback on an execution targets its step", () => ({ journal: settled(), messages: [{ kind: "feedback", target: { kind: "execution", stepKey: "article", seq: 1 } }] }),
      ["article: feedback", "publish: upstream-changed:article"]],
    ["an edit to cover moved its output: cover is not a candidate, later steps are", () => ({ journal: moved(settled(), "cover", { outputHash: out("cover", 2) }), messages: [edit("cover")] }),
      ["article: upstream-changed:cover", "publish: upstream-changed:cover upstream-changed:article"]],
    ["an edit is never a candidate even with another reason", () => ({ journal: moved(settled(), "voice", { outputHash: out("voice", 2) }), messages: [edit("voice"), feedback("voice")] }),
      ["cover: upstream-changed:voice", "article: upstream-changed:voice upstream-changed:cover", "publish: upstream-changed:voice upstream-changed:cover upstream-changed:article"]],
    ["drift placed at the start: every step, reason start", () => ({ journal: settled(), state: { start: "import-2" } }),
      STEPS.map((k, i) => [`${k}: upstream-changed:start`, ...STEPS.slice(0, i).map((e) => `upstream-changed:${e}`)].join(" "))],
    ["a params change: every step, reason params", () => ({ journal: settled(), state: { params: "params-2" } }),
      STEPS.map((k, i) => [`${k}: upstream-changed:params`, ...STEPS.slice(0, i).map((e) => `upstream-changed:${e}`)].join(" "))],
    ["a when-false step is skipped, never a candidate, and passes nothing on", () => ({ journal: { executions: [], heads: {} }, state: { whenFalse: new Set(["cover"]) } }),
      ["draft: never-succeeded", "voice: never-succeeded", "article: never-succeeded", "publish: never-succeeded"]],
    ["a compose conflict on article: article, then publish", () => ({ journal: settled(), state: { composeConflicts: new Set(["article"]) } }),
      ["article: compose-conflict", "publish: upstream-changed:article"]],
    ["a failed active execution is not reused: never-succeeded", () => ({ journal: moved(settled(), "publish", { state: "failed", outputHash: null }) }),
      ["publish: never-succeeded"]],
    ["a rate-limited active execution is not reused either", () => ({ journal: moved(settled(), "publish", { state: "failed", failure: "rate-limited", outputHash: null }) }),
      ["publish: never-succeeded"]],
    ["several reasons on one step, in the fixed order", () => ({ journal: settled(), messages: [feedback("article")], state: { definitionHashes: { ...ws().definitionHashes, article: "x", voice: "y" }, composeConflicts: new Set(["article"]) } }),
      ["voice: definition-changed", "cover: upstream-changed:voice", "article: definition-changed upstream-changed:voice upstream-changed:cover feedback compose-conflict", "publish: upstream-changed:voice upstream-changed:cover upstream-changed:article"]],
  ])("C2 row: %s", (_name, make, expected) => {
    const { journal, messages = [], state = {} } = make();
    expect(show(candidates(journal, template, messages, ws(state)))).toEqual(expected);
  });

  describe("read sets (none are recorded in phase 1)", () => {
    const changedCover = (readSet: Execution["readSet"]) => moved(settled({ article: { readSet } }), "cover", { outputHash: out("cover", 2) });
    const state = { changedPaths: { cover: ["cover.png"] } };
    it("R1: no read set counts as reading everything: the change to cover makes article a candidate", () => {
      expect(show(candidates(changedCover(null), template, [], ws(state)))[0]).toBe("article: upstream-changed:cover");
    });
    it("R2: a complete read set disjoint from the changed paths removes that upstream reason", () => {
      expect(show(candidates(changedCover({ complete: true, paths: ["article.md"] }), template, [], ws(state)))).toEqual(["publish: upstream-changed:cover"]);
    });
    it("R3: an incomplete read set, or one that meets the changed paths, removes nothing", () => {
      expect(show(candidates(changedCover({ complete: false, paths: ["article.md"] }), template, [], ws(state)))[0]).toBe("article: upstream-changed:cover");
      expect(show(candidates(changedCover({ complete: true, paths: ["cover.png"] }), template, [], ws(state)))[0]).toBe("article: upstream-changed:cover");
    });
    it("R4: a step that is itself about to re-run has no known changed paths; a read set cannot remove it", () => {
      const journal = settled({ article: { readSet: { complete: true, paths: ["article.md"] } } });
      expect(show(candidates(journal, template, [feedback("cover")], ws(state)))).toContain("article: upstream-changed:cover");
    });
  });

  describe("cutoff inputs", () => {
    it("U1: an upstream output whose equals projection is unchanged is no change", () => {
      const journal = moved(settled({ voice: { projection: "proj-v" }, cover: { ranOnInputs: { start: "import-1", params: "params-1", earlier: [{ stepKey: "draft", outputHash: out("draft"), projection: null }, { stepKey: "voice", outputHash: out("voice"), projection: "proj-v" }] } } }), "voice", { outputHash: out("voice", 2), projection: "proj-v" });
      expect(show(candidates(journal, template, [], ws()))).toEqual(["article: upstream-changed:voice", "publish: upstream-changed:voice upstream-changed:article"]);
    });
    it("U2: an output the person accepted as unchanged is no change", () => {
      const journal = moved(settled(), "voice", { outputHash: out("voice", 2) });
      expect(show(candidates(journal, template, [], ws({ acceptedUnchanged: new Set(["voice"]) })))).toEqual([]);
    });
  });
});

describe("proposal validation (§7.3): the model may only remove", () => {
  const list = candidates(settled(), template, [feedback("voice")], ws());
  const targets = new Set(["voice"]);
  it("P1: skips of candidates are accepted as given", () => {
    expect(validateProposal({ skips: [{ stepKey: "cover", reason: "the cover does not show the text" }] }, list, targets))
      .toEqual({ ok: true, skips: [{ stepKey: "cover", reason: "the cover does not show the text" }], unsure: [] });
  });
  it("P2: a key outside the candidates is invalid", () => {
    expect(validateProposal({ skips: [{ stepKey: "draft", reason: "x" }] }, list, targets)).toMatchObject({ ok: false });
  });
  it("P3: a feedback-targeted step may not be skipped, directly or through startAt", () => {
    expect(validateProposal({ skips: [{ stepKey: "voice", reason: "x" }] }, list, targets)).toMatchObject({ ok: false });
    expect(validateProposal({ skips: [], startAt: "article" }, list, targets)).toMatchObject({ ok: false });
  });
  it("P4: startAt becomes skips of every earlier candidate", () => {
    const noTargets = new Set<string>();
    expect(validateProposal({ skips: [], startAt: "article" }, list, noTargets))
      .toEqual({ ok: true, skips: [{ stepKey: "voice", reason: "before startAt article" }, { stepKey: "cover", reason: "before startAt article" }], unsure: [] });
  });
  it.each([
    ["not an object", "skip cover"],
    ["an extra key", { skips: [], add: ["draft"] }],
    ["an extra key in a skip", { skips: [{ stepKey: "cover", reason: "x", order: 1 }] }],
    ["a reorder field", { skips: [], order: ["publish", "voice"] }],
    ["startAt not a candidate", { skips: [], startAt: "draft" }],
    ["the same key twice", { skips: [{ stepKey: "cover", reason: "x" }, { stepKey: "cover", reason: "y" }] }],
    ["an empty reason", { skips: [{ stepKey: "cover", reason: "" }] }],
  ])("P5: %s is invalid", (_name, raw) => {
    expect(validateProposal(raw, list, targets)).toMatchObject({ ok: false });
  });
});

describe("unsure marks (gaps §5.1, §6.4): code validates, absence is never uncertainty", () => {
  // voice has feedback; cover/article/publish follow by upstream; `cover` also never succeeded in the second list.
  const list = candidates(settled(), template, [feedback("voice")], ws());
  const targets = new Set(["voice"]);
  const withNever = candidates(settled({ cover: { state: "failed" } }), template, [], ws());
  const filled = candidates(settled(), template, [], ws({ filled: new Set(["voice"]) }));
  const ask = "keep the cover?";

  it("U1: a valid unsure passes through, in template order, with the skips", () => {
    expect(validateProposal({ skips: [{ stepKey: "cover", reason: "x" }], unsure: [{ stepKey: "publish", question: "q2" }, { stepKey: "article", question: ask }] }, list, targets))
      .toEqual({ ok: true, skips: [{ stepKey: "cover", reason: "x" }], unsure: [{ stepKey: "article", question: ask }, { stepKey: "publish", question: "q2" }] });
  });
  it("U2: no unsure field means an empty list", () => {
    expect(validateProposal({ skips: [] }, list, targets)).toEqual({ ok: true, skips: [], unsure: [] });
  });
  it.each([
    ["a feedback step", list, targets, { skips: [], unsure: [{ stepKey: "voice", question: ask }] }],
    ["a fill step", filled, new Set<string>(), { skips: [], unsure: [{ stepKey: "voice", question: ask }] }],
    ["a never-succeeded step", withNever, new Set<string>(), { skips: [], unsure: [{ stepKey: "cover", question: ask }] }],
    ["a non-candidate key", list, targets, { skips: [], unsure: [{ stepKey: "draft", question: ask }] }],
    ["a key that is also skipped", list, targets, { skips: [{ stepKey: "cover", reason: "x" }], unsure: [{ stepKey: "cover", question: ask }] }],
    ["a key skipped through startAt", list, targets, { skips: [], startAt: "article", unsure: [{ stepKey: "cover", question: ask }] }],
    ["the same key twice", list, targets, { skips: [], unsure: [{ stepKey: "cover", question: ask }, { stepKey: "cover", question: ask }] }],
    ["an empty question", list, targets, { skips: [], unsure: [{ stepKey: "cover", question: "" }] }],
    ["a 201-char question", list, targets, { skips: [], unsure: [{ stepKey: "cover", question: "q".repeat(201) }] }],
    ["an extra key", list, targets, { skips: [], unsure: [{ stepKey: "cover", question: ask, why: "x" }] }],
  ])("U3: unsure on %s is invalid", (_name, candidatesList, feedbackTargets, raw) => {
    expect(validateProposal(raw, candidatesList, feedbackTargets)).toMatchObject({ ok: false });
  });
  it("U4: a 200-char question is valid", () => {
    expect(validateProposal({ skips: [], unsure: [{ stepKey: "cover", question: "q".repeat(200) }] }, list, targets)).toMatchObject({ ok: true });
  });
  it("F1: fill sorts after feedback and before never-succeeded; the model may not skip it", () => {
    const both = candidates(settled({ voice: { state: "failed" } }), template, [feedback("voice")], ws({ filled: new Set(["voice"]) }));
    expect(both.find((c) => c.stepKey === "voice")!.reasons).toEqual(["feedback", "fill", "never-succeeded"]);
    expect(validateProposal({ skips: [{ stepKey: "voice", reason: "x" }] }, filled, new Set())).toMatchObject({ ok: false });
    expect(validateProposal({ skips: [], startAt: "cover" }, filled, new Set())).toMatchObject({ ok: false });
  });
  it("F2: a filled step's later steps are candidates by the ordinary upstream rule", () => {
    expect(show(filled)).toEqual(["voice: fill", "cover: upstream-changed:voice", "article: upstream-changed:voice upstream-changed:cover", "publish: upstream-changed:voice upstream-changed:cover upstream-changed:article"]);
  });
});

describe("the chosen plan (§7.4, §7.5)", () => {
  it("X1: runs in template order whatever order the skips, adds or proposal came in", () => {
    const list = candidates(settled(), template, [feedback("voice")], ws());
    expect(chosenPlan(list, { skips: ["article", "cover"], add: ["draft"] }, STEPS)).toEqual(["draft", "voice", "publish"]);
  });
  it("X2: a step that is not in the template cannot be added", () => {
    expect(() => chosenPlan([], { skips: [], add: ["nope"] }, STEPS)).toThrow(/flow-step-not-found/);
  });
});

describe("after an execution (§7.5): steps only leave", () => {
  const plan = { chosen: ["voice", "cover", "article", "publish"], executed: ["voice"] };
  it("A1: when voice's re-run left its output unchanged, the steps that were candidates only through voice leave", () => {
    expect(afterExecution(plan, [])).toEqual({ chosen: ["voice"], executed: ["voice"] });
  });
  it("A2: a step with another live reason stays", () => {
    expect(afterExecution(plan, [{ stepKey: "article", reasons: ["feedback"] }])).toEqual({ chosen: ["voice", "article"], executed: ["voice"] });
  });
  it("A3: a new candidate the person did not choose is never added", () => {
    expect(afterExecution({ chosen: ["voice", "article"], executed: ["voice"] }, [{ stepKey: "cover", reasons: ["upstream-changed:voice"] }, { stepKey: "article", reasons: ["upstream-changed:voice"] }]))
      .toEqual({ chosen: ["voice", "article"], executed: ["voice"] });
  });
});

describe("reuse (§7.5, R §4): failed or rate-limited executions are never reused", () => {
  it("F1: the latest done execution with the same fingerprint is reused; a failed one with that fingerprint is not", () => {
    let journal = settled();
    journal = moved(journal, "cover", { state: "failed", fingerprint: "fp-x", outputHash: null });
    journal = moved(journal, "cover", { state: "failed", failure: "rate-limited", fingerprint: "fp-y", outputHash: null });
    expect(reusable(journal, "cover", "fp-x")).toBeNull();
    expect(reusable(journal, "cover", "fp-y")).toBeNull();
    expect(reusable(journal, "cover", "fp-cover")).toMatchObject({ stepKey: "cover", seq: 1, state: "done" });
  });
});

describe("fp1 fingerprints (§6.4)", () => {
  const def = {
    step: { id: "voice", kind: "work", prompt: "prompts/voice.md" }, promptBytes: "Make it sound like me.\n",
    skillLocks: [{ sourceId: "runskills", resolvedCommit: "a".repeat(40), contentMd5: "m".repeat(32) }],
    checks: ["python3 fidelity.py a b"], tools: { commands: [{ exact: "wc -m x" }] }, kindVersion: 1,
  };
  it("H1: agent and model are recorded, never hashed", () => {
    expect(definitionHash({ ...def, agent: "claude", model: "opus" })).toBe(definitionHash({ ...def, agent: "codex", model: "gpt" }));
    expect(definitionHash({ ...def, agent: "claude", model: "opus" })).toBe(definitionHash(def));
  });
  it.each([
    ["the prompt bytes", { promptBytes: "Make it sound like you.\n" }],
    ["a skill's content", { skillLocks: [{ ...def.skillLocks[0]!, contentMd5: "n".repeat(32) }] }],
    ["a check command", { checks: ["python3 fidelity.py b a"] }],
    ["the tools", { tools: null }],
    ["the kind version", { kindVersion: 2 }],
    ["the step definition", { step: { ...def.step, prompt: "prompts/v2.md" } }],
  ])("H2: %s changes the definition hash", (_name, change) => {
    expect(definitionHash({ ...def, ...change })).not.toBe(definitionHash(def));
  });
  it("H3: ranOn is stable however parallel siblings finished, and moves with the base, an output or the params", () => {
    const a = ranOn("tree-1", [{ stepKey: "cover", templatePos: 2, outputHash: "c" }, { stepKey: "voice", templatePos: 1, outputHash: "v" }], "p");
    expect(ranOn("tree-1", [{ stepKey: "voice", templatePos: 1, outputHash: "v" }, { stepKey: "cover", templatePos: 2, outputHash: "c" }], "p")).toBe(a);
    expect(ranOn("tree-2", [{ stepKey: "voice", templatePos: 1, outputHash: "v" }, { stepKey: "cover", templatePos: 2, outputHash: "c" }], "p")).not.toBe(a);
    expect(ranOn("tree-1", [{ stepKey: "voice", templatePos: 1, outputHash: "v2" }, { stepKey: "cover", templatePos: 2, outputHash: "c" }], "p")).not.toBe(a);
    expect(ranOn("tree-1", [{ stepKey: "voice", templatePos: 1, outputHash: "v" }, { stepKey: "cover", templatePos: 2, outputHash: "c" }], "q")).not.toBe(a);
  });
  it("H4: the fingerprint is sha256 of both halves; each half moves it", () => {
    expect(fingerprint("d", "r")).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint("d", "r")).not.toBe(fingerprint("d2", "r"));
    expect(fingerprint("d", "r")).not.toBe(fingerprint("d", "r2"));
  });
  it("H5: an output hash is over sorted (path, blob) pairs; a record's is its artifact hash", () => {
    expect(outputHashOfCommit([{ path: "b", blob: "2" }, { path: "a", blob: "1" }])).toBe(outputHashOfCommit([{ path: "a", blob: "1" }, { path: "b", blob: "2" }]));
    expect(outputHashOfCommit([{ path: "a", blob: "1" }])).not.toBe(outputHashOfCommit([{ path: "a", blob: "3" }]));
    expect(outputHashOfRecord("f".repeat(64))).toBe("f".repeat(64));
  });
});
