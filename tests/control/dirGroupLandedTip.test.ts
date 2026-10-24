/**
 * Dir-requirements spec §6.5 (plan Task 4): for a dir group, every write that records a move of the work branch also sets
 * `placement.landedTip` to the new tip -- D's markLanded, R's finishReconcile landed write, E's ledger-commit write --
 * so prerequisiteDone (§7) reads it with no git child. Each landing path is driven here through the driver harness's
 * synthetic ccloop, with group "g" made a dir group (its body's `dirWorkspace` and the export's placement record, its
 * work branch at the base, as the export leaves them); the harness resolves every repository id to its own repository.
 * A repository group's body gains no `placement`. Every assertion reads git or the store after the driver ran.
 */
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { initialPlacement, readPlacement } from "../../src/control/dirGroup.js";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

const BRANCH = "refs/heads/orca/g";
const LANDED = ["landed", "settled"];
const good = { question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface" };
type T = Awaited<ReturnType<typeof driverHarness>>;
const groupBody = (t: T): Record<string, unknown> => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

/** The harness's group made a dir group as the export leaves one: work branch at the base, placement idle there. */
function asDirGroup(t: T): string {
  const base = git(t.repo, "rev-parse", "main");
  git(t.repo, "update-ref", BRANCH, base, "");
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...groupBody(t),
    dirWorkspace: { dir: "/nowhere/notes", vaultId: "e".repeat(64) }, placement: initialPlacement({ base, landedTip: base, at: 1 }) }));
  return base;
}
const landedTip = (t: T): string | null => readPlacement(groupBody(t).placement)?.landedTip ?? null;

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 50)); await driver.round(); }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

describe("a dir group's landings record placement.landedTip (§6.5)", () => {
  it("D: markLanded records the landing commit; a repository group's body gets no placement", async () => {
    for (const dir of [true, false]) {
      const t = await driverHarness([{ taskId: "a" }]); try {
        const base = dir ? asDirGroup(t) : null;
        const runId = await t.claim();
        await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
        const landed = t.body(runId).drive.landedCommit as string;
        expect(git(t.repo, "rev-parse", BRANCH)).toBe(landed);
        if (dir) {
          expect(landed).not.toBe(base);
          expect(landedTip(t)).toBe(landed);
        } else expect(Object.hasOwn(groupBody(t), "placement")).toBe(false);
      } finally { await t.h.dispose(); }
    }
  }, 30_000);

  it("E: an empty result's ledger commit is recorded; with nothing to write the landed tip stays", async () => {
    for (const decisions of [true, false]) {
      const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), ...(decisions ? { decisions: () => [good] } : {}) }); try {
        const base = asDirGroup(t);
        const runId = await t.claim();
        await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
        const drive = t.body(runId).drive;
        expect(drive.landedCommit).toBe(null);
        if (decisions) {
          expect(drive.ledgerCommit).toBe(git(t.repo, "rev-parse", BRANCH));
          expect(drive.ledgerCommit).not.toBe(base);
          expect(landedTip(t)).toBe(drive.ledgerCommit);
        } else {
          expect(drive.ledgerCommit).toBe(null);
          expect(landedTip(t)).toBe(base);
        }
      } finally { await t.h.dispose(); }
    }
  }, 30_000);

  it("R: a reconciled landing's merge is recorded", async () => {
    const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
    const files: HarnessOptions["files"] = (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
    const t = await driverHarness(conflicting, { files }); try {
      asDirGroup(t);
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const ids = [await t.claim(), await t.claim()];
      await untilDeadline(t.driver(), () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const reconciled = ids.find((id) => t.body(id).drive?.reconcile != null)!;
      const merged = t.body(reconciled).drive.landedCommit as string;
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(merged);
      expect(landedTip(t)).toBe(merged);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
