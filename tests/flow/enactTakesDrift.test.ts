import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { enactEffect } from "../../src/flow/effects.js";
import { loadRun, resumeExecution, vaultOf } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, getHead, listEffects } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §5.4, §9.2 (T18 enact, finding A): what the person changed in their folder is taken before ANY
 * execution starts -- also one that starts because the person enacted a staged effect (or confirmed a card). In the
 * acceptance run the person replaced the cover with a PNG and pointed `00-cover.final.txt` at it, then enacted the
 * staged draft-box record: the child started from the vault head without the edit, uploaded the old SVG and failed.
 * The edit must reach the step's workspace; and since it moves what the record was staged on, the record is not
 * enacted as it stands -- a new one is staged with the difference shown (§9.2), and enacting that one runs the step on
 * the person's cover.
 */
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: cover, kind: work, prompt: cover.md}
  - {id: upload, kind: work, prompt: upload.md, effect: wechat-draft}
`, assets: { "cover.md": "Cover.\n", "upload.md": "Upload.\n" } } };

describe("enacting a staged effect takes the person's drift first (§5.4, T18 finding A)", () => {
  it("a folder edit made after staging reaches the enacted step's workspace", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(TPL, { children: children.port }); try {
      w.store.transaction(() => writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects: { external: "stage-only" } } }, orchestrationRevision(w.store) + 1));
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "cover", 1), { "cover.final.txt": "cover.svg\n" });
      await w.advance();
      expect(w.latest(flowRunId, "upload")!.state).toBe("staged");
      const [staged] = listEffects(w.store, flowRunId);

      // The person replaces the cover in their folder, after the record was staged.
      writeFileSync(join(w.folder, "cover.final.txt"), "cover.png\n");
      const first = await enactEffect(w.deps, staged!.id, "ann", "cli:test");
      // The edit is the cover step's new active output (by the person, via fs) ...
      expect(w.latest(flowRunId, "cover")).toMatchObject({ seq: 2, state: "done", by: "ann", via: "fs", reasons: ["edit"] });
      expect(getHead(w.store, flowRunId, "cover")).toBe(2);
      // ... so the record staged on the old cover is not enacted: a new one is staged in its place.
      expect(first).toMatchObject({ state: "restaged", replaces: staged!.id });
      expect(children.opened.has(childGroupIdOf(flowRunId, "upload", 1))).toBe(false);

      const second = await enactEffect(w.deps, (first as { recordId: string }).recordId, "ann", "cli:test");
      expect(second).toEqual({ state: "running", recordId: (first as { recordId: string }).recordId });
      const opened = children.opened.get(childGroupIdOf(flowRunId, "upload", 1))!;
      const vault = vaultOf(loadRun(w.store, flowRunId))!;
      const atBase = execFileSync("/usr/bin/git", ["--git-dir", vault.path, "show", `${opened.baseCommit}:cover.final.txt`], { encoding: "utf8" });
      expect(atBase).toBe("cover.png\n");
      // It ran on the person's cover: once it lands the run is done -- the step is not run a second time.
      children.land(childGroupIdOf(flowRunId, "upload", 1), { "sent.json": "{}" }, { flow: { effect: { remoteId: "media-1" } } });
      await w.advance();
      expect(w.execs(flowRunId, "upload").map((e) => [e.seq, e.state])).toEqual([[1, "done"]]);
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
      expect(children.counts().dispatches).toBe(2);
    } finally { await w.dispose(); }
  });

  // The other way an execution starts outside a pass: a step parked on an exhausted pool resumes when the pool is raised.
  it("a parked execution that resumes takes the person's drift first and runs once on it", async () => {
    const children = fakeChildPort();
    const POOL = { p: { yaml: `format: orca-flow-v1
id: p
workspace: {kind: dir}
budget: {tokensPerRun: 100000}
steps:
  - {id: write, kind: work, prompt: write.md, budget: {tokens: 60000}}
  - {id: polish, kind: work, prompt: polish.md, budget: {tokens: 60000}}
`, assets: { "write.md": "Write.\n", "polish.md": "Polish.\n" } } };
    const w = await flowWorld(POOL, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/p" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), { "article.md": "draft\n" }, { spentTokens: 60_000 });
      await w.advance();
      const parked = w.latest(flowRunId, "polish")!;
      expect(parked).toMatchObject({ state: "parked", childGroupId: null });
      writeFileSync(join(w.folder, "article.md"), "mine\n");
      w.store.db.prepare("UPDATE flow_runs SET pool_tokens=pool_tokens+100000 WHERE id=?").run(flowRunId);
      const { needsYou: _parked, ...rest } = parked.body as Record<string, unknown>;
      await resumeExecution(w.deps, loadRun(w.store, flowRunId), { ...parked, body: rest as never });
      expect(w.latest(flowRunId, "write")).toMatchObject({ seq: 2, by: "ann", via: "fs", reasons: ["edit"] });
      const opened = children.opened.get(childGroupIdOf(flowRunId, "polish", 1))!;
      const vault = vaultOf(loadRun(w.store, flowRunId))!;
      expect(execFileSync("/usr/bin/git", ["--git-dir", vault.path, "show", `${opened.baseCommit}:article.md`], { encoding: "utf8" })).toBe("mine\n");
      children.land(childGroupIdOf(flowRunId, "polish", 1), { "article.md": "polished\n" });
      await w.advance();
      expect(w.execs(flowRunId, "polish").map((e) => [e.seq, e.state])).toEqual([[1, "done"]]);
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
    } finally { await w.dispose(); }
  });
});
