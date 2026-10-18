import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectKeyOf } from "../../src/corrections/projectKey.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { ORIGINAL, makeTargetRepo } from "../corrections/harness.js";
import { sessionFor } from "./fixtures/auth.js";

/**
 * Debug task plan Task 6 (withdraw Amendment 2), through the shipped panel: a correction recorded on the panel, its
 * debug group opened through the control route, then the correction withdrawn -- the unstarted group is archived and
 * the withdraw answer names it. ORCA_CONTROL_DIR and ORCA_CORRECTIONS_DIR are temp directories (Rule 17).
 */
describe("withdrawing a correction archives its unstarted debug group", { timeout: 60_000 }, () => {
  it("archives the open debug group and says so beside the withdrawal", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-withdraw-debug-")));
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const corrections = join(root, "corrections");
      await mkdir(corrections, { mode: 0o700 });
      const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
      const projectKey = await projectKeyOf(repo.path);
      const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--repo", `${projectKey}=${repo.path}`], env), env);
      try {
        const session = await sessionFor(panel, env);
        const post = async (path: string, body: unknown) => {
          const response = await session.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          return { status: response.status, body: await response.json() as Record<string, unknown> };
        };
        const recorded = await post("/api/corrections", { projectKey, decisionId: ORIGINAL.id, kind: "wrong", because: "the premise was false" });
        expect(recorded.status).toBe(200);
        const cid = (recorded.body.correction as { id: string }).id;
        const opened = await post(`/api/control/corrections/${cid}/debug-group`, { commandId: "open-1", expectedRevision: 0, payload: { correctionId: cid } });
        expect([opened.status, opened.body.result]).toEqual([201, { kind: "debug-group-opened", groupId: `debug-${cid}`, correctionId: cid, created: true }]);

        const withdrawn = await post("/api/corrections/withdraw", { correctionId: cid });
        expect(withdrawn.status).toBe(200);
        expect(withdrawn.body.debugGroups).toEqual([{ groupId: `debug-${cid}`, state: "archived" }]);
        expect((withdrawn.body.withdrawal as { correctionId: string }).correctionId).toBe(cid);
        const group = await session.fetch(`/api/control/groups/debug-${cid}`);
        expect(((await group.json()) as { summary: { archived: boolean } }).summary.archived).toBe(true);
      } finally { await panel.close(); }
    } finally {
      await repo.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });
});
