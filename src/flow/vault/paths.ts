/**
 * Flow engine spec §5.2 and §20 (Rule 17): where a folder's vault lives. One vault per directory, shared by every flow
 * run on it, at `$ORCA_VAULT_DIR/<sha256(NFC(realpath(dir)))>.git`. This module is the only place the vault's default
 * root is computed from the home directory; every caller passes its env, so a criterion redirects it.
 */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function vaultDir(env: NodeJS.ProcessEnv): string {
  const override = env.ORCA_VAULT_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca", "vault");
}

/** The vault's name for a real path: NFC first, so a composed and a decomposed spelling of one folder name one vault. */
export const vaultKeyOf = (realPath: string): string => createHash("sha256").update(realPath.normalize("NFC")).digest("hex");

export async function vaultPathFor(env: NodeJS.ProcessEnv, dir: string): Promise<string> {
  return join(vaultDir(env), `${vaultKeyOf(await realpath(dir))}.git`);
}
