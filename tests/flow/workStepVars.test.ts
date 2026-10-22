import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §12.1 (plan Task 14, needed by the built-in `wechat-article`): a `work` step's gate checks and tool
 * rules reach its child with their variables expanded -- ccloop runs the checks and claude matches the rules literally,
 * so `'{{param.slug}}.md'` left as written would test a file nobody writes and allow a command nobody runs. A
 * `{{base:<path>}}` is a read-only copy of the path at the execution's composition (the voice step's fidelity gate
 * compares before and after); `{{skill.<name>.dir}}` stays for the driver to fill with the injected copy; the effect
 * record id reaches the prompt (`--confirmed-by-orca '{{effect.recordId}}'`); an unset optional parameter reads empty in
 * a prompt but makes a command fail, never run with an empty value.
 */
const TPL = (gate: string) => ({
  yaml: `format: orca-flow-v1
id: t
params:
  slug: {type: slug, default: tea}
  cover: {type: path, required: false}
workspace: {kind: dir}
requires:
  skills:
    - {source: src, ref: "${"c".repeat(40)}", path: skills, skills: [voice]}
effects:
  wechat-draft: {class: external}
steps:
  - id: voice
    kind: work
    prompt: voice.md
    skills: [voice]
    effect: wechat-draft
    acceptance: {checks: [{run: "${gate}", role: gate}]}
    tools: {commands: [{exact: "python3 '{{skill.voice.dir}}/fidelity.py' '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'"}, {prefix: "wc -m '{{param.slug}}.md'"}]}
`,
  assets: { "voice.md": "Rewrite {{param.slug}}.md; cover '{{param.cover}}'; pass --confirmed-by-orca '{{effect.recordId}}'; run '{{skill.voice.dir}}/x'.\n" },
});

const contractOf = (children: ReturnType<typeof fakeChildPort>, id: string) =>
  JSON.parse(children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson) as {
    objective: { goal: string }; verification: { requiredChecks: string[] }; executionPolicy: { toolRules: { commands: Array<{ kind: string; value: string }> } };
  };

describe("work step variables (§12.1)", () => {
  it("gates and tool rules are expanded, the base copy is written read-only, skill dirs stay for the driver", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: TPL("python3 '{{skill.voice.dir}}/fidelity.py' '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'") }, { children: children.port, files: { "tea.md": "before\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      const contract = contractOf(children, childGroupIdOf(flowRunId, "voice", 1));
      const [gate] = contract.verification.requiredChecks;
      const base = /'([^']+)' 'tea\.md'$/.exec(gate!)![1]!;
      expect(gate).toBe(`python3 '{{skill.voice.dir}}/fidelity.py' '${base}' 'tea.md'`);
      expect(readFileSync(base, "utf8")).toBe("before\n");
      expect(statSync(base).mode & 0o777).toBe(0o400);
      expect(contract.executionPolicy.toolRules.commands).toEqual([
        { kind: "exact", value: `python3 '{{skill.voice.dir}}/fidelity.py' '${base}' 'tea.md'` },
        { kind: "prefix", value: "wc -m 'tea.md'" },
      ]);
      const record = (w.latest(flowRunId, "voice")!.body as { effectRecordId: string }).effectRecordId;
      expect(contract.objective.goal).toContain(`Rewrite tea.md; cover ''; pass --confirmed-by-orca '${record}'; run '{{skill.voice.dir}}/x'.`);
    } finally { await w.dispose(); }
  });

  it("an unset parameter in a command fails the execution instead of running with an empty value", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: TPL("test -s '{{param.cover}}'") }, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      expect(children.counts().dispatches).toBe(0);
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "failed" });
      expect((w.latest(flowRunId, "voice")!.body as { failure: string }).failure).toMatch(/^flow-command-vars:unknown variable \{\{param\.cover\}\}/);
    } finally { await w.dispose(); }
  });
});
