import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { writePrivateFile } from "../../service/privateFiles.js";
import type { AccountsStore } from "./store.js";
import { USER_NAME_PATTERN } from "./store.js";

export const INITIAL_PASSWORD_FILE = "initial-password";

/**
 * Accounts spec §3.2 (D2): a store with no user gets one owner named after --by (or "owner" when --by is not a valid
 * name), whose initial password is the first 16 hex characters of SHA-256 over 32 random bytes. The password goes to a
 * 0600 file only; the log line names the file, never the password.
 */
export function ensureDefaultOwner(store: AccountsStore, root: string, by: string, log: (line: string) => void, now: number): { created: boolean } {
  if (store.userCount() > 0) return { created: false };
  const name = USER_NAME_PATTERN.test(by) ? by : "owner";
  const password = createHash("sha256").update(randomBytes(32)).digest("hex").slice(0, 16);
  const path = join(root, INITIAL_PASSWORD_FILE);
  writePrivateFile(path, `${password}\n`);
  store.createUser({ name, password, roles: ["owner"], mustChangePassword: true, now, by: "panel" });
  log(`orca-panel: initial password for ${name} written to ${path}\n`);
  return { created: true };
}
