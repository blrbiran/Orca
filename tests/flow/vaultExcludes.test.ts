/**
 * Flow engine spec §5.2 (review finding I5): one vault per folder, shared by every run on it. A template's
 * `workspace.excludes` belong to its run: they are applied to that run's snapshots (import and drift), never written to the
 * vault's shared `info/exclude` -- otherwise each start rewrote it for every other run on the folder, and a run whose
 * excludes were dropped by a later start would read its excluded files as the person's drift.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRun, vaultOf } from "../../src/flow/kernel.js";
import { getFlowRun, listMessages } from "../../src/flow/store.js";
import { DEFAULT_EXCLUDES, vaultGit } from "../../src/flow/vault/vault.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const step = "steps:\n  - {id: write, kind: work, prompt: p.md}\n";
const TEMPLATES = {
  private: { yaml: `format: orca-flow-v1\nid: private\nworkspace: {kind: dir, excludes: [secret/]}\n${step}`, assets: { "p.md": "Write.\n" } },
  open: { yaml: `format: orca-flow-v1\nid: open\nworkspace: {kind: dir}\n${step}`, assets: { "p.md": "Write.\n" } },
};

describe("a template's excludes are its run's, not the shared vault's (I5)", () => {
  it("a later start on the same folder leaves the shared exclude file and the earlier run's excludes alone", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(TEMPLATES, { children: children.port, files: { "a.md": "a\n", "secret/key.txt": "k\n" } }); try {
      const a = await w.start({ templateRef: "builtin/private" });
      const vault = vaultOf(loadRun(w.store, a.flowRunId))!;
      const exclude = () => readFileSync(join(vault.path, "info", "exclude"), "utf8");
      expect(exclude()).toBe(DEFAULT_EXCLUDES.map((line) => `${line}\n`).join(""));
      const importOf = (id: string) => (getFlowRun(w.store, id)!.body as { importCommit: string }).importCommit;
      const files = async (commit: string) => (await vaultGit(vault, ["ls-tree", "-r", "--name-only", commit])).trim().split("\n");
      expect(await files(importOf(a.flowRunId))).toEqual(["a.md"]);
      const b = await w.start({ templateRef: "builtin/open" });
      expect(await files(importOf(b.flowRunId))).toEqual(["a.md", "secret/key.txt"]);
      expect(exclude()).toBe(DEFAULT_EXCLUDES.map((line) => `${line}\n`).join(""));
      // The person adds another secret: still nothing of the first run's (no drift, its import unchanged).
      mkdirSync(join(w.folder, "secret"), { recursive: true });
      writeFileSync(join(w.folder, "secret", "more.txt"), "m\n");
      const before = importOf(a.flowRunId);
      await w.advance();
      expect(importOf(a.flowRunId)).toBe(before);
      expect(listMessages(w.store, a.flowRunId).filter((m) => m.via === "fs")).toEqual([]);
    } finally { await w.dispose(); }
  });
});
