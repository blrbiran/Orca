// CLI v2 spec §15.3, §15.6 criterion 10 (plan Task 11): `orca login` / `orca logout` and `--as-person`. The token is
// stored under $ORCA_PERSON_DIR (a temp dir here; Rule 17: never the person's ~/.orca), dir 0700 and file 0600 when
// created, an existing file's mode untouched; it is sent only with --as-person, never under the dispatched-run marker.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { personDir } from "../../src/commands/person.js";
import { runRegistered } from "../../src/commands/run.js";
import type { CommandIo } from "../../src/commands/types.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { sessionFor, TEST_PASSWORD } from "../panel/fixtures/auth.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useSocketPanels();

// Rule 17 guard: nothing in this file touches the person's real ~/.orca.
const REAL = join(homedir(), ".orca");
const stamp = (): string => (existsSync(REAL) ? String(statSync(REAL).mtimeMs) : "absent");
let before = "";
beforeAll(() => { before = stamp(); });
afterAll(() => { expect(stamp()).toBe(before); });

const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" });
const ledger = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};
const mode = (path: string): number => statSync(path).mode & 0o777;

async function setUp() {
  const w = await workspace();
  execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: gitEnv() });
  const panel = await boot(w, [], { port: true }) as StartedPanel;
  await sessionFor(panel, w.env); // seeds "tester" with TEST_PASSWORD
  const personDir = join(w.root, "person");
  const env: NodeJS.ProcessEnv = { ...w.env, ORCA_PERSON_DIR: personDir };
  const prompts: string[] = [];
  const run = async (argv: string[], extra: Partial<CommandIo> = {}) => {
    const out: string[] = [], err: string[] = [];
    const io: CommandIo = {
      stdout: (t) => out.push(t), stderr: (t) => err.push(t), env, cwd: w.root, stdinIsTTY: true,
      readSecret: async (prompt) => { prompts.push(prompt); return TEST_PASSWORD; }, ...extra,
    };
    const code = await runRegistered([...argv, "--control-state-dir", w.state], io);
    return { code, out: out.join(""), err: err.join("") };
  };
  // A token-tier write (spec §15.1: the spend verbs) the socket accepts only with a person token.
  const tokenWrite = (commandId: string, extra: string[] = [], io: Partial<CommandIo> = {}) =>
    run(["usage", "set-cap", "--scope", "all", "--period", "week", "--tokens", "5000", "--json", "--command-id", commandId, ...extra], io);
  const codeOf = (out: string): string | undefined => (JSON.parse(out) as { body: { error?: { code: string } } }).body.error?.code;
  return { w, env, personDir, run, tokenWrite, codeOf, prompts };
}

// Review M2 (session b37f7ce9): the default store is under the passed environment's HOME (as agents/paths.ts), never
// os.homedir(); pure calls only, so no mutation of it can read or write the real ~/.orca.
describe("personDir (CLI v2 spec §15.3, review M2)", () => {
  it("defaults under env.HOME, prefers ORCA_PERSON_DIR, and refuses a missing or relative HOME", () => {
    // Mutation "join(homedir(), ...)" -> the real home -> red.
    expect(personDir({ HOME: "/tmp/orca-person-home" })).toBe("/tmp/orca-person-home/.orca/person");
    expect(personDir({ HOME: "/tmp/h", ORCA_PERSON_DIR: "/tmp/p" })).toBe("/tmp/p");
    for (const HOME of [undefined, "", "relative/home"]) {
      expect(() => personDir({ HOME })).toThrow(expect.objectContaining({ code: "person-dir-unresolved" }));
    }
  });
});

describe("orca login / logout and --as-person (CLI v2 spec §15.3)", { timeout: 60_000 }, () => {
  it("login stores the token: dir 0700, token.json 0600, the password read at the terminal", async () => {
    const { personDir, run, prompts } = await setUp();
    const login = await run(["login", "--name", "tester"]);
    expect([login.code, login.err]).toEqual([0, ""]);
    expect(prompts).toHaveLength(1);
    const file = join(personDir, "token.json");
    expect([mode(personDir), mode(file)]).toEqual([0o700, 0o600]);
    const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["expiresAt", "schema", "sid", "token", "user"]);
    expect([stored.schema, stored.user]).toEqual(["orca-person-token-v1", "tester"]);
  });

  it("keeps an existing token.json's mode (0644 stays 0644)", async () => {
    const { personDir, run } = await setUp();
    mkdirSync(personDir, { mode: 0o700 });
    const file = join(personDir, "token.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);
    expect((await run(["login", "--name", "tester"])).code).toBe(0);
    expect(mode(file)).toBe(0o644);
    expect((JSON.parse(readFileSync(file, "utf8")) as { schema: string }).schema).toBe("orca-person-token-v1");
  });

  it("refuses login without a terminal, writing nothing", async () => {
    const { personDir, run } = await setUp();
    const login = await run(["login", "--name", "tester"], { stdinIsTTY: false });
    expect(login.code).toBe(1);
    expect(login.err).toContain("person-login-needs-terminal");
    expect(existsSync(personDir)).toBe(false);
  });

  it("sends the token only with --as-person: without it the token tier is refused even though a token is stored", async () => {
    const { w, run, tokenWrite, codeOf } = await setUp();
    expect((await run(["login", "--name", "tester"])).code).toBe(0);
    const without = await tokenWrite("cc-without");
    expect([without.code, codeOf(without.out)]).toEqual([2, "control-person-token-required"]);
    const withToken = await tokenWrite("cc-with", ["--as-person"]);
    expect(codeOf(withToken.out)).not.toBe("control-person-token-required");
    expect(withToken.code).toBe(0);
    expect(ledger(w.state).filter((id) => id.startsWith("cc-")).sort()).toEqual(["cc-with"]);
  });

  it("refuses --as-person under the dispatched-run marker before sending anything", async () => {
    const { w, env, run, tokenWrite, codeOf } = await setUp();
    expect((await run(["login", "--name", "tester"])).code).toBe(0);
    const marked = await tokenWrite("cc-marked", ["--as-person"], { env: { ...env, ORCA_DISPATCHED_RUN: "run-1" } });
    expect([marked.code, codeOf(marked.out), (JSON.parse(marked.out) as { status: number }).status]).toEqual([1, "control-dispatched-run-refused", 0]);
    expect(ledger(w.state)).not.toContain("cc-marked");
  });

  it("refuses --as-person with no stored token, before sending", async () => {
    const { tokenWrite, codeOf } = await setUp();
    const none = await tokenWrite("cc-none", ["--as-person"]);
    expect([none.code, codeOf(none.out)]).toEqual([1, "person-token-missing"]);
  });

  it("logout revokes the session and removes the file; a kept copy of the token is refused 401 control-person-token-invalid", async () => {
    const { personDir, run, tokenWrite, codeOf } = await setUp();
    expect((await run(["login", "--name", "tester"])).code).toBe(0);
    const file = join(personDir, "token.json");
    const copy = readFileSync(file, "utf8");
    const logout = await run(["logout"]);
    expect([logout.code, existsSync(file)]).toEqual([0, false]);
    writeFileSync(file, copy, { mode: 0o600 });
    const after = await tokenWrite("cc-after", ["--as-person"]);
    expect([after.code, codeOf(after.out)]).toEqual([2, "control-person-token-invalid"]);
  });
});
