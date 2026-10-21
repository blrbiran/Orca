/**
 * Flow engine spec §5.2 and §20 (Rule 17): one vault per directory at `$ORCA_VAULT_DIR/<sha256(NFC(realpath(dir)))>.git`.
 * The env redirect is the only way a criterion reaches it, and the NFC step is what keeps one folder one vault when
 * the same name arrives composed from one tool and decomposed from another (macOS hands out both).
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vaultDir, vaultKeyOf, vaultPathFor } from "../../src/flow/vault/paths.js";

const temp = (): string => realpathSync(mkdtempSync(join(tmpdir(), "vault-paths-")));
const NFC_NAME = "café";
const NFD_NAME = "café";

describe("vault paths (flow spec §5.2, §20)", () => {
  it("V1: ORCA_VAULT_DIR wins when set; otherwise ~/.orca/vault", () => {
    expect(vaultDir({ ORCA_VAULT_DIR: "/x/vault" })).toBe("/x/vault");
    expect(vaultDir({})).toBe(join(homedir(), ".orca", "vault"));
    expect(vaultDir({ ORCA_VAULT_DIR: "" })).toBe(join(homedir(), ".orca", "vault"));
  });

  it("V2: the vault of a folder is <vaultDir>/<sha256 of its real path>.git, through a symlink too", async () => {
    const root = temp();
    const folder = join(root, "articles");
    mkdirSync(folder);
    symlinkSync(folder, join(root, "link"));
    const env = { ORCA_VAULT_DIR: join(root, "vaults") };
    const path = await vaultPathFor(env, folder);
    expect(path).toBe(join(root, "vaults", `${vaultKeyOf(folder)}.git`));
    expect(vaultKeyOf(folder)).toMatch(/^[0-9a-f]{64}$/);
    expect(await vaultPathFor(env, join(root, "link"))).toBe(path);
  });

  it("V3: a composed and a decomposed spelling of one path name one vault", () => {
    expect(NFC_NAME).not.toBe(NFD_NAME);
    expect(vaultKeyOf(`/data/${NFD_NAME}`)).toBe(vaultKeyOf(`/data/${NFC_NAME}`));
  });

  it("V4: a folder created under its decomposed name resolves to the same vault from either spelling", async () => {
    const root = temp();
    mkdirSync(join(root, NFD_NAME));
    const env = { ORCA_VAULT_DIR: join(root, "vaults") };
    const viaNfd = await vaultPathFor(env, join(root, NFD_NAME));
    // On a normalisation-insensitive file system (APFS) the composed spelling opens the same folder; elsewhere it is
    // another folder, and only the decomposed one is checked.
    let viaNfc: string | null = null;
    try { viaNfc = await vaultPathFor(env, join(root, NFC_NAME)); } catch { /* not the same folder here */ }
    if (viaNfc !== null) expect(viaNfc).toBe(viaNfd);
    expect(viaNfd).toBe(join(root, "vaults", `${vaultKeyOf(join(root, NFC_NAME))}.git`));
  });
});
