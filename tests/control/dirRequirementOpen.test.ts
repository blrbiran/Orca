/**
 * Dir-requirements spec §5.1, criterion D1 (plan Task 2): requirement-open on a `dir` project records the folder it was
 * opened on, frozen, at the top of the group body -- `dirWorkspace = { dir, vaultId }`, the folder's real path as
 * `openVault` resolves it (NFC) and that path's vault key -- so the group names the very vault a flow run on that folder
 * names, whatever spelling the project gave (a symlink, a decomposed or composed name, another letter case). Open writes
 * nothing outside the control DB: no vault exists afterwards. A repository project's group carries no such field.
 *
 * Rule 17: HOME and ORCA_VAULT_DIR are temporary directories in process.env too, so not even a wrong default could
 * create a vault under the real ~/.orca.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, symlinkSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dirWorkspaceOf } from "../../src/control/dirGroup.js";
import { WebControlService } from "../../src/control/webService.js";
import { vaultPathFor } from "../../src/flow/vault/paths.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";

/** Whether this machine's temporary directory is on a case-insensitive file system (macOS's default). */
function caseInsensitiveTmp(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "orca-case-"));
  try {
    mkdirSync(join(probe, "Aa"));
    try { return existsSync(join(probe, "aA")); } finally { rmdirSync(join(probe, "Aa")); }
  } finally { rmdirSync(probe); }
}
const CASE_INSENSITIVE = caseInsensitiveTmp();
// Rule 12: a skipped case is said out loud.
if (!CASE_INSENSITIVE) console.log("dirRequirementOpen: the letter-case case is skipped: this file system is case-sensitive");

afterEach(() => { vi.unstubAllEnvs(); });

async function world() {
  const x = await requirementHarness({ answers: [], startAt: "none" });
  const env: NodeJS.ProcessEnv = { HOME: join(x.root, "home"), ORCA_VAULT_DIR: join(x.root, "vaults") };
  mkdirSync(env.HOME!, { mode: 0o700 });
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value!);
  // A folder whose name is stored decomposed (NFD): its real path is not NFC as the file system returns it.
  const folder = join(x.root, `Pos${"té".normalize("NFD")}s`);
  mkdirSync(folder);
  let given: string | null = folder, n = 0;
  const service = new WebControlService({ ...x.service.deps, dirProjectOf: (repoId: string) => (repoId === "repo" && given !== null ? { path: given } : null) });
  /** Opens a requirement with the dir project registered at `path` (null: "repo" is a repository project); answers the group body. */
  const openAt = async (path: string | null): Promise<Record<string, unknown>> => {
    given = path;
    const groupId = `g${++n}`;
    const answer = await service.openRequirement({ schema: "orca-raw-command-v1", commandId: `open-${groupId}`, actorId: "human", expectedRevision: 0, verb: "requirement-open",
      target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", idea: "Let people export their notes as Markdown." } } as never);
    expect(answer).toMatchObject({ result: { kind: "requirement-opened", groupId } });
    return JSON.parse(String(x.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  };
  /** The vault id a flow run on `dir` gets: the name of the vault `openVault` would open for it. */
  const flowVaultId = async (dir: string): Promise<string> => basename(await vaultPathFor(env, dir), ".git");
  return { ...x, env, folder, openAt, flowVaultId };
}

describe("requirement-open on a dir project records the dir workspace (D1)", () => {
  it("through a symlink: the real path, NFC, and the vault id a flow run on the folder gets, at the top of the body", async () => {
    const w = await world(); try {
      const link = join(w.root, "link-to-posts");
      symlinkSync(w.folder, link);
      const body = await w.openAt(link);
      const real = (await realpath(w.folder)).normalize("NFC");
      expect(real).not.toBe(await realpath(w.folder)); // the fixture is meaningful: the stored name is decomposed
      expect(body.dirWorkspace).toEqual({ dir: real, vaultId: await w.flowVaultId(w.folder) });
      expect((body.requirement as Record<string, unknown>).dirWorkspace).toBeUndefined();
      expect((body.requirement as Record<string, unknown>).repoId).toBe("repo");
    } finally { await w.dispose(); }
  });

  it("the name given decomposed and composed: one vault id and one NFC dir", async () => {
    const w = await world(); try {
      const decomposed = w.folder, composed = w.folder.normalize("NFC");
      const a = await w.openAt(decomposed);
      expect(a.dirWorkspace).toEqual({ dir: (await realpath(w.folder)).normalize("NFC"), vaultId: await w.flowVaultId(w.folder) });
      if (existsSync(composed)) {
        const b = await w.openAt(composed);
        expect(b.dirWorkspace).toEqual(a.dirWorkspace);
      } else console.log("dirRequirementOpen: the composed spelling does not name the folder on this file system; only the decomposed one is opened");
    } finally { await w.dispose(); }
  });

  it.skipIf(!CASE_INSENSITIVE)("the folder given in another letter case names the vault a flow run on the folder names", async () => {
    const w = await world(); try {
      const other = join(w.root, basename(w.folder).toUpperCase());
      expect(existsSync(other)).toBe(true);
      expect(realpathSync(other)).not.toBe(realpathSync.native(other)); // the spelling given is not the stored one
      const body = await w.openAt(other);
      expect(body.dirWorkspace).toEqual({ dir: (await realpath(w.folder)).normalize("NFC"), vaultId: await w.flowVaultId(w.folder) });
    } finally { await w.dispose(); }
  });

  it("a dir project whose folder is gone is refused dir-folder-missing, booked, and no group exists", async () => {
    const w = await world(); try {
      const service = new WebControlService({ ...w.service.deps, dirProjectOf: () => ({ path: join(w.root, "gone") }) });
      const answer = await service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open-gone", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "gone" }, payload: { groupId: "gone", repoId: "repo", idea: "x" } } as never);
      expect(answer).toMatchObject({ error: { code: "dir-folder-missing" } });
      expect(w.store.db.prepare("SELECT id FROM groups WHERE id='gone'").get()).toBeUndefined();
    } finally { await w.dispose(); }
  });

  it("a body whose dirWorkspace is malformed is loud, never read as a repository group", () => {
    expect(dirWorkspaceOf({})).toBe(null);
    expect(dirWorkspaceOf({ dirWorkspace: { dir: "/x", vaultId: "a".repeat(64) } })).toEqual({ dir: "/x", vaultId: "a".repeat(64) });
    for (const field of [null, {}, { dir: "/x" }, { dir: "/x", vaultId: "not-a-key" }, { dir: "", vaultId: "a".repeat(64) }]) {
      expect(() => dirWorkspaceOf({ dirWorkspace: field }), JSON.stringify(field)).toThrow(/dir-workspace-invalid/);
    }
  });

  it("a repository project's group has no dirWorkspace; no vault directory exists after any open", async () => {
    const w = await world(); try {
      const repo = await w.openAt(null);
      expect(repo).not.toHaveProperty("dirWorkspace");
      await w.openAt(w.folder);
      expect(existsSync(w.env.ORCA_VAULT_DIR!)).toBe(false);
      expect(existsSync(join(w.env.HOME!, ".orca"))).toBe(false);
    } finally { await w.dispose(); }
  });
});
