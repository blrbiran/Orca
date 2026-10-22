/**
 * Flow engine plan Task 14: the built-in `wechat-article` (the real template and prompts, copied into the world's
 * built-in root) over fake agents -- the recording call port answers the single calls, the fake child port lands each
 * work step's files as the skill would write them. `toDraftBox` drives a run from the brief to the draft box, crossing
 * one pause: the article step asks the person a question (`flow.needs`) while its parallel sibling, the cover, goes on.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect } from "vitest";
import { answerNeeds, openAsks } from "../../../src/flow/kernel.js";
import { childGroupIdOf } from "../../../src/flow/kinds/work.js";
import { BUILTIN_ROOT } from "../../../src/flow/template/load.js";
import { fakeChildPort } from "./childPort.js";
import { flowWorld } from "./flowWorld.js";

export const SLUG = "tea-for-engineers";
export const WECHAT = `${SLUG}.wechat.md`;
const wechatFile = (title: string, last: string) => `---\ntitle: ${title}\nauthor: Ann\ndigest: Why tea helps engineers think.\n---\n\nTea slows you down.\n\nIt is warm.\n\nIt has a ritual.\n\n${last}\n`;
export const TITLES = { items: ["Tea, slowly", "Why engineers drink tea", "The tea break"], recommended: 1 };

function builtinFiles(): { yaml: string; assets: Record<string, string> } {
  const dir = join(BUILTIN_ROOT, "wechat-article");
  const assets: Record<string, string> = {};
  for (const entry of readdirSync(join(dir, "prompts"), { withFileTypes: true })) {
    if (entry.isFile()) assets[relative(dir, join(dir, "prompts", entry.name))] = readFileSync(join(dir, "prompts", entry.name), "utf8");
  }
  return { yaml: readFileSync(join(dir, "template.yaml"), "utf8"), assets };
}

export async function wechatWorld() {
  const children = fakeChildPort();
  const commands: string[] = [];
  const w = await flowWorld({ "wechat-article": builtinFiles() }, {
    children: children.port,
    // `requires.commands` (md2wechat doctor) is a check at start; the fake machine has it.
    runCommand: async (command) => { commands.push(command); return { exitCode: 0, output: "{}" }; },
  });
  const child = (flowRunId: string, stepKey: string, seq: number) => childGroupIdOf(flowRunId, stepKey, seq);
  const goalOf = (id: string) => JSON.parse(children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
  return { w, children, commands, child, goalOf };
}

const zeroRound = {
  slug: SLUG, statement: "An article on tea for engineers.", acceptanceCriteria: [{ id: "AC1", text: "Says why tea helps." }],
  questions: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [],
  classification: { scope: "small", scopeReason: "One article.", clarity: "clear", clarityReason: "The idea says it all." },
  zeroRound: true, understanding: "A short article on tea for engineers.",
};

/** Brief → … → draft box. Returns the run id; asserts the pause crossed on the way. */
export async function toDraftBox(world: Awaited<ReturnType<typeof wechatWorld>>): Promise<string> {
  const { w, children, child, goalOf } = world;
  const { flowRunId } = await w.start({ templateRef: "builtin/wechat-article", params: { idea: "Tea for engineers" } });
  await w.advance();
  expect(w.calls[0]).toMatchObject({ purpose: "clarify" });
  await w.answer(0, zeroRound);
  const land = async (stepKey: string, seq: number, files: Record<string, string>, extra = {}) => {
    children.land(child(flowRunId, stepKey, seq), files, extra);
    await w.advance();
  };
  await land("outline", 1, { [`${SLUG}.outline.md`]: "# Tea\n## Why\n## How\n" });
  // approve-outline (review-after): its candidates call; the defaults (approve) let the flow go on unratified (P2).
  expect(w.calls[1]).toMatchObject({ purpose: "flow-ask", key: { stepKey: "approve-outline" } });
  await w.answer(1, { candidates: {} });
  await land("draft", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you down.\n" });
  await land("deslop", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you.\n" });
  await land("voice", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you down a bit.\n" });
  await land("finetune", 1, { [WECHAT]: wechatFile("Draft title", "Drink it.") }, { flow: { candidates: { title: TITLES } } });
  // pick-title took the recommended candidate into the frontmatter; visuals is off (illustrations false); the article
  // and its parallel cover are both out.
  expect(w.latest(flowRunId, "pick-title")).toMatchObject({ state: "done", outputKind: "commit" });
  expect(w.latest(flowRunId, "visuals")).toMatchObject({ state: "skipped" });
  expect([...children.opened.keys()]).toEqual(expect.arrayContaining([child(flowRunId, "article", 1), child(flowRunId, "cover", 1)]));
  // The article asks the person (flow.needs): only it and the steps after it wait; the cover finishes meanwhile.
  await land("article", 1, {}, { flow: { needs: { kind: "input", question: "Which source: the illustrated one or the plain one?", candidates: ["plain", "illustrated"] } } });
  expect(openAsks(w.store, flowRunId).map((a) => a.stepKey)).toEqual(["article"]);
  await land("cover", 1, { "assets/wechat/00-cover.jpg": "jpg\n", "assets/wechat/00-cover.final.txt": "assets/wechat/00-cover.jpg\n" });
  expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "done" });
  expect(w.execs(flowRunId, "to-draft-box")).toHaveLength(0);
  // The person answers; the article runs again with the answer in its prompt, then the draft box.
  await answerNeeds(w.deps, { flowRunId, stepKey: "article" }, "plain", "ann", "cli:test");
  await w.advance();
  expect(goalOf(child(flowRunId, "article", 2))).toContain("Answer: plain");
  await land("article", 2, { [`${SLUG}.wechat.html`]: "<p>Tea</p>\n" });
  expect(goalOf(child(flowRunId, "to-draft-box", 1))).toContain("assets/wechat/00-cover.final.txt");
  await land("to-draft-box", 1, {}, { flow: { effect: { remoteId: "media-1" } } });
  return flowRunId;
}

export { wechatFile };
