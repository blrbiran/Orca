import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveControlOptions, controlRoot, controlRepoKey, DEFAULT_CONTROL_WAKE_MS } from "../../src/panel/controlOptions.js";

/**
 * Assembly plan Task 1. This module is the single place that decides whether the control plane
 * mounts and where its state lives, so every judgement below is about a decision, never about a
 * file: `resolveControlOptions` performs no I/O, which is what lets the home-directory fallback be
 * asserted at all without a criterion reaching into a person's real ~/.orca (CLAUDE.md Rule 17).
 */

const repo = (key: string) => ({ projectKey: key, path: `/tmp/${key}` });
const base = ["--by", "tester"];
const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ORCA_CONTROL_DIR: "/relocated", ...over });

describe("resolveControlOptions decides the control mount", () => {
  it("mounts by default and names the state directory after the single repo key", () => {
    const resolved = resolveControlOptions([...base, "--repo", "proj=/x", "--estimator-profile", "p1", "--estimate-mode", "soft"], env(), [repo("proj")]);
    expect(resolved.enabled).toBe(true);
    expect(resolved.rejection).toBe(null);
    expect(resolved.stateDir).toBe(join("/relocated", controlRepoKey("proj")));
  });

  it("turns off with --no-control, and then names no state directory at all", () => {
    const resolved = resolveControlOptions([...base, "--no-control", "--repo", "proj=/x"], env(), [repo("proj")]);
    expect(resolved.enabled).toBe(false);
    expect(resolved.stateDir).toBe(null);
    expect(resolved.rejection).toBe(null);
  });

  it("reads the relocation variable rather than a constant frozen at import", () => {
    const first = resolveControlOptions([...base, "--estimator-profile", "p", "--estimate-mode", "soft"], env({ ORCA_CONTROL_DIR: "/one" }), [repo("k")]);
    const second = resolveControlOptions([...base, "--estimator-profile", "p", "--estimate-mode", "soft"], env({ ORCA_CONTROL_DIR: "/two" }), [repo("k")]);
    expect(first.stateDir).toBe(join("/one", controlRepoKey("k")));
    expect(second.stateDir).toBe(join("/two", controlRepoKey("k")));
  });

  it("falls back to the home directory when the variable is unset or empty, without touching it", () => {
    // Pure string computation: controlRoot opens nothing, so asserting the real-home spelling here
    // creates no directory. An empty string is unset, matching the ORCA_CORRECTIONS_DIR convention.
    expect(controlRoot({})).toBe(join(homedir(), ".orca", "control"));
    expect(controlRoot({ ORCA_CONTROL_DIR: "" })).toBe(join(homedir(), ".orca", "control"));
    expect(controlRoot({ ORCA_CONTROL_DIR: "/elsewhere" })).toBe("/elsewhere");
  });

  it("does not expand a tilde, because node would create a directory literally named ~", () => {
    expect(controlRoot({ ORCA_CONTROL_DIR: "~/somewhere" })).toBe("~/somewhere");
  });
});

describe("resolveControlOptions refuses what it cannot name", () => {
  it("refuses two repos with no explicit state directory, because there is no key to use", () => {
    const resolved = resolveControlOptions([...base, "--estimator-profile", "p", "--estimate-mode", "soft"], env(), [repo("a"), repo("b")]);
    expect(resolved.rejection).toBe("control-state-dir-required");
    expect(resolved.stateDir).toBe(null);
  });

  it("takes an explicit state directory verbatim, and that settles the two-repo case", () => {
    const resolved = resolveControlOptions(
      [...base, "--control-state-dir", "/named/here", "--estimator-profile", "p", "--estimate-mode", "soft"],
      env(),
      [repo("a"), repo("b")],
    );
    expect(resolved.rejection).toBe(null);
    expect(resolved.stateDir).toBe("/named/here");
  });

  it("lets an explicit state directory beat the derived one for a single repo", () => {
    const resolved = resolveControlOptions(
      [...base, "--control-state-dir", "/named/here", "--estimator-profile", "p", "--estimate-mode", "soft"],
      env(),
      [repo("only")],
    );
    expect(resolved.stateDir).toBe("/named/here");
  });

  it("does not mount at all when no repository was named, so today's zero-repo boots are untouched", () => {
    // Measured before this was written: 11 of 40 parsePanelArgs sites pass no --repo. A control
    // plane over no repository can dispatch nothing, so the answer is "off", not "rejected" --
    // a rejection here would turn every one of those green boots red.
    const resolved = resolveControlOptions(base, env(), []);
    expect(resolved.enabled).toBe(false);
    expect(resolved.rejection).toBe(null);
  });

  it("asks for nothing once control is off, however malformed the rest is", () => {
    const resolved = resolveControlOptions([...base, "--no-control", "--control-wake-ms", "-1"], env(), [repo("a"), repo("b")]);
    expect(resolved.enabled).toBe(false);
    expect(resolved.rejection).toBe(null);
  });
});

describe("resolveControlOptions validates the wake interval", () => {
  const mounted = (...extra: string[]) =>
    resolveControlOptions([...base, "--estimator-profile", "p", "--estimate-mode", "soft", ...extra], env(), [repo("k")]);

  it("defaults the interval when the flag is absent", () => {
    expect(mounted().wakeIntervalMs).toBe(DEFAULT_CONTROL_WAKE_MS);
    expect(DEFAULT_CONTROL_WAKE_MS).toBe(5000);
  });

  it("accepts a positive safe integer", () => {
    expect(mounted("--control-wake-ms", "5000").wakeIntervalMs).toBe(5000);
    expect(mounted("--control-wake-ms", "1").rejection).toBe(null);
  });

  for (const bad of ["0", "-1", "1.5", "abc", "", "9007199254740993", "Infinity"]) {
    it(`refuses ${JSON.stringify(bad)} as an interval`, () => {
      expect(mounted("--control-wake-ms", bad).rejection).toBe("control-wake-ms-invalid");
    });
  }
});

describe("resolveControlOptions makes the estimator an operator choice", () => {
  const withRepo = (...extra: string[]) => resolveControlOptions([...base, ...extra], env(), [repo("k")]);

  it("mounts with no estimator at all rather than refusing to boot (ruling R7)", () => {
    // The parallel of R5. Measured before this was ruled: refusing here turned 36 of the 220
    // tests/panel criteria red, in five files that have nothing to do with the control plane.
    const resolved = withRepo();
    expect(resolved.enabled).toBe(true);
    expect(resolved.rejection).toBe(null);
    expect(resolved.estimatorProfileId).toBe(null);
    expect(resolved.estimateMode).toBe(null);
  });

  it("refuses half an estimator, in both directions, because a half is an operator who meant to configure one", () => {
    expect(withRepo("--estimate-mode", "soft").rejection).toBe("control-estimator-incomplete");
    expect(withRepo("--estimator-profile", "p").rejection).toBe("control-estimator-incomplete");
  });

  it("refuses a mode it does not recognise, separately from an absent one", () => {
    expect(withRepo("--estimator-profile", "p", "--estimate-mode", "lenient").rejection).toBe("control-estimate-mode-invalid");
  });

  it("carries both operator choices through when they are given", () => {
    const resolved = withRepo("--estimator-profile", "est-1", "--estimate-mode", "strict");
    expect(resolved.estimatorProfileId).toBe("est-1");
    expect(resolved.estimateMode).toBe("strict");
    expect(resolved.rejection).toBe(null);
  });

  it("never reports one of the pair without the other", () => {
    for (const args of [[], ["--estimator-profile", "e", "--estimate-mode", "strict"]]) {
      const r = withRepo(...args);
      expect(r.estimatorProfileId === null).toBe(r.estimateMode === null);
    }
  });

  it("leaves both null when control is off", () => {
    const resolved = resolveControlOptions([...base, "--no-control"], env(), [repo("k")]);
    expect(resolved.estimatorProfileId).toBe(null);
    expect(resolved.estimateMode).toBe(null);
  });
});

describe("resolveControlOptions reports whether an execution port is configured", () => {
  const withEnv = (over: Record<string, string>) =>
    resolveControlOptions([...base, "--estimator-profile", "p", "--estimate-mode", "soft"], env(over), [repo("k")]);

  it("calls the port unconfigured when neither variable is set", () => {
    expect(withEnv({}).executionPort).toBe("unconfigured");
  });

  it("needs both variables, not either one", () => {
    expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop" }).executionPort).toBe("unconfigured");
    expect(withEnv({ ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("unconfigured");
  });

  it("calls the port configured only when both are set and non-empty", () => {
    expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop", ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("configured");
    expect(withEnv({ ORCA_CCLOOP_BIN: "", ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("unconfigured");
  });

  it("does not let a missing port become a boot rejection, which is the whole of ruling R5", () => {
    expect(withEnv({}).rejection).toBe(null);
    expect(withEnv({}).enabled).toBe(true);
  });
});

describe("resolveControlOptions answers with one rejection in a fixed order", () => {
  it("reports the state directory before the wake interval", () => {
    const resolved = resolveControlOptions(
      [...base, "--control-wake-ms", "-1", "--estimator-profile", "p", "--estimate-mode", "soft"],
      env(),
      [repo("a"), repo("b")],
    );
    expect(resolved.rejection).toBe("control-state-dir-required");
  });

  it("reports the wake interval before the estimator", () => {
    const resolved = resolveControlOptions([...base, "--control-wake-ms", "0", "--estimate-mode", "soft"], env(), [repo("k")]);
    expect(resolved.rejection).toBe("control-wake-ms-invalid");
  });
});

describe("the project key is encoded before it becomes a directory or an id", () => {
  it("never produces a nested path, however the key was spelled", () => {
    for (const key of ["github.com/biran/orca", "a/b/c", "../escape", "/absolute"]) {
      expect(controlRepoKey(key)).not.toContain("/");
      expect(controlRepoKey(key)).not.toContain("..");
    }
  });

  it("produces something the control id schema accepts", () => {
    for (const key of ["github.com/biran/orca", "proj", "...", "\u4e2d\u6587"]) {
      expect(controlRepoKey(key)).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    }
  });

  it("keeps two keys that sanitise alike in separate stores", () => {
    // Sanitising alone would map both to the same directory, and two repositories would then share
    // one ledger. The digest is what makes that impossible, so it is judged directly.
    expect(controlRepoKey("a/b")).not.toBe(controlRepoKey("a-b"));
  });

  it("answers the same thing every time, because the store has to be found again after a restart", () => {
    expect(controlRepoKey("github.com/biran/orca")).toBe(controlRepoKey("github.com/biran/orca"));
  });
});
