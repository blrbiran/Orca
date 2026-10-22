/**
 * Flow engine spec §12.2 phase 1 (plan Task 10): each `work` execution injects exactly its step's skills, once, through
 * today's inject path (the driver's A2, syncskill); a lock whose resolved_commit is not the template's pinned `ref` is a
 * run-page warning, never a refusal; and the execution's definition hash uses the skills' actual content_md5, so a later
 * re-run plan sees a changed skill as a changed definition. Without these a step would run with no skills or another
 * step's, a drifted skill would pass unseen, and the planner would call two different skill versions the same step.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { definitionHash } from "../../src/flow/journal/fingerprint.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { insertFlowRun } from "../../src/flow/store.js";
import type { SyncskillOptions } from "../../src/skills/syncskill.js";
import { FIXTURE_OTHER_AGENT_ID } from "../control/fixtures/agents.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const FAKE = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

async function fakeSyncskill(): Promise<{ o: SyncskillOptions; calls: () => Promise<string[][]> }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-flow-skills-")));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, "syncskill");
  await writeFile(bin, `#!/bin/sh\nexport FAKE_SYNCSKILL_MODE=inject-ok\nexec '${process.execPath}' '${FAKE}' "$@"\n`, { mode: 0o755 });
  const log = join(dir, "calls.jsonl");
  const { readFile } = await import("node:fs/promises");
  return {
    o: { bin, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: join(dir, "home"), FAKE_SYNCSKILL_LOG: log } },
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]),
  };
}

describe("per-step skills (§12.2 phase 1)", () => {
  it("a flow child's A2 injects exactly its step's skills; a child without skills injects nothing", { timeout: 60_000 }, async () => {
    for (const skills of [["alpha", "beta"], undefined]) {
      const fake = await fakeSyncskill();
      const t = await driverHarness([{ taskId: "a", agent: { agent: FIXTURE_OTHER_AGENT_ID } }], { syncskill: fake.o });
      cleanups.push(() => t.h.dispose());
      t.h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('parent',1,1,1,?)").run(JSON.stringify({ groupId: "parent", flow: { role: "parent", flowRunId: "fr-1" } }));
      insertFlowRun(t.h.store, { id: "fr-1", groupId: "parent", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind: "dir" }, vaultId: "f".repeat(64), paramsSha256: "p", poolTokens: 1, poolDrawn: 0, state: "running", revision: 0, body: {} });
      const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, flow: { role: "child", flowRunId: "fr-1", parentGroupId: "parent", stepKey: "write", seq: 1, ...(skills === undefined ? {} : { skills }) } }));
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      const drive = t.body(runId).drive;
      if (skills === undefined) {
        expect(drive.skills).toBe(null);
        expect(await fake.calls()).toEqual([]);
      } else {
        expect((await fake.calls()).map((argv) => argv[argv.indexOf("--skills") + 1])).toEqual(["alpha,beta"]);
        expect(drive.skills.lock.map((l: { name: string; content_md5: string }) => [l.name, l.content_md5])).toEqual([["alpha", "md5-alpha"], ["beta", "md5-beta"]]);
      }
      // A2 leaves the snapshot read-only; give write back so the harness can remove it.
      const { chmodSync, readdirSync, lstatSync } = await import("node:fs");
      const restore = (path: string): void => { let s; try { s = lstatSync(path); } catch { return; } if (s.isSymbolicLink()) return; chmodSync(path, 0o700); if (s.isDirectory()) for (const e of readdirSync(path)) restore(join(path, e)); };
      cleanups.push(async () => restore(`${t.h.store.stateDir}.workspaces`));
    }
  });

  it("the step's skills reach the child; a lock off the pinned ref is a warning; the definition hash takes the actual content_md5", async () => {
    const pin = "c".repeat(40);
    const template = {
      yaml: `format: orca-flow-v1
id: s
workspace: {kind: dir}
requires:
  skills:
    - {source: src, ref: "${pin}", path: skills, skills: [alpha, beta]}
steps:
  - {id: write, kind: work, prompt: p.md, skills: [alpha, beta]}
`,
      assets: { "p.md": "Write.\n" },
    };
    const children = fakeChildPort();
    const w = await flowWorld({ s: template }, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/s" });
      await w.advance();
      const id = childGroupIdOf(flowRunId, "write", 1);
      expect(children.opened.get(id)!.skills).toEqual(["alpha", "beta"]);
      const queued = w.latest(flowRunId, "write")!.definitionHash;
      const lock = [
        { name: "alpha", source: { name: "src", type: "git", url: "u" }, resolved_commit: pin, content_md5: "md5-alpha" },
        { name: "beta", source: { name: "src", type: "git", url: "u" }, resolved_commit: "d".repeat(40), content_md5: "md5-beta" },
      ];
      children.land(id, { "a.md": "a\n" }, { skills: lock });
      await w.advance();
      const done = w.latest(flowRunId, "write")!;
      expect(done.state).toBe("done");
      expect((done.body as { warnings?: string[] }).warnings).toEqual(["skill-ref-mismatch:beta"]);
      const step = { id: "write", kind: "work", prompt: "p.md", skills: ["alpha", "beta"] };
      expect(done.definitionHash).toBe(definitionHash({
        step, promptBytes: "Write.\n", checks: [], tools: null, kindVersion: 1,
        skillLocks: [{ sourceId: "src", resolvedCommit: pin, contentMd5: "md5-alpha" }, { sourceId: "src", resolvedCommit: "d".repeat(40), contentMd5: "md5-beta" }],
      }));
      expect(done.definitionHash).not.toBe(queued);
    } finally { await w.dispose(); }
  });
});
