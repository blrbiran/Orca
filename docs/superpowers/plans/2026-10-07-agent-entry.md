# Agent entry (N2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an AI agent read Orca's control state and deliver control commands to a running panel through a unix socket, an `orca control` CLI, a skill file and an `orca mcp serve` stdio bridge.

**Architecture:** The panel, once it holds the control store lock and has recovered, also listens on `<stateDir>/control.sock` (0600) with a second express app that mounts only the existing `/api/control` routes, minus the token, plus a client-attribution header and a human-only gate. A small client library (`src/entry/`) discovers the socket, speaks HTTP over it and wraps every answer in one JSON envelope; the CLI and the MCP bridge are thin shells over it.

**Tech Stack:** TypeScript (ESM, Node ≥ 22.13.1), express 5, zod 3, node:sqlite, vitest 2, `@modelcontextprotocol/sdk` (new, Task 8).

**Spec:** `docs/superpowers/specs/2026-10-07-agent-entry-design.md` (§1–§11, plus §12 plan-time decisions added by Task 0).

## Global Constraints

- Never touch the real `~/.orca`, never run a paid model, never restart the human's panel, never push (CLAUDE.md Rules 15, 17; session constraints).
- Every criterion relocates `ORCA_CONTROL_DIR`, `ORCA_CORRECTIONS_DIR`, `ORCA_PROJECTS_FILE` (when discovery is involved) and HOME into a temp dir; socket state dirs are short (`mkdtemp(join(tmpdir(), "os-"))` + `/s`), because macOS caps `sun_path` at 104 bytes including the NUL.
- New directories 0700, new files 0600; the socket is chmod 0600; existing directories' modes are never changed.
- `--no-control` and the Web channel stay byte-for-byte as before (same routes, same bodies, same stdout ready line).
- Human-only constants: `HUMAN_ONLY_VERBS = ["set-limit"]`, `HUMAN_ONLY_FIELDS = { "requirement-open": ["limit"], "proposal-edit": ["proposedGroupLimit"] }`; codes `control-verb-human-only` (403), `control-field-human-only` (403), `control-client-invalid` (400).
- Client header: `x-orca-client`, value matching `^(cli|mcp)(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$`; Web rows are attributed `web`.
- CLI stdout: exactly one line, `{"schema":"orca-cli-response-v1","status":<n>,"commandId"?:<id>,"body":<panel body or local error>}`. Exit 0 = 2xx, 1 = local refusal, 2 = panel non-2xx, 3 = unhandled.
- Local error codes: `panel-not-running` (retryable), `control-socket-path-too-long`, `control-socket-timeout` (retryable), `control-projects-file-invalid`, `control-cli-argument-invalid`, `control-cli-path-invalid`, `control-cli-binary-route`.
- Code, comments, commits, ledger: English. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Use `/usr/bin/git`, `/bin/rm`, `/bin/cp`.
- Verification output is redirected to a file and read back whole; never piped through grep/tail (Rule 14).
- Rule 9: every new branch gets a named deletion mutation, run in a `git clone --local` copy, seen red (Task 9 collects them; each task lists its own).

## Review Focus

1. **A long default TMPDIR**: an existing criterion booting a control panel under a long temp path must still pass — the socket fails soft (stderr line), the Web UI works. Pinned in Task 3 (path-too-long test).
2. **An agent retrying after a timeout with no `--command-id`**: the envelope must carry the generated commandId even on an error answer, so the retry can reuse it. Pinned in Task 5 (C8 test).
3. **Two panels on one state dir**: the loser must not unlink or rebind the winner's socket. Pinned in Task 3 (C4 test).
4. **A command replayed across channels** (sent over Web, retried over socket with the same commandId): must replay, not conflict, and keep the original `client`. Pinned in Task 4.
5. **A projects file that exists but is broken**: the CLI must refuse by name instead of silently looking in the default dir. Pinned in Task 5 (C20 test).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/control/migrations.ts` | modify | `schema6To7` (commands.client), version 7 |
| `src/control/store.ts` | modify | accept stored version "6" for migration |
| `src/control/commandClient.ts` | create | header name/pattern, AsyncLocalStorage `{commandId, client}` |
| `src/control/commandLedger.ts` | modify | write `client` in `persistCommandOutcome` |
| `src/panel/humanOnly.ts` | create | human-only constants and `humanOnlyRefusal` |
| `src/panel/controlApi.ts` | modify | `channel` parameter; socket gate; client context around the service call |
| `src/panel/controlSocket.ts` | create | socket app builder, bind (stale unlink, chmod), close (unlink) |
| `src/panel/server.ts` | modify | bind socket after recovery; close order; `StartedPanel.socketPath` |
| `src/cli.ts` | modify | stderr socket line; `control` and `mcp` commands; USAGE |
| `src/entry/envelope.ts` | create | `CliResponseV1`, `EntryRejection`, exit-code mapping |
| `src/entry/discovery.ts` | create | socket path resolution |
| `src/entry/socketClient.ts` | create | HTTP over unix socket |
| `src/entry/operations.ts` | create | `controlGet`, `controlSend` (validation, commandId) |
| `src/entry/controlCommand.ts` | create | `orca control` argv parsing and output |
| `src/entry/mcp.ts` | create | `orca mcp serve` |
| `skills/orca-control/SKILL.md` | create | agent instructions and route table |
| tests | create | `tests/control/commandClient.test.ts`, `tests/panel/humanOnly.test.ts`, `tests/panel/controlSocket.test.ts`, `tests/panel/controlSocketGate.test.ts`, `tests/entry/*.test.ts` |

---

### Task 0: Record plan-time decisions in the spec

**Files:** Modify: `docs/superpowers/specs/2026-10-07-agent-entry-design.md` (append only)

- [ ] **Step 1: Append §12** (Rule 13: the committed text above stays verbatim):

```markdown
## 12. Plan-time decisions (2026-10-07, session 6cc0c1e9)

- D1. §3.3's ready-line field is not added. `scripts/verify-panel.ts` parses the stdout line with `^orca-panel ready url=(\S+) token=(\S+)\s*$`, and the line is a contract with one reader per field. The socket path goes to stderr as `orca-panel: control socket <path>` and to `StartedPanel.socketPath`; C1 checks those instead.
- D2. The socket-only codes (`control-client-invalid`, `control-verb-human-only`, `control-field-human-only`) are not added to `controlErrorCatalog`: the catalog is served to the Web UI and every entry needs Chinese copy (`tests/panel/refusalCoverage.test.ts`), and these codes never reach the Web UI.
- D3. The client library times out a socket request after 120 s with local error `control-socket-timeout` (retryable), so a wedged panel cannot hang an agent forever.
- D4. The MCP bridge uses the SDK's low-level `Server` with plain JSON Schema tool inputs (no zod coupling to the SDK's zod version); a commandId it generates is `mcp-<uuid>`.
- D5. `tests/control/requirementRecords.test.ts` asserts `schemaVersion` "6"; the migration makes it "7", so that expectation changes with Task 1.
```

- [ ] **Step 2: Commit** — `git add` the spec and this plan; message `docs(plan): plan the N2 agent entry and record plan-time decisions`.

---

### Task 1: Command client attribution in the store

**Files:**
- Create: `src/control/commandClient.ts`
- Modify: `src/control/migrations.ts`, `src/control/store.ts:86`, `src/control/commandLedger.ts:234-243`, `tests/control/requirementRecords.test.ts:25`
- Test: `tests/control/commandClient.test.ts`

**Interfaces:**
- Produces: `CLIENT_HEADER = "x-orca-client"`, `CLIENT_PATTERN: RegExp`, `withCommandClient<T>(commandId: string, client: string, fn: () => T): T`, `commandClientFor(commandId: string): string | null`; column `commands.client TEXT`; `schemaVersion === "7"`.

- [ ] **Step 1: Write the failing tests** in `tests/control/commandClient.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_PATTERN, commandClientFor, withCommandClient } from "../../src/control/commandClient.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function stateDir() { const root = await mkdtemp(join(tmpdir(), "cc-")); roots.push(root); return join(root, "s"); }

describe("command client context (spec §6)", () => {
  it("answers the client only for the commandId it was set for", async () => {
    await withCommandClient("cmd-a", "cli:claude", async () => {
      expect(commandClientFor("cmd-a")).toBe("cli:claude");
      // Background work started inside the call inherits the context; it must not stamp another command's row.
      expect(commandClientFor("cmd-b")).toBe(null);
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(commandClientFor("cmd-a")).toBe("cli:claude");
    });
    expect(commandClientFor("cmd-a")).toBe(null);
  });

  it("accepts exactly the documented header values", () => {
    for (const ok of ["cli", "mcp", "cli:claude-code", "mcp:Codex_1.2", "cli:a"]) expect(CLIENT_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "web", "cli:", "cli:-x", "mcp:a b", "cli:" + "a".repeat(65), "CLI", "cli:x:y"]) expect(CLIENT_PATTERN.test(bad), bad).toBe(false);
  });
});

describe("schema 6 to 7 (spec §6)", () => {
  it("a fresh store has commands.client and version 7", async () => {
    const store = await openControlStore({ stateDir: await stateDir() });
    try {
      expect(schemaVersion).toBe("7");
      const columns = store.db.prepare("PRAGMA table_info(commands)").all().map((row) => String(row.name));
      expect(columns).toContain("client");
    } finally { store.close(); }
  });

  it("a version-6 store upgrades, and a row written before keeps client null", async () => {
    const dir = await stateDir();
    (await openControlStore({ stateDir: dir })).close();
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.exec("ALTER TABLE commands DROP COLUMN client");
    raw.prepare("INSERT INTO commands(group_id,id,payload_hash,result) VALUES ('g','old','h','{}')").run();
    raw.prepare("UPDATE meta SET value='6' WHERE key='schemaVersion'").run();
    raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()).toMatchObject({ value: "7" });
      expect(store.db.prepare("SELECT client FROM commands WHERE id='old'").get()).toMatchObject({ client: null });
    } finally { store.close(); }
  });
});
```

(If `control.sqlite` is not the database file name, read `src/control/store.ts` for the name and use it.)

- [ ] **Step 2: Run** `npx vitest run tests/control/commandClient.test.ts > $SCRATCH/t1.txt 2>&1; echo rc=$?` and read the file. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/control/commandClient.ts`:**

```ts
import { AsyncLocalStorage } from "node:async_hooks";

/** Agent entry spec §4.2: which client sent a socket request. Attribution only, never authorization (§6). */
export const CLIENT_HEADER = "x-orca-client";
export const CLIENT_PATTERN = /^(cli|mcp)(:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})?$/;

const current = new AsyncLocalStorage<{ commandId: string; client: string }>();

/** Spec §6: set by the route around the service call; outside the raw command, so in neither hash. */
export function withCommandClient<T>(commandId: string, client: string, fn: () => T): T {
  return current.run({ commandId, client }, fn);
}

/**
 * The client for the row being written, or null. Matched on commandId: work the call leaves running in the background
 * inherits the async context, and must not stamp a row it did not come from.
 */
export function commandClientFor(commandId: string): string | null {
  const context = current.getStore();
  return context !== undefined && context.commandId === commandId ? context.client : null;
}
```

- [ ] **Step 4: Migration.** In `src/control/migrations.ts`: set `schemaVersion = "7"`; add after `schema5To6`:

```ts
// Agent entry spec §6: which client delivered a command (web, cli[:name], mcp[:name]); null for rows not from a route.
export const schema6To7 = `ALTER TABLE commands ADD COLUMN client TEXT;
`;
```

Append `+ schema6To7` to `initialSchema` and to every branch of `migrateSchema`, and add `else if (fromVersion === "6") store.exec(schema6To7);` before the `else throw`. In `src/control/store.ts:86` add `&& version !== "6"` to the accepted-versions condition. In `tests/control/requirementRecords.test.ts:25` change `"6"` to `"7"` (plan decision D5).

- [ ] **Step 5: Write the column.** In `persistCommandOutcome` (`src/control/commandLedger.ts:234`), add `client` to the column list after `projection_seq`, one more `?`, and pass `commandClientFor(rawCommand.commandId)` as the last value; import it from `./commandClient.js`. Leave `src/control/commands.ts:34` (legacy insert, not a route) unchanged — its rows get null.

- [ ] **Step 6: Run** the new test file and `npx vitest run tests/control/requirementRecords.test.ts tests/control/commandLedger*.test.ts` into a file; expected PASS. Then `npm run typecheck > $SCRATCH/t1tc.txt 2>&1; echo rc=$?` → 0.

- [ ] **Step 7: Mutations (clone).** In a `git clone --local` copy at `$SCRATCH/mut-t1`: (a) replace `context.commandId === commandId ? context.client : null` with `context !== undefined ? context.client : null` → first test red; (b) delete `+ schema6To7` from `initialSchema` → fresh-store test red; (c) delete the `fromVersion === "6"` branch → upgrade test red. Record each in the ledger.

- [ ] **Step 8: Commit** `feat(control): record which client delivered each command`.

---

### Task 2: Human-only constants

**Files:** Create: `src/panel/humanOnly.ts`; Test: `tests/panel/humanOnly.test.ts`

**Interfaces:**
- Consumes: `CommandVerbV1`, `rawAuthorityCommandSchema` (`src/control/webProtocol.ts`), `amountSchema` (`src/control/schema.ts:22`).
- Produces: `HUMAN_ONLY_VERBS`, `HUMAN_ONLY_FIELDS`, `AGENT_AMOUNT_FIELDS: Readonly<Record<string, string>>` (key `"<verb>:<dot.path>"` → reason), `humanOnlyRefusal(verb: CommandVerbV1, payload: unknown): { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null`.

- [ ] **Step 1: Failing tests** `tests/panel/humanOnly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { amountSchema } from "../../src/control/schema.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { AGENT_AMOUNT_FIELDS, HUMAN_ONLY_FIELDS, HUMAN_ONLY_VERBS, humanOnlyRefusal } from "../../src/panel/humanOnly.js";

/** Every amountSchema field in every raw command payload, as "<verb>:<path>" (spec §5, C19). */
function amountFields(): string[] {
  const found: string[] = [];
  const walk = (schema: z.ZodTypeAny, verb: string, path: string[]): void => {
    if (schema === amountSchema) { found.push(`${verb}:${path.join(".")}`); return; }
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return walk(schema.unwrap(), verb, path);
    if (schema instanceof z.ZodDefault) return walk(schema._def.innerType, verb, path);
    if (schema instanceof z.ZodEffects) return walk(schema.innerType(), verb, path);
    if (schema instanceof z.ZodArray) return walk(schema.element, verb, [...path, "[]"]);
    if (schema instanceof z.ZodObject) { for (const [key, child] of Object.entries(schema.shape)) walk(child as z.ZodTypeAny, verb, [...path, key]); return; }
    if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) { for (const option of schema.options as z.ZodTypeAny[]) walk(option, verb, path); return; }
    if (schema instanceof z.ZodIntersection) { walk(schema._def.left, verb, path); walk(schema._def.right, verb, path); }
  };
  const union = (rawAuthorityCommandSchema as unknown as z.ZodEffects<z.ZodDiscriminatedUnion<"verb", z.ZodObject<z.ZodRawShape>[]>>).innerType();
  for (const option of union.options) {
    const verb = (option.shape.verb as z.ZodLiteral<string>).value;
    walk(option.shape.payload as z.ZodTypeAny, verb, []);
  }
  return [...new Set(found)].sort();
}

describe("the human-only surface (spec §5)", () => {
  it("covers every amount a raw command can carry, or lists it with a reason (C19)", () => {
    const fields = amountFields();
    // Non-vacuous: the walk must see the three inputs the spec names.
    expect(fields).toEqual(expect.arrayContaining(["set-limit:limit", "requirement-open:limit", "proposal-edit:proposedGroupLimit"]));
    const covered = (entry: string): boolean => {
      const [verb, path] = entry.split(":") as [string, string];
      return (HUMAN_ONLY_VERBS as readonly string[]).includes(verb)
        || ((HUMAN_ONLY_FIELDS as Record<string, readonly string[]>)[verb] ?? []).includes(path)
        || Object.hasOwn(AGENT_AMOUNT_FIELDS, entry);
    };
    expect(fields.filter((entry) => !covered(entry))).toEqual([]);
    for (const reason of Object.values(AGENT_AMOUNT_FIELDS)) expect(reason.trim()).not.toBe("");
  });

  it("refuses the verb and the two fields, and nothing else", () => {
    expect(humanOnlyRefusal("set-limit", { limit: {} })?.code).toBe("control-verb-human-only");
    expect(humanOnlyRefusal("requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-field-human-only");
    expect(humanOnlyRefusal("proposal-edit", { proposedGroupLimit: {} })?.code).toBe("control-field-human-only");
    expect(humanOnlyRefusal("requirement-open", { groupId: "g" })).toBe(null);
    expect(humanOnlyRefusal("proposal-edit", { operations: [] })).toBe(null);
    expect(humanOnlyRefusal("confirm", { limit: {} })).toBe(null);
    expect(humanOnlyRefusal("requirement-open", "not an object")).toBe(null);
    // An inherited property is not the payload's own field.
    expect(humanOnlyRefusal("requirement-open", Object.create({ limit: {} }))).toBe(null);
  });
});
```

- [ ] **Step 2: Run**, expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/panel/humanOnly.ts`:

```ts
import type { CommandVerbV1 } from "../control/webProtocol.js";

/**
 * Agent entry spec §5 (human ruling H3): over the socket an agent may do everything the Web UI can, except set a
 * group's budget amount -- the bound every other agent-permitted command stays under. Checked on the socket channel only.
 */
export const HUMAN_ONLY_VERBS: readonly CommandVerbV1[] = ["set-limit"];
export const HUMAN_ONLY_FIELDS: Readonly<Partial<Record<CommandVerbV1, readonly string[]>>> = {
  "requirement-open": ["limit"],
  "proposal-edit": ["proposedGroupLimit"],
};
/** Spec §5 / C19: an amount field an agent may send, with the reason. Empty until a reviewed exception exists. */
export const AGENT_AMOUNT_FIELDS: Readonly<Record<string, string>> = {};

export function humanOnlyRefusal(verb: CommandVerbV1, payload: unknown):
  { code: "control-verb-human-only" | "control-field-human-only"; message: string } | null {
  if (HUMAN_ONLY_VERBS.includes(verb)) return { code: "control-verb-human-only", message: `${verb} is done by a person in the Web UI.` };
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const field = (HUMAN_ONLY_FIELDS[verb] ?? []).find((name) => Object.hasOwn(payload, name));
  return field === undefined ? null : { code: "control-field-human-only", message: `${verb}.${field} is set by a person in the Web UI; send the command without it.` };
}
```

If the C19 walk finds another amount field, do not silently allow it: add it to `HUMAN_ONLY_FIELDS` when it sets a limit, otherwise to `AGENT_AMOUNT_FIELDS` with a one-line reason, and record the choice in the ledger.

- [ ] **Step 4: Run** → PASS; typecheck → 0.
- [ ] **Step 5: Mutations (clone):** (a) empty `HUMAN_ONLY_VERBS` → both tests red; (b) delete the `"proposal-edit"` entry → both red; (c) replace `Object.hasOwn(payload, name)` with `name in payload` → inherited-property assertion red.
- [ ] **Step 6: Commit** `feat(panel): name the human-only command surface`.

---

### Task 3: The control socket (bind, serve, close)

**Files:**
- Create: `src/panel/controlSocket.ts`; Test: `tests/panel/controlSocket.test.ts`
- Modify: `src/panel/controlApi.ts` (channel parameter only), `src/panel/server.ts` (wiring, `StartedPanel.socketPath`), `src/cli.ts:346-349` (stderr line)

**Interfaces:**
- Consumes: `registerControlReadRoutes(app, deps, channel)`, `verifyControlJsonBody`, `sendControlError`.
- Produces: `type ControlChannel = "web" | "socket"` (exported from `controlApi.ts`); `CONTROL_SOCKET_NAME = "control.sock"`; `controlSocketPath(stateDir: string): string`; `socketPathTooLong(path: string): boolean`; `buildControlSocketApp(deps: ControlReadApiDeps): Express`; `bindControlSocket(app: Express, path: string): Promise<ControlSocketHandle | ControlSocketFailure>` where `ControlSocketHandle = { path: string; close(): void }` and `ControlSocketFailure = { code: "control-socket-path-too-long" | "control-socket-path-occupied" | "control-socket-listen-failed"; detail: string }`; `StartedPanel.socketPath: string | null`.

- [ ] **Step 1: Channel parameter.** In `controlApi.ts` export `export type ControlChannel = "web" | "socket";`, change signatures to `registerControlReadRoutes(app: Express, deps: ControlReadApiDeps, channel: ControlChannel = "web")` and `registerControlMutationRoutes(app: Express, store: ControlStore, service: WebControlService, channel: ControlChannel = "web")`, and pass `channel` at `:110`. No behaviour change yet (Task 4 uses it).

- [ ] **Step 2: Failing tests** `tests/panel/controlSocket.test.ts` — boot helper and requests over the socket:

```ts
import { request } from "node:http";
import { lstat, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { controlSocketPath, socketPathTooLong } from "../../src/panel/controlSocket.js";

const roots: string[] = [];
const panels: StartedPanel[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (panels.length) await panels.pop()!.close().catch(() => undefined);
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "os-")));
  roots.push(root);
  for (const dir of ["repo", "corrections", "control"]) await mkdir(join(root, dir), { recursive: true });
  return { root, repo: join(root, "repo"), state: join(root, "s"), env: { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections") } };
}
async function boot(w: Awaited<ReturnType<typeof workspace>>, extra: string[] = []) {
  const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", w.state, ...extra], w.env);
  const panel = await createPanelServer(opts, w.env);
  panels.push(panel);
  return panel;
}
export function overSocket(socketPath: string, method: string, path: string, headers: Record<string, string> = { "x-orca-client": "cli" }, body?: unknown) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: { connection: "close", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe("the control socket (spec §3)", () => {
  it("C1: binds <stateDir>/control.sock as a 0600 socket and serves the control summary without a token", async () => {
    const w = await workspace();
    const panel = await boot(w);
    expect(panel.socketPath).toBe(controlSocketPath(await realpath(w.state)));
    const info = await lstat(panel.socketPath!);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
    const summary = await overSocket(panel.socketPath!, "GET", "/api/control/summary");
    expect(summary.status).toBe(200);
    expect(JSON.parse(summary.text).schema).toBe("orca-control-summary-v1");
  });

  it("C2: replaces a stale socket left by a dead owner", async () => {
    const w = await workspace();
    const first = await boot(w);
    const path = first.socketPath!;
    // Simulate a crash: the store lock is released by close(), but put a dead socket file back at the path.
    await first.close(); panels.pop();
    const { createServer } = await import("node:net");
    const dead = createServer(); await new Promise<void>((r) => dead.listen(path, r));
    // Leave the file behind without unlinking: close the handle only.
    (dead as unknown as { _handle: { close(): void } })._handle.close();
    expect((await lstat(path)).isSocket()).toBe(true);
    const second = await boot(w);
    expect((await overSocket(second.socketPath!, "GET", "/api/control/summary")).status).toBe(200);
  });

  it("C2: a regular file at the path is not removed; the panel still serves the Web UI and says why on stderr", async () => {
    const w = await workspace();
    await mkdir(w.state, { recursive: true, mode: 0o700 });
    await writeFile(join(w.state, "control.sock"), "not a socket", { mode: 0o600 });
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    const panel = await boot(w);
    expect(panel.socketPath).toBe(null);
    expect(lines.join("")).toContain("orca-panel: control socket unavailable: control-socket-path-occupied");
    expect((await stat(join(w.state, "control.sock"))).isFile()).toBe(true);
    const web = await fetch(`${panel.url}/api/control/config`, { headers: { "x-orca-token": panel.token } });
    expect(web.status).toBe(200);
  });

  it("C3: close() removes the socket file", async () => {
    const w = await workspace();
    const panel = await boot(w);
    const path = panel.socketPath!;
    await panel.close(); panels.pop();
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C4: --no-control binds nothing; a second panel on a held store binds nothing and leaves the first one's socket", async () => {
    const w = await workspace();
    const off = await boot(w, ["--no-control"]);
    expect(off.socketPath).toBe(null);
    await expect(lstat(join(w.state, "control.sock"))).rejects.toMatchObject({ code: "ENOENT" });
    const first = await boot(w);
    const second = await boot(w);
    expect(second.socketPath).toBe(null);
    expect((await overSocket(first.socketPath!, "GET", "/api/control/summary")).status).toBe(200);
  });

  it("C5: serves no non-control route and no page", async () => {
    const w = await workspace();
    const panel = await boot(w);
    expect((await overSocket(panel.socketPath!, "GET", "/api/reviews")).status).toBe(404);
    expect((await overSocket(panel.socketPath!, "GET", "/")).status).toBe(404);
  });

  it("C15: a path over the sun_path limit is refused by name, and the panel still starts", async () => {
    expect(socketPathTooLong("/" + "a".repeat(120))).toBe(true);
    expect(socketPathTooLong("/tmp/x/control.sock")).toBe(false);
    const w = await workspace();
    const deep = join(w.root, "d".repeat(100));
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", deep], w.env);
    const panel = await createPanelServer(opts, w.env); panels.push(panel);
    expect(panel.socketPath).toBe(null);
    expect(lines.join("")).toContain("control-socket-path-too-long");
  });
});
```

If the `_handle` trick in C2 proves unreliable on the platform, create the stale socket with a child process that listens and is killed with SIGKILL (`node -e "require('net').createServer().listen(process.argv[1])" <path>`), which leaves the file behind the same way a crash does.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement `src/panel/controlSocket.ts`:**

```ts
import express, { type Express } from "express";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "./controlApi.js";
import { sendControlError } from "./controlErrors.js";

/** Agent entry spec §3: the panel's second listener, for agents on this machine. Auth is the file mode. */
export const CONTROL_SOCKET_NAME = "control.sock";
/** sun_path including its NUL: 104 on macOS, 108 on Linux. */
const SUN_PATH_BYTES = process.platform === "darwin" ? 104 : 108;

export const controlSocketPath = (stateDir: string): string => join(stateDir, CONTROL_SOCKET_NAME);
export const socketPathTooLong = (path: string): boolean => Buffer.byteLength(path) >= SUN_PATH_BYTES;

export interface ControlSocketHandle { path: string; close(): void }
export interface ControlSocketFailure { code: "control-socket-path-too-long" | "control-socket-path-occupied" | "control-socket-listen-failed"; detail: string }

/** Spec §3.2: only the control routes; no page, no token, no Host check -- there is no network peer. */
export function buildControlSocketApp(deps: ControlReadApiDeps): Express {
  const app = express();
  app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));
  registerControlReadRoutes(app, deps, "socket");
  app.use((_req, res) => { sendControlError(res, 404, "route-not-found", "The control socket serves only /api/control routes."); });
  return app;
}

const isSocketAt = (path: string): boolean | null => {
  try { return lstatSync(path).isSocket(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};

/**
 * Spec §3.1: called only by the process holding the store lock, after recovery. A socket already at the path is a dead
 * owner's leftover and is replaced; anything else there is not ours to remove.
 */
export async function bindControlSocket(app: Express, path: string): Promise<ControlSocketHandle | ControlSocketFailure> {
  if (socketPathTooLong(path)) return { code: "control-socket-path-too-long", detail: `${Buffer.byteLength(path)} bytes: ${path}` };
  const existing = isSocketAt(path);
  if (existing === false) return { code: "control-socket-path-occupied", detail: path };
  if (existing === true) unlinkSync(path);
  const server: Server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
    chmodSync(path, 0o600);
  } catch (error) {
    server.close();
    return { code: "control-socket-listen-failed", detail: error instanceof Error ? error.message : String(error) };
  }
  let closed = false;
  return {
    path,
    close() {
      if (closed) return;
      closed = true;
      server.close();
      server.closeIdleConnections();
      if (isSocketAt(path) === true) unlinkSync(path);
    },
  };
}
```

- [ ] **Step 5: Wire `src/panel/server.ts`.** Add `socketPath: string | null` to `StartedPanel`. After `runControlPanelStartup(...)` and before the pump is armed:

```ts
  // Agent entry spec §3.1: only the store's holder binds, and only after recovery -- the same ordering as the TCP listen.
  let socket: ControlSocketHandle | null = null;
  if (control !== null) {
    const bound = await bindControlSocket(
      buildControlSocketApp({ store: control.store, epoch, config: control.config, service: control.service, port: control.port }),
      controlSocketPath(control.store.stateDir),
    );
    if ("code" in bound) process.stderr.write(`orca-panel: control socket unavailable: ${bound.code}: ${bound.detail}\n`);
    else socket = bound;
  }
```

Close order (spec §3.3): change the `closed` handler to `server.once("close", () => { socket?.close(); control?.close(); resolve(); })`; in `onSignal` call `socket?.close()` inside the `finally` before `server.close()`; in the returned `close()` call `socket?.close()` before `server.close(...)`. Return `socketPath: socket?.path ?? null`. Use the same deps object the TCP `buildApi` receives (copy its exact field list from the `buildApi` call so they cannot diverge).

- [ ] **Step 6: stderr line** in `src/cli.ts` `runPanel`, after the existing "open … in a browser" line: `if (started.socketPath !== null) process.stderr.write(\`orca-panel: control socket ${started.socketPath}\n\`);` (decision D1; stdout unchanged).

- [ ] **Step 7: Run** the new file, then `npx vitest run tests/panel > $SCRATCH/t3panel.txt 2>&1` and typecheck. Expected PASS; read the whole file for any regression (existing panel criteria must stay green; any boot under a long temp path must only print the stderr line).

- [ ] **Step 8: Mutations (clone):** (a) delete `if (existing === true) unlinkSync(path);` → C2 stale test red; (b) delete `chmodSync(path, 0o600);` → C1 red (if umask yields 0o600 anyway, set `process.umask(0o022)` in the test's `beforeEach` and restore it after — record); (c) delete the unlink inside `close()` → C3 red; (d) delete `if (control !== null)` guard's body binding (bind unconditionally with `control!`) → C4 red; (e) delete the `existing === false` refusal → C2 regular-file test red.

- [ ] **Step 9: Commit** `feat(panel): serve the control routes on an owner-only unix socket`.

---

### Task 4: Socket gate and attribution in the route handler

**Files:** Modify: `src/panel/controlApi.ts` (mutation handler), `src/panel/controlSocket.ts` (header middleware); Test: `tests/panel/controlSocketGate.test.ts`

**Interfaces:**
- Consumes: `humanOnlyRefusal` (Task 2), `CLIENT_HEADER`, `CLIENT_PATTERN`, `withCommandClient` (Task 1), `ControlChannel` (Task 3), `overSocket` helper (copy it into this test file; do not import across test files).
- Produces: socket requests without a valid header → 400 `control-client-invalid`; human-only refusals → 403; every route-delivered command row carries `client`.

- [ ] **Step 1: Failing tests** `tests/panel/controlSocketGate.test.ts` (reuse the Task 3 `workspace`/`boot`/`overSocket` helpers verbatim at the top of this file). The repository id in `--repo proj=…` mode is `controlRepoKey("proj")` from `src/panel/controlOptions.ts`.

```ts
// ...helpers from Task 3 copied here...
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { openControlStore } from "../../src/control/store.js";

const send = (panel: StartedPanel, route: string, envelope: unknown, client = "cli:test") =>
  overSocket(panel.socketPath!, "POST", `/api/control/${route}`, { "x-orca-client": client }, envelope);
const ledger = async (state: string) => {
  // Read through the panel's own store would race the writer; the panel exposes none, so read the row count over the
  // command lookup route instead where possible. For counts, use node:sqlite read-only on the file.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT id, client FROM commands ORDER BY id").all() as Array<{ id: string; client: string | null }>; } finally { db.close(); }
};

describe("the socket gate (spec §4.2, §5, §6)", () => {
  it("C11: a socket request without a valid client header is refused before any route, and books nothing", async () => {
    const w = await workspace(); const panel = await boot(w);
    for (const headers of [{}, { "x-orca-client": "web" }, { "x-orca-client": "cli:" }]) {
      const res = await overSocket(panel.socketPath!, "GET", "/api/control/summary", headers);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.text).error.code).toBe("control-client-invalid");
    }
    const repo = controlRepoKey("proj");
    const res = await overSocket(panel.socketPath!, "POST", `/api/control/repositories/${repo}/workspace-mode`, {}, { commandId: "no-header", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(res.status).toBe(400);
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("no-header");
  });

  it("C9: set-limit over the socket is refused by name and books nothing; over the Web it is not", async () => {
    const w = await workspace(); const panel = await boot(w);
    const res = await send(panel, "groups/g1/set-limit", { commandId: "lim-1", expectedRevision: 0, payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).error).toMatchObject({ code: "control-verb-human-only", retryable: false });
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("lim-1");
    const web = await fetch(`${panel.url}/api/control/groups/g1/set-limit`, { method: "POST", headers: { "x-orca-token": panel.token, "content-type": "application/json" }, body: JSON.stringify({ commandId: "lim-2", expectedRevision: 0, payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } }) });
    expect(((await web.json()) as { error: { code: string } }).error.code).not.toBe("control-verb-human-only");
  });

  it("C10: requirement-open with limit and proposal-edit with proposedGroupLimit are refused; without the field they are not", async () => {
    const w = await workspace(); const panel = await boot(w);
    const amount = { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 };
    const withLimit = await send(panel, "requirements", { commandId: "ro-1", expectedRevision: 0, payload: { groupId: "g2", repoId: controlRepoKey("proj"), idea: "x", limit: amount } });
    expect(JSON.parse(withLimit.text).error.code).toBe("control-field-human-only");
    const edit = await send(panel, "groups/g2/proposal/edit", { commandId: "pe-1", expectedRevision: 0, payload: { baseProposalVersion: 1, operations: [], proposedGroupLimit: amount } });
    expect(JSON.parse(edit.text).error.code).toBe("control-field-human-only");
    const without = await send(panel, "requirements", { commandId: "ro-2", expectedRevision: 0, payload: { groupId: "g3", repoId: controlRepoKey("proj"), idea: "x" } });
    expect(JSON.parse(without.text).error?.code ?? "accepted").not.toBe("control-field-human-only");
    expect((await ledger(w.state)).map((row) => row.id)).not.toEqual(expect.arrayContaining(["ro-1"]));
  });

  it("C12: rows carry the client; a Web command retried over the socket replays and keeps 'web'", async () => {
    const w = await workspace(); const panel = await boot(w);
    const repo = controlRepoKey("proj");
    const envelope = { commandId: "ws-socket", expectedRevision: 0, payload: { workspaceMode: "clone" } };
    const first = await send(panel, `repositories/${repo}/workspace-mode`, envelope, "cli:claude");
    expect(first.status).toBe(200);
    const webEnvelope = { commandId: "ws-web", expectedRevision: 1, payload: { workspaceMode: "worktree" } };
    const web = await fetch(`${panel.url}/api/control/repositories/${repo}/workspace-mode`, { method: "POST", headers: { "x-orca-token": panel.token, "content-type": "application/json" }, body: JSON.stringify(webEnvelope) });
    expect(web.status).toBe(200);
    const webBody = await web.text();
    // Same commandId, same payload, other channel: identical raw command (actorId is the panel operator on both), so a replay.
    const replay = await send(panel, `repositories/${repo}/workspace-mode`, webEnvelope, "mcp:other");
    expect(replay.status).toBe(200);
    expect(replay.text).toBe(webBody);
    const rows = await ledger(w.state);
    expect(rows.find((row) => row.id === "ws-socket")?.client).toBe("cli:claude");
    expect(rows.find((row) => row.id === "ws-web")?.client).toBe("web");
  });
});
```

Adjust the `requirement-open` payload to the real `requirementOpenPayloadSchema` (`src/control/webProtocol.ts:783`; `idea` is `ideaSchema`) so that "without the field" fails, if at all, for a reason other than the schema — the assertion only requires that the refusal is not the human-only code. If the database file is not `control.sqlite`, use the name from `store.ts`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Header middleware** — in `buildControlSocketApp`, first middleware (before `express.json`):

```ts
  app.use((req, res, next) => {
    const client = req.header(CLIENT_HEADER);
    if (client === undefined || !CLIENT_PATTERN.test(client)) {
      sendControlError(res, 400, "control-client-invalid", `Socket requests carry ${CLIENT_HEADER}: cli|mcp[:<name>].`);
      return;
    }
    res.locals.orcaClient = client;
    next();
  });
```

- [ ] **Step 4: Gate and attribution** in the mutation handler (`controlApi.ts:331`), at the top of the `try`:

```ts
      if (channel === "socket") {
        const refusal = humanOnlyRefusal(route.verb, (req.body as { payload?: unknown } | undefined)?.payload);
        if (refusal !== null) { sendControlError(res, 403, refusal.code, refusal.message); return; }
      }
```

and wrap the `switch` plus the result lookup so the service call runs inside the client context:

```ts
      const client = channel === "web" ? "web" : String(res.locals.orcaClient);
      await withCommandClient(command.commandId, client, async () => {
        switch (command.verb) { /* unchanged cases */ }
      });
```

(The `lookupCommandResult` and response lines stay after the wrapper, unchanged.)

- [ ] **Step 5: Run** the new file, `tests/panel/controlSocket.test.ts`, `npx vitest run tests/panel tests/control/web*.test.ts > $SCRATCH/t4.txt 2>&1`, typecheck. Expected PASS.

- [ ] **Step 6: Mutations (clone):** (a) delete the header middleware's refusal (`next()` always) → C11 red; (b) delete the socket gate block → C9 and C10 red; (c) replace `client` with `"web"` in the wrapper → C12 socket-row assertion red; (d) remove `withCommandClient` wrapper (call switch directly) → C12 red (rows null).

- [ ] **Step 7: Commit** `feat(panel): gate the human-only surface and attribute socket commands`.

---

### Task 5: Client library (`src/entry/`)

**Files:** Create: `src/entry/envelope.ts`, `src/entry/discovery.ts`, `src/entry/socketClient.ts`, `src/entry/operations.ts`; Test: `tests/entry/discovery.test.ts`, `tests/entry/operations.test.ts`

**Interfaces:**
- Consumes: `controlRoot` (`src/panel/controlOptions.ts`), `projectsFilePath`, `readProjectsFile` (`src/panel/projectsFile.ts`), `CONTROL_SOCKET_NAME`, `socketPathTooLong` (Task 3), `idSchema` (`src/control/schema.ts`).
- Produces:
  - `envelope.ts`: `interface CliResponseV1 { schema: "orca-cli-response-v1"; status: number; commandId?: string; body: unknown }`; `class EntryRejection extends Error { code: string; retryable: boolean }`; `localError(error: EntryRejection, commandId?: string): CliResponseV1`; `exitCodeFor(response: CliResponseV1): 0 | 1 | 2`.
  - `discovery.ts`: `discoverSocketPath(input: { stateDirFlag?: string; env: NodeJS.ProcessEnv }): string` (throws `EntryRejection`).
  - `socketClient.ts`: `requestOverSocket(input: { socketPath: string; method: "GET" | "POST"; path: string; client: string; body?: unknown; timeoutMs?: number }): Promise<{ status: number; body: unknown }>` (throws `EntryRejection`).
  - `operations.ts`: `controlGet(input: { socketPath: string; client: string; path: string }): Promise<CliResponseV1>`; `controlSend(input: { socketPath: string; client: string; route: string; expectedRevision: number; payload: unknown; commandId?: string; commandIdPrefix?: "cli" | "mcp" }): Promise<CliResponseV1>`. Both never throw `EntryRejection` (they return `localError(...)`).

- [ ] **Step 1: Failing tests.** `tests/entry/discovery.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSocketPath } from "../../src/entry/discovery.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "od-")); roots.push(r); return r; }

describe("socket discovery (spec §4.3)", () => {
  it("prefers the flag, then the projects file's controlStateDir, then ORCA_CONTROL_DIR, then ~/.orca", async () => {
    const r = await root();
    const projects = join(r, "projects.json");
    await writeFile(projects, JSON.stringify({ version: 1, controlStateDir: join(r, "fromfile"), projects: [] }), { mode: 0o600 });
    const env = { ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ stateDirFlag: join(r, "flag"), env })).toBe(join(r, "flag", "control.sock"));
    expect(discoverSocketPath({ env })).toBe(join(r, "fromfile", "control.sock"));
    expect(discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") } })).toBe(join(r, "ctl", "panel", "control.sock"));
    expect(discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(r, "missing.json") } })).toBe(join(homedir(), ".orca", "control", "panel", "control.sock"));
  });

  it("C20: a projects file that exists but does not parse is refused by name, not guessed past", async () => {
    const r = await root();
    const projects = join(r, "projects.json");
    await writeFile(projects, "{ not json", { mode: 0o600 });
    expect(() => discoverSocketPath({ env: { ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") } })).toThrow(expect.objectContaining({ code: "control-projects-file-invalid" }));
  });
});
```

`tests/entry/operations.test.ts` — a fake panel on a socket, so the library is judged alone:

```ts
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { idSchema } from "../../src/control/schema.js";
import { exitCodeFor } from "../../src/entry/envelope.js";
import { controlGet, controlSend } from "../../src/entry/operations.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function fakePanel(handler: (method: string, url: string, headers: Record<string, unknown>, body: string) => { status: number; body: unknown }) {
  const dir = await mkdtemp(join(tmpdir(), "of-"));
  const socketPath = join(dir, "control.sock");
  const seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const out = handler(req.method!, req.url!, req.headers, body);
      res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  cleanups.push(async () => { await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { socketPath, seen };
}

describe("controlGet / controlSend (spec §4)", () => {
  it("C6-shape: wraps a 200 read verbatim, exit 0, with the client header and the /api/control prefix", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: { schema: "orca-control-summary-v1" } }));
    const out = await controlGet({ socketPath: panel.socketPath, client: "cli", path: "summary?sinceChangeSeq=3" });
    expect(out).toEqual({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-control-summary-v1" } });
    expect(exitCodeFor(out)).toBe(0);
    expect(panel.seen[0]).toMatchObject({ method: "GET", url: "/api/control/summary?sinceChangeSeq=3" });
    expect(panel.seen[0]!.headers["x-orca-client"]).toBe("cli");
  });

  it("C8: a generated commandId matches idSchema and is in the envelope even when the panel answers an error", async () => {
    const panel = await fakePanel(() => ({ status: 409, body: { error: { code: "revision-conflict", retryable: false } } }));
    const out = await controlSend({ socketPath: panel.socketPath, client: "cli", route: "groups/g1/pause-dispatch", expectedRevision: 4, payload: {} });
    expect(out.status).toBe(409);
    expect(idSchema.safeParse(out.commandId).success).toBe(true);
    expect(out.commandId).toMatch(/^cli-[0-9a-f-]{36}$/);
    expect(exitCodeFor(out)).toBe(2);
    expect(JSON.parse(panel.seen[0]!.body)).toEqual({ commandId: out.commandId, expectedRevision: 4, payload: {} });
  });

  it("keeps a given commandId and uses the mcp prefix when asked", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: {} }));
    expect((await controlSend({ socketPath: panel.socketPath, client: "mcp", route: "r", expectedRevision: 0, payload: {}, commandId: "keep-1" })).commandId).toBe("keep-1");
    expect((await controlSend({ socketPath: panel.socketPath, client: "mcp", route: "r", expectedRevision: 0, payload: {}, commandIdPrefix: "mcp" })).commandId).toMatch(/^mcp-/);
  });

  it("C14-lib: no socket is panel-not-running, retryable, exit 1", async () => {
    const out = await controlGet({ socketPath: join(tmpdir(), "nope-" + process.pid, "control.sock"), client: "cli", path: "summary" });
    expect(out).toMatchObject({ status: 0, body: { error: { code: "panel-not-running", retryable: true } } });
    expect(exitCodeFor(out)).toBe(1);
  });

  it("refuses bad paths, binary routes and bad arguments locally, before any request", async () => {
    const panel = await fakePanel(() => ({ status: 200, body: {} }));
    for (const path of ["/summary", "groups/../x", "", "groups/a b"]) {
      expect((await controlGet({ socketPath: panel.socketPath, client: "cli", path })).body).toMatchObject({ error: { code: "control-cli-path-invalid" } });
    }
    expect((await controlGet({ socketPath: panel.socketPath, client: "cli", path: "runs/r1/evidence/a1" })).body).toMatchObject({ error: { code: "control-cli-binary-route" } });
    expect((await controlSend({ socketPath: panel.socketPath, client: "cli", route: "r", expectedRevision: -1, payload: {} })).body).toMatchObject({ error: { code: "control-cli-argument-invalid" } });
    expect((await controlSend({ socketPath: panel.socketPath, client: "cli", route: "r", expectedRevision: 0, payload: {}, commandId: "-bad" })).body).toMatchObject({ error: { code: "control-cli-argument-invalid" } });
    expect((await controlSend({ socketPath: panel.socketPath, client: "cli", route: "summary?x=1", expectedRevision: 0, payload: {} })).body).toMatchObject({ error: { code: "control-cli-path-invalid" } });
    expect(panel.seen).toEqual([]);
  });

  it("C15-lib: a socket path over the limit is refused by name", async () => {
    const out = await controlGet({ socketPath: "/" + "a".repeat(120) + "/control.sock", client: "cli", path: "summary" });
    expect(out.body).toMatchObject({ error: { code: "control-socket-path-too-long" } });
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `src/entry/envelope.ts`:**

```ts
/** Agent entry spec §4.4: the one JSON object the CLI prints and the MCP bridge returns. */
export interface CliResponseV1 { schema: "orca-cli-response-v1"; status: number; commandId?: string; body: unknown }

/** A refusal made on this side of the socket; `status` 0 in the envelope. */
export class EntryRejection extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message); }
}

export function localError(error: EntryRejection, commandId?: string): CliResponseV1 {
  return { schema: "orca-cli-response-v1", status: 0, ...(commandId === undefined ? {} : { commandId }), body: { error: { code: error.code, message: error.message, retryable: error.retryable } } };
}

/** 0: the panel answered 2xx. 1: refused here. 2: the panel answered an error (its body names it). */
export function exitCodeFor(response: CliResponseV1): 0 | 1 | 2 {
  if (response.status === 0) return 1;
  return response.status >= 200 && response.status < 300 ? 0 : 2;
}
```

- [ ] **Step 4: Implement `src/entry/discovery.ts`:**

```ts
import { join } from "node:path";
import { controlRoot } from "../panel/controlOptions.js";
import { CONTROL_SOCKET_NAME } from "../panel/controlSocket.js";
import { projectsFilePath, readProjectsFile } from "../panel/projectsFile.js";
import { EntryRejection } from "./envelope.js";

/**
 * Spec §4.3: the same answer the panel's default file/registry mode gives (controlOptions.ts:135), read-only.
 * Deterministic and never guessed past: a broken projects file is refused, not skipped.
 */
export function discoverSocketPath(input: { stateDirFlag?: string; env: NodeJS.ProcessEnv }): string {
  if (input.stateDirFlag !== undefined && input.stateDirFlag.length > 0) return join(input.stateDirFlag, CONTROL_SOCKET_NAME);
  const file = projectsFilePath(input.env);
  const read = readProjectsFile(file);
  if (read.kind === "invalid") throw new EntryRejection("control-projects-file-invalid", `${file}: ${read.reason}`);
  if (read.kind === "valid" && read.config.controlStateDir !== undefined) return join(read.config.controlStateDir, CONTROL_SOCKET_NAME);
  return join(controlRoot(input.env), "panel", CONTROL_SOCKET_NAME);
}
```

- [ ] **Step 5: Implement `src/entry/socketClient.ts`:**

```ts
import { request } from "node:http";
import { CLIENT_HEADER } from "../control/commandClient.js";
import { socketPathTooLong } from "../panel/controlSocket.js";
import { EntryRejection } from "./envelope.js";

/** Spec §4: HTTP over the panel's socket. Connection: close, so the panel's shutdown never waits on an idle client. */
export function requestOverSocket(input: { socketPath: string; method: "GET" | "POST"; path: string; client: string; body?: unknown; timeoutMs?: number }): Promise<{ status: number; body: unknown }> {
  if (socketPathTooLong(input.socketPath)) return Promise.reject(new EntryRejection("control-socket-path-too-long", `${Buffer.byteLength(input.socketPath)} bytes: ${input.socketPath}`));
  return new Promise((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const req = request({
      socketPath: input.socketPath, method: input.method, path: `/api/control/${input.path}`,
      headers: { connection: "close", [CLIENT_HEADER]: input.client, ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown }); }
        catch { reject(new EntryRejection("control-cli-response-invalid", `the panel answered ${res.statusCode} with a body that is not JSON`)); }
      });
    });
    req.setTimeout(input.timeoutMs ?? 120_000, () => req.destroy(new EntryRejection("control-socket-timeout", "the panel did not answer in time", true)));
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof EntryRejection) reject(error);
      else if (error.code === "ENOENT" || error.code === "ECONNREFUSED") reject(new EntryRejection("panel-not-running", `no panel is listening at ${input.socketPath}; start it with: orca panel --by <who>`, true));
      else reject(error);
    });
    req.end(payload);
  });
}
```

(`control-cli-response-invalid` joins the local codes list; add it to the Global Constraints line in the ledger when recording.)

- [ ] **Step 6: Implement `src/entry/operations.ts`:**

```ts
import { randomUUID } from "node:crypto";
import { idSchema } from "../control/schema.js";
import { EntryRejection, localError, type CliResponseV1 } from "./envelope.js";
import { requestOverSocket } from "./socketClient.js";

const SEGMENT = /^[A-Za-z0-9@:._-]+$/;
const BINARY = /^runs\/[^/?]+\/evidence\/[^/?]+/;

/** Spec §4.1: the CLI checks only what it needs to build a request; the panel's schemas judge the rest. */
function checkPath(path: string, allowQuery: boolean): void {
  const [route, query] = path.split("?", 2) as [string, string | undefined];
  if (query !== undefined && !allowQuery) throw new EntryRejection("control-cli-path-invalid", "a command route takes no query string");
  const segments = route.split("/");
  if (route.length === 0 || segments.some((segment) => !SEGMENT.test(segment) || segment === "." || segment === ".."))
    throw new EntryRejection("control-cli-path-invalid", `not a control path: ${JSON.stringify(path)} (no leading /, no .., ASCII segments)`);
  if (allowQuery && BINARY.test(route)) throw new EntryRejection("control-cli-binary-route", "evidence artifacts are binary; read runs/<id>/evidence for the manifest");
}

export async function controlGet(input: { socketPath: string; client: string; path: string }): Promise<CliResponseV1> {
  try {
    checkPath(input.path, true);
    const { status, body } = await requestOverSocket({ socketPath: input.socketPath, method: "GET", path: input.path, client: input.client });
    return { schema: "orca-cli-response-v1", status, body };
  } catch (error) {
    if (error instanceof EntryRejection) return localError(error);
    throw error;
  }
}

export async function controlSend(input: { socketPath: string; client: string; route: string; expectedRevision: number; payload: unknown; commandId?: string; commandIdPrefix?: "cli" | "mcp" }): Promise<CliResponseV1> {
  const commandId = input.commandId ?? `${input.commandIdPrefix ?? "cli"}-${randomUUID()}`;
  try {
    checkPath(input.route, false);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new EntryRejection("control-cli-argument-invalid", "--expected-revision wants a non-negative integer");
    if (!idSchema.safeParse(commandId).success) throw new EntryRejection("control-cli-argument-invalid", "--command-id must start with a letter or digit, at most 200 characters");
    const { status, body } = await requestOverSocket({ socketPath: input.socketPath, method: "POST", path: input.route, client: input.client, body: { commandId, expectedRevision: input.expectedRevision, payload: input.payload } });
    return { schema: "orca-cli-response-v1", status, commandId, body };
  } catch (error) {
    if (error instanceof EntryRejection) return localError(error, commandId);
    throw error;
  }
}
```

- [ ] **Step 7: Run** both test files → PASS; typecheck → 0.
- [ ] **Step 8: Mutations (clone):** (a) delete the projects-file step in discovery → first discovery test red; (b) delete the `invalid` throw → C20 red; (c) in `controlSend` error path return `localError(error)` without commandId → C8-adjacent: add assertion in the bad-argument test that `commandId` is present on local errors too (`expect(out.commandId).toBeDefined()`) and see it red; (d) change `exitCodeFor` to return 0 for any status → C8 red; (e) map ENOENT to a non-retryable error → C14-lib red.
- [ ] **Step 9: Commit** `feat(entry): discover the panel socket and speak to it with one response envelope`.

---

### Task 6: `orca control` CLI

**Files:** Create: `src/entry/controlCommand.ts`; Modify: `src/cli.ts` (USAGE, dispatch); Test: `tests/entry/controlCommand.test.ts`, `tests/entry/panelSocketE2e.test.ts`

**Interfaces:**
- Consumes: `discoverSocketPath`, `controlGet`, `controlSend`, `exitCodeFor`, `localError`, `EntryRejection`.
- Produces: `runControlCommand(args: string[], env: NodeJS.ProcessEnv, io?: { write(line: string): void; readFile(path: string): string }): Promise<number>`.

- [ ] **Step 1: Failing tests.** `tests/entry/controlCommand.test.ts` (in-process, captured output):

```ts
import { describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";

async function run(args: string[], env: NodeJS.ProcessEnv = { ORCA_PROJECTS_FILE: "/nonexistent/p.json", ORCA_CONTROL_DIR: "/nonexistent/ctl" }, files: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await runControlCommand(args, env, { write: (line) => lines.push(line), readFile: (path) => { if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files[path]!; } });
  return { code, lines };
}

describe("orca control argv and output (spec §4.1, §4.4, C16)", () => {
  it("prints exactly one JSON line for every outcome, including local refusals", async () => {
    for (const args of [[], ["get"], ["send", "r"], ["send", "r", "--expected-revision", "x", "--payload", "{}"], ["send", "r", "--expected-revision", "0", "--payload", "{bad"], ["get", "summary", "--bogus"], ["get", "summary"]]) {
      const { code, lines } = await run(args);
      expect(lines.length, JSON.stringify(args)).toBe(1);
      expect(lines[0]!.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.schema).toBe("orca-cli-response-v1");
      expect(code).toBe(1);
    }
  });

  it("names argument errors, and panel-not-running when nothing listens", async () => {
    expect(JSON.parse((await run(["send", "r", "--expected-revision", "0"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
    expect(JSON.parse((await run(["send", "r", "--expected-revision", "0", "--payload", "{}", "--payload-file", "f"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
    expect(JSON.parse((await run(["get", "summary"])).lines[0]!).body.error.code).toBe("panel-not-running");
  });

  it("reads --payload-file and refuses a bad --client-name", async () => {
    const out = await run(["send", "r", "--expected-revision", "0", "--payload-file", "/p.json"], undefined, { "/p.json": "{\"a\":1}" });
    expect(JSON.parse(out.lines[0]!).body.error.code).toBe("panel-not-running");
    expect(JSON.parse((await run(["get", "summary", "--client-name", "bad name"])).lines[0]!).body.error.code).toBe("control-cli-argument-invalid");
  });
});
```

`tests/entry/panelSocketE2e.test.ts` — a real panel booted in-process (Task 3 helpers copied) plus the real CLI spawned:

```ts
// helpers: workspace(), boot() from Task 3 copied here
import { spawn } from "node:child_process";
import { controlSummarySchema } from "../../src/control/webProtocol.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

function cli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c)); child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("orca control against a real panel (C6, C7, C14)", () => {
  it("reads the summary, sends a command, looks it up, and replays it byte-identically", async () => {
    const w = await workspace(); const panel = await boot(w);
    const env = { ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") };
    const read = await cli(["control", "get", "summary", "--control-state-dir", w.state], env);
    expect(read.code).toBe(0);
    const summary = JSON.parse(read.stdout);
    expect(read.stdout.trim().split("\n")).toHaveLength(1);
    expect(controlSummarySchema.safeParse(summary.body).success).toBe(true);

    const repo = controlRepoKey("proj");
    const sendArgs = ["control", "send", `repositories/${repo}/workspace-mode`, "--expected-revision", "0", "--payload", "{\"workspaceMode\":\"clone\"}", "--command-id", "e2e-1", "--control-state-dir", w.state];
    const sent = await cli(sendArgs, env);
    expect(sent.code).toBe(0);
    const first = JSON.parse(sent.stdout);
    expect(first).toMatchObject({ status: 200, commandId: "e2e-1" });
    const lookup = await cli(["control", "get", `groups/@repository:${repo}/commands/e2e-1`, "--control-state-dir", w.state], env);
    expect(JSON.parse(lookup.stdout).body).toEqual(first.body);
    const again = await cli(sendArgs, env);
    expect(JSON.parse(again.stdout).body).toEqual(first.body);
    void panel;
  });

  it("C14: with no panel the CLI says panel-not-running, exit 1, and creates nothing", async () => {
    const w = await workspace();
    const env = { ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") };
    const out = await cli(["control", "get", "summary", "--control-state-dir", w.state], env);
    expect(out.code).toBe(1);
    expect(JSON.parse(out.stdout).body.error.code).toBe("panel-not-running");
    await expect(stat(w.state)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C3: SIGTERM to a spawned panel removes the socket; its stderr names the socket", async () => {
    const w = await workspace();
    const env = { ...w.env, HOME: w.root };
    const child = spawn(join(process.cwd(), "node_modules", ".bin", "tsx"), ["src/cli.ts", "panel", "--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", w.state], { cwd: process.cwd(), env: { ...process.env, ...env } });
    let stderr = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no socket line: " + stderr)), 30_000);
      child.stderr.on("data", (c) => { stderr += c; if (stderr.includes("orca-panel: control socket ")) { clearTimeout(timer); resolve(); } });
    });
    const path = join(await realpath(w.state), "control.sock");
    expect((await lstat(path)).isSocket()).toBe(true);
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});
```

(The command-result scope for a repository verb is `@repository:<repoId>`, per `controlApi.ts:292-297`; URL-encode it if the router needs it — check `/api/control/groups/:groupId/commands/:commandId` handling of `@` and `:`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `src/entry/controlCommand.ts`:**

```ts
import { readFileSync } from "node:fs";
import { CLIENT_PATTERN } from "../control/commandClient.js";
import { discoverSocketPath } from "./discovery.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "./envelope.js";
import { controlGet, controlSend } from "./operations.js";

const VALUE_FLAGS = new Set(["--control-state-dir", "--client-name", "--expected-revision", "--payload", "--payload-file", "--command-id"]);

/** Spec §4: `orca control get|send`. stdout carries exactly one JSON line, whatever happens short of a crash. */
export async function runControlCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  io: { write(line: string): void; readFile(path: string): string } = { write: (line) => process.stdout.write(line), readFile: (path) => readFileSync(path, "utf8") },
): Promise<number> {
  const print = (response: CliResponseV1): number => { io.write(`${JSON.stringify(response)}\n`); return exitCodeFor(response); };
  try {
    const [sub, target, ...rest] = args;
    const flags = new Map<string, string>();
    for (let i = 0; i < rest.length; i += 2) {
      const name = rest[i]!, value = rest[i + 1];
      if (!VALUE_FLAGS.has(name) || value === undefined || flags.has(name)) throw new EntryRejection("control-cli-argument-invalid", `unexpected argument ${JSON.stringify(name)}`);
      flags.set(name, value);
    }
    if ((sub !== "get" && sub !== "send") || target === undefined) throw new EntryRejection("control-cli-argument-invalid", "usage: orca control get <path> | send <route> --expected-revision <n> --payload <json>");
    const name = flags.get("--client-name");
    const client = name === undefined ? "cli" : `cli:${name}`;
    if (!CLIENT_PATTERN.test(client)) throw new EntryRejection("control-cli-argument-invalid", "--client-name wants letters, digits, . _ - (at most 64)");
    const socketPath = discoverSocketPath({ stateDirFlag: flags.get("--control-state-dir"), env });
    if (sub === "get") {
      for (const only of ["--expected-revision", "--payload", "--payload-file", "--command-id"]) if (flags.has(only)) throw new EntryRejection("control-cli-argument-invalid", `${only} is for send`);
      return print(await controlGet({ socketPath, client, path: target }));
    }
    const revisionText = flags.get("--expected-revision");
    if (revisionText === undefined || !/^(0|[1-9][0-9]*)$/.test(revisionText)) throw new EntryRejection("control-cli-argument-invalid", "--expected-revision wants a non-negative integer");
    const inline = flags.get("--payload"), file = flags.get("--payload-file");
    if ((inline === undefined) === (file === undefined)) throw new EntryRejection("control-cli-argument-invalid", "give exactly one of --payload and --payload-file");
    let payload: unknown;
    try { payload = JSON.parse(inline ?? io.readFile(file!)); }
    catch { throw new EntryRejection("control-cli-argument-invalid", "the payload is not readable JSON"); }
    return print(await controlSend({ socketPath, client, route: target, expectedRevision: Number(revisionText), payload, commandId: flags.get("--command-id") }));
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
```

- [ ] **Step 4: Wire `src/cli.ts`.** In `main`, before the USAGE fallthrough: `if (command === "control") { const { runControlCommand } = await import("./entry/controlCommand.js"); return runControlCommand(rest, process.env); }`. Add to USAGE (after the `orca agents show` entry):

```
  orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
  orca control send <route> --expected-revision <n> (--payload <json> | --payload-file <file>)
                    [--command-id <id>] [--control-state-dir <dir>] [--client-name <name>]
                                 talk to a running panel over its control socket (<state dir>/control.sock,
                                 found from --control-state-dir, the projects file's controlStateDir,
                                 $ORCA_CONTROL_DIR/panel or ~/.orca/control/panel). stdout is one JSON line,
                                 {"schema":"orca-cli-response-v1",status,commandId?,body}. Never starts a panel.
                                 set-limit and a budget limit field are refused: a person sets those in the
                                 Web UI. Exit 0 answered 2xx, 1 refused here (panel-not-running included),
                                 2 the panel answered an error
```

If a test asserts USAGE text (`tests/**/usage.test.ts`), read it and extend it rather than weaken it.

- [ ] **Step 5: Run** both files, `tests/panel/usage.test.ts`, typecheck → PASS.
- [ ] **Step 6: Mutations (clone):** (a) make `print` write two lines (`io.write(...); io.write("\n")`) → C16 red; (b) remove the `--payload`/`--payload-file` exclusivity check → second test red; (c) remove the `if (command === "control")` dispatch → E2E red.
- [ ] **Step 7: Commit** `feat(cli): add orca control get and send over the panel socket`.

---

### Task 7: Skill

**Files:** Create: `skills/orca-control/SKILL.md`; Test: `tests/entry/skill.test.ts`

- [ ] **Step 1: Failing test** `tests/entry/skill.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync("skills/orca-control/SKILL.md", "utf8");
const api = readFileSync("src/panel/controlApi.ts", "utf8");

describe("the orca-control skill (spec §7, C18)", () => {
  it("has frontmatter naming it", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: orca-control$/m);
    expect(front).toMatch(/^description: .{20,}$/m);
  });

  it("lists exactly the panel's mutation routes, so the table cannot drift", () => {
    const routes = new Set([...api.matchAll(/path: "\/api\/control\/([^"]+)"/g)].map((m) => m[1]!.replace(/:([A-Za-z]+)/g, "<$1>")));
    expect(routes.size).toBe(23);
    const table = new Set([...skill.matchAll(/^\| `POST ([^`]+)` \|/gm)].map((m) => m[1]!));
    expect([...table].sort()).toEqual([...routes].sort());
  });

  it("teaches the four rules", () => {
    for (const phrase of ["--expected-revision", "--command-id", "panel-not-running", "control-verb-human-only", "control-field-human-only", "revision-conflict"]) expect(skill).toContain(phrase);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write `skills/orca-control/SKILL.md`.** Frontmatter `name: orca-control`, `description: Use when operating Orca from an agent — reading task groups, opening requirements, answering clarifications, confirming or starting work — through the orca control CLI against a running panel.` Body sections, in English: (1) prerequisites (a panel running; never start one; `panel-not-running` → ask the human); (2) reading (`orca control get summary|groups/<id>|recovery|groups/<scope>/commands/<id>`); (3) writing (read the revision first, `send … --expected-revision N --payload '<json>'`, `revision-conflict` → re-read and decide again); (4) retries (`commandId` from the envelope; resend with `--command-id`; look the result up); (5) long work (poll the group view every 30–60 s; never wait on a command); (6) what only a person does (`set-limit`, `requirement-open.limit`, `proposal-edit.proposedGroupLimit` → `control-verb-human-only` / `control-field-human-only`); (7) exit codes and envelope; (8) the route table: one row per mutation route, format `| \`POST <route with <param>>\` | <verb> | <minimal payload example> |`, payloads taken from the schemas in `src/control/webProtocol.ts` (read each schema; do not invent fields), e.g. `| \`POST groups/<groupId>/pause-dispatch\` | pause-dispatch | \`{}\` |`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Mutation (clone):** delete one table row → route-set test red.
- [ ] **Step 6: Commit** `docs(skill): teach agents to operate Orca through orca control`.

---

### Task 8: MCP bridge

**Files:** Modify: `package.json`, `package-lock.json` (dependency); Create: `src/entry/mcp.ts`; Modify: `src/cli.ts` (dispatch, USAGE); Test: `tests/entry/mcp.test.ts`

**Interfaces:**
- Consumes: `discoverSocketPath`, `controlGet`, `controlSend`, `localError`, `EntryRejection`, `CLIENT_PATTERN`.
- Produces: `runMcpServe(args: string[], env: NodeJS.ProcessEnv): Promise<number>`; tools `orca_read`, `orca_send`.

- [ ] **Step 1: Dependency.** `npm install @modelcontextprotocol/sdk@^1 > $SCRATCH/t8npm.txt 2>&1; echo rc=$?`; read the file. Then `npm ls zod > $SCRATCH/t8zod.txt 2>&1` and read it: the root `zod` must be the same version as before the install (record both). If npm would change the root zod, stop and record it in the ledger as a blocker instead of accepting the change.
- [ ] **Step 2: Failing test** `tests/entry/mcp.test.ts`:

```ts
// helpers: workspace(), boot() from Task 3 copied here
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connect(w: { root: string; state: string; env: Record<string, string> }) {
  const transport = new StdioClientTransport({
    command: join(process.cwd(), "node_modules", ".bin", "tsx"),
    args: ["src/cli.ts", "mcp", "serve", "--control-state-dir", w.state],
    cwd: process.cwd(),
    env: { ...process.env as Record<string, string>, ...w.env, HOME: w.root, ORCA_PROJECTS_FILE: join(w.root, "none.json") },
  });
  const client = new Client({ name: "orca-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
const envelope = (result: { content: Array<{ type: string; text?: string }> }) => JSON.parse(result.content[0]!.text!);

describe("orca mcp serve (spec §8, C17, C14)", () => {
  it("lists exactly orca_read and orca_send, and both round-trip against the panel", async () => {
    const w = await workspace(); await boot(w);
    const client = await connect(w);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["orca_read", "orca_send"]);
      const read = await client.callTool({ name: "orca_read", arguments: { path: "summary" } });
      expect(read.isError ?? false).toBe(false);
      expect(envelope(read as never)).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
      const repo = controlRepoKey("proj");
      const sent = await client.callTool({ name: "orca_send", arguments: { route: `repositories/${repo}/workspace-mode`, expectedRevision: 0, payload: { workspaceMode: "clone" } } });
      expect(envelope(sent as never)).toMatchObject({ status: 200, commandId: expect.stringMatching(/^mcp-/) });
      const refused = await client.callTool({ name: "orca_send", arguments: { route: "groups/g1/set-limit", expectedRevision: 0, payload: { limit: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 } } } });
      expect(refused.isError).toBe(true);
      expect(envelope(refused as never).body.error.code).toBe("control-verb-human-only");
    } finally { await client.close(); }
  }, 60_000);

  it("C14: with no panel, orca_read answers panel-not-running as an error result", async () => {
    const w = await workspace();
    const client = await connect(w);
    try {
      const read = await client.callTool({ name: "orca_read", arguments: { path: "summary" } });
      expect(read.isError).toBe(true);
      expect(envelope(read as never).body.error.code).toBe("panel-not-running");
    } finally { await client.close(); }
  }, 60_000);

  it("refuses malformed tool arguments as an error result, without a request", async () => {
    const w = await workspace();
    const client = await connect(w);
    try {
      const bad = await client.callTool({ name: "orca_send", arguments: { route: "r", expectedRevision: "zero", payload: {} } });
      expect(bad.isError).toBe(true);
      expect(envelope(bad as never).body.error.code).toBe("control-cli-argument-invalid");
    } finally { await client.close(); }
  }, 60_000);
});
```

- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement `src/entry/mcp.ts`** (decision D4: low-level `Server`, JSON Schema inputs):

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_PATTERN } from "../control/commandClient.js";
import { discoverSocketPath } from "./discovery.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "./envelope.js";
import { controlGet, controlSend } from "./operations.js";

const TOOLS = [
  {
    name: "orca_read",
    description: "Read Orca control state from the running panel: summary, groups/<id>, groups/<id>/requirement, recovery, groups/<scope>/commands/<commandId>, config, agents, operator/agent-preferences. Returns {schema:'orca-cli-response-v1',status,body}.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "orca_send",
    description: "Deliver one control command to the running panel (route as in the orca-control skill, e.g. groups/<id>/requirement/answer). Read the revision first; reuse commandId when retrying. set-limit and budget limit fields are refused: a person sets them. Returns {schema,status,commandId,body}.",
    inputSchema: {
      type: "object",
      properties: { route: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 }, payload: { type: "object" }, commandId: { type: "string" } },
      required: ["route", "expectedRevision", "payload"], additionalProperties: false,
    },
  },
] as const;

/** Spec §8: a stdio MCP server that is only a socket client. No resources, prompts or tasks; never starts a panel. */
export async function runMcpServe(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const flag = args[0] === "serve" ? args.indexOf("--control-state-dir") : -1;
  if (args[0] !== "serve" || (args.length !== 1 && !(args.length === 3 && flag === 1))) {
    process.stderr.write("usage: orca mcp serve [--control-state-dir <dir>]\n");
    return 1;
  }
  const stateDirFlag = flag === 1 ? args[2] : undefined;
  const server = new Server({ name: "orca", version: "0.1.0" }, { capabilities: { tools: {} } });
  const clientHeader = (): string => {
    const name = server.getClientVersion()?.name;
    return name !== undefined && CLIENT_PATTERN.test(`mcp:${name}`) ? `mcp:${name}` : "mcp";
  };
  const result = (response: CliResponseV1) => ({ content: [{ type: "text" as const, text: JSON.stringify(response) }], isError: exitCodeFor(response) !== 0 });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const input = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const socketPath = discoverSocketPath({ stateDirFlag, env });
      if (request.params.name === "orca_read") {
        if (typeof input.path !== "string") throw new EntryRejection("control-cli-argument-invalid", "path must be a string");
        return result(await controlGet({ socketPath, client: clientHeader(), path: input.path }));
      }
      if (request.params.name === "orca_send") {
        const { route, expectedRevision, payload, commandId } = input;
        if (typeof route !== "string" || typeof expectedRevision !== "number" || typeof payload !== "object" || payload === null || Array.isArray(payload) || (commandId !== undefined && typeof commandId !== "string"))
          throw new EntryRejection("control-cli-argument-invalid", "orca_send wants route (string), expectedRevision (integer), payload (object), commandId (string, optional)");
        return result(await controlSend({ socketPath, client: clientHeader(), route, expectedRevision, payload, commandId: commandId as string | undefined, commandIdPrefix: "mcp" }));
      }
      throw new EntryRejection("control-cli-argument-invalid", `unknown tool ${request.params.name}`);
    } catch (error) {
      if (error instanceof EntryRejection) return result(localError(error));
      throw error;
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => { transport.onclose = () => resolve(); process.stdin.on("end", () => resolve()); });
  return 0;
}
```

If the SDK's installed version names an API differently (e.g. `getClientVersion`), read its `.d.ts` under `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts` and adapt; record the version used.

- [ ] **Step 5: Wire `src/cli.ts`:** `if (command === "mcp") { const { runMcpServe } = await import("./entry/mcp.js"); return runMcpServe(rest, process.env); }`; USAGE entry:

```
  orca mcp serve [--control-state-dir <dir>]
                                 a stdio MCP server with two tools, orca_read and orca_send, that talk to a
                                 running panel over its control socket exactly as orca control does
```

- [ ] **Step 6: Run** the MCP test, `tests/panel/usage.test.ts`, typecheck → PASS.
- [ ] **Step 7: Mutations (clone):** (a) make `result` always `isError: false` → refusal assertion red; (b) drop `commandIdPrefix: "mcp"` → `^mcp-` assertion red; (c) drop the argument type check → malformed-arguments test red.
- [ ] **Step 8: Commit** `feat(mcp): add orca mcp serve as a thin client of the panel socket` (include `package.json` and `package-lock.json`).

---

### Task 9: Gates, mutation evidence and ledger close

**Files:** Modify: `.superpowers/sdd/2026-10-07-agent-entry/progress.md` (append only)

- [ ] **Step 1: Isolated clone gate.** In `$SCRATCH/orca-n2-gate` (`git clone --local` at the final commit), with HOME, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` relocated into the scratchpad and a short `TMPDIR`, `npm ci`, then each into its own file with `echo rc=$?` appended: `npm run typecheck`, `npm run build --workspace web`, `npm run --ws check`, `npm test`, `npm run verify:control` (with the scratch `ORCA_CCLOOP_BIN` and `ORCA_AGENTS_TABLE` from the earlier gate), `npm run verify:panel`, `node scripts/check-tmp-leak.mjs`. Read every file whole.
- [ ] **Step 2: Known flakes.** A failure in `driverRecovery`, `driverRequirementSplit` or `controlShutdown` is re-run alone three times and recorded with load averages (`uptime`); any other failure is a real failure and gets fixed.
- [ ] **Step 3: Mutation table.** Collect every mutation from Tasks 1–8 into one table: mutation, criterion, observed red (test name + assertion), restore proof (`git diff | wc -c` = 0 in the clone).
- [ ] **Step 4: Append to the ledger** the gate table (command, rc, counts, commit), the mutation table, decisions D1–D5 and any execution-time rulings. Commit `docs(sdd): close the N2 agent entry round in its ledger` with `git add -f`.

---

## Self-review

- Spec coverage: §3.1 (Task 3), §3.2 (Tasks 3–4), §3.3 (Task 3; ready line per D1), §3.4 (spec only), §4.1–§4.4 (Tasks 5–6), §5 (Tasks 2, 4), §6 (Tasks 1, 4), §7 (Task 7), §8 (Task 8), §9 C1–C20 (C1/C2/C3/C4/C5/C15 Task 3 and 6; C6/C7/C14/C16 Tasks 5–6; C8 Task 5; C9–C12 Task 4; C13 Task 1; C17 Task 8; C18 Task 7; C19 Task 2; C20 Task 5), regression gates (Task 9).
- Types: `ControlChannel`, `ControlSocketHandle`, `CliResponseV1`, `EntryRejection`, `controlGet`/`controlSend` signatures are identical wherever used.
