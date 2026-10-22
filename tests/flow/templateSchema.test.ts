/**
 * Flow engine spec §3 (C1, plan Task 3): an `orca-flow-v1` template is strict at every level, and the one static
 * checklist (§3.3) is what publish and start run -- save only parses YAML, so a broken draft can be kept and fixed.
 * Review Focus 1 and 2: a command may only carry validated params (slug, int, enum, path), and no asset or path param
 * may lead outside the template or the workspace.
 */
import { describe, expect, it } from "vitest";
import { checkTemplate, type AssetReader, type Finding } from "../../src/flow/template/checklist.js";
import { parseTemplateDraft } from "../../src/flow/template/load.js";
import { flowTemplateSchema } from "../../src/flow/template/schema.js";

const PROMPT = "Write the article for {{param.idea}} into {{param.slug}}.md in {{workspace}} (run {{run.id}}).\n";
const assets = (files: Record<string, string> = {}): AssetReader => {
  const all: Record<string, string> = { "prompts/draft.md": PROMPT, "prompts/brief.md": "Background.\n", "prompts/review.md": "Rubric.\n", ...files };
  return { exists: (rel) => rel in all, read: (rel) => { if (!(rel in all)) throw new Error(`no ${rel}`); return all[rel]!; } };
};
const ctx = { builtinEffectSkills: new Set<string>(["md2publish-draft"]) };

/** A valid template using every phase-1 kind; each case below breaks exactly one thing. */
function valid(): any {
  return {
    format: "orca-flow-v1",
    id: "article",
    title: { en: "Article", zh: "文章" },
    params: {
      idea: { type: "longtext", required: true },
      slug: { type: "slug", derive: "slug-of-idea" },
      tone: { type: "enum", options: ["plain", "warm"], default: "plain" },
      words: { type: "int", default: 1500 },
      illustrations: { type: "bool", default: false },
      cover: { type: "path", required: false },
    },
    workspace: { kind: "dir", excludes: [".cache/"] },
    roles: { writer: { tier: "high", suggest: { agent: "claude" } }, reviewer: { tier: "high", distinctFrom: "writer" } },
    requires: {
      skills: [{ source: "github.com/blrbiran/runskills", ref: "a".repeat(40), path: "skills", skills: ["tech-writer"] },
        { source: "github.com/blrbiran/md2publish-skills", ref: "b".repeat(40), path: "skills", skills: ["md2publish-draft"] }],
      commands: [{ name: "md2wechat", check: "md2wechat doctor --json" }],
    },
    effects: { "wechat-draft": { class: "external" } },
    budget: { tokensPerRun: 2_000_000 },
    steps: [
      { id: "brief", kind: "clarify", mode: "auto", background: "prompts/brief.md", sections: ["Reader", "Purpose"] },
      {
        id: "draft", kind: "work", role: "writer", skills: ["tech-writer"], prompt: "prompts/draft.md",
        tools: { commands: [{ exact: "wc -m '{{param.slug}}.md'" }, { prefix: "python3 '{{skill.tech-writer.dir}}/scripts/scan.py'" }], network: false, secrets: ["OPENAI_API_KEY"] },
        acceptance: { checks: [{ id: "exists", run: "test -s '{{param.slug}}.md'", role: "gate" }, { id: "diff", run: "diff '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'", role: "diagnostic" }] },
        loop: { until: { check: "exists" }, max: 2 }, budget: { tokens: 400_000 },
        hints: { skipWhen: "only the title changed", owns: ["body"], equals: "headings({{param.slug}}.md)" },
      },
      { id: "summary", kind: "draft", prompt: "prompts/draft.md", when: { and: [{ param: "tone", equals: "plain" }, { not: { param: "illustrations", truthy: true } }] } },
      { id: "lint", kind: "check", acceptance: { checks: [{ id: "len", run: "test $(wc -m < '{{param.slug}}.md') -le {{param.words}}", role: "gate" }] } },
      { id: "review", kind: "review", role: "reviewer", reviews: "draft", rubric: "prompts/review.md", maxRounds: 2, loop: { until: { verdict: "pass" }, max: 2 } },
      {
        id: "approve", kind: "ask", executor: "person", policy: "review-after",
        form: { approve: { type: "bool", default: true }, notes: { type: "longtext", required: false } },
        writeTo: { file: "{{param.slug}}.md", frontmatter: "approved" },
      },
      { id: "pick", kind: "ask", executor: "either", policy: "confirm-before", candidatesFrom: { step: "draft", name: "title" }, form: { title: { type: "text" } } },
      { id: "to-draft-box", kind: "work", skills: ["md2publish-draft"], prompt: "prompts/draft.md", effect: "wechat-draft", recommendedLevel: "confirm", parallelWith: "lint" },
    ],
  };
}
const codes = (findings: Finding[]): string[] => findings.map((finding) => finding.code);
const errorsOf = (tpl: unknown, files?: Record<string, string>): string[] => codes(checkTemplate(tpl, assets(files), ctx).errors);
const mutate = (fn: (tpl: any) => void): any => { const tpl = valid(); fn(tpl); return tpl; };

describe("orca-flow-v1 schema and checklist (C1)", () => {
  it("S0: the valid template passes with no errors and no warnings", () => {
    expect(checkTemplate(valid(), assets(), ctx)).toEqual({ errors: [], warnings: [] });
    expect(flowTemplateSchema.safeParse(valid()).success).toBe(true);
  });

  it.each([
    ["top level", (t: any) => { t.extra = 1; }],
    ["a param", (t: any) => { t.params.idea.label = "x"; }],
    ["the workspace", (t: any) => { t.workspace.mode = "x"; }],
    ["a role", (t: any) => { t.roles.writer.model = "x"; }],
    ["a role suggestion", (t: any) => { t.roles.writer.suggest.tier = "x"; }],
    ["a required skill", (t: any) => { t.requires.skills[0].sha = "x"; }],
    ["an effect", (t: any) => { t.effects["wechat-draft"].level = "confirm"; }],
    ["the run budget", (t: any) => { t.budget.tokens = 1; }],
    ["a step", (t: any) => { t.steps[1].reads = ["a.md"]; }],
    ["a step's tools", (t: any) => { t.steps[1].tools.env = []; }],
    ["a tool command", (t: any) => { t.steps[1].tools.commands[0].glob = "x"; }],
    ["a check", (t: any) => { t.steps[1].acceptance.checks[0].timeout = 1; }],
    ["a loop", (t: any) => { t.steps[1].loop.every = 1; }],
    ["hints", (t: any) => { t.steps[1].hints.reads = []; }],
    ["a when predicate", (t: any) => { t.steps[2].when.and[0].op = "eq"; }],
    ["an ask form field", (t: any) => { t.steps[5].form.approve.widget = "x"; }],
    ["a writeTo", (t: any) => { t.steps[5].writeTo.mode = "x"; }],
  ])("S1: an unknown key in %s is a schema error", (_where, fn) => {
    expect(errorsOf(mutate(fn))).toEqual(["schema"]);
  });

  it.each(["effect", "subflow", "software-change", "foreach", "wait", "bogus"])("S2: kind %s is not a phase-1 kind", (kind) => {
    expect(errorsOf(mutate((t) => { t.steps.push({ id: "later", kind }); }))).toEqual(["schema"]);
  });

  it("S3: the two budget additions must be positive integers", () => {
    expect(errorsOf(mutate((t) => { t.budget.tokensPerRun = 0; }))).toEqual(["schema"]);
    expect(errorsOf(mutate((t) => { t.steps[1].budget.tokens = 1.5; }))).toEqual(["schema"]);
  });

  it.each([
    ["duplicate-step-id", (t: any) => { t.steps.push({ id: "draft", kind: "draft", prompt: "prompts/draft.md" }); }],
    ["duplicate-check-id", (t: any) => { t.steps[1].acceptance.checks.push({ id: "exists", run: "true", role: "gate" }); }],
    ["skill-not-required", (t: any) => { t.steps[1].skills.push("tech-writer-voice"); }],
    ["effect-kind-unknown", (t: any) => { t.steps[7].effect = "image-generate"; }],
    ["effect-class-human-only", (t: any) => { t.effects["wechat-draft"].class = "human-only"; }],
    ["unknown-var", (t: any) => { t.steps[1].acceptance.checks[0].run = "test -s '{{param.nope}}.md'"; }],
    ["unknown-var", (t: any) => { t.steps[1].tools.commands[0].exact = "echo '{{run.title}}'"; }],
    ["unknown-var", (t: any) => { t.steps[1].tools.commands[1].prefix = "python3 '{{skill.md2publish-draft.dir}}/x.py'"; }],
    ["unknown-var", (t: any) => { t.steps[5].writeTo.file = "{{param.missing}}.md"; }],
    ["loop-check-missing", (t: any) => { t.steps[1].loop.until.check = "nope"; }],
    ["loop-check-not-gate", (t: any) => { t.steps[1].loop.until.check = "diff"; }],
    ["tools-bare-interpreter", (t: any) => { t.steps[1].tools.commands.push({ prefix: "python3" }); }],
    ["tools-bare-interpreter", (t: any) => { t.steps[1].tools.commands.push({ prefix: "sh" }); }],
    // T18 acceptance: ccloop refuses a rule with surrounding whitespace (claude cannot hold it literally); trimming it
    // here would widen the author's rule (prefix "mkdir -p " would also allow a bare `mkdir -p`), so it is refused.
    ["tools-whitespace", (t: any) => { t.steps[1].tools.commands.push({ prefix: "mkdir -p " }); }],
    ["tools-whitespace", (t: any) => { t.steps[1].tools.commands[0].exact = " wc -m '{{param.slug}}.md'"; }],
    ["tools-bare-interpreter", (t: any) => { t.steps[1].tools.commands.push({ prefix: "node" }); }],
    ["tools-bare-interpreter", (t: any) => { t.steps[1].tools.commands.push({ prefix: "bun" }); }],
    // T18 acceptance: claude resets the shell's working directory after each command, so a `cd` rule helps nothing.
    ["tools-cd", (t: any) => { t.steps[1].tools.commands.unshift({ exact: "cd '{{skill.tech-writer.dir}}'" }); }],
    ["executor-person-not-allowed", (t: any) => { t.steps[3].executor = "person"; }],
    ["executor-person-not-allowed", (t: any) => { t.steps[2].executor = "person"; }],
    ["parallel-with-unknown", (t: any) => { t.steps[7].parallelWith = "nope"; }],
    ["distinct-from-unknown", (t: any) => { t.roles.reviewer.distinctFrom = "editor"; }],
    ["role-unknown", (t: any) => { t.steps[1].role = "editor"; }],
    ["when-unknown-param", (t: any) => { t.steps[2].when.and[0].param = "mood"; }],
    ["when-unknown-param", (t: any) => { t.steps[2].when = { not: { param: "mood", truthy: true } }; }],
    ["asset-missing", (t: any) => { t.steps[1].prompt = "prompts/missing.md"; }],
    ["asset-missing", (t: any) => { t.steps[0].background = "prompts/none.md"; }],
    ["asset-missing", (t: any) => { t.steps[4].rubric = "prompts/none.md"; }],
    ["reviews-unknown", (t: any) => { t.steps[4].reviews = "nope"; }],
    ["candidates-from-unknown", (t: any) => { t.steps[6].candidatesFrom.step = "nope"; }],
    ["effect-step-loop", (t: any) => { t.steps[7].loop = { until: { check: "x" }, max: 1 }; t.steps[7].acceptance = { checks: [{ id: "x", run: "true", role: "gate" }] }; }],
    ["effect-step-loop", (t: any) => { t.steps[7].onFailure = { retry: 1, then: "fail" }; }],
    ["hints-equals-invalid", (t: any) => { t.steps[1].hints.equals = "words(x.md)"; }],
  ])("S4: %s", (code, fn) => {
    expect(errorsOf(mutate(fn))).toEqual([code]);
  });

  // T18 acceptance (fr-12b4198a): the template's `cd '<skill dir>'` then `python3 scripts/verify.py` failed with ENOENT,
  // because claude resets the shell's working directory after every command; finetune's self-check and the cover's
  // generator never ran. A command relative to a `cd` rule is flagged where it is; without a `cd`, a relative path is
  // the workspace's and stays allowed.
  it("S4b: a command that depends on a cd rule is an error at that command; a workspace-relative one alone is not", () => {
    const findings = checkTemplate(mutate((t) => {
      t.steps[1].tools.commands = [{ exact: "cd '{{skill.tech-writer.dir}}'" }, { prefix: "python3 scripts/verify.py" }, { prefix: "bun shared/scripts/imagegen/main.ts" }, { exact: "wc -m '{{param.slug}}.md'" }];
    }), assets(), ctx).errors;
    expect(findings.map((f) => [f.code, f.path])).toEqual([
      ["tools-cd", "steps.1.tools.commands.0"], ["tools-depends-on-cd", "steps.1.tools.commands.1"], ["tools-depends-on-cd", "steps.1.tools.commands.2"],
    ]);
    expect(errorsOf(mutate((t) => { t.steps[1].tools.commands.push({ prefix: "python3 tools/check.py" }); }))).toEqual([]);
  });

  it("S4c: a bare interpreter with a trailing space is refused for both", () => {
    expect(errorsOf(mutate((t) => { t.steps[1].tools.commands.push({ prefix: "bash " }); }))).toEqual(["tools-bare-interpreter", "tools-whitespace"]);
  });

  it("S5: every finding names where it is, so Web and CLI can point at it", () => {
    const findings = checkTemplate(mutate((t) => { t.steps[1].skills.push("tech-writer-voice"); }), assets(), ctx).errors;
    expect(findings).toEqual([{ code: "skill-not-required", path: "steps.1.skills.1", message: expect.stringContaining("tech-writer-voice") }]);
  });

  it("S6: an unknown variable inside a prompt asset is an error at the step that uses it", () => {
    expect(errorsOf(valid(), { "prompts/draft.md": "Use {{param.idea}} and {{workspace.root}}.\n" })).toEqual(["unknown-var", "unknown-var", "unknown-var"]);
  });

  it("S7: warning, not error, for an unclassed step using a skill a built-in classes as an effect", () => {
    const tpl = mutate((t) => { delete t.steps[7].effect; delete t.steps[7].recommendedLevel; });
    const result = checkTemplate(tpl, assets(), ctx);
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(["unclassed-effect-skill"]);
  });

  it("S8: save accepts a broken draft (YAML only); the checklist refuses it", () => {
    const text = "format: orca-flow-v1\nid: article\nsteps:\n  - {id: a, kind: wait}\n  - {id: a, kind: work}\nbogus: true\n";
    const draft = parseTemplateDraft(text);
    expect(draft.ok).toBe(true);
    expect(draft.ok ? codes(checkTemplate(draft.raw, assets(), ctx).errors) : []).toContain("schema");
    expect(parseTemplateDraft("steps: [\n").ok).toBe(false);
  });
});

describe("Review Focus 1: params allowed in commands", () => {
  it("R1: a longtext or text param in a check run or a tools command is refused; slug, int, enum and path are fine", () => {
    expect(errorsOf(mutate((t) => { t.steps[1].acceptance.checks[0].run = "grep -q '{{param.idea}}' x.md"; }))).toEqual(["param-type-not-allowed-in-command"]);
    expect(errorsOf(mutate((t) => { t.params.title = { type: "text" }; t.steps[1].tools.commands[0].exact = "echo '{{param.title}}'"; }))).toEqual(["param-type-not-allowed-in-command"]);
    expect(errorsOf(mutate((t) => { t.steps[1].tools.commands[0].exact = "echo '{{param.slug}}' '{{param.words}}' '{{param.tone}}' '{{param.cover}}'"; }))).toEqual([]);
  });
  it("R2: a bool param in a command is refused too (only the four validated types pass)", () => {
    expect(errorsOf(mutate((t) => { t.steps[3].acceptance.checks[0].run = "test '{{param.illustrations}}' = true"; }))).toEqual(["param-type-not-allowed-in-command"]);
  });
  it("R3: a text param reaching a command through {{base:...}} is refused as well", () => {
    expect(errorsOf(mutate((t) => { t.steps[1].acceptance.checks[1].run = "cat '{{base:{{param.idea}}.md}}'"; }))).toEqual(["param-type-not-allowed-in-command"]);
  });
  it("R4: {{base:...}} is a command variable only; in a prompt it is unknown", () => {
    expect(errorsOf(valid(), { "prompts/draft.md": "Compare {{base:{{param.slug}}.md}}.\n" })).toEqual(["unknown-var", "unknown-var", "unknown-var"]);
  });
});

describe("Review Focus 2: paths stay inside the template and the workspace", () => {
  it.each(["../x.md", "/etc/x", "prompts/../../x.md", "prompts\\x.md"])("P1: asset %s is outside the template", (path) => {
    expect(errorsOf(mutate((t) => { t.steps[1].prompt = path; }), { [path]: "x" })).toEqual(["asset-path-outside-template"]);
  });
  it.each(["../a", "/etc/passwd", "a/../../b", "it's", "a\nb", "a\u0000b"])("P2: a path param default %j is refused", (value) => {
    expect(errorsOf(mutate((t) => { t.params.cover.default = value; }))).toEqual(["param-path-invalid"]);
  });
  it.each(["../x.md", "/tmp/x.md"])("P3: writeTo.file %s is refused", (file) => {
    expect(errorsOf(mutate((t) => { t.steps[5].writeTo.file = file; }))).toEqual(["write-to-outside-workspace"]);
  });
});
