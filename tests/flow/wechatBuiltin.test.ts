import { describe, expect, it } from "vitest";
import { seedBuiltinTemplates } from "../../src/flow/builtins.js";
import { checkTemplate } from "../../src/flow/template/checklist.js";
import { BUILTIN_ROOT, directoryAssets, loadBuiltin, parseTemplateDraft } from "../../src/flow/template/load.js";
import type { FlowStep } from "../../src/flow/template/schema.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestStore } from "../control/fixtures/store.js";

/**
 * Flow engine spec §15 (H1, H2, H5, H34; plan Task 14): the built-in `wechat-article` is the human's chain as a template.
 * Its shape is the spec's table: every step with its kind, skills, effect, `when`, gates and `tools`; the pins are the
 * commits that carry §16.4 (md2publish-skills eabf4f7e, the `--confirmed-by-orca` switch and script files) and the
 * measured runskills commit; no tool rule names a bare interpreter or an inline script (claude refuses rules it cannot
 * read literally, §16.2, so `python3 -c` would leave the step unable to run the skill's own commands). The run ends at
 * the draft box: publishing is the person's click in the WeChat backend. Each effect step's prompt passes the effect
 * record as `--confirmed-by-orca`, and the draft box reads the cover step's FINAL file, never the sidecar default.
 */
/** T18 enact: md2wechat 3.2.0 uploads jpg, jpeg, png, gif, bmp or webp only ("unsupported image format" for the SVG). */
const RASTER_CHECK = "grep -Eiq '[.](jpe?g|png|gif|bmp|webp)$' assets/wechat/00-cover.final.txt";
const COVER_RASTER_GATE = "grep -Eiq '[.](png|jpe?g)$' assets/wechat/00-cover.final.txt";
const RUNSKILLS = "e62c5f8edaaf7d36770fc13962dad22404765adc";
const MD2PUBLISH = "eabf4f7e3aeec16019e55afb0ed918647580d580";
const dir = join(BUILTIN_ROOT, "wechat-article");
const loaded = loadBuiltin("wechat-article");
const steps = loaded.template.steps;
const step = (id: string): FlowStep => steps.find((s) => s.id === id)!;
const prompt = (id: string): string => readFileSync(join(dir, (step(id) as { prompt: string }).prompt), "utf8");
const gates = (id: string): string[] => ("acceptance" in step(id) ? (step(id) as { acceptance?: { checks: Array<{ run: string; role: string }> } }).acceptance?.checks ?? [] : []).filter((c) => c.role === "gate").map((c) => c.run);
const rules = (id: string): string[] => ((step(id) as { tools?: { commands?: Array<{ exact?: string; prefix?: string }> } }).tools?.commands ?? []).map((r) => r.exact ?? r.prefix!);

describe("built-in wechat-article (§15)", () => {
  it("passes the static checklist with no error and no warning", () => {
    const draft = parseTemplateDraft(readFileSync(join(dir, "template.yaml"), "utf8"));
    expect(draft.ok).toBe(true);
    const effectSkills = new Set(steps.filter((s) => "effect" in s && s.effect !== undefined).flatMap((s) => ("skills" in s ? s.skills ?? [] : [])));
    expect(checkTemplate((draft as { raw: unknown }).raw, directoryAssets(dir), { builtinEffectSkills: effectSkills })).toEqual({ errors: [], warnings: [] });
    expect(loaded.template).toMatchObject({ id: "wechat-article", version: 3, workspace: { kind: "dir" }, effects: { "image-generate": { class: "cost" }, "wechat-draft": { class: "external" } } });
  });

  // Gaps spec §8.1, §8.5 (version 3): the person's cover is an `image` param (checked by its bytes, storable as a preset);
  // `hints.owns` labels tell feedback triage which step takes what (§4.4). The person reviews the text as a diff (F §22).
  it("version 3: coverImage is an optional image; the writing steps carry their owns labels", () => {
    expect(loaded.template.params?.coverImage).toEqual({ type: "image", required: false });
    const owns = Object.fromEntries(steps.filter((s) => s.hints?.owns !== undefined).map((s) => [s.id, s.hints!.owns]));
    expect(owns).toEqual({
      outline: ["结构", "提纲"], draft: ["内容", "论证", "啰嗦"], deslop: ["AI 味", "套路句式"], voice: ["语气", "口语", "生硬"], finetune: ["公众号风格", "标题"],
    });
    expect((step("outline") as { hints?: { equals?: string } }).hints?.equals).toBe("headings({{param.slug}}.outline.md)");
  });

  it("is the spec's table: steps in order with their kinds, skills, effects, conditions and parallel sibling", () => {
    expect(steps.map((s) => [s.id, s.kind, "skills" in s ? s.skills ?? [] : []])).toEqual([
      ["brief", "clarify", []], ["outline", "work", ["tech-writer"]], ["approve-outline", "ask", []], ["draft", "work", ["tech-writer"]],
      ["deslop", "work", ["tech-writer-deslop"]], ["voice", "work", ["tech-writer-voice"]], ["finetune", "work", ["wechat-finetune"]],
      ["pick-title", "ask", []], ["visuals", "work", ["md2publish-visuals"]], ["article", "work", ["md2publish-article"]],
      ["cover", "work", ["md2publish-cover", "md2publish-diagram"]], ["to-draft-box", "work", ["md2publish-draft"]],
    ]);
    expect(step("brief")).toMatchObject({ mode: "auto", sections: ["Reader", "Purpose", "Angle", "Must-use material", "Length"] });
    expect(step("approve-outline")).toMatchObject({ executor: "person", policy: "review-after", form: { approve: { type: "bool", default: true } } });
    expect(step("pick-title")).toMatchObject({ executor: "either", policy: "review-after", candidatesFrom: { step: "finetune", name: "title" }, writeTo: { file: "{{param.slug}}.wechat.md", frontmatter: "title" } });
    expect(step("visuals")).toMatchObject({ effect: "image-generate", recommendedLevel: "confirm", when: { param: "illustrations", truthy: true } });
    expect(step("cover")).toMatchObject({ effect: "image-generate", recommendedLevel: "confirm", parallelWith: "article", when: { not: { param: "coverImage", truthy: true } } });
    expect(step("to-draft-box")).toMatchObject({ effect: "wechat-draft", recommendedLevel: "confirm" });
    expect(steps.filter((s) => "effect" in s && s.effect !== undefined).map((s) => s.id)).toEqual(["visuals", "cover", "to-draft-box"]);
    expect(steps.at(-1)!.id).toBe("to-draft-box");
    expect(loaded.template.requires?.commands).toEqual([{ name: "md2wechat", check: "md2wechat doctor --json" }]);
  });

  it("pins runskills and md2publish-skills at full commits", () => {
    expect(loaded.template.requires?.skills).toEqual([
      { source: "github.com/blrbiran/runskills", ref: RUNSKILLS, path: "skills", skills: ["tech-writer", "tech-writer-deslop", "tech-writer-voice"] },
      { source: "github.com/blrbiran/md2publish-skills", ref: MD2PUBLISH, path: "skills", skills: ["wechat-finetune", "md2publish-visuals", "md2publish-article", "md2publish-cover", "md2publish-draft", "md2publish-diagram"] },
    ]);
  });

  it("gates and tools per step; every work step declares tools; no bare interpreter, no inline script", () => {
    expect(gates("outline")).toEqual(["test -s '{{param.slug}}.outline.md'"]);
    expect(gates("draft")).toEqual(["test -s '{{param.slug}}.md'"]);
    expect(gates("voice")).toEqual(["python3 '{{skill.tech-writer-voice.dir}}/scripts/fidelity.py' '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'"]);
    expect(gates("finetune")).toEqual(["test -s '{{param.slug}}.wechat.md'"]);
    expect(gates("article")).toEqual(["test -s '{{param.slug}}.wechat.html' || test -s '{{param.slug}}.illustrated.html'"]);
    expect(gates("to-draft-box")).toEqual([]);
    expect((step("outline") as { hints?: { equals?: string } }).hints?.equals).toBe("headings({{param.slug}}.outline.md)");
    for (const work of steps.filter((s) => s.kind === "work")) expect((work as { tools?: unknown }).tools, work.id).toBeDefined();
    expect(rules("deslop")).toEqual(["python3 '{{skill.tech-writer-deslop.dir}}/scripts/scan.py' --json '{{param.slug}}.md'"]);
    expect(rules("to-draft-box")).toEqual([RASTER_CHECK, "md2wechat doctor", "md2wechat upload_image", "md2wechat create_draft"]);
    expect((step("to-draft-box") as { tools: { network: boolean; secrets: string[] } }).tools).toMatchObject({ network: true, secrets: ["WECHAT_APPID", "WECHAT_SECRET"] });
    for (const id of ["visuals", "cover"]) expect((step(id) as { tools: { network: boolean } }).tools.network, id).toBe(true);
    for (const id of ["outline", "draft", "deslop", "voice", "finetune", "article"]) expect((step(id) as { tools: { network?: boolean } }).tools.network, id).toBe(false);
    const all = steps.flatMap((s) => rules(s.id));
    expect(all.filter((r) => /^(python3?|bash|sh|zsh|node|bun|deno)\s*$/.test(r.trim()))).toEqual([]);
    expect(all.filter((r) => /python3? -c|python3? - /.test(r))).toEqual([]);
    // T18 acceptance: claude resets the shell's working directory after every command, so `cd '<skill dir>'` then
    // `python3 scripts/…` failed (ENOENT) and the cover's generator and finetune's self-check never ran. Every skill
    // script is named by its absolute path under its own step's skill directory (§16.4); no rule is a `cd`.
    expect(all.filter((r) => /^\s*cd(\s|$)/.test(r))).toEqual([]);
    // T18 acceptance: ccloop refused every rule ending in a space (8 in cover, 2 in article); none is left.
    expect(all.filter((r) => r !== r.trim())).toEqual([]);
    // Ruling: 这次批准改写所有必要的判据 (b37f7ce9) -- a script is under one of its own step's skills (the cover's
    // svg2raster.py is md2publish-diagram's: md2publish-cover does not ship it at the pinned commit).
    for (const id of ["finetune", "visuals", "article", "cover"]) {
      const skills = (step(id) as { skills: string[] }).skills.join("|");
      const scripts = rules(id).filter((r) => /^(python3|bun) /.test(r));
      expect(scripts.length, id).toBeGreaterThan(0);
      for (const r of scripts) expect(r, id).toMatch(new RegExp(`^(python3|bun) '\\{\\{skill\\.(${skills})\\.dir\\}\\}/(shared/)?scripts/[a-z0-9_/]+\\.(py|ts)'( |$)`));
    }
    for (const id of ["finetune", "visuals", "article", "cover", "to-draft-box"]) expect(prompt(id), id).not.toMatch(/`cd '/);
  });

  // T18 acceptance (fr-12b4198a, tokens per child execution, plan + execute, from ccloop's usage.json:
  // wechat-acceptance/logs/usage-final.txt): the even share of the pool (~220-245k a work step) was too small --
  // finetune#1 ended budget-exhausted at 308,331. Each work step declares its own budget, at least 1.5x what it used
  // there (the cover's is its two attempts together), and the run's pool funds all of them at once.
  it("declares a budget per work step sized from the acceptance run, and a run pool at least their sum", () => {
    const measured: Record<string, number> = {
      outline: 141_650, draft: 204_585, deslop: 202_530, voice: 189_211, finetune: 308_331, article: 551_824, cover: 660_760,
    };
    const work = steps.filter((s) => s.kind === "work");
    const budgets = Object.fromEntries(work.map((s) => [s.id, s.budget?.tokens]));
    for (const s of work) expect(budgets[s.id], s.id).toBeGreaterThan(0);
    for (const [id, used] of Object.entries(measured)) expect(budgets[id]!, id).toBeGreaterThanOrEqual(Math.ceil(used * 1.5));
    // visuals makes images as the cover does (unmeasured: illustrations were off); it gets at least the cover's.
    expect(budgets.visuals!).toBeGreaterThanOrEqual(budgets.cover!);
    const sum = work.reduce((total, s) => total + s.budget!.tokens, 0);
    expect(loaded.template.budget?.tokensPerRun).toBeGreaterThanOrEqual(sum);
  });

  it("each effect step passes its record as --confirmed-by-orca; the article passes the run id; the draft box takes the cover's FINAL path", () => {
    for (const id of ["visuals", "cover", "to-draft-box"]) expect(prompt(id), id).toContain("--confirmed-by-orca '{{effect.recordId}}'");
    expect(prompt("article")).toContain("--confirmed-by-orca '{{run.id}}'");
    expect(prompt("cover")).toContain("assets/wechat/00-cover.final.txt");
    expect(gates("cover")).toEqual(["test -s assets/wechat/00-cover.final.txt", COVER_RASTER_GATE]);
    expect(prompt("to-draft-box")).toContain("assets/wechat/00-cover.final.txt");
    expect(prompt("to-draft-box")).toMatch(/never the sidecar default/);
    expect(prompt("finetune")).toContain("flow.candidates.title");
  });

  // T18 enact: the cover step drew an SVG; md2wechat 3.2.0 refused it ("unsupported image format") only at the draft
  // box, after the person enacted the external effect. The cover must hand over a raster (a vector is converted with
  // svg2raster.py first), its gate refuses anything else, and the draft box checks the cover before any upload and
  // stops with a named failure. Version 2: the bytes changed.
  it("the cover hands over a raster; the draft box refuses a non-raster cover before uploading", () => {
    const dirOf = mkdtempSync(join(tmpdir(), "orca-raster-"));
    try {
      const exits = (command: string, final: string): number => {
        mkdirSync(join(dirOf, "assets/wechat"), { recursive: true });
        writeFileSync(join(dirOf, "assets/wechat/00-cover.final.txt"), final);
        return spawnSync("/bin/sh", ["-c", command], { cwd: dirOf }).status!;
      };
      for (const [final, cover, box] of [["assets/wechat/00-cover.svg\n", 1, 1], ["assets/wechat/00-cover.png\n", 0, 0], ["assets/wechat/00-cover.JPG\n", 0, 0],
        ["assets/wechat/00-cover.webp\n", 1, 0], ["assets/wechat/00-cover.png.svg\n", 1, 1]] as const) {
        expect([exits(COVER_RASTER_GATE, final), exits(RASTER_CHECK, final)], final).toEqual([cover, box]);
      }
    } finally { rmSync(dirOf, { recursive: true, force: true }); }
    expect(rules("cover")).toContain("python3 '{{skill.md2publish-diagram.dir}}/shared/scripts/svg2raster.py'");
    expect(prompt("cover")).toContain("python3 '{{skill.md2publish-diagram.dir}}/shared/scripts/svg2raster.py' --svg");
    expect(prompt("to-draft-box")).toContain(RASTER_CHECK);
    expect(prompt("to-draft-box")).toContain("cover-not-raster");
  });

  it("is seeded into flow_templates by upsert at start; seeding again changes nothing", async () => {
    const h = await openTestStore(); try {
      const rows = () => h.store.db.prepare("SELECT layer, id, version, sha256, published_by AS publishedBy FROM flow_templates ORDER BY id").all();
      expect(seedBuiltinTemplates(h.store, 5)).toEqual([{ id: "wechat-article", version: 3, sha256: loaded.sha256 }]);
      expect(rows()).toEqual([{ layer: "builtin", id: "wechat-article", version: 3, sha256: loaded.sha256, publishedBy: "orca" }]);
      seedBuiltinTemplates(h.store, 6);
      expect(rows()).toHaveLength(1);
    } finally { await h.dispose(); }
  });
});
