/**
 * Flow engine spec §3.2 (`when`, `derive`), §12.1 (variables) and §17 package 1 (built-in loader). All code, no model
 * (Rule 5): a predicate is a structure, never an expression string; a derived default is a pure function of the params;
 * an unknown variable is never left in a prompt or a command; a built-in is read from the repository Orca runs from,
 * not from whatever directory it was started in.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_ROOT, loadBuiltin } from "../../src/flow/template/load.js";
import { deriveParam, expandVars, type VarScope } from "../../src/flow/template/vars.js";
import { evaluateWhen } from "../../src/flow/template/when.js";

describe("evaluateWhen", () => {
  const params = { tone: "warm", words: 1500, illustrations: false, cover: "", title: "x" };
  const on = (pred: unknown, classification: { scope?: string; clarity?: string } | null = null): boolean => evaluateWhen(pred as never, { params, classification });
  it.each([
    [{ param: "tone", equals: "warm" }, true],
    [{ param: "tone", equals: "plain" }, false],
    [{ param: "words", equals: 1500 }, true],
    [{ param: "words", equals: "1500" }, false],
    [{ param: "tone", in: ["plain", "warm"] }, true],
    [{ param: "tone", in: ["plain"] }, false],
    [{ param: "illustrations", truthy: true }, false],
    [{ param: "illustrations", truthy: false }, true],
    [{ param: "cover", truthy: true }, false],
    [{ param: "title", truthy: true }, true],
    [{ param: "absent", truthy: false }, true],
    [{ not: { param: "cover", truthy: true } }, true],
    [{ and: [{ param: "tone", equals: "warm" }, { param: "words", in: [1500] }] }, true],
    [{ and: [{ param: "tone", equals: "warm" }, { param: "words", in: [1] }] }, false],
    [{ or: [{ param: "tone", equals: "plain" }, { not: { param: "illustrations", truthy: true } }] }, true],
    [{ or: [{ param: "tone", equals: "plain" }, { param: "illustrations", truthy: true }] }, false],
    [{ and: [] }, true],
    [{ or: [] }, false],
  ])("W1: %j is %s", (pred, expected) => {
    expect(on(pred)).toBe(expected);
  });
  it("W2: classification matches each field given; with no classification yet it is false", () => {
    expect(on({ classification: { scope: "small" } }, { scope: "small", clarity: "clear" })).toBe(true);
    expect(on({ classification: { scope: "small", clarity: "unclear" } }, { scope: "small", clarity: "clear" })).toBe(false);
    expect(on({ classification: { clarity: "clear" } }, { scope: "large", clarity: "clear" })).toBe(true);
    expect(on({ classification: { scope: "small" } }, null)).toBe(false);
    expect(on({ not: { classification: { scope: "small" } } }, null)).toBe(true);
  });
});

describe("expandVars (§12.1)", () => {
  const scope: VarScope = {
    params: { slug: "my-post", idea: "An idea", words: 1500 },
    runId: "run-1", workspace: "/ws/attempt", skillDirs: { "tech-writer": "/skills/tech-writer" }, effectRecordId: "eff-9",
    base: (path) => `/tmp/base/${path}`,
  };
  it("V1: every prompt variable", () => {
    expect(expandVars("{{param.idea}} -> {{param.slug}}.md in {{workspace}}, {{run.id}}, {{skill.tech-writer.dir}}, {{effect.recordId}}, {{param.words}}", scope, "prompt"))
      .toBe("An idea -> my-post.md in /ws/attempt, run-1, /skills/tech-writer, eff-9, 1500");
  });
  it("V2: {{base:<path>}} in a command, with the path's own variables expanded first", () => {
    expect(expandVars("fidelity.py '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'", scope, "command")).toBe("fidelity.py '/tmp/base/my-post.md' 'my-post.md'");
  });
  it.each(["{{param.nope}}", "{{run.title}}", "{{skill.other.dir}}", "{{workspace.root}}", "{{ param.slug }}", "{{base:x.md}}"])("V3: %s in a prompt throws", (text) => {
    expect(() => expandVars(text, scope, "prompt")).toThrow(/unknown variable/);
  });
  it("V4: {{effect.recordId}} on a step with no effect record throws", () => {
    const { effectRecordId: _drop, ...rest } = scope;
    expect(() => expandVars("--confirmed-by-orca '{{effect.recordId}}'", rest, "command")).toThrow(/unknown variable/);
  });
  it("V5: text with no variables, and braces that are not a variable, pass through", () => {
    expect(expandVars("plain { text } {x}", scope, "command")).toBe("plain { text } {x}");
  });
});

describe("deriveParam (§3.2)", () => {
  const now = new Date("2026-10-22T23:30:00.000Z");
  it("D1: slug-of-idea is lowercase ASCII [a-z0-9-], deterministic", () => {
    const params = { idea: "  Why Rust's Borrow Checker -- Helps (2026)!  " };
    expect(deriveParam("slug-of-idea", params, now)).toBe("why-rust-s-borrow-checker-helps-2026");
    expect(deriveParam("slug-of-idea", params, now)).toBe(deriveParam("slug-of-idea", params, new Date(0)));
  });
  it("D2: at most 64 characters, never ending in a dash", () => {
    const slug = deriveParam("slug-of-idea", { idea: `${"abcdefghi ".repeat(20)}` }, now);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
  it("D3: a CJK-only idea falls back to article-<sha8>", () => {
    const idea = "为什么要写公众号文章";
    const sha8 = createHash("sha256").update(idea).digest("hex").slice(0, 8);
    expect(deriveParam("slug-of-idea", { idea }, now)).toBe(`article-${sha8}`);
  });
  it("D4: mixed CJK and Latin keeps the Latin part", () => {
    expect(deriveParam("slug-of-idea", { idea: "Orca 的流程引擎" }, now)).toBe("orca");
  });
  it("D5: today is the UTC date of now", () => {
    expect(deriveParam("today", {}, now)).toBe("2026-10-22");
  });
});

describe("loadBuiltin (§17 package 1)", () => {
  const template = "format: orca-flow-v1\nid: mini\ntitle: {en: Mini}\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: prompts/write.md}\n";
  const root = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "flow-builtin-"));
    mkdirSync(join(dir, "mini", "prompts"), { recursive: true });
    writeFileSync(join(dir, "mini", "template.yaml"), template);
    writeFileSync(join(dir, "mini", "prompts", "write.md"), "Write.\n");
    return dir;
  };
  it("L1: reads <root>/<id>/template.yaml, returns its bytes, sha256, the parsed template and its assets", () => {
    const loaded = loadBuiltin("mini", root());
    expect(loaded.bytes.toString("utf8")).toBe(template);
    expect(loaded.sha256).toBe(createHash("sha256").update(template).digest("hex"));
    expect(loaded.template.id).toBe("mini");
    expect(loaded.template.steps.map((step) => step.kind)).toEqual(["work"]);
    expect(loaded.assets.read("prompts/write.md")).toBe("Write.\n");
    expect(loaded.assets.exists("prompts/none.md")).toBe(false);
  });
  it("L2: a built-in that fails the checklist does not load (flow-template-invalid)", () => {
    const dir = root();
    writeFileSync(join(dir, "mini", "template.yaml"), template.replace("prompts/write.md", "prompts/none.md"));
    expect(() => loadBuiltin("mini", dir)).toThrow(/^flow-template-invalid: asset-missing/);
  });
  it("L3: the default root is <repository>/flows/builtin, found from the module, not from the working directory", async () => {
    expect(BUILTIN_ROOT).toBe(join(__dirname, "..", "..", "flows", "builtin"));
    // Loaded afresh while the working directory says somewhere else: the root does not move with it.
    vi.resetModules();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue("/nowhere");
    try { expect((await import("../../src/flow/template/load.js")).BUILTIN_ROOT).toBe(BUILTIN_ROOT); }
    finally { cwd.mockRestore(); }
    expect(() => loadBuiltin("no-such-template")).toThrow(/^flow-template-invalid: .*no-such-template/);
  });
  it.each(["../mini", "a/b", "", "Mini"])("L4: id %j is not a template id", (id) => {
    expect(() => loadBuiltin(id, root())).toThrow(/^flow-template-invalid/);
  });
});
