import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachmentPath, attachmentsDir, storeAttachment } from "../../src/flow/feedback/attachments.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { getFlowRun, getIntake, listExecutions } from "../../src/flow/store.js";
import { toDraftBox, wechatWorld, WECHAT } from "./fixtures/wechatWorld.js";
import { flowWorld } from "./fixtures/flowWorld.js";
import { vaultWorld } from "./fixtures/vaultWorld.js";
import { controlRoot } from "../../src/panel/controlOptions.js";

/**
 * Flow engine spec §20, §21 C21 (CLAUDE.md Rule 17, IR-C4): a whole flow run -- the built-in article flow from the brief
 * to the draft box -- with `HOME` set to one temporary directory and every `ORCA_*` redirect to a separate one. Nothing
 * may appear under that `HOME` afterwards: a path defaulted from `os.homedir()` at a call site (instead of through the
 * one resolver that honours the redirect) would write the person's real `~/.orca` on a real machine.
 */
let home: string;
let saved: string | undefined;
beforeEach(() => { saved = process.env.HOME; home = realpathSync(mkdtempSync(join(tmpdir(), "orca-c21-home-"))); process.env.HOME = home; });
afterEach(() => { if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved; rmSync(home, { recursive: true, force: true }); });

// A whole wechat-article run: a drift snapshot before every execution (§5.4) costs seconds under load.
describe("out-of-repo writes (C21)", { timeout: 60_000 }, () => {
  // Gaps Task 9 fix round (review I2, Rule 17): every flow world's env names its own control root (0700) -- never one
  // under a home directory -- so a test that stores an attachment or an image without setting ORCA_CONTROL_DIR cannot
  // reach the person's ~/.orca (it did once: t9-green1).
  it("a flow world's control root is its own temp directory, 0700, never under the real or the test HOME", async () => {
    for (const make of [() => flowWorld({}), async () => (await wechatWorld()).w]) {
      const w = await make();
      try {
        const root = controlRoot(w.deps.env);
        expect(root.startsWith(w.root + "/")).toBe(true);
        for (const h of [saved, homedir()]) if (h !== undefined) expect(root.startsWith(h + "/"), `${root} under ${h}`).toBe(false);
        expect(statSync(root).mode & 0o777).toBe(0o700);
      } finally { await w.dispose(); }
    }
    // Fix round 2 (re-review O1): the vault world too. (The ccloop driver world sets ORCA_CONTROL_DIR to its own root:
    // tests/control/fixtures/ccloopWorld.ts, env before `...worldOptions.env`.)
    const v = await vaultWorld();
    try {
      const root = controlRoot(v.env);
      expect(root.startsWith(v.root + "/")).toBe(true);
      for (const h of [saved, homedir()]) if (h !== undefined) expect(root.startsWith(h + "/"), `${root} under ${h}`).toBe(false);
      expect(statSync(root).mode & 0o777).toBe(0o700);
    } finally { rmSync(v.root, { recursive: true, force: true }); }
  });

  it("a whole flow run writes nothing under HOME", async () => {
    const world = await wechatWorld();
    try {
      expect(world.w.deps.env.ORCA_VAULT_DIR).toMatch(/^\/.+/);
      expect(world.w.deps.env.ORCA_VAULT_DIR!.startsWith(home)).toBe(false);
      const flowRunId = await toDraftBox(world);
      expect(getFlowRun(world.w.store, flowRunId)!.state).toBe("done");
      expect(readdirSync(home, { recursive: true })).toEqual([]);
    } finally { await world.w.dispose(); }
  });

  // Gaps spec §4.7, §16 (G14): feedback with two screenshots on a finished run. The store is under ORCA_CONTROL_DIR
  // (0700/0600), nothing lands under HOME, and no attachment reaches the attempt commit, the vault head or the folder.
  // The work agent is given each attachment's absolute store path (spec §21 entry 4, the human's choice (a)): under
  // ORCA_CONTROL_DIR, never under HOME.
  it("feedback with two attachments writes them only to the store, never under HOME, into a commit, the head or the folder", async () => {
    const world = await wechatWorld();
    const control = realpathSync(mkdtempSync(join(tmpdir(), "orca-g14-control-")));
    try {
      const { w, children } = world;
      w.deps.env.ORCA_CONTROL_DIR = control;
      const flowRunId = await toDraftBox(world);
      const ids = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 2])]
        .map((bytes) => { const s = storeAttachment(w.deps.env, bytes); return `${s.sha256}.${s.ext}`; });
      const sent = await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "run" }, body: { text: "see the screenshots", anchors: [{ quote: "It has a ritual." }], attachments: ids }, by: "ann", via: "cli:test", requestId: "g14" });
      expect(sent.state).toBe("accepted");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "finetune", why: "tone" }] });
      expect(getIntake(w.store, flowRunId, sent.seq)!.state).toBe("planned");
      await w.answer(w.calls.length - 1, { skips: [] });
      const finetune = childGroupIdOf(flowRunId, "finetune", 2);
      const goal = JSON.parse(children.opened.get(finetune)!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
      for (const id of ids) expect(goal).toContain(`- ${join(control, "flow-attachments", id)}`);
      expect(goal).not.toContain(home);
      const landed = children.land(finetune, { [WECHAT]: "---\ntitle: T\n---\n\nTea.\n" });
      await w.advance();
      expect(listExecutions(w.store, flowRunId).find((e) => e.stepKey === "finetune" && e.seq === 2)!.state).toBe("done");
      const run = getFlowRun(w.store, flowRunId)!.body as { vaultPath: string };
      const git = (...args: string[]) => execFileSync("/usr/bin/git", ["--git-dir", run.vaultPath, ...args], { encoding: "utf8" });
      const named = (listing: string) => ids.some((id) => listing.includes(id)) || listing.includes(".orca/");
      expect(named(git("ls-tree", "-r", "--name-only", landed))).toBe(false);
      expect(named(git("ls-tree", "-r", "--name-only", `refs/orca/${flowRunId}/head`))).toBe(false);
      expect(named(readdirSync(w.folder, { recursive: true }).map(String).join("\n"))).toBe(false);
      expect(readdirSync(home, { recursive: true })).toEqual([]);
      expect(statSync(attachmentsDir(w.deps.env)).mode & 0o777).toBe(0o700);
      for (const id of ids) expect(statSync(attachmentPath(w.deps.env, id)).mode & 0o777).toBe(0o600);
    } finally { rmSync(control, { recursive: true, force: true }); await world.w.dispose(); }
  });
});
