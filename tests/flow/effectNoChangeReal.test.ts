/**
 * Flow engine spec §9.6 and §6.2 over the real ccloop build (ORCA_CCLOOP_BIN, fbd3512 on): an effect step's side effect
 * may change no file (an upload, a WeChat draft). Session b37f7ce9's paid acceptance (progress.md `flow draft push:`)
 * found it never settled: the child's empty result has no landed commit, so no acceptance, so the driver leaves its work
 * item `blocked` (deviation D14, the dev rule), and the child port read anything short of `done` as `running` -- the
 * effect stayed `confirmed`, the reported draft id was never stored, and a retry would make a second draft.
 *
 * The agent is ccloop's fake codex in mode `reported`; it writes `answer.txt` as `42\n`, which the person's folder
 * already holds, so the attempt changes nothing, and it reports `flow.effect`.
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { listEffects, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const UPLOAD = {
  yaml: `format: orca-flow-v1
id: upload
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
effects:
  wechat-draft: {class: external}
steps:
  - {id: upload, kind: work, role: writer, prompt: prompts/upload.md, effect: wechat-draft}
`,
  assets: { "prompts/upload.md": "Upload answer.txt as a draft.\n" },
};

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-effect-noop-", epochPrefix: "epoch-effect-noop-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("an effect step that changes no file, through the real ccloop and driver (§9.6)", { timeout: 300_000 }, () => {
  relocateHome("orca-effect-noop-home-");

  it("settles: the effect is applied with the reported remote id, the output is no files, the composition stays", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-effect-noop-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    // The person's folder already holds what the agent writes: the attempt is empty.
    const f = await flowRunWorld(w, { templates: { upload: UPLOAD }, folder: { "answer.txt": "42\n" }, flow: { effect: { remoteId: "draft-7" } } });
    const { runtime, flowRunId } = await f.start("builtin/upload");
    try {
      runtime.startPump(50);
      const child = childGroupIdOf(flowRunId, "upload", 1);
      const childRun = () => {
        const row = runtime.store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid DESC LIMIT 1").get(child);
        return row === undefined ? null : JSON.parse(String(row.body)) as { state: string; drive?: { outcome?: string | null; landedCommit?: string | null } };
      };
      await until(() => childRun()?.state === "settled", 180_000, "the child's run to settle", 100);
      // The driver's rule is untouched: the empty result has no landing, so the child's own work item is blocked.
      expect(childRun()!.drive).toMatchObject({ outcome: "succeeded", landedCommit: null });
      expect(JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id=?").get(child)!.body)).status).toBe("blocked");
      // Before the fix the execution stayed `running` here for good (13 minutes observed in the acceptance).
      await until(() => listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "upload")?.state !== "running", 30_000, "the step to settle", 100);
      const upload = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "upload")!;
      expect(upload.state).toBe("done");
      const [effect] = listEffects(runtime.store, flowRunId);
      expect([effect!.state, effect!.remoteRef]).toEqual(["applied", "draft-7"]);
      expect((upload.body as { flags?: string[] }).flags).toContain("effect-applied");
      expect((upload.body as { reported?: unknown }).reported).toEqual({ effect: { remoteId: "draft-7" } });
      // No files: the output is the execution's record, never a workspace commit, so the composition does not move.
      expect(upload.outputKind).toBe("artifact");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
