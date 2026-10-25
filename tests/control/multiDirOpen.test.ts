/**
 * Multi-directory projects spec §5.2-§5.3, criterion M4: requirement-open on a multi-dir project freezes the registered
 * list at the top of the group body -- `multiDir = { project, dirs: [{ key, repoId, kind, dirWorkspace? }], landing: null }`
 * -- in registered order, with each member's real path (a `dir` member's frozen workspace too), and no `dirWorkspace` of
 * the single-folder shape. The frozen copy does not alias the registry, so a later edit cannot change an open group.
 * Open writes nothing outside the control DB: no vault and nothing under HOME.
 */
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupRepoId } from "../../src/control/dirGroup.js";
import { dirTargetRepoId, createMultiDirProjects, multiDirOf, multiPrimaryRepoId } from "../../src/control/multiGroup.js";
import { WebControlService } from "../../src/control/webService.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";

afterEach(() => { vi.unstubAllEnvs(); });

const thrownCode = (fn: () => unknown): unknown => {
  try { fn(); return null; } catch (error) { return (error as { code?: unknown }).code; }
};

async function world() {
  const x = await requirementHarness({ answers: [], startAt: "none" });
  const env: NodeJS.ProcessEnv = { HOME: join(x.root, "home"), ORCA_VAULT_DIR: join(x.root, "vaults") };
  mkdirSync(env.HOME!, { mode: 0o700 });
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!);
  const alpha = join(x.root, "alpha"), posts = join(x.root, "posts");
  mkdirSync(alpha); mkdirSync(posts);
  // Reached through a symlink: what is frozen is the real path, as a flow run on the folder would resolve it.
  const link = join(x.root, "posts-link");
  symlinkSync(posts, link);
  const dirs = [
    { key: "posts", repoId: controlRepoKey("posts"), kind: "dir" as const, path: link },
    { key: "alpha", repoId: controlRepoKey("alpha"), kind: "repo" as const, path: alpha },
  ];
  const service = new WebControlService({ ...x.service.deps, dirProjectOf: () => null,
    multiDirProjectOf: (repoId: string) => (repoId === "repo" ? { dirs } : null) });
  /** Opens requirement `groupId` on the multi id "repo" and answers the stored group body. */
  const open = async (groupId: string): Promise<Record<string, unknown>> => {
    const answer = await service.openRequirement({ schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0,
      verb: "requirement-open", target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown." } } as never);
    expect(answer).toMatchObject({ result: { kind: "requirement-opened", groupId } });
    return JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  };
  return { ...x, env, dirs, posts, link, open, bodyOf: (groupId: string) =>
    JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown> };
}

describe("requirement-open on a multi-dir project freezes the member list (M4, §5.2-§5.3)", () => {
  it("at the body's top level, in registered order, with realpaths and a dir member's frozen workspace", async () => {
    const w = await world(); try {
      const body = await w.open("m1");
      const realPosts = realpathSync(w.link).normalize("NFC");
      expect(body.multiDir).toEqual({
        project: "repo",
        dirs: [
          { key: "posts", repoId: controlRepoKey("posts"), kind: "dir", dirWorkspace: { dir: realPosts, vaultId: vaultKeyOf(realPosts) } },
          { key: "alpha", repoId: controlRepoKey("alpha"), kind: "repo" },
        ],
        landing: null,
      });
      expect(body).not.toHaveProperty("dirWorkspace");
      expect((body.requirement as Record<string, unknown>).repoId).toBe("repo");
      // Target resolution (§5.3): a repo member is its repo id, a dir member its folder's vault, and the primary is dirs[0].
      expect(dirTargetRepoId(w.store, "m1", "alpha")).toBe(controlRepoKey("alpha"));
      expect(dirTargetRepoId(w.store, "m1", "posts")).toBe(flowVaultRepoId(vaultKeyOf(realPosts)));
      expect(multiPrimaryRepoId(w.store, "m1")).toBe(flowVaultRepoId(vaultKeyOf(realPosts)));
      expect(thrownCode(() => dirTargetRepoId(w.store, "m1", "nope"))).toBe("multi-dir-invalid");
      expect(thrownCode(() => groupRepoId(w.store, "m1"))).toBe("multi-dir-group-no-single-repo");
    } finally { await w.dispose(); }
  });

  it("is a frozen copy: reversing or replacing the registry's list does not change the open group", async () => {
    const w = await world(); try {
      const body = await w.open("m2");
      const frozen = JSON.stringify(body.multiDir);
      w.dirs.reverse();
      w.dirs[0] = { ...w.dirs[0]!, key: "changed", path: join(w.root, "elsewhere") };
      expect(JSON.stringify(w.bodyOf("m2").multiDir)).toBe(frozen);
    } finally { await w.dispose(); }
  });

  it("writes nothing outside the control DB: no vault directory and nothing under HOME", async () => {
    const w = await world(); try {
      await w.open("m3");
      expect(existsSync(w.env.ORCA_VAULT_DIR!)).toBe(false);
      expect(existsSync(join(w.env.HOME!, ".orca"))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a member folder removed before open is refused multi-dir-invalid, booked, and no group row exists", async () => {
    const w = await world(); try {
      const gone = join(w.root, "gone");
      mkdirSync(gone); rmSync(gone, { recursive: true });
      const service = new WebControlService({ ...w.service.deps, dirProjectOf: () => null,
        multiDirProjectOf: (repoId: string) => (repoId === "repo" ? { dirs: [
          { key: "alpha", repoId: controlRepoKey("alpha"), kind: "repo" as const, path: join(w.root, "alpha") },
          { key: "gone", repoId: controlRepoKey("gone"), kind: "repo" as const, path: gone },
        ] } : null) });
      const answer = await service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open-gone", actorId: "human", expectedRevision: 0,
        verb: "requirement-open", target: { kind: "group", groupId: "gone-group" }, payload: { groupId: "gone-group", repoId: "repo", idea: "x" } } as never);
      expect((answer as { error?: { code?: string } }).error?.code).toBe("multi-dir-invalid");
      expect(w.store.db.prepare("SELECT id FROM groups WHERE id='gone-group'").get()).toBeUndefined();
    } finally { await w.dispose(); }
  });
});

describe("the multi map copies what it stores and what it answers (M4, §5.3)", () => {
  const member = (key: string): { key: string; repoId: string; kind: "repo"; path: string } => ({ key, repoId: `@${key}`, kind: "repo", path: `/${key}` });

  it("does not alias the input on add, nor a previous answer on of", () => {
    const map = createMultiDirProjects();
    const dirs = [member("a"), member("b")];
    map.add({ repoId: "multi", dirs });
    dirs.reverse();
    dirs[0] = { ...dirs[0]!, key: "changed" };
    expect(map.of("multi")!.dirs).toEqual([member("a"), member("b")]);
    const answer = map.of("multi")!;
    answer.dirs[0]!.key = "mutated";
    answer.dirs.pop();
    expect(map.of("multi")!.dirs).toEqual([member("a"), member("b")]);
  });

  it("removes an entry and replaces the list with setDirs", () => {
    const map = createMultiDirProjects();
    map.add({ repoId: "multi", dirs: [member("a"), member("b")] });
    map.setDirs("multi", [member("c"), member("d")]);
    expect(map.of("multi")!.dirs).toEqual([member("c"), member("d")]);
    map.remove("multi");
    expect(map.has("multi")).toBe(false);
    expect(map.of("multi")).toBeNull();
  });
});

describe("multiDirOf reads the frozen list and keeps landing (M4, §5.3)", () => {
  const dirs = [{ key: "a", repoId: "r1", kind: "repo" }, { key: "b", repoId: "r2", kind: "repo" }];

  it("answers a writer's landing value as-is, null when absent, and null for a body without the field", () => {
    expect(multiDirOf({ multiDir: { project: "p", dirs, landing: { state: "landed" } } })!.landing).toEqual({ state: "landed" });
    expect(multiDirOf({ multiDir: { project: "p", dirs } })!.landing).toBeNull();
    expect(multiDirOf({})).toBeNull();
  });

  it("refuses a malformed field multi-dir-invalid", () => {
    for (const malformed of [
      {},
      { project: "p", dirs: [dirs[0]] },
      { project: "p", dirs, extra: true },
      "multi",
    ]) expect(thrownCode(() => multiDirOf({ multiDir: malformed })), JSON.stringify(malformed)).toBe("multi-dir-invalid");
  });
});
