import { existsSync } from "node:fs";
import { join } from "node:path";
import { readStdin } from "../../commands/local/stdin.js";
import { DISPATCHED_RUN_ENV } from "../../control/commandClient.js";
import { PASSWORD_STDIN_FLAG, REAL_PANEL_REFUSAL, STDIN_INVALID_MESSAGE, STDIN_INVALID_REFUSAL, passwordFromStdin, realOrcaDir, realPanelMessage, realPanelPath } from "../../commands/passwordStdin.js";
import { controlRoot } from "../controlOptions.js";
import type { Role } from "./jwt.js";
import { rotateSigningKey } from "./signingKey.js";
import { ACCOUNTS_FILE, AccountsRejection, USER_NAME_PATTERN, openAccountsStore, type AccountsStore } from "./store.js";

export interface UserIo {
  stdinIsTTY: boolean;
  readSecret(prompt: string): Promise<string>;
  /** All of stdin, for --password-stdin (passwordStdin.ts). */
  readStdin?(): Promise<string>;
  /** The real ~/.orca --password-stdin refuses to touch; a seam for the criteria. Default: realOrcaDir(). */
  realOrcaDir?: string;
  out(line: string): void;
  err(line: string): void;
  env: NodeJS.ProcessEnv;
  nowMs(): number;
}

const BY = "cli";
const usage = (message: string): AccountsRejection => new AccountsRejection("user-argument-invalid", 400, message);

/**
 * Strict: `--role owner|member` on `add` only, `--password-stdin` on `add` and `passwd` only (an isolated test panel,
 * passwordStdin.ts); every other flag, `--password` included, is refused.
 */
function parse(argv: string[]): { sub: string; name: string | null; roles: Role[]; fromStdin: boolean } {
  const [sub, ...rest] = argv;
  if (sub === undefined) throw usage("a subcommand is required: add, passwd, disable, list or rotate-key");
  const positional: string[] = [];
  let role: Role = "member";
  let fromStdin = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--role" && sub === "add") {
      const value = rest[++i];
      if (value !== "owner" && value !== "member") throw usage("--role is owner or member");
      role = value;
    } else if (arg === `--${PASSWORD_STDIN_FLAG}` && (sub === "add" || sub === "passwd")) fromStdin = true;
    else if (arg.startsWith("-")) throw usage(`unknown option ${arg}; passwords are typed at a terminal, never passed as arguments`);
    else positional.push(arg);
  }
  const wantsName = sub === "add" || sub === "passwd" || sub === "disable";
  if (!["add", "passwd", "disable", "list", "rotate-key"].includes(sub)) throw usage(`unknown subcommand ${sub}`);
  if (positional.length !== (wantsName ? 1 : 0)) throw usage(wantsName ? `${sub} takes one <name>` : `${sub} takes no arguments`);
  return { sub, name: positional[0] ?? null, roles: [role], fromStdin };
}

/** --password-stdin: one line, read once (nobody is typing it, so there is no second entry to compare). */
async function readPassword(io: UserIo, fromStdin: boolean): Promise<string> {
  if (!fromStdin) return readTwice(io);
  const line = passwordFromStdin(await (io.readStdin ?? readStdin)());
  if (line === null) throw new AccountsRejection(STDIN_INVALID_REFUSAL, 1, STDIN_INVALID_MESSAGE);
  return line;
}

async function readTwice(io: UserIo): Promise<string> {
  const first = await io.readSecret("password: ");
  const second = await io.readSecret("password again: ");
  if (first !== second) throw new AccountsRejection("user-passwords-differ", 400, "the two entries differ");
  return first;
}

/** 0 ok, 1 refused. Accounts spec §3.2, §10; the store is the one the service panel serves (X13), never a new one. */
export async function runUserCommand(argv: string[], io: UserIo): Promise<number> {
  let store: AccountsStore | null = null;
  try {
    const { sub, name, roles, fromStdin } = parse(argv);
    const needsPassword = sub === "add" || sub === "passwd";
    if (needsPassword && !fromStdin && !io.stdinIsTTY) throw new AccountsRejection("user-password-needs-tty", 1, "a password is typed at a terminal; it is never read from an argument or the environment, and from a pipe only with --password-stdin on an isolated test panel");
    const root = controlRoot(io.env);
    if (fromStdin) {
      // As orca login: a run Orca dispatched does not act on accounts unattended.
      if ((io.env[DISPATCHED_RUN_ENV] ?? "") !== "") throw new AccountsRejection("control-dispatched-run-refused", 1, "--password-stdin is not used by a run Orca dispatched");
      const real = io.realOrcaDir ?? realOrcaDir();
      const hit = realPanelPath({ "control directory": root }, real);
      if (hit !== null) throw new AccountsRejection(REAL_PANEL_REFUSAL, 1, realPanelMessage(hit, real));
    }
    if (!existsSync(join(root, ACCOUNTS_FILE))) {
      throw new AccountsRejection("user-store-missing", 1, `no accounts store at ${join(root, ACCOUNTS_FILE)}; start the panel once, or set ORCA_CONTROL_DIR to the service panel's control directory (orca panel install --dry-run shows it)`);
    }
    store = openAccountsStore(root);
    io.err(`orca-user: accounts store ${join(root, ACCOUNTS_FILE)}\n`);
    const now = io.nowMs();
    if (sub === "add") {
      if (!USER_NAME_PATTERN.test(name!)) throw new AccountsRejection("user-name-invalid", 400, "a user name is 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit");
      const password = await readPassword(io, fromStdin);
      const user = store.createUser({ name: name!, password, roles, now, by: BY });
      io.out(`orca-user: added ${user.name} (${user.roles.join(",")})\n`);
    } else if (sub === "passwd") {
      const user = store.findByName(name!);
      if (!user) throw new AccountsRejection("user-not-found", 1, `no user named ${name}`);
      if (user.disabledAt !== null) throw new AccountsRejection("user-disabled", 1, `${user.name} is disabled; a password cannot be changed for a disabled user`);
      const password = await readPassword(io, fromStdin);
      store.resetPassword(user.id, password, now, BY);
      io.out(`orca-user: password changed for ${user.name}; their sessions are logged out\n`);
    } else if (sub === "disable") {
      const user = store.findByName(name!);
      if (!user) throw new AccountsRejection("user-not-found", 1, `no user named ${name}`);
      store.disableUser(user.id, now, BY);
      io.out(`orca-user: disabled ${user.name}; their sessions are logged out\n`);
    } else if (sub === "list") {
      for (const user of store.listUsers()) io.out(`${user.name}\t${user.roles.join(",")}\t${user.disabledAt === null ? "active" : "disabled"}\n`);
    } else {
      rotateSigningKey(root);
      store.revokeAllSessions(now);
      store.appendSecurityEvent("key-rotated", {}, now);
      io.out("orca-user: signing key replaced; every session is logged out; restart the panel to sign new sessions with it\n");
    }
    return 0;
  } catch (error) {
    if (error instanceof AccountsRejection) {
      io.err(`rejected: ${error.code}: ${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    store?.close();
  }
}
