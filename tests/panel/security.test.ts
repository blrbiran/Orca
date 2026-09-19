import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertBindAllowed, EXTERNAL_BIND_NOT_CONFIRMED, isHostAllowed } from "../../src/panel/bindGuard.js";
import { mintToken, tokenMatches } from "../../src/panel/token.js";
import { parsePanelArgs } from "../../src/panel/server.js";
import { NO_VIEWER_IDENTITY } from "../../src/panel/rejection.js";
import { controlErrorBody } from "../../src/panel/controlErrors.js";

// Only for the read-only lsof observation below; the panel child itself is
// driven through runPanelProcess (F5), never execFileAsync, so it can be
// killed as a whole process group on its own deadline.
const execFileAsync = promisify(execFile);

interface PanelProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * F5 (Task 4, repaying a Task 3 debt): runs `tsx src/cli.ts panel ...` as a
 * REAL child process, the way a person would from a shell, with a deadline of
 * its own that is shorter than vitest's per-test timeout.
 *
 * Measured: installed tsx is 4.23.13, which re-execs the script in a CHILD
 * node process -- the one that actually calls listen(). Killing only this
 * function's own child would leave that grandchild orphaned and listening.
 * `detached: true` makes this child the leader of a new process GROUP (pgid
 * == its own pid on POSIX), which the grandchild inherits since it does not
 * detach itself; signalling the NEGATED pid reaches the whole group.
 *
 * If the guard under test is gone and the server actually starts, this
 * process never exits by itself. On the deadline, the whole group is killed
 * and the returned promise REJECTS naming the hang -- so a criterion built on
 * this helper fails loudly instead of either passing vacuously or hanging
 * vitest itself while the child keeps listening past the test.
 */
function runPanelProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
  deadlineMs = 5_000,
): { result: Promise<PanelProcessResult>; killIfAlive: () => void } {
  const child = spawn("./node_modules/.bin/tsx", ["src/cli.ts", ...args], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  let settled = false;
  const killIfAlive = (): void => {
    if (settled || child.pid === undefined) return;
    // Not a "settled" flag flip here: exit/error handlers below own that.
    // This can be called again after a clean exit (from afterEach, as a
    // backstop) -- ESRCH from signalling an already-gone group is expected
    // and swallowed, never thrown at the test.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };

  const result = new Promise<PanelProcessResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      killIfAlive();
      settled = true;
      reject(
        new Error(
          `orca panel (pid ${child.pid}) did not exit by itself within ${deadlineMs}ms; the whole ` +
            `process group was killed. This must never read as a pass: a hang means the guard under ` +
            `test let the server actually start. stderr so far: ${JSON.stringify(stderr)}`,
        ),
      );
    }, deadlineMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      settled = true;
      resolve({ code, stdout, stderr });
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      settled = true;
      reject(err);
    });
  });

  return { result, killIfAlive };
}

// RFC 5737 TEST-NET-1. Measured in spec section 1.7: it is on no interface of
// this machine, so bind fails with EADDRNOTAVAIL when the guard is gone.
//
// It is NOT 0.0.0.0 and must never become it. External review I5 caught the
// first draft leaving 0.0.0.0 in the mutation column after taking it out of the
// criterion: running THAT mutation would really have published a service that
// reads a person's global data on every interface. A criterion has to be safe
// on the run where the guard is deleted, because that run is the point of it.
const TEST_NET_1 = "192.0.2.1";

describe("panel security (spec sections 3.1 and 3.2)", () => {
  it("requires --by even on the loopback interface", async () => {
    // `by` is min(1) and feeds BOTH derived ids (section 1.3). A default like
    // "panel" is a sentence nobody said, written permanently into an
    // append-only ledger.
    expect(() => parsePanelArgs([], {})).toThrowError(
      expect.objectContaining({ code: NO_VIEWER_IDENTITY }),
    );
    expect(() => parsePanelArgs(["--by", ""], {})).toThrowError(
      expect.objectContaining({ code: NO_VIEWER_IDENTITY }),
    );
  });

  it("defaults the bind address to the literal 127.0.0.1", () => {
    // The literal, not "is it loopback": mutation P-2 changes the default to
    // TEST-NET-1, and a predicate like isLoopback() would have to be wrong in
    // the same direction to catch it. Assert the value the spec names.
    expect(parsePanelArgs(["--by", "amy"], {}).bind).toBe("127.0.0.1");
    expect(parsePanelArgs(["--by", "amy"], {}).confirmedExternal).toBe(false);
  });

  it("refuses a non-loopback bind by NAME when the exposure is not confirmed", () => {
    // Identity IS supplied here. That is the whole repair for external review
    // C2: with --by missing, parsing exits first and this guard could be
    // deleted without a single criterion noticing.
    const opts = parsePanelArgs(["--by", "amy", "--bind", TEST_NET_1], {});
    expect(() => assertBindAllowed(opts.bind, opts.confirmedExternal)).toThrowError(
      expect.objectContaining({ code: EXTERNAL_BIND_NOT_CONFIRMED }),
    );
    // Not the identity refusal, and not an OS-level bind error: three different
    // failures all leave nothing listening, so "nothing is listening" alone
    // would stay green for the wrong reason.
  });

  it("lets a confirmed external bind through the guard", () => {
    const opts = parsePanelArgs(["--by", "amy", "--bind", TEST_NET_1, "--i-know-this-is-exposed"], {});
    // Negative control. Without it, a guard that refuses EVERYTHING passes the
    // criterion above and nobody can ever use --bind.
    expect(() => assertBindAllowed(opts.bind, opts.confirmedExternal)).not.toThrow();
  });

  // Final review I-4 / ruling R67, the half an in-process server cannot reach:
  // a confirmed external bind also answers to the address it was bound to
  // (TEST-NET-1 is on no interface, so this is pinned on the pure predicate).
  it("accepts the bind address itself as a Host only alongside the loopback names, and refuses a missing Host", () => {
    expect(isHostAllowed(TEST_NET_1, `${TEST_NET_1}:7777`)).toBe(true);
    expect(isHostAllowed(TEST_NET_1, "localhost:7777")).toBe(true);
    expect(isHostAllowed(TEST_NET_1, "evil.example:7777")).toBe(false);
    // Negative control: a loopback-bound panel does NOT answer to that address.
    expect(isHostAllowed("127.0.0.1", `${TEST_NET_1}:7777`)).toBe(false);
    expect(isHostAllowed("::1", "[::1]:7777")).toBe(true);
    expect(isHostAllowed("127.0.0.1", "LOCALHOST:7777")).toBe(true);
    expect(isHostAllowed("127.0.0.1", undefined)).toBe(false);
    expect(isHostAllowed("127.0.0.1", "")).toBe(false);
  });

  // Final review Minor N-4. hostnameOf's own comment says a guard that guesses
  // at a malformed header is not a guard, and then the bracketed branch
  // accepted ANY content between the brackets: `[localhost]` parsed to the
  // allowed name `localhost`. Brackets mean an IP-literal (RFC 3986 §3.2.2) and
  // nothing else, so the content has to look like one or the header is
  // malformed and refused.
  it("reads brackets as an IPv6 literal only, so a bracketed name is a malformed Host and not an allowed one", () => {
    expect(isHostAllowed("127.0.0.1", "[localhost]:1")).toBe(false);
    expect(isHostAllowed("127.0.0.1", "[localhost]")).toBe(false);
    // A bracketed IPv4 is the same malformation wearing the other shape: the
    // name inside is allowed, the spelling is not.
    expect(isHostAllowed("127.0.0.1", "[127.0.0.1]")).toBe(false);
    // Positive controls, or a branch that refuses EVERY bracketed host passes
    // the three above and no browser on IPv6 loopback can reach the panel.
    expect(isHostAllowed("127.0.0.1", "[::1]")).toBe(true);
    expect(isHostAllowed("127.0.0.1", "[::1]:7777")).toBe(true);
    expect(isHostAllowed("::ffff:127.0.0.1", "[::FFFF:127.0.0.1]:7777")).toBe(true);
  });

  it("mints a token that is not guessable and compares it in constant time", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(tokenMatches(a, a)).toBe(true);
    expect(tokenMatches(a, b)).toBe(false);
    expect(tokenMatches(a, undefined)).toBe(false);
    expect(tokenMatches(a, "")).toBe(false);
    // A length-mismatched candidate must not throw out of timingSafeEqual.
    expect(tokenMatches(a, "deadbeef")).toBe(false);
    expect(controlErrorBody("token-required", "this panel needs its one-time token")).toEqual({
      error: { code: "token-required", message: "this panel needs its one-time token", commandRevision: null, evidenceIds: [], retryable: false },
    });
  });
});

describe("panel security via the real CLI process (controller ruling E2/E3: not skipped)", () => {
  let throwawayStore: string;
  // F5: set by each `it` right after spawning, so afterEach can kill
  // anything still alive from THAT criterion even if an assertion below
  // throws first. A no-op once the child has already exited or been killed
  // (see runPanelProcess's `settled` guard).
  let killCurrent: (() => void) | undefined;

  beforeEach(async () => {
    // E4: the brief's real-process criterion references `throwawayStore` but
    // never declares it where it lives. Minted per-run, removed after. The
    // child's env gets ORCA_CORRECTIONS_DIR pointing at it -- the brief's own
    // comment says it: a criterion whose isolation depends on the guard it is
    // testing is not isolated, and this env redirect is not optional even for
    // the --by criterion below, which never reaches correctionsDir() today.
    throwawayStore = await mkdtemp(join(tmpdir(), "orca-panel-"));
    killCurrent = undefined;
  });

  afterEach(async () => {
    // F5: the backstop. runPanelProcess already kills on its own deadline
    // before rejecting, so in the common case this is a no-op; it exists so
    // a thrown assertion between spawn and the deadline cannot skip cleanup.
    killCurrent?.();
    await rm(throwawayStore, { recursive: true, force: true });
  });

  it(
    "refuses a missing --by through the REAL process (ruling E3: the hole Task 1's stub left open)",
    async () => {
      // Task 1's stub had a --by guard that no criterion pinned at CLI level:
      // an independent verifier deleted the whole guard and every existing
      // (unit-only) criterion stayed green. This one drives the actual
      // `orca panel` entry point, so it survives the next rewrite of
      // server.ts the way a unit-level criterion on parsePanelArgs alone
      // would not.
      const { result, killIfAlive } = runPanelProcess(["panel"], {
        ...process.env,
        ORCA_CORRECTIONS_DIR: throwawayStore,
      });
      killCurrent = killIfAlive;
      const run = await result;

      expect(run).toMatchObject({ code: 1 });
      expect(run.stderr).toContain(NO_VIEWER_IDENTITY);
    },
    20_000,
  );

  it(
    "refuses an unconfirmed external bind through the REAL process, leaving no listener",
    async () => {
      // The guard runs before listen(), so what comes back is the named refusal
      // rather than EADDRNOTAVAIL.
      const { result, killIfAlive } = runPanelProcess(["panel", "--by", "amy", "--bind", TEST_NET_1], {
        ...process.env,
        ORCA_CORRECTIONS_DIR: throwawayStore,
      });
      killCurrent = killIfAlive;
      const run = await result;

      expect(run).toMatchObject({ code: 1 });
      expect(run.stderr).toContain(EXTERNAL_BIND_NOT_CONFIRMED);

      // The process is gone, so nothing it owns can be listening. Observed on
      // the operating system side, never with connect(): section 1.7 measured
      // that a connect to TEST-NET-1 follows the default route and times out
      // instead of giving ECONNREFUSED, so a connect-based assertion would
      // pass either way.
      //
      // E6: a bare `.catch(() => ({ stdout: "" }))` around lsof would turn a
      // failing lsof into an empty listing, and "does not contain the
      // address" is vacuously true over nothing. Let a failing lsof fail this
      // criterion instead, with a message saying the observation itself could
      // not be made. A per-pid filter is not the fix either: the child has
      // already exited above, so the child is gone and a pid filter would
      // assert against an empty set by construction.
      const listeners = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]).catch((err: unknown) => {
        throw new Error(
          `could not observe the machine's listening sockets via lsof, so absence of ` +
            `${TEST_NET_1} cannot be confirmed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      // Non-empty first: an empty listing would make "does not contain the
      // address" true regardless of whether the guard ran.
      expect(listeners.stdout.length).toBeGreaterThan(0);
      expect(listeners.stdout).not.toContain(TEST_NET_1);
    },
    20_000,
  );
});

describe("parsePanelArgs argument validation (F6: task 3's deferred malformed-port / malformed-repo-argument)", () => {
  // Asserted at the parsePanelArgs level, not through the real process:
  // on the run where the guard under test here is the one deleted, a
  // real-process criterion would go on to START A SERVER on loopback (port
  // defaults to 0, an ephemeral port picked by the kernel) and then hang
  // forever, because nothing in `orca panel` ever exits by itself once it is
  // listening -- the exact hazard F5 above exists to repair. A parse-level
  // criterion never spawns anything, so it cannot create that hazard.
  //
  // `--by` is supplied in every case: without it, NO_VIEWER_IDENTITY fires
  // first and the criterion would observe the wrong guard -- the exact shape
  // external review C2 caught for the bind guard. `{}` as env, never
  // `process.env`, so none of these can resolve to the real ~/.orca (Rule 17).

  it("rejects --port by name for a non-integer, for -1, and for 65536; accepts 65535", () => {
    for (const bad of ["abc", "-1", "65536"]) {
      expect(() => parsePanelArgs(["--by", "amy", "--port", bad], {}), bad).toThrowError(
        expect.objectContaining({ code: "malformed-port" }),
      );
    }
    // Negative control: without it, a guard that refuses every port passes
    // the three assertions above vacuously.
    expect(parsePanelArgs(["--by", "amy", "--port", "65535"], {}).port).toBe(65535);
  });

  it("rejects --repo by name for a value with no '=' and for one starting with '='; accepts k=path", () => {
    for (const bad of ["no-equals-here", "=path"]) {
      expect(() => parsePanelArgs(["--by", "amy", "--repo", bad], {}), bad).toThrowError(
        expect.objectContaining({ code: "malformed-repo-argument" }),
      );
    }
    // Negative control: without it, a guard that refuses every --repo value
    // passes the two assertions above vacuously.
    expect(parsePanelArgs(["--by", "amy", "--repo", "k=/some/path"], {}).repos).toEqual([
      { projectKey: "k", path: "/some/path" },
    ]);
  });
});
