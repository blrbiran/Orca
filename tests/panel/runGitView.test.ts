import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "../control/fixtures/driverHarness.js";
import { webFixture } from "../control/fixtures/web.js";

// Board spec 2026-10-03 D4: a run's view carries the git facts of its drive record -- the workspace mode it ran in, the
// work branch commit it started from, the commit that landed it -- so the panel's Git section shows what happened, not
// a fixed sentence. Every expected commit below is read from the repository with git, never from the drive record.

const viewOf = (store: Parameters<typeof readControlGroup>[0], runId: string) => readControlGroup(store, "epoch", "g").runs.find((run) => run.runId === runId)!;

describe("RunViewV1.git (board spec D4)", () => {
  it("gives a landed run's mode, the commit its work branch started from, and the commit that landed it", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const main = git(t.repo, "rev-parse", "main").trim();
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g").trim();
      expect(tip).not.toBe(main);
      expect(viewOf(t.h.store, runId).git).toEqual({ workspaceMode: "worktree", base: main, landedCommit: tip });
    } finally { await t.h.dispose(); }
  }, 30000);

  it("gives the mode the run was started in, which is the repository's setting at that time", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      t.h.store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES (?,?)")
        .run("repo", canonicalBytes({ workspaceMode: "clone", revision: 1 }).toString("utf8"));
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(viewOf(t.h.store, runId).git?.workspaceMode).toBe("clone");
    } finally { await t.h.dispose(); }
  }, 30000);

  it("gives null for a run no driver has prepared, rather than inventing a mode", async () => {
    const h = await webFixture(); try {
      const deps = { ...h.deps, now: () => new Date("2026-10-03T10:00:00.000Z") };
      const service = new WebControlService(deps);
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      await service.start(h.command("start", {}));
      const claim = await deliverScheduledStart(deps, "g");
      if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
      expect(viewOf(h.store, claim.runId).git).toBeNull();
    } finally { await h.dispose(); }
  });
});
