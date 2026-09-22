// CLAUDE.md Rule 4's ONE success criterion for the E3 web panel: start the
// real `orca panel` against a throwaway repository and walk the twelve steps
// of spec §7 over real HTTP, exiting 0 only if every one holds.
//
// Wired into `npm run verify` after `npm run build --workspace web` (task 9
// ruling L4): the panel's default dist directory only exists once that build
// has actually run, and this script is the first thing in the whole chain
// that would notice if it did not (Rule 4: "panel-dist-missing" is exactly
// the unreachable-success-criterion shape this task exists to close).
//
// Every child `orca panel` process is spawned the way
// tests/panel/security.test.ts's `runPanelProcess` does: detached, killed by
// its whole process GROUP (negative pid), because tsx re-execs into a child
// node process and signalling only the tsx pid would orphan the listener
// (measured there). ORCA_CORRECTIONS_DIR always points at a directory this
// script itself creates and removes -- never the real ~/.orca (Rule 17).
//
// `main` runs only when this file is executed directly; its pure helpers
// (`parseReadyLine`, first of all) are exported for tests/panel/endToEnd.test.ts.

import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { makeChainRepo } from "../tests/helpers/chainRepo.js";
import { fakeClaude } from "../tests/helpers/fakeClaude.js";
import { CORRECTION_ALREADY_RECORDED, readCorrections, recordCorrection } from "../src/corrections/store.js";
import type { Correction } from "../src/corrections/schema.js";
import { projectKeyOf } from "../src/corrections/projectKey.js";
import { UNRESOLVED_PROJECT_KEYS } from "../src/metrics/discover.js";
import { isHighTier } from "../src/metrics/highTier.js";
import { DECISION_KINDS, DECISION_SCOPES } from "../src/ledger/types.js";
import type { DecisionEvent } from "../src/ledger/schema.js";
import { appendEvents } from "../src/ledger/writer.js";
import { detailUrl } from "../src/panel/listProjection.js";
import { TOKEN_REQUIRED } from "../src/panel/rejection.js";
import { EXTERNAL_BIND_NOT_CONFIRMED, PANEL_HOST_NOT_ALLOWED } from "../src/panel/bindGuard.js";
import { REVIEWS_LOCK_TIMEOUT_MS } from "../src/panel/reviewsLock.js";
import { readReviews } from "../src/panel/reviewsStore.js";
import { TOKEN_ANCHOR } from "../src/panel/staticFiles.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// The script's own parser -- pinned by tests/panel/endToEnd.test.ts (ruling
// L3), so `orca-panel ready url=<url> token=<token>` (src/cli.ts) has exactly
// one place that reads it back.
// ---------------------------------------------------------------------------

export class ReadyLineParseError extends Error {}

export interface ReadyLine {
  url: string;
  token: string;
}

const READY_LINE = /^orca-panel ready url=(\S+) token=(\S+)\s*$/;

/** Reads the CLI's ONE machine-readable line out of (possibly multi-line) stdout. */
export function parseReadyLine(stdout: string): ReadyLine {
  for (const line of stdout.split("\n")) {
    const match = READY_LINE.exec(line);
    if (!match) continue;
    const [, url, token] = match;
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
      throw new ReadyLineParseError(`ready line's url ${JSON.stringify(url)} is not http://127.0.0.1:<port>`);
    }
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new ReadyLineParseError(`ready line's token ${JSON.stringify(token)} is not 64 lowercase hex characters`);
    }
    return { url, token };
  }
  throw new ReadyLineParseError("no 'orca-panel ready' line found in stdout");
}

// ---------------------------------------------------------------------------
// Step bookkeeping. Rule 4: one command, exit 0 or non-zero. Every step
// prints exactly one PASS/FAIL line; the first failure aborts the remaining
// steps (teardown still runs, in `main`'s `finally`).
// ---------------------------------------------------------------------------

class StepFailure extends Error {
  constructor(
    readonly step: number,
    readonly what: string,
    readonly expected: unknown,
    readonly got: unknown,
  ) {
    super(`step ${step} (${what}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
}

function fail(step: number, what: string, expected: unknown, got: unknown): never {
  throw new StepFailure(step, what, expected, got);
}

function pass(step: number, what: string): void {
  console.log(`PASS ${step} ${what}`);
}

/** Attributes a rejected promise to a step, instead of letting it fall through unnamed. */
async function must<T>(step: number, what: string, expectedDesc: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    fail(step, what, expectedDesc, err instanceof Error ? err.message : String(err));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ruling R61 (fix round 1): teardown must never hang waiting to confirm a
 * child is dead. Bounds any such wait so "cannot confirm dead" becomes a
 * named, timed-out failure instead of a stuck process.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Ruling R59 / L5: an absence check ("still 0", "still only N") must not
 * trust an immediate read -- a fire-and-forget write can land ~500ms after
 * the response that triggered it (measured in task 6). Polls until any check
 * EXCEEDS its ceiling (fails fast, naming the real number) or the window
 * elapses, then asserts every check sits at exactly its expected value.
 *
 * Never prints its own PASS line -- the caller does, once, after every check
 * for its step has passed (contract: exactly one PASS line per step).
 */
async function assertStaysAt(
  step: number,
  what: string,
  checks: ReadonlyArray<{ label: string; get: () => Promise<number>; expected: number }>,
  windowMs: number,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const results = await Promise.all(checks.map(async (c) => ({ ...c, got: await c.get() })));
    const exceeded = results.find((r) => r.got > r.expected);
    if (exceeded) fail(step, `${what} (${exceeded.label})`, exceeded.expected, exceeded.got);
    if (Date.now() >= deadline) {
      for (const r of results) {
        if (r.got !== r.expected) fail(step, `${what} (${r.label})`, r.expected, r.got);
      }
      return;
    }
    await sleep(50);
  }
}

/** Positive wait: poll until `get()` reaches exactly `expected`, or time out. */
async function waitForExactly(
  step: number,
  what: string,
  label: string,
  get: () => Promise<number>,
  expected: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let got = await get();
  while (got !== expected && Date.now() < deadline) {
    await sleep(50);
    got = await get();
  }
  if (got !== expected) fail(step, `${what} (${label})`, expected, got);
}

/** Same budget as the reviews lock (ruling L5): long enough for the slowest legal write. */
const WINDOW_MS = REVIEWS_LOCK_TIMEOUT_MS + 1000;

// ---------------------------------------------------------------------------
// Git + fixture helpers. Deliberately NOT imported from
// tests/corrections/harness.ts: that file pulls in a test-only sandbox
// module, and this script is not a test.
// ---------------------------------------------------------------------------

const GIT_IDENTITY = ["-c", "user.name=verify-panel", "-c", "user.email=verify-panel@invalid"];

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...GIT_IDENTITY, ...args], { cwd: repo });
  return stdout;
}

/**
 * Ruling R61 (fix round 1): every destructive removal this script runs is a
 * `mkdtemp` directory it created itself, never a path taken on faith. Refuses
 * an empty string outright (an empty `path` to `rm(..., {recursive:true})`
 * would resolve against the current working directory) and refuses anything
 * that does not carry the exact `mkdtemp` prefix this script minted it with,
 * so a future bug that hands this an unexpected value fails loudly instead of
 * silently deleting the wrong tree.
 */
async function guardedRmRecursive(path: string, expectedPrefix: string): Promise<void> {
  if (path.length === 0 || !path.includes(expectedPrefix)) {
    throw new Error(
      `refusing to recursively remove ${JSON.stringify(path)}: expected a path containing ${JSON.stringify(expectedPrefix)}`,
    );
  }
  await rm(path, { recursive: true, force: true });
}

/** K5's pattern: choose a high-tier (scope, kind) by calling isHighTier, never a hard-coded table. */
function findHighTierCombo(): { scope: (typeof DECISION_SCOPES)[number]; kind: (typeof DECISION_KINDS)[number] } {
  for (const scope of DECISION_SCOPES) {
    for (const kind of DECISION_KINDS) {
      if (isHighTier(scope, kind)) return { scope, kind };
    }
  }
  throw new Error("no (scope, kind) combination classifies as high tier -- isHighTier's table changed shape");
}

interface Fixture {
  repoPath: string;
  repoKey: string;
  decisionA: { id: string };
  decisionB: { id: string };
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "orca-panel-verify-target-"));
  const repoPath = join(root, "repo");
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init"]);
  await git(repoPath, ["remote", "add", "origin", "https://github.com/biran/orca.git"]);
  await writeFile(join(repoPath, "README.md"), "verify-panel fixture\n");
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, ["commit", "-m", "init"]);

  // Measured (L5): this is what discoverRepos would derive from the remote if
  // --repo did not name it explicitly. Used anyway, so this fixture's --repo
  // key matches what a real `orca correct` run against this same remote would
  // produce -- --repo itself never checks it against the remote.
  const repoKey = await projectKeyOf(repoPath);

  const { scope, kind } = findHighTierCombo();
  const base = {
    ev: "decision" as const,
    run: "verify-panel-1",
    question: "which lock",
    chose: "in-process mutex",
    alternatives: [{ option: "file lease", why_not: "too heavy for this" }],
    because: "fastest to implement",
    undo: { how: "git revert <ref>", cost: "roll back three repos' W branches", blast_radius: "three repos" },
    scope,
    kind,
  };
  const decisionA: DecisionEvent = { ...base, id: "verify-panel-1/1", at: "2020-01-01T00:00:00.000Z" };
  const decisionB: DecisionEvent = { ...base, id: "verify-panel-1/2", at: "2020-01-01T00:01:00.000Z" };
  const decisionsDir = join(repoPath, ".decisions");
  await appendEvents(decisionsDir, "verify-panel-1", [decisionA, decisionB]);
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, ["commit", "-m", "seed two high-tier decisions"]);

  return {
    repoPath,
    repoKey,
    decisionA: { id: decisionA.id },
    decisionB: { id: decisionB.id },
    cleanup: () => guardedRmRecursive(root, "orca-panel-verify-target-"),
  };
}

async function snapshotDecisionsDir(dir: string): Promise<Record<string, string>> {
  const names = (await readdir(dir).catch(() => [])).sort();
  const out: Record<string, string> = {};
  for (const name of names) {
    out[name] = createHash("sha256").update(await readFile(join(dir, name))).digest("hex");
  }
  return out;
}

// ---------------------------------------------------------------------------
// ~/.orca snapshot (ruling R56): Rule 17's own gate, the one case in this
// script that reads the real home directory -- read-only, only to prove
// nothing else in the run wrote there. A permanent "still absent" would
// punish anyone who has ever run `orca correct` for real, so this compares a
// before/after snapshot rather than asserting absence outright.
// ---------------------------------------------------------------------------

interface HomeOrcaSnapshot {
  exists: boolean;
  entries: Array<{ path: string; size: number; mtimeMs: number }>;
}

async function snapshotHomeOrca(): Promise<HomeOrcaSnapshot> {
  const dir = join(homedir(), ".orca");
  const exists = await stat(dir).then(
    () => true,
    () => false,
  );
  if (!exists) return { exists: false, entries: [] };

  const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const walk = async (sub: string): Promise<void> => {
    const items = await readdir(join(dir, sub), { withFileTypes: true });
    for (const item of items) {
      const rel = sub === "" ? item.name : `${sub}/${item.name}`;
      if (item.isDirectory()) {
        await walk(rel);
      } else {
        const info = await stat(join(dir, rel));
        entries.push({ path: rel, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  };
  await walk("");
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { exists: true, entries };
}

// ---------------------------------------------------------------------------
// Child process plumbing, mirroring tests/panel/security.test.ts's
// `runPanelProcess` (F5): detached, killed by process GROUP, a deadline
// shorter than the step it backs. tsx re-execs into a child node process, so
// killing only the spawned pid would orphan the grandchild that actually
// calls listen() -- measured there.
// ---------------------------------------------------------------------------

/**
 * 🔴 CLAUDE.md Rule 17. `orca panel` mounts the control plane by default and its state lives under
 * ~/.orca/control/<key> unless ORCA_CONTROL_DIR says otherwise. Step 14 asserts ~/.orca is unchanged
 * by the whole run, and it caught this: without relocation, every panel this script spawns writes a
 * control store into a real home directory. Set here rather than at each call site so that a new
 * step cannot forget it -- an explicit value in `env` still wins.
 */
const VERIFY_CONTROL_ROOT = mkdtempSync(join(tmpdir(), "orca-panel-verify-control-"));

function spawnOrcaCli(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  env = { ORCA_CONTROL_DIR: VERIFY_CONTROL_ROOT, ...env };
  return spawn("./node_modules/.bin/tsx", ["src/cli.ts", ...args], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/**
 * Attached ONCE, at spawn time -- never a fresh `child.once("exit", ...)`
 * called after the fact. A process killed by signal (killGroup's SIGKILL)
 * leaves `child.exitCode` null forever (Node sets `signalCode` instead), and
 * the "exit" event itself fires exactly once: a second listener added after
 * that single firing never sees it and hangs forever. Measured: this is
 * exactly what made the panel's own backstop cleanup (in `main`'s `finally`,
 * re-awaiting a child step 12 had already killed and awaited) leave every
 * mkdtemp directory behind with no error printed anywhere.
 */
function watchExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

interface ReadyChild {
  child: ChildProcess;
  ready: Promise<ReadyLine>;
  exited: Promise<number | null>;
}

/** Spawns the real panel and waits for its ONE machine-readable line, never a fixed sleep. */
function spawnPanelAndAwaitReady(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): ReadyChild {
  const child = spawnOrcaCli(args, env);
  const exited = watchExit(child);
  let stdoutBuf = "";
  let stderrBuf = "";
  let settled = false;

  const ready = new Promise<ReadyLine>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup(child);
      reject(
        new Error(
          `orca panel (pid ${child.pid}) never printed its ready line within ${timeoutMs}ms. ` +
            `stdout: ${JSON.stringify(stdoutBuf)} stderr: ${JSON.stringify(stderrBuf)}`,
        ),
      );
    }, timeoutMs);

    const tryParse = (): void => {
      if (settled) return;
      try {
        const parsed = parseReadyLine(stdoutBuf);
        settled = true;
        clearTimeout(timer);
        resolve(parsed);
      } catch {
        // Not there yet (or not yet a complete line) -- keep waiting.
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      tryParse();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(`orca panel (pid ${child.pid}) exited with code ${code} before a ready line. stderr: ${stderrBuf}`),
      );
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });

  return { child, ready, exited };
}

interface ExitedChild {
  pid: number | undefined;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Step 11's second process: expected to refuse and exit BY ITSELF. A hang means the guard is gone. */
// Step 13 also uses this function, with its own label and hang sentence.
function runToExit(
  args: string[],
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
  label = "orca panel",
  hangMeans = " A hang here means the bind guard let the server actually start.",
): Promise<ExitedChild> {
  const child = spawnOrcaCli(args, env);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup(child);
      reject(
        new Error(
          `${label} (pid ${child.pid}) did not exit by itself within ${deadlineMs}ms; the whole process ` +
            `group was killed.${hangMeans} stderr: ${stderr}`,
        ),
      );
    }, deadlineMs);

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, code, stdout, stderr });
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolves once `pid` no longer exists; rejects naming it after `ms`. */
async function waitForPidGone(pid: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`pid ${pid} is still alive after ${ms}ms`);
    await sleep(100);
  }
}

async function lsofListenForPid(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]);
    return stdout;
  } catch (err) {
    const asExec = err as { code?: unknown; stdout?: string };
    // lsof exits 1 (with empty stdout) when nothing matches -- the expected,
    // ordinary case here (the process has exited), not a tool failure.
    if (typeof asExec.code === "number") return asExec.stdout ?? "";
    throw new Error(`could not run lsof to check pid ${pid}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function rawGet(
  hostname: string,
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function apiGet(baseUrl: string, path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, token === undefined ? {} : { headers: { "x-orca-token": token } });
}

async function apiPost(baseUrl: string, path: string, body: unknown, token: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "x-orca-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const homeBefore = await snapshotHomeOrca();
  const cleanups: Array<{ what: string; run: () => Promise<void> | void }> = [];
  let exitCode = 0;

  try {
    // Pre-check (task 9 ruling L5 / spec §7): the panel's default dist
    // directory has to exist and be flat BEFORE any step runs, or every run
    // of this script stops at the same wall no matter what it tests.
    const distDir = join(process.cwd(), "web", "dist");
    const distEntries = await readdir(distDir, { withFileTypes: true }).catch(() => {
      fail(0, "web/dist exists (run `npm run build --workspace web` first)", "web/dist to exist", "missing");
    });
    const subdirs = distEntries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (subdirs.length > 0) {
      fail(0, "web/dist has no subdirectory (staticFiles.ts reads the top level only)", [], subdirs);
    }
    const indexHtml = await readFile(join(distDir, "index.html"), "utf8").catch(() => "");
    if (!indexHtml.includes(TOKEN_ANCHOR)) {
      fail(0, "web/dist/index.html carries the token anchor", TOKEN_ANCHOR, indexHtml.length === 0 ? "<missing file>" : "<anchor absent>");
    }
    pass(0, "web/dist exists, is flat, and carries the token anchor");

    const fixture = await makeFixture();
    cleanups.push({ what: "remove the throwaway target repo", run: fixture.cleanup });

    const storeDir = await mkdtemp(join(tmpdir(), "orca-panel-verify-store-"));
    cleanups.push({
      what: "remove the throwaway ORCA_CORRECTIONS_DIR",
      run: () => guardedRmRecursive(storeDir, "orca-panel-verify-store-"),
    });

    const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CORRECTIONS_DIR: storeDir };

    // Step 1: start the real panel, parse its ONE machine-readable line.
    const panelArgs = [
      "panel",
      "--by",
      "tester",
      "--port",
      "0",
      "--bind",
      "127.0.0.1",
      "--repo",
      `${fixture.repoKey}=${fixture.repoPath}`,
    ];
    const { child: panelChild, ready, exited: panelExited } = spawnPanelAndAwaitReady(panelArgs, env, 10_000);
    cleanups.push({
      what: "kill the panel child's process group and confirm it exited",
      run: () => {
        killGroup(panelChild);
        return withTimeout(
          panelExited,
          5_000,
          `panel child (pid ${panelChild.pid}) did not confirm exit within 5000ms after SIGKILL`,
        ).then(() => undefined);
      },
    });

    const readyLine = await must(1, "orca panel prints its ready line", "orca-panel ready url=... token=...", ready);
    const { url: baseUrl, token } = readyLine;
    const parsedUrl = new URL(baseUrl);
    const host = parsedUrl.hostname;
    const port = Number(parsedUrl.port);
    pass(1, `orca panel is up at ${baseUrl}, ready line parsed`);

    const A = fixture.decisionA.id;
    const B = fixture.decisionB.id;
    const projectKey = fixture.repoKey;

    const countRows = async (decisionId: string, action: "opened" | "reviewed"): Promise<number> => {
      const rows = await readReviews(storeDir);
      return rows.filter((r) => r.projectKey === projectKey && r.decisionId === decisionId && r.action === action)
        .length;
    };

    // Step 2: list, with token -- listing must record nothing (mutation E-1).
    const listRes = await apiGet(baseUrl, "/api/decisions", token);
    if (listRes.status !== 200) fail(2, "GET /api/decisions succeeds", 200, listRes.status);
    await assertStaysAt(
      2,
      "listing records nothing (opened/reviewed stay 0 for both decisions)",
      [
        { label: `opened(${A})`, get: () => countRows(A, "opened"), expected: 0 },
        { label: `reviewed(${A})`, get: () => countRows(A, "reviewed"), expected: 0 },
        { label: `opened(${B})`, get: () => countRows(B, "opened"), expected: 0 },
        { label: `reviewed(${B})`, get: () => countRows(B, "reviewed"), expected: 0 },
      ],
      WINDOW_MS,
    );
    pass(2, "listing records nothing (opened/reviewed stay 0 for both decisions)");

    // Step 3: open one decision's detail -- `opened` lands (async,
    // fire-and-forget); `reviewed` does not (spec §4.2: paging past != reading).
    const detailRes = await apiGet(baseUrl, detailUrl(projectKey, A), token);
    if (detailRes.status !== 200) fail(3, "GET decision detail succeeds", 200, detailRes.status);
    await waitForExactly(
      3,
      "opened lands exactly once for the opened decision",
      `opened(${A})`,
      () => countRows(A, "opened"),
      1,
      WINDOW_MS,
    );
    await assertStaysAt(
      3,
      "reviewed stays 0 for the merely-opened decision",
      [{ label: `reviewed(${A})`, get: () => countRows(A, "reviewed"), expected: 0 }],
      WINDOW_MS,
    );
    pass(3, "opening a decision's detail records exactly one 'opened' row and no 'reviewed' row");

    // Step 4: open the SAME detail again -- dedupe means the count stays at 1.
    const detailRes2 = await apiGet(baseUrl, detailUrl(projectKey, A), token);
    if (detailRes2.status !== 200) fail(4, "GET decision detail (again) succeeds", 200, detailRes2.status);
    await assertStaysAt(
      4,
      "opening the same detail again does not duplicate the 'opened' row",
      [{ label: `opened(${A})`, get: () => countRows(A, "opened"), expected: 1 }],
      WINDOW_MS,
    );
    pass(4, "re-opening the same decision's detail does not duplicate the 'opened' row");

    // Step 5: click "agreed" on the OTHER decision -- reviewed lands
    // (synchronous, awaited by the handler), coverage's numerator becomes 1,
    // and it drops off the to-do list while the merely-opened decision stays.
    const agreeRes = await apiPost(baseUrl, "/api/reviews", { projectKey, decisionId: B }, token);
    if (agreeRes.status !== 200) fail(5, "POST /api/reviews (agreed) succeeds", 200, agreeRes.status);
    const reviewedB = await countRows(B, "reviewed");
    if (reviewedB !== 1) fail(5, "agreeing records exactly one 'reviewed' row", 1, reviewedB);
    const metricsAfterAgree = (await (await apiGet(baseUrl, "/api/metrics", token)).json()) as {
      panel_review_coverage: { reviewed_high_tier: number };
    };
    if (metricsAfterAgree.panel_review_coverage.reviewed_high_tier !== 1) {
      fail(5, "coverage numerator becomes 1", 1, metricsAfterAgree.panel_review_coverage.reviewed_high_tier);
    }
    const todoAfterAgree = (await (await apiGet(baseUrl, "/api/todo", token)).json()) as { rows: Array<{ id: string }> };
    const todoIds = todoAfterAgree.rows.map((r) => r.id);
    if (todoIds.includes(B)) fail(5, "the agreed decision leaves the to-do list", false, true);
    if (!todoIds.includes(A)) fail(5, "the other high-tier decision stays on the to-do list", true, false);
    pass(5, "agreeing records 'reviewed', moves the coverage numerator to 1, and updates the to-do list");

    // Step 6: record a correction on the OPENED decision -- corrections gets a
    // row, reviews gets a 'reviewed' row for it too, and the target repo is
    // untouched (A' §4.1: the panel never closes the loop).
    const beforeDecisions = await snapshotDecisionsDir(join(fixture.repoPath, ".decisions"));
    const beforeHead = await git(fixture.repoPath, ["rev-parse", "HEAD"]);
    const correctRes = await apiPost(
      baseUrl,
      "/api/corrections",
      { projectKey, decisionId: A, kind: "wrong", because: "verify:panel step 6 fixture" },
      token,
    );
    if (correctRes.status !== 200) fail(6, "POST /api/corrections succeeds", 200, correctRes.status);
    const correctionsAfter = await readCorrections(storeDir);
    if (correctionsAfter.length !== 1) fail(6, "exactly one correction is stored", 1, correctionsAfter.length);
    const reviewedAAfterCorrection = await countRows(A, "reviewed");
    if (reviewedAAfterCorrection !== 1) fail(6, "recording a correction also records 'reviewed' for it", 1, reviewedAAfterCorrection);
    const porcelain = await git(fixture.repoPath, ["status", "--porcelain"]);
    if (porcelain !== "") fail(6, "the target repo's git status stays clean", "", porcelain);
    const headAfter = await git(fixture.repoPath, ["rev-parse", "HEAD"]);
    if (headAfter !== beforeHead) fail(6, "the target repo's HEAD does not move", beforeHead, headAfter);
    const afterDecisions = await snapshotDecisionsDir(join(fixture.repoPath, ".decisions"));
    if (JSON.stringify(afterDecisions) !== JSON.stringify(beforeDecisions)) {
      fail(6, "the target repo's .decisions/ is byte-identical", beforeDecisions, afterDecisions);
    }
    pass(6, "recording a correction records it and 'reviewed', and never closes the loop");

    // Step 7: recording a SECOND correction on the SAME decision is refused BY
    // NAME, with the panel's own message (not the CLI's --again wording).
    const secondRes = await apiPost(
      baseUrl,
      "/api/corrections",
      { projectKey, decisionId: A, kind: "stale", because: "verify:panel step 7 fixture" },
      token,
    );
    if (secondRes.status !== 409) fail(7, "a second correction on the same decision is refused", 409, secondRes.status);
    const secondBody = (await secondRes.json()) as { code: string; message: string; retry_field: string };
    if (secondBody.code !== CORRECTION_ALREADY_RECORDED) {
      fail(7, "refusal names CORRECTION_ALREADY_RECORDED", CORRECTION_ALREADY_RECORDED, secondBody.code);
    }
    if (secondBody.message.includes("--again")) fail(7, "the panel's own message never mentions --again", false, true);
    if (secondBody.retry_field !== "again") fail(7, "retry_field names 'again'", "again", secondBody.retry_field);
    const correctionsAfterSecond = await readCorrections(storeDir);
    if (correctionsAfterSecond.length !== 1) {
      fail(7, "the refused second correction is not stored", 1, correctionsAfterSecond.length);
    }
    pass(7, "a second correction on the same decision is refused by name, with the panel's own message");

    // Step 8: inject a correction with an unresolvable projectKey directly
    // into the redirected store, AFTER the panel is already up -- the
    // integrity gate (spec §2.1.1 row 1) is re-evaluated on every request, so
    // the very next one must answer 409 by name.
    const unresolvableRow: Correction = {
      id: `verify-panel-unresolvable-${Date.now()}`,
      projectKey: "verify-panel-unresolvable-project",
      decisionId: "does-not-matter/1",
      kind: "wrong",
      because: "verify:panel step 8 fixture",
      at: new Date().toISOString(),
      by: "verify-panel",
    };
    await recordCorrection(storeDir, unresolvableRow, { again: true });
    const gatedRes = await apiGet(baseUrl, "/api/metrics", token);
    if (gatedRes.status !== 409) fail(8, "the next request notices the unresolvable projectKey", 409, gatedRes.status);
    const gatedBody = (await gatedRes.json()) as { code: string };
    if (gatedBody.code !== UNRESOLVED_PROJECT_KEYS) {
      fail(8, "refusal names UNRESOLVED_PROJECT_KEYS", UNRESOLVED_PROJECT_KEYS, gatedBody.code);
    }
    pass(8, "a correction with an unresolvable projectKey makes the next request answer 409 by name");

    // Step 9: a raw traversal path (sent through node:http, never fetch --
    // WHATWG URL parsing would collapse the dot segments before it left this
    // process) answers 404; a positive control proves the static route is
    // still the thing answering (without it, deleting the route entirely
    // would leave this step green for the wrong reason).
    const traversal = await rawGet(host, port, "/../../etc/passwd");
    if (traversal.status !== 404) fail(9, "a raw traversal path answers 404", 404, traversal.status);
    const rootRes = await apiGet(baseUrl, "/");
    if (rootRes.status !== 200) fail(9, "GET / (positive control) answers 200", 200, rootRes.status);
    const rootBody = await rootRes.text();
    if (!rootBody.includes(token)) fail(9, "GET / body carries the injected token", true, false);
    // Final review I-4 / ruling R67: the same GET / with a foreign Host (a
    // DNS-rebound page's request, still arriving over loopback) is refused by
    // name and carries no token; the positive control above is its pair.
    const rebound = await rawGet(host, port, "/", { host: `evil.example:${port}` });
    if (rebound.status !== 403) fail(9, "GET / with Host evil.example answers 403", 403, rebound.status);
    if (rebound.body.includes(token)) fail(9, "the 403 body carries no token", false, true);
    let reboundCode: unknown;
    try {
      reboundCode = (JSON.parse(rebound.body) as { code?: unknown }).code;
    } catch {
      reboundCode = rebound.body;
    }
    if (reboundCode !== PANEL_HOST_NOT_ALLOWED) {
      fail(9, "the foreign-Host refusal names PANEL_HOST_NOT_ALLOWED", PANEL_HOST_NOT_ALLOWED, reboundCode);
    }
    pass(
      9,
      "a raw traversal path 404s, GET / still serves the token-injected index.html, and a foreign Host is refused 403 by name without the token",
    );

    // Step 10: no token -- refused by name, never a stack trace.
    const noTokenRes = await apiGet(baseUrl, "/api/metrics");
    if (noTokenRes.status !== 401) fail(10, "a request with no token is refused", 401, noTokenRes.status);
    const noTokenBody = (await noTokenRes.json()) as { code: string };
    if (noTokenBody.code !== TOKEN_REQUIRED) fail(10, "refusal names TOKEN_REQUIRED", TOKEN_REQUIRED, noTokenBody.code);
    pass(10, "a request with no token is refused by name (401 TOKEN_REQUIRED)");

    // Step 11: a second panel, bound to a non-loopback address with NO
    // external-bind confirmation, must refuse by name and never actually
    // listen. TEST-NET-1 (RFC 5737) is on no interface of any machine --
    // never 0.0.0.0, which really would expose a real interface.
    const secondArgs = [
      "panel",
      "--by",
      "tester",
      "--port",
      "0",
      "--bind",
      "192.0.2.1",
      "--repo",
      `${fixture.repoKey}=${fixture.repoPath}`,
    ];
    const secondRun = await must(
      11,
      "the unconfirmed external bind process exits by itself (no hang)",
      "exit within 5000ms",
      runToExit(secondArgs, env, 5_000),
    );
    if (secondRun.code === 0 || secondRun.code === null) {
      fail(11, "the unconfirmed external bind exits non-zero", "non-zero", secondRun.code);
    }
    if (!secondRun.stderr.includes(EXTERNAL_BIND_NOT_CONFIRMED)) {
      fail(11, "the refusal names EXTERNAL_BIND_NOT_CONFIRMED", EXTERNAL_BIND_NOT_CONFIRMED, secondRun.stderr);
    }
    if (secondRun.pid !== undefined) {
      const listening = await lsofListenForPid(secondRun.pid);
      if (listening.trim() !== "") fail(11, "the refused process's pid is not LISTENing on anything", "", listening);
    }
    pass(11, "an unconfirmed external bind is refused by name, and the process never listens");

    // Step 12: close the panel, then prove Rule 17 held -- ~/.orca is exactly
    // what it was before step 1 (this machine, today: absent both times).
    killGroup(panelChild);
    await panelExited;
    const homeAfter = await snapshotHomeOrca();
    if (JSON.stringify(homeAfter) !== JSON.stringify(homeBefore)) {
      fail(12, "~/.orca is unchanged by the whole run", homeBefore, homeAfter);
    }
    pass(12, `panel closed; ~/.orca is unchanged (${homeBefore.exists ? "present" : "absent"} before and after)`);

    // Step 13 (reviews compaction spec 2026-09-16, section 6.2). Not one of E3
    // spec section 7's twelve: it runs after them, on its OWN store directory
    // and its OWN panel process, because step 8 left an unresolvable
    // correction in the first store that makes every collect() refuse.
    // A running panel remembers a `reviewed` row; compaction moves it out while
    // the decision is archived; the decision comes back; agreeing again must
    // WRITE, not answer `duplicate` from memory.
    const storeDir13 = await mkdtemp(join(tmpdir(), "orca-panel-verify-store-"));
    cleanups.push({
      what: "remove step 13's throwaway ORCA_CORRECTIONS_DIR",
      run: () => guardedRmRecursive(storeDir13, "orca-panel-verify-store-"),
    });
    const env13: NodeJS.ProcessEnv = { ...process.env, ORCA_CORRECTIONS_DIR: storeDir13 };
    const {
      child: panel13,
      ready: ready13,
      exited: panel13Exited,
    } = spawnPanelAndAwaitReady(panelArgs, env13, 10_000);
    cleanups.push({
      what: "kill step 13's panel child's process group and confirm it exited",
      run: () => {
        killGroup(panel13);
        return withTimeout(
          panel13Exited,
          5_000,
          `step 13 panel child (pid ${panel13.pid}) did not confirm exit within 5000ms after SIGKILL`,
        ).then(() => undefined);
      },
    });
    const ready13Line = await must(13, "the step 13 panel prints its ready line", "orca-panel ready url=... token=...", ready13);
    const reviewedRows13 = async (decisionId: string): Promise<number> =>
      (await readReviews(storeDir13)).filter(
        (r) => r.projectKey === projectKey && r.decisionId === decisionId && r.action === "reviewed",
      ).length;

    const agree13 = await apiPost(ready13Line.url, "/api/reviews", { projectKey, decisionId: B }, ready13Line.token);
    if (agree13.status !== 200) fail(13, "the first agree succeeds", 200, agree13.status);
    if ((await reviewedRows13(B)) !== 1) fail(13, "the first agree records one 'reviewed' row", 1, await reviewedRows13(B));

    const ledgerName = "verify-panel-1.jsonl";
    const archivedRel = join(".decisions", "archive", "2020", ledgerName);
    await mkdir(join(fixture.repoPath, ".decisions", "archive", "2020"), { recursive: true });
    await git(fixture.repoPath, ["mv", join(".decisions", ledgerName), archivedRel]);
    const compaction = await must(
      13,
      "orca compact-reviews --apply exits by itself",
      "exit within 20000ms",
      runToExit(
        ["compact-reviews", "--apply", "--repo", `${fixture.repoKey}=${fixture.repoPath}`],
        env13,
        20_000,
        "orca compact-reviews",
        " A hang here means compaction never released the reviews lock or never finished.",
      ),
    );
    if (compaction.code !== 0) fail(13, "orca compact-reviews --apply exits 0", 0, `${compaction.code}: ${compaction.stderr}`);
    if ((await reviewedRows13(B)) !== 0) {
      fail(13, "compaction moved the archived decision's 'reviewed' row out of reviews.jsonl", 0, await reviewedRows13(B));
    }
    await git(fixture.repoPath, ["mv", archivedRel, join(".decisions", ledgerName)]);

    const againRes = await apiPost(ready13Line.url, "/api/reviews", { projectKey, decisionId: B }, ready13Line.token);
    if (againRes.status !== 200) fail(13, "agreeing again succeeds", 200, againRes.status);
    const againBody = (await againRes.json()) as { result?: unknown };
    if (againBody.result !== "written") {
      fail(13, "the running panel writes the review again instead of answering duplicate from memory", "written", againBody.result);
    }
    if ((await reviewedRows13(B)) !== 1) fail(13, "exactly one 'reviewed' row is back on disk", 1, await reviewedRows13(B));
    const todo13 = (await (await apiGet(ready13Line.url, "/api/todo", ready13Line.token)).json()) as {
      rows: Array<{ id: string }>;
    };
    if (todo13.rows.some((r) => r.id === B)) fail(13, "the re-reviewed decision is off the to-do list", false, true);

    killGroup(panel13);
    await panel13Exited;
    const homeAfter13 = await snapshotHomeOrca();
    if (JSON.stringify(homeAfter13) !== JSON.stringify(homeBefore)) {
      fail(13, "~/.orca is unchanged by step 13 as well", homeBefore, homeAfter13);
    }
    pass(13, "a running panel writes a review again after compaction moved it out, and ~/.orca is still unchanged");

    // Step 14 (D-launch spec §8.2-8): the real panel opens a chain by spawning `orca chain start`; a fake claude's one
    // session ends it with done; the status view says so; malformed and unknown stops are refused; ~/.orca untouched.
    const chainTarget = await makeChainRepo({ gate: true });
    cleanups.push({ what: "remove step 14's chain target repository", run: chainTarget.cleanup });
    const fake14 = await fakeClaude();
    cleanups.push({ what: "kill step 14's fake claude processes and remove its directory", run: fake14.teardown });
    await fake14.scenario(1, { steps: [{ do: "commit", file: "step14.txt" }, { do: "exitCheckpoint", status: "done", next: [] }], result: { subtype: "success", cost: 0.25 } });
    const storeDir14 = await mkdtemp(join(tmpdir(), "orca-panel-verify-store-"));
    cleanups.push({ what: "remove step 14's throwaway ORCA_CORRECTIONS_DIR", run: () => guardedRmRecursive(storeDir14, "orca-panel-verify-store-") });
    const { child: panel14, ready: ready14, exited: panel14Exited } = spawnPanelAndAwaitReady(
      ["panel", "--by", "tester", "--port", "0", "--bind", "127.0.0.1", "--repo", `chains=${chainTarget.path}`],
      fake14.env({ ORCA_CORRECTIONS_DIR: storeDir14 }),
      10_000,
    );
    cleanups.push({
      what: "kill step 14's panel child's process group and confirm it exited",
      run: () => {
        killGroup(panel14);
        return withTimeout(panel14Exited, 5_000, `step 14 panel child (pid ${panel14.pid}) did not confirm exit within 5000ms after SIGKILL`).then(() => undefined);
      },
    });
    const r14 = await must(14, "the step 14 panel prints its ready line", "orca-panel ready url=... token=...", ready14);
    const startRes = await apiPost(r14.url, "/api/chains", { repoKey: "chains", goal: "verify-panel step 14", maxSessions: 2, maxCostUsd: 1 }, r14.token);
    if (startRes.status !== 200) fail(14, "POST /api/chains starts a chain", 200, `${startRes.status} ${await startRes.text()}`);
    const { chainId } = (await startRes.json()) as { chainId: string };
    if (!/^chain-[0-9a-f]{8}$/.test(chainId)) fail(14, "the answer names the chain", "chain-<8 hex>", chainId);
    // Named rather than `typeof view` (review, TS2339): a `typeof` query on a `let` reassigned inside the same
    // loop it is read in is self-referential and TS collapses it to `never`. A named type sidesteps that.
    type Step14ChainView = { chainId?: string; state?: string; via?: string; by?: string; stop?: { reason?: string } | null };
    let view: Step14ChainView | null = null;
    const until14 = Date.now() + 60_000;
    while (Date.now() < until14) {
      const body = (await (await apiGet(r14.url, "/api/chains", r14.token)).json()) as { repos: Array<{ chain: Step14ChainView | null }> };
      view = body.repos[0]?.chain ?? null;
      if (view?.state === "stopped") break;
      await sleep(250);
    }
    const seen = { chainId: view?.chainId, state: view?.state, reason: view?.stop?.reason, via: view?.via, by: view?.by };
    const wanted = { chainId, state: "stopped", reason: "done", via: "panel", by: "tester" };
    if (JSON.stringify(seen) !== JSON.stringify(wanted)) fail(14, "the status view shows the chain stopped with done", wanted, seen);
    const badId = await apiPost(r14.url, "/api/chains/chain-XYZ/stop", { repoKey: "chains" }, r14.token);
    if (badId.status !== 400) fail(14, "a malformed chain id is refused with 400", 400, badId.status);
    const unknown = await apiPost(r14.url, "/api/chains/chain-00000000/stop", { repoKey: "chains" }, r14.token);
    if (unknown.status !== 404) fail(14, "an unknown chain id is refused with 404", 404, unknown.status);
    const record14 = JSON.parse(await readFile(join(chainTarget.path, ".orca", "chains", `${chainId}.json`), "utf8")) as { supervisorPid: number };
    await must(14, "the chain's supervisor exits by itself", "gone within 10000ms", waitForPidGone(record14.supervisorPid, 10_000));
    killGroup(panel14);
    await panel14Exited;
    const homeAfter14 = await snapshotHomeOrca();
    if (JSON.stringify(homeAfter14) !== JSON.stringify(homeBefore)) fail(14, "~/.orca is unchanged by step 14", homeBefore, homeAfter14);
    pass(14, "the panel opened a chain by spawning orca chain start, it ran to done and the status view says so, bad stops are refused, ~/.orca is unchanged");
  } catch (err) {
    if (err instanceof StepFailure) {
      console.error(`FAIL ${err.step} ${err.what}: ${JSON.stringify(err.expected)} vs ${JSON.stringify(err.got)}`);
    } else {
      console.error(`FAIL (unexpected error): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
    exitCode = 1;
  } finally {
    // Ruling R61 (fix round 1): a teardown failure must be as loud as a step
    // failure -- it is proof this run may have left something behind (a
    // process, a directory) for the NEXT run or the person's own machine to
    // trip over. Every item still runs regardless of an earlier one's
    // failure (one bad removal must not skip the rest), but ANY failure here
    // forces a non-zero exit, even on a run where every numbered step passed.
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup.run();
      } catch (cleanupErr) {
        console.error(
          `FAIL teardown: ${cleanup.what}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
        exitCode = 1;
      }
    }
  }

  return exitCode;
}

// Only runs when invoked directly as `tsx scripts/verify-panel.ts`, mirroring
// src/cli.ts's own guard -- so this module can be imported for its pure
// helpers (parseReadyLine) without starting anything.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
