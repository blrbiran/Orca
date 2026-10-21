/**
 * CLI v2 spec §15.3: the person token. `orca login` asks the panel (over its control socket) for a token of the panel
 * account whose password is typed at the terminal, and stores it; `orca logout` revokes it and removes the file. A
 * command sends it only with --as-person, never under the dispatched-run marker (§15.4).
 *
 * Out-of-repo write (Rule 17, registered in CLI v2 spec §15.3 and the accounts spec's Correction §15):
 * `$ORCA_PERSON_DIR/token.json`, default `~/.orca/person`. The directory is created 0700 and the file 0600 when absent;
 * an existing one keeps its mode. Written temp + rename, so a failure leaves no partial token.json (at most a
 * `.token.json.<pid>.tmp` beside it, removed on the way out).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DISPATCHED_RUN_ENV } from "../control/commandClient.js";
import { discoverSocketPath } from "../entry/discovery.js";
import { EntryRejection } from "../entry/envelope.js";
import { requestOverSocket } from "../entry/socketClient.js";
import type { CommandIo, ParsedArgs } from "./types.js";

export const PERSON_TOKEN_SCHEMA = "orca-person-token-v1";
export const PERSON_TOKEN_HEADER = "x-orca-person-token";
const TOKEN_FILE = "token.json";

export interface StoredPersonToken { schema: typeof PERSON_TOKEN_SCHEMA; token: string; sid: string; user: string; expiresAt: number }

export const personDir = (env: NodeJS.ProcessEnv): string => env.ORCA_PERSON_DIR || join(homedir(), ".orca", "person");

const marked = (env: NodeJS.ProcessEnv): boolean => (env[DISPATCHED_RUN_ENV] ?? "") !== "";

/** The header --as-person sends: refused here (exit 1, nothing sent) under the dispatched-run marker or with no stored token. */
export function personTokenHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  if (marked(env)) throw new EntryRejection("control-dispatched-run-refused", "--as-person is not used by a run Orca dispatched; a person sends it from a session they attend");
  return storedTokenHeaders(env);
}

function storedTokenHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const file = join(personDir(env), TOKEN_FILE);
  let stored: Partial<StoredPersonToken>;
  try { stored = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredPersonToken>; }
  catch { throw new EntryRejection("person-token-missing", `no person token at ${file}: run orca login first`); }
  if (stored.schema !== PERSON_TOKEN_SCHEMA || typeof stored.token !== "string") throw new EntryRejection("person-token-missing", `${file} is not an orca person token: run orca login again`);
  return { [PERSON_TOKEN_HEADER]: stored.token };
}

/** Temp + rename; an existing file's mode is carried over (never changed), a new one is 0600; the directory 0700 when created. */
function store(dir: string, value: StoredPersonToken): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, TOKEN_FILE);
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600;
  const temp = join(dir, `.${TOKEN_FILE}.${process.pid}.tmp`);
  rmSync(temp, { force: true });
  try {
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(temp, mode);
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}

const errorOf = (body: unknown): { code: string; message: string } => {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return { code: typeof error?.code === "string" ? error.code : "panel-error", message: typeof error?.message === "string" ? error.message : "" };
};

/** A refusal or the panel's error: one line on stderr; 1 here, 2 the panel's (spec §7). */
function fail(io: CommandIo, exit: 1 | 2, code: string, message: string): number {
  io.stderr(`orca: ${code}: ${message}\n`);
  return exit;
}

export async function runLogin(args: ParsedArgs, io: CommandIo): Promise<number> {
  const name = args.flags.name as string;
  if (marked(io.env)) return fail(io, 1, "control-dispatched-run-refused", "orca login is not run by a run Orca dispatched");
  if (!io.stdinIsTTY) return fail(io, 1, "person-login-needs-terminal", "orca login reads the password at a terminal; run it in a session you attend");
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  const read = io.readSecret ?? (async (prompt: string) => (await import("../panel/accounts/ttySecret.js")).readSecretFromTty(prompt));
  const password = await read(`Password for ${name} on this panel: `);
  const { status, body } = await requestOverSocket({ socketPath, method: "POST", path: "person/login", client: "cli", body: { name, password } });
  if (status !== 200) { const e = errorOf(body); return fail(io, 2, e.code, e.message); }
  const answer = body as { token: string; sid: string; user: { name: string }; expiresAt: number };
  const dir = personDir(io.env);
  store(dir, { schema: PERSON_TOKEN_SCHEMA, token: answer.token, sid: answer.sid, user: answer.user.name, expiresAt: answer.expiresAt });
  if (!args.global.quiet) io.stdout(`logged in as ${answer.user.name} until ${new Date(answer.expiresAt).toISOString()}; token in ${join(dir, TOKEN_FILE)} (sent only with --as-person)\n`);
  return 0;
}

export async function runLogout(args: ParsedArgs, io: CommandIo): Promise<number> {
  const file = join(personDir(io.env), TOKEN_FILE);
  if (!existsSync(file)) return fail(io, 1, "person-token-missing", `no person token at ${file}`);
  // Logging out only gives power up, so it is not refused under the marker.
  const headers = storedTokenHeaders(io.env);
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  const { status, body } = await requestOverSocket({ socketPath, method: "POST", path: "person/logout", client: "cli", headers, body: {} });
  // A token the panel no longer honours is as good as revoked: the file goes either way.
  const dead = status === 401 && errorOf(body).code === "control-person-token-invalid";
  if (status !== 200 && !dead) { const e = errorOf(body); return fail(io, 2, e.code, e.message); }
  rmSync(file, { force: true });
  if (!args.global.quiet) io.stdout(dead ? `the token was no longer live; removed ${file}\n` : `logged out; removed ${file}\n`);
  return 0;
}
