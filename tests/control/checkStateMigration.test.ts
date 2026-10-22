import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateIntegrationMeta } from "../../src/control/checks/migrate.js";
import { readCheckState } from "../../src/control/checks/state.js";
import type { Trigger } from "../../src/control/checks/trigger.js";
import { gitChild } from "../../src/control/integrationGit.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { readIntegrationCheckSetting } from "../../src/control/integrationCheck.js";
import { orchestrationRevision, readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { WebControlService } from "../../src/control/webService.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { checksWorld, g } from "./fixtures/checksWorld.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Checks spec 2026-10-22 §4.1 "Migration (no aliases, P1)" and §5.1: schema 16 creates the empty `check_state` table and
 * moves each repository's `integrationCheck {enabled, command}` to `checks.integrationCheck` with the identical meaning,
 * removing the old field. A person who switched the integration check on with a custom command must find it on, with
 * that command, after the upgrade — and every other row untouched. Temp stores only (Rule 17).
 */
const TABLES = ["groups", "runs", "usage_ledger", "activity", "pending_decisions", "flagged_decisions", "group_orchestration", "group_edges", "orchestration_settings", "meta"];

async function v15Store(bodies: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "s16-")), dir = join(root, "s");
  const store = await openControlStore({ stateDir: dir });
  store.transaction(() => {
    store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',3,1,?)").run('{"groupId":"g"}');
    for (const [repoId, body] of Object.entries(bodies)) store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES (?,?)").run(repoId, body);
  });
  store.close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  raw.exec("DROP TABLE check_state");
  raw.prepare("UPDATE meta SET value='15' WHERE key='schemaVersion'").run();
  const before = TABLES.map((t) => t === "meta" ? raw.prepare("SELECT * FROM meta WHERE key<>'schemaVersion'").all() : raw.prepare(`SELECT * FROM ${t}`).all());
  raw.close();
  return { root, dir, before };
}

describe("schema 16", () => {
  it("a fresh store opens at the current version (17 since the flow journal step) with an empty check_state table", async () => {
    const root = await mkdtemp(join(tmpdir(), "s16f-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      expect(schemaVersion).toBe("17");
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("17");
      expect(store.db.prepare("SELECT count(*) AS n FROM check_state").get()!.n).toBe(0);
      expect(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='check_state'").get()!.sql).toContain("PRIMARY KEY(repo_id, kind, target)");
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("moves integrationCheck to checks.integrationCheck with the identical meaning, revision and other fields unchanged", async () => {
    const { root, dir, before } = await v15Store({
      on: '{"criteriaReview":false,"integrationCheck":{"command":"npm ci && npm test","enabled":true},"revision":4,"workspaceMode":"clone"}',
      off: '{"integrationCheck":{"command":null,"enabled":false},"revision":2,"workspaceMode":"worktree"}',
      none: '{"revision":1,"workspaceMode":"worktree"}',
    });
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("17");
      const raw = (repoId: string) => String(store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId)!.body);
      // Canonical bytes: sorted keys, no old field.
      expect(raw("on")).toBe('{"checks":{"integrationCheck":{"command":"npm ci && npm test","enabled":true}},"criteriaReview":false,"revision":4,"workspaceMode":"clone"}');
      expect(raw("off")).toBe('{"checks":{"integrationCheck":{"command":null,"enabled":false}},"revision":2,"workspaceMode":"worktree"}');
      expect(raw("none")).toBe('{"revision":1,"workspaceMode":"worktree"}');
      // The reader sees the same effective setting as before the upgrade.
      expect(readIntegrationCheckSetting(store, "on")).toEqual({ enabled: true, command: "npm ci && npm test" });
      expect(readIntegrationCheckSetting(store, "off")).toEqual({ enabled: false, command: null });
      expect(readIntegrationCheckSetting(store, "none")).toEqual({ enabled: false, command: null });
      expect(readRepositorySettingsBody(store, "on")).not.toHaveProperty("integrationCheck");
      // Every other table byte-identical; check_state created empty.
      expect(TABLES.map((t) => t === "meta" ? store.db.prepare("SELECT * FROM meta WHERE key<>'schemaVersion'").all() : store.db.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);
      expect(store.db.prepare("SELECT count(*) AS n FROM check_state").get()!.n).toBe(0);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("refuses a stored body that still carries the old field (strict body: no alias)", async () => {
    const root = await mkdtemp(join(tmpdir(), "s16s-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES ('r',?)").run('{"integrationCheck":{"command":null,"enabled":true},"revision":1,"workspaceMode":"worktree"}');
      expect(() => readRepositorySettingsBody(store, "r")).toThrow("repository-settings-invalid");
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("keeps the other check settings when the older verbs write the same bodies", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
    try {
      const service = new WebControlService({ ...h.deps, knownRepository: (repoId: string) => repoId === "repo" });
      const trigger: Trigger = { all: [{ any: [{ kind: "landed-groups", min: 3 }] }] };
      const globalChecks = { modelReview: { enabled: false, budgetTokens: 500_000 }, locks: ["modelReview.budgetTokens" as const] };
      h.store.transaction(() => {
        writeOrchestrationSettings(h.store, { maxRunningGroups: 3, checks: globalChecks }, 1);
        writeRepositorySettingsBody(h.store, "repo", { workspaceMode: "worktree", revision: 1, checks: { integrationCheck: { trigger }, modelReview: { maxGroupsPerReview: 4 } } });
      });
      // set-orchestration-settings changes the cap; the global check settings stay as stored.
      expect(service.setOrchestrationSettings(h.rawCommand("cap", orchestrationRevision(h.store), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups: 5 }) as never)).toMatchObject({ result: { kind: "orchestration-settings-set" } });
      expect(readOrchestrationSettings(h.store)).toEqual({ maxRunningGroups: 5, checks: globalChecks });
      // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): set-check-settings (which replaced the removed setter, spec §4.4)
      // writes enabled/command and keeps the project's trigger and other kinds.
      expect(service.setCheckSettings(h.rawCommand("ic", 1, "set-check-settings", { kind: "repository", repoId: "repo" }, { kind: "integration-check", set: { enabled: true, command: "npm test" }, clear: [] }) as never)).toMatchObject({ result: { kind: "check-settings-set" } });
      expect(readRepositorySettingsBody(h.store, "repo")?.checks).toEqual({ integrationCheck: { trigger, enabled: true, command: "npm test" }, modelReview: { maxGroupsPerReview: 4 } });
    } finally { await h.dispose(); }
  });
});

/**
 * Checks spec §5.1, criterion 6 (lazy part): the integration check's pre-16 `meta` row is converted by code at the
 * pump's first evaluation of the repository -- never earlier -- into a watermark that skips no landed-but-unchecked
 * group. Written with the `meta` row's deletion in one transaction: a crash before the commit leaves the old row.
 */
describe("lazy conversion of the integration check's meta row", () => {
  const meta = (covered: Record<string, string>, last: unknown = null) => JSON.stringify({ lastAt: 1_000, covered, last });
  const seed = (w: Awaited<ReturnType<typeof checksWorld>>, value: string) => w.h.store.db.prepare("INSERT INTO meta(key,value) VALUES ('integration-check:repo',?)").run(value);
  const metaRow = (w: Awaited<ReturnType<typeof checksWorld>>) => w.h.store.db.prepare("SELECT value FROM meta WHERE key='integration-check:repo'").get();
  const state = (w: Awaited<ReturnType<typeof checksWorld>>) => readCheckState(w.h.store, "repo", "integration-check", "main");

  it("all covered ⇒ W = the newest covered commit (not the last check's commit); the row is converted only by the pass", async () => {
    const w = await checksWorld(); try {
      const c1 = await w.commitLand("g1", { "a.txt": "1\n" });
      const c2 = await w.commitLand("g2", { "b.txt": "2\n" });
      await w.commitLand("other", { "o.txt": "o\n" }); // a group that is not Orca's last... landed later but covered too
      const c3 = g(w.repo, "rev-parse", "main");
      // The old state's last check ran at c1 (an older commit than the newest covered one).
      seed(w, meta({ g1: c1, g2: c2, other: c3 }, { state: "passed", at: 900, commit: c1, groups: ["g1", "g2"], detail: null, debugGroupId: null }));
      expect(state(w)).toBeNull();
      expect(metaRow(w)).toBeDefined(); // nothing converts it before the pump's evaluation
      await w.pass();
      expect(metaRow(w)).toBeUndefined();
      expect(state(w)).toMatchObject({ watermark: c3, lastStartAt: 1_000, last: { state: "passed", to: c1, groups: ["g1", "g2"] } });
    } finally { await w.h.dispose(); }
  });

  it("one landed-but-uncovered group between covered ones ⇒ W = the first parent of its commit; the later covered one is re-covered", async () => {
    const w = await checksWorld(); try {
      const c1 = await w.commitLand("g1", { "a.txt": "1\n" });
      const c2 = await w.commitLand("g2", { "b.txt": "2\n" }); // uncovered
      const c3 = await w.commitLand("g3", { "c.txt": "3\n" });
      seed(w, meta({ g1: c1, g3: c3 }));
      await w.pass();
      expect(state(w)).toMatchObject({ watermark: g(w.repo, "rev-parse", `${c2}^1`), last: { detail: "migrated: re-covers 1 groups" } });
      expect(state(w)!.watermark).toBe(c1);
    } finally { await w.h.dispose(); }
  });

  it("no landed group ⇒ W unset (the first-evaluation rule then sets it)", async () => {
    const w = await checksWorld(); try {
      seed(w, meta({}));
      await w.service.checksPass();
      expect(metaRow(w)).toBeUndefined();
      // Nothing landed, no target known: no state row at all.
      expect(state(w)).toBeNull();
    } finally { await w.h.dispose(); }
  });

  it("an unreadable target keeps the meta row: the conversion is retried once the target reads, and no group is skipped", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      const c1 = await w.commitLand("g1", { "a.txt": "1\n" });
      await w.commitLand("g2", { "b.txt": "2\n" }); // uncovered
      seed(w, meta({ g1: c1 }));
      g(w.repo, "branch", "-m", "main", "gone");
      await w.pass();
      expect(metaRow(w)).toBeDefined();
      // The pass's own evaluation records the unreadable target, without a watermark.
      expect(state(w)).toMatchObject({ watermark: null, last: { state: "errored", detail: "target unreadable: main" } });
      g(w.repo, "branch", "-m", "gone", "main");
      await w.pass();
      expect(metaRow(w)).toBeUndefined();
      // Not the head (that would skip g2): the conversion's watermark, before g2.
      expect(state(w)).toMatchObject({ watermark: c1, last: { detail: "migrated: re-covers 0 groups" } });
    } finally { await w.h.dispose(); }
  });

  it("a landed group off the target's first-parent history is named in the record, not dropped silently", async () => {
    const w = await checksWorld(); try {
      const c1 = await w.commitLand("g1", { "a.txt": "1\n" });
      // A side branch's own commit is the group's integrated commit; a merge (not a group) brings it into main.
      g(w.repo, "checkout", "-q", "-b", "side");
      await writeFile(join(w.repo, "s.txt"), "s\n");
      g(w.repo, "add", "s.txt"); g(w.repo, "commit", "-qm", "side");
      const side = g(w.repo, "rev-parse", "side");
      g(w.repo, "checkout", "-q", "main"); g(w.repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
      w.land("side", side);
      seed(w, meta({ g1: c1 }));
      await w.service.checksPass();
      expect(metaRow(w)).toBeUndefined();
      expect(state(w)).toMatchObject({ watermark: c1, last: { state: "migrated", detail: "off first-parent history: side" } });
    } finally { await w.h.dispose(); }
  });

  it("a crash before the commit leaves the meta row and writes no state", async () => {
    const w = await checksWorld(); try {
      const c1 = await w.commitLand("g1", { "a.txt": "1\n" });
      seed(w, meta({ g1: c1 }));
      await expect(migrateIntegrationMeta(w.h.store, gitChild, w.repo, "repo", { beforeCommit: () => { throw new Error("injected crash"); } })).rejects.toThrow("injected crash");
      expect(metaRow(w)).toBeDefined();
      expect(state(w)).toBeNull();
      expect(await migrateIntegrationMeta(w.h.store, gitChild, w.repo, "repo")).toBe(true);
      expect(metaRow(w)).toBeUndefined();
      expect(state(w)!.watermark).toBe(c1);
    } finally { await w.h.dispose(); }
  });
});
