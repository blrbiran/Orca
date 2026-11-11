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
import { isAbsolute, join } from "node:path";
import { DISPATCHED_RUN_ENV, dispatchedRunHeaders } from "../control/commandClient.js";
import { discoverSocketPath } from "../entry/discovery.js";
import { EntryRejection } from "../entry/envelope.js";
import { requestOverSocket } from "../entry/socketClient.js";
import { readStdin } from "./local/stdin.js";
import { PASSWORD_STDIN_FLAG, REAL_PANEL_REFUSAL, STDIN_INVALID_MESSAGE, STDIN_INVALID_REFUSAL, passwordFromStdin, realOrcaDir, realPanelMessage, realPanelPath } from "./passwordStdin.js";
import type { CommandIo, ParsedArgs } from "./types.js";

export const PERSON_TOKEN_SCHEMA = "orca-person-token-v1";
export const PERSON_TOKEN_HEADER = "x-orca-person-token";
const TOKEN_FILE = "token.json";

export interface StoredPersonToken { schema: typeof PERSON_TOKEN_SCHEMA; token: string; sid: string; user: string; expiresAt: number }

/**
 * Review M2 (session b37f7ce9), as agents/paths.ts: the default is under the PASSED environment's HOME, never
 * os.homedir(), so a caller (a criterion) that relocates HOME relocates the token store; a missing or non-absolute HOME
 * is refused rather than falling back to the process's real home.
 */
export function personDir(env: NodeJS.ProcessEnv): string {
  if (env.ORCA_PERSON_DIR) return env.ORCA_PERSON_DIR;
  const home = env.HOME;
  if (home === undefined || home === "" || !isAbsolute(home)) {
    throw new EntryRejection("person-dir-unresolved", `ORCA_PERSON_DIR is not set and HOME is not an absolute path (got ${JSON.stringify(home)})`);
  }
  return join(home, ".orca", "person");
}

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
  catch { throw new EntryRejection("person-token-missing", `no person token at ${file}: run orca auth login first`); }
  if (stored.schema !== PERSON_TOKEN_SCHEMA || typeof stored.token !== "string") throw new EntryRejection("person-token-missing", `${file} is not an orca person token: run orca auth login again`);
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
function fail(io: CommandIo, exit: 1 | 2 | typeof AUTH_LOGIN_CANCELLED, code: string, message: string): number {
  io.stderr(`orca: ${code}: ${message}\n`);
  return exit;
}

export async function runLogin(args: ParsedArgs, io: CommandIo): Promise<number> {
  const name = args.flags.name as string;
  if (marked(io.env)) return fail(io, 1, "control-dispatched-run-refused", "orca login is not run by a run Orca dispatched");
  const fromStdin = args.flags[PASSWORD_STDIN_FLAG] === true;
  if (!fromStdin && !io.stdinIsTTY) return fail(io, 1, "person-login-needs-terminal", "orca login reads the password at a terminal; run it in a session you attend (an isolated test panel may use --password-stdin)");
  // Resolved before the panel is asked, so a store that cannot be named leaves no live session behind.
  const dir = personDir(io.env);
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  let password: string;
  if (fromStdin) {
    const real = io.realOrcaDir ?? realOrcaDir();
    const hit = realPanelPath({ "panel socket": socketPath, "person token store": dir }, real);
    if (hit !== null) return fail(io, 1, REAL_PANEL_REFUSAL, realPanelMessage(hit, real));
    const line = passwordFromStdin(io.stdinText ?? await readStdin());
    if (line === null) return fail(io, 1, STDIN_INVALID_REFUSAL, STDIN_INVALID_MESSAGE);
    password = line;
  } else {
    const read = io.readSecret ?? (async (prompt: string) => (await import("../panel/accounts/ttySecret.js")).readSecretFromTty(prompt));
    password = await read(`Password for ${name} on this panel: `);
  }
  const { status, body } = await requestOverSocket({ socketPath, method: "POST", path: "person/login", client: "cli", body: { name, password } });
  if (status !== 200) { const e = errorOf(body); return fail(io, 2, e.code, e.message); }
  const answer = body as { token: string; sid: string; user: { name: string }; expiresAt: number };
  store(dir, { schema: PERSON_TOKEN_SCHEMA, token: answer.token, sid: answer.sid, user: answer.user.name, expiresAt: answer.expiresAt });
  if (!args.global.quiet) io.stdout(`logged in as ${answer.user.name} until ${new Date(answer.expiresAt).toISOString()}; token in ${join(dir, TOKEN_FILE)} (sent only with --as-person)\n`);
  return 0;
}

/**
 * CLI browser login spec §6.11: whether `orca auth login` opens a browser -- not with --no-browser, not over SSH on macOS
 * (it would open on the console's screen), not on Linux without a display, and on no other platform (it only prints).
 */
export function browserAllowed(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, noBrowser: boolean): boolean {
  if (noBrowser) return false;
  if (platform === "darwin") return !env.SSH_CONNECTION && !env.SSH_TTY;
  if (platform === "linux") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return false;
}

/** The default `openUrl`: no shell, detached, nothing inherited; rejects when the opener cannot be spawned. */
function openWithSystem(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void import("node:child_process").then(({ spawn }) => {
      const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    }, reject);
  });
}

/** Spec §6.1: the panel's answer must be a loopback http URL of exactly this shape before anything opens it. */
const CLI_LOGIN_URL = /^http:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]):\d{1,5}\/#cli-login\/[A-Z0-9-]{9}$/;
const AUTH_LOGIN_CANCELLED = 130;

/**
 * CLI browser login spec §6: `orca auth login`. Asks the panel for a login request, prints its code and URL, opens the URL
 * (§6.11), and polls with the request id -- never printed -- until an owner approves or denies the code in the browser, or
 * it expires. The token is stored as `orca login` stores it. Refused under the dispatched-run marker (§6.7) and over MCP
 * (§6.8), before anything is sent.
 */
export async function runAuthLogin(args: ParsedArgs, io: CommandIo): Promise<number> {
  if (marked(io.env)) throw new EntryRejection("control-dispatched-run-refused", "orca auth login is not run by a run Orca dispatched; a person runs it in a terminal they attend");
  const client = io.client ?? "cli";
  if (client.startsWith("mcp")) throw new EntryRejection("cli-login-not-over-mcp", "orca auth login is not available over MCP; a person runs it in a terminal they attend");
  // Resolved before the panel is asked, so a store that cannot be named leaves no request behind.
  const dir = personDir(io.env);
  const socketPath = discoverSocketPath({ stateDirFlag: args.global.controlStateDir, env: io.env });
  const ask = (path: string, body: unknown) => requestOverSocket({ socketPath, method: "POST", path, client, headers: dispatchedRunHeaders(io.env), body });
  const started = await ask("person/cli-login", { pid: process.pid, ppid: process.ppid, cwd: io.cwd, startedAt: Math.round(performance.timeOrigin) });
  if (started.status !== 200) { const e = errorOf(started.body); return fail(io, 2, e.code, e.message); }
  const request = started.body as { requestId: string; code: string; url: string; expiresAt: number; pollMs: number };
  const cancel = (): Promise<unknown> => ask("person/cli-login/cancel", { requestId: request.requestId }).catch(() => undefined);
  if (typeof request.url !== "string" || !CLI_LOGIN_URL.test(request.url)) {
    await cancel();
    return fail(io, 2, "cli-login-url-invalid", `the panel answered a login URL that is not a loopback http URL of the expected shape: ${JSON.stringify(request.url)}`);
  }
  io.stdout(`Code ${request.code}: approve it in the browser at ${request.url}\n`);
  if (browserAllowed(process.platform, io.env, args.flags["no-browser"] === true)) {
    try { await (io.openUrl ?? openWithSystem)(request.url); }
    catch { io.stderr("orca: could not open a browser; open the URL above yourself\n"); }
  }
  // Spec §6.10: a signal while waiting cancels the request, so the page says so instead of waiting for the expiry.
  let interrupted = false;
  let wake: () => void = () => undefined;
  const onSignal = (): void => { interrupted = true; wake(); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const pollMs = Number.isSafeInteger(request.pollMs) && request.pollMs > 0 && request.pollMs <= 10_000 ? request.pollMs : 1_000;
    // The panel's clock decides the expiry; this deadline only stops a loop the panel never ends.
    const deadline = Date.now() + Math.max(0, request.expiresAt - Date.now()) + 5 * pollMs + 5_000;
    while (!interrupted) {
      const answer = await ask("person/cli-login/poll", { requestId: request.requestId });
      const body = answer.body as { state?: unknown; token?: unknown; sid?: unknown; user?: { name?: unknown }; expiresAt?: unknown };
      if (answer.status !== 200) {
        const e = errorOf(answer.body);
        return fail(io, 2, e.code, e.code === "cli-login-unknown" ? "the panel has no such login request (it may have restarted): run orca auth login again" : e.message);
      }
      if (typeof body.token === "string") {
        const user = String(body.user?.name);
        const expiresAt = Number(body.expiresAt);
        store(dir, { schema: PERSON_TOKEN_SCHEMA, token: body.token, sid: String(body.sid), user, expiresAt });
        if (!args.global.quiet) io.stdout(`logged in as ${user} until ${new Date(expiresAt).toISOString()}; token in ${join(dir, TOKEN_FILE)} (sent only with --as-person)\n`);
        return 0;
      }
      if (Date.now() > deadline) { await cancel(); return fail(io, 2, "cli-login-expired", "the login request expired: run orca auth login again"); }
      await new Promise<void>((resolve) => { const timer = setTimeout(resolve, pollMs); wake = () => { clearTimeout(timer); resolve(); }; });
    }
    await cancel();
    return fail(io, AUTH_LOGIN_CANCELLED, "cli-login-cancelled", "cancelled; the browser page will say so");
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/** CLI browser login spec §6.12: the stored token's user and expiry, labelled as stored; never the token itself. */
export async function runAuthStatus(_args: ParsedArgs, io: CommandIo): Promise<number> {
  const file = join(personDir(io.env), TOKEN_FILE);
  let stored: Partial<StoredPersonToken>;
  try { stored = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredPersonToken>; }
  catch { return fail(io, 1, "person-token-missing", `no person token at ${file}: run orca auth login`); }
  if (stored.schema !== PERSON_TOKEN_SCHEMA || typeof stored.user !== "string" || typeof stored.expiresAt !== "number") return fail(io, 1, "person-token-missing", `${file} is not an orca person token: run orca auth login`);
  const expired = stored.expiresAt <= Date.now() ? " (expired)" : "";
  io.stdout(`stored person token: ${stored.user}, expires ${new Date(stored.expiresAt).toISOString()}${expired}\n`);
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
