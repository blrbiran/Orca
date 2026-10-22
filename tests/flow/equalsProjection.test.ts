/**
 * Gaps spec §7 / §17 G6, pure part: `projectionOf` is what lets an unchanged-in-shape output stop the re-run cascade.
 * The reads are in-memory; a projection that cannot be computed is `null` (no cutoff), never an error.
 */
import { describe, expect, it } from "vitest";
import { projectionOf } from "../../src/flow/journal/projection.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { listPlans } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const reader = (files: Record<string, string>) => (path: string): Buffer | null => (path in files ? Buffer.from(files[path]!) : null);

describe("projectionOf headings(<path>)", () => {
  const spec = "headings(a.outline.md)";
  const p = (text: string) => projectionOf(spec, reader({ "a.outline.md": text }), null);
  it("same headings with a different body are equal", () => {
    expect(p("# T\n\n正文一\n\n## S\n\n内容 A")).toBe(p("# T\n\n完全不同的正文\n\n## S\n\n内容 B"));
    expect(p("# T\n\n正文")).not.toBeNull();
  });
  it("a changed heading, level or order is different", () => {
    const base = p("# T\n\n## S");
    expect(p("# T\n\n## S2")).not.toBe(base);
    expect(p("# T\n\n### S")).not.toBe(base);
    expect(p("## S\n\n# T")).not.toBe(base);
  });
  it("headings inside a code fence or front matter do not count", () => {
    expect(p("---\n# x\n---\n# T\n\n```\n# not a heading\n```")).toBe(p("# T"));
  });
  it("is insensitive to markdown noise and spacing in the heading text (norm)", () => {
    expect(p("# **A** b")).toBe(p("#  a  B"));
  });
  it("a missing file or a file without headings is null (no cutoff)", () => {
    expect(projectionOf(spec, reader({}), null)).toBeNull();
    expect(p("just text")).toBeNull();
  });
});

describe("projectionOf json(<path>, <pointer>)", () => {
  const p = (spec: string, text: string | null) => projectionOf(spec, reader(text === null ? {} : { "r.json": text }), null);
  it("hashes the value at the pointer, not the document", () => {
    expect(p("json(r.json, /a/b)", '{"a":{"b":[1,2]},"z":1}')).toBe(p("json(r.json, /a/b)", '{"z":2,"a":{"b":[1,2]}}'));
    expect(p("json(r.json, /a/b)", '{"a":{"b":[1,2]}}')).not.toBe(p("json(r.json, /a/b)", '{"a":{"b":[1,3]}}'));
  });
  it("canonical: key order does not matter; array index and ~1 escapes work", () => {
    expect(p("json(r.json, /o)", '{"o":{"x":1,"y":2}}')).toBe(p("json(r.json, /o)", '{"o":{"y":2,"x":1}}'));
    expect(p("json(r.json, /l/1)", '{"l":[7,8]}')).toBe(p("json(r.json, /l/1)", '{"l":[0,8]}'));
    expect(p("json(r.json, /a~1b)", '{"a/b":5}')).not.toBeNull();
  });
  it("a missing file, bad JSON or a missing pointer is null", () => {
    expect(p("json(r.json, /a)", null)).toBeNull();
    expect(p("json(r.json, /a)", "{not json")).toBeNull();
    expect(p("json(r.json, /missing)", '{"a":1}')).toBeNull();
    expect(p("json(r.json, /l/5)", '{"l":[1]}')).toBeNull();
  });
});

describe("projectionOf verdict", () => {
  it("is the hash of the verdict; no verdict is null", () => {
    expect(projectionOf("verdict", () => null, "pass")).toBe(projectionOf("verdict", () => null, "pass"));
    expect(projectionOf("verdict", () => null, "pass")).not.toBe(projectionOf("verdict", () => null, "fail"));
    expect(projectionOf("verdict", () => null, null)).toBeNull();
  });
  it("an unknown spec is null", () => {
    expect(projectionOf("whatever(x)", () => Buffer.from("x"), null)).toBeNull();
  });
});

/**
 * Gaps spec §7 wiring / §17 G6, kernel part: a `done` execution of a step with `hints.equals` stores its projection
 * (`body.projection`, `{{param.*}}` expanded), every later execution records it in `ranOnInputs.earlier[]`, and the
 * planner compares them -- so a re-run whose projection did not move stops the cascade at once.
 */
describe("the kernel cuts re-runs off by the equals projection (G6)", () => {
  const tpl = (equals: string) => ({ t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
params:
  slug: {type: slug, default: tea}
steps:
  - {id: outline, kind: work, prompt: outline.md, hints: {equals: "${equals}"}}
  - {id: draft, kind: draft, prompt: draft.md}
`, assets: { "outline.md": "Outline.\n", "draft.md": "Draft.\n" } } });

  async function rerunOutline(equals: string, first: Record<string, string>, second: Record<string, string>) {
    const children = fakeChildPort();
    const w = await flowWorld(tpl(equals), { children: children.port });
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    children.land(childGroupIdOf(flowRunId, "outline", 1), first);
    await w.advance();
    await w.answer(w.calls.findIndex((c) => c.key.stepKey === "draft"), { content: "draft 1" });
    await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "outline" }, body: { text: "tighter" }, by: "ann", via: "cli:test", requestId: "fb-1" });
    await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
    children.land(childGroupIdOf(flowRunId, "outline", 2), second);
    await w.advance();
    const draftReran = w.calls.some((c) => c.key.stepKey === "draft" && c.key.seq === 2);
    return { w, flowRunId, draftReran };
  }

  it("an outline re-run that keeps its headings: draft is not a candidate by outline (it leaves the plan, never re-runs)", async () => {
    const { w, flowRunId, draftReran } = await rerunOutline("headings({{param.slug}}.outline.md)", { "tea.outline.md": "# Tea\n## Why\n\nbody one\n" }, { "tea.outline.md": "# Tea\n## Why\n\na different body\n" }); try {
      const outlines = w.execs(flowRunId, "outline");
      const projection = (outlines[0]!.body as { projection?: string | null }).projection;
      expect(projection).toMatch(/^[0-9a-f]{64}$/);
      expect((outlines[1]!.body as { projection?: string | null }).projection).toBe(projection);
      expect(outlines[1]!.outputHash).not.toBe(outlines[0]!.outputHash);
      expect((w.execs(flowRunId, "draft")[0]!.body as { ranOnInputs: { earlier: Array<{ stepKey: string; projection: string | null }> } }).ranOnInputs.earlier)
        .toEqual([expect.objectContaining({ stepKey: "outline", projection })]);
      expect(draftReran).toBe(false);
      expect((listPlans(w.store, flowRunId).at(-1)!.chosen as { steps: string[] }).steps).toEqual(["outline"]);
    } finally { await w.dispose(); }
  });

  it("changed headings: draft re-runs", async () => {
    const { w, draftReran } = await rerunOutline("headings({{param.slug}}.outline.md)", { "tea.outline.md": "# Tea\n## Why\n" }, { "tea.outline.md": "# Tea\n## Why not\n" }); try {
      expect(draftReran).toBe(true);
    } finally { await w.dispose(); }
  });

  it("json(<path>, <pointer>): an unchanged value at the pointer cuts off, a changed one does not", async () => {
    const same = await rerunOutline("json(plan.json, /sections)", { "plan.json": '{"sections":["a","b"],"note":1}' }, { "plan.json": '{"note":2,"sections":["a","b"]}' });
    try { expect(same.draftReran).toBe(false); } finally { await same.w.dispose(); }
    const moved = await rerunOutline("json(plan.json, /sections)", { "plan.json": '{"sections":["a","b"]}' }, { "plan.json": '{"sections":["a","c"]}' });
    try { expect(moved.draftReran).toBe(true); } finally { await moved.w.dispose(); }
  });

  it("a missing file is a null projection: no cutoff, draft re-runs", async () => {
    const { w, flowRunId, draftReran } = await rerunOutline("headings({{param.slug}}.outline.md)", { "other.md": "# Tea\n" }, { "other.md": "# Tea\n\nmore\n" }); try {
      expect((w.execs(flowRunId, "outline")[0]!.body as { projection?: string | null }).projection ?? null).toBeNull();
      expect(draftReran).toBe(true);
    } finally { await w.dispose(); }
  });

  it("verdict: a review re-run with the same verdict cuts off the step after it", async () => {
    const w = await flowWorld({ t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: d, kind: draft, prompt: d.md}
  - {id: r, kind: review, reviews: d, hints: {equals: verdict}}
  - {id: e, kind: draft, prompt: e.md}
`, assets: { "d.md": "D.\n", "e.md": "E.\n" } } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      const at = (stepKey: string, seq: number) => w.calls.findIndex((c) => c.key.stepKey === stepKey && c.key.seq === seq);
      await w.answer(at("d", 1), { content: "d 1" });
      await w.answer(at("r", 1), { verdict: "pass", findings: ["fine"] });
      await w.answer(at("e", 1), { content: "e 1" });
      await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "r" }, body: { text: "look again" }, by: "ann", via: "cli:test", requestId: "fb-1" });
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      await w.answer(at("r", 2), { verdict: "pass", findings: ["still fine", "one nit"] });
      expect(w.execs(flowRunId, "r")[1]!.outputHash).not.toBe(w.execs(flowRunId, "r")[0]!.outputHash);
      expect(at("e", 2)).toBe(-1);
    } finally { await w.dispose(); }
  });
});
