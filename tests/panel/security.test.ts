import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertBindAllowed, EXTERNAL_BIND_NOT_CONFIRMED } from "../../src/panel/bindGuard.js";
import { mintToken, tokenMatches } from "../../src/panel/token.js";
import { parsePanelArgs } from "../../src/panel/server.js";
import { NO_VIEWER_IDENTITY } from "../../src/panel/rejection.js";

const execFileAsync = promisify(execFile);

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
  });
});

describe("panel security via the real CLI process (controller ruling E2/E3: not skipped)", () => {
  let throwawayStore: string;

  beforeEach(async () => {
    // E4: the brief's real-process criterion references `throwawayStore` but
    // never declares it where it lives. Minted per-run, removed after. The
    // child's env gets ORCA_CORRECTIONS_DIR pointing at it -- the brief's own
    // comment says it: a criterion whose isolation depends on the guard it is
    // testing is not isolated, and this env redirect is not optional even for
    // the --by criterion below, which never reaches correctionsDir() today.
    throwawayStore = await mkdtemp(join(tmpdir(), "orca-panel-"));
  });

  afterEach(async () => {
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
      const run = await execFileAsync(
        "./node_modules/.bin/tsx",
        ["src/cli.ts", "panel"],
        { cwd: process.cwd(), env: { ...process.env, ORCA_CORRECTIONS_DIR: throwawayStore } },
      ).catch((err: { code: number; stderr: string; stdout: string }) => err);

      expect(run).toMatchObject({ code: 1 });
      expect((run as { stderr: string }).stderr).toContain(NO_VIEWER_IDENTITY);
    },
    20_000,
  );

  it(
    "refuses an unconfirmed external bind through the REAL process, leaving no listener",
    async () => {
      // The guard runs before listen(), so what comes back is the named refusal
      // rather than EADDRNOTAVAIL.
      const run = await execFileAsync(
        "./node_modules/.bin/tsx",
        ["src/cli.ts", "panel", "--by", "amy", "--bind", TEST_NET_1],
        { cwd: process.cwd(), env: { ...process.env, ORCA_CORRECTIONS_DIR: throwawayStore } },
      ).catch((err: { code: number; stderr: string; stdout: string }) => err);

      expect(run).toMatchObject({ code: 1 });
      expect((run as { stderr: string }).stderr).toContain(EXTERNAL_BIND_NOT_CONFIRMED);

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
      // not be made. A per-pid filter is not the fix either: execFileAsync
      // has already returned above, so the child is gone and a pid filter
      // would assert against an empty set by construction.
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
