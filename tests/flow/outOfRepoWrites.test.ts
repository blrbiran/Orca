import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFlowRun } from "../../src/flow/store.js";
import { toDraftBox, wechatWorld } from "./fixtures/wechatWorld.js";

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

describe("out-of-repo writes (C21)", () => {
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
});
