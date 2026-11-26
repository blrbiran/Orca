import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheckRecorded } from "../../src/control/checkCommand.js";
import { acceptanceSetupDigest, failureIdentitiesOf, readAcceptanceFailureIdentities, recordAcceptanceFailureIdentities } from "../../src/control/acceptanceFailureIdentity.js";
import { openControlStore } from "../../src/control/store.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const workdir = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), "orca-acceptance-identities-")); dirs.push(dir); return dir; };

function tapFailure(input: { ordinal: number; duration: string; location: string; parent?: string; testName?: string }): string {
  const parent = input.parent ?? "authentication";
  const testName = input.testName ?? "rejects invalid input";
  return [
    "TAP version 13",
    "# Subtest: tests/login.test.mjs",
    `    # Subtest: ${parent}`,
    `        # Subtest: ${testName}`,
    `        not ok ${input.ordinal} - ${testName}`,
    "          ---",
    "          error: AssertionError",
    "          actual: 1",
    "          expected: 2",
    "          operator: strictEqual",
    `          location: '${input.location}'`,
    `          duration_ms: ${input.duration}`,
    "          ...",
    "    1..1",
    "    # tests 1",
    "    # pass 0",
    "    # fail 1",
    "not ok 1 - tests/login.test.mjs",
    "  ---",
    "  error: 1 subtest failed",
    "  failureType: subtestsFailed",
    "  ...",
    "# tests 1",
    "# pass 0",
    "# fail 1",
    "# duration_ms 12",
    "",
  ].join("\n");
}

function commandFor(output: string): string {
  const escaped = output.replaceAll("\\", "\\\\").replaceAll("'", "'\\''").replaceAll("\n", "\\n");
  return `printf '%b' '${escaped}'; exit 1`;
}

describe("acceptance failure identities", () => {
  it("captures the nested failing test identity and diagnostic hash from the complete command output", async () => {
    const dir = await workdir();
    const result = await runCheckRecorded(dir, commandFor(tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4" })), 10_000, { runId: "run-identity" });
    expect(result.failureIdentities).toEqual([{
      key: expect.any(String), file: "tests/login.test.mjs", testPath: ["authentication", "rejects invalid input"], diagnosticHash: expect.any(String),
    }]);
    expect(result.failureIdentities?.[0]?.key).toMatch(/^[a-f0-9]{64}$/);
    expect(result.failureIdentities?.[0]?.diagnosticHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps an identity stable when TAP ordinals, durations, and absolute worktree paths change", async () => {
    const dir = await workdir();
    const first = await runCheckRecorded(dir, commandFor(tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4" })), 10_000, { runId: "run-identity" });
    const second = await runCheckRecorded(dir, commandFor(tapFailure({ ordinal: 9, duration: "88", location: "/private/tmp/run-2/tests/login.test.mjs:91:12" })), 10_000, { runId: "run-identity" });
    expect(first.failureIdentities).toHaveLength(1);
    expect(second.failureIdentities).toHaveLength(1);
    expect(first.failureIdentities![0]!.key).toBe(second.failureIdentities![0]!.key);
  });

  it("keeps same-named failures under different parent suites distinct and ignores their file-level parent failure", async () => {
    const dir = await workdir();
    const output = `${tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4", parent: "authentication" })}${tapFailure({ ordinal: 1, duration: "4", location: "/private/tmp/run-1/tests/login.test.mjs:8:4", parent: "registration" })}`;
    const result = await runCheckRecorded(dir, commandFor(output), 10_000, { runId: "run-identity" });
    expect(result.failureIdentities).toHaveLength(2);
    expect(result.failureIdentities?.map((item) => item.testPath)).toEqual([
      ["authentication", "rejects invalid input"], ["registration", "rejects invalid input"],
    ]);
  });

  it("marks duplicate failure paths as ambiguous instead of collapsing them", async () => {
    const dir = await workdir();
    const output = `${tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4" })}${tapFailure({ ordinal: 2, duration: "4", location: "/private/tmp/run-1/tests/login.test.mjs:8:4" })}`;
    const result = await runCheckRecorded(dir, commandFor(output), 10_000, { runId: "run-identity" });
    expect(result.failureIdentityStatus).toBe("ambiguous");
  });

  it("marks unsupported or structurally incomplete red output as non-comparable", async () => {
    const dir = await workdir();
    const result = await runCheckRecorded(dir, commandFor("TAP version 13\nnot ok 1 - missing TAP context\n# fail 1\n"), 10_000, { runId: "run-identity" });
    expect(result.failureIdentityStatus).toBe("ambiguous");
    expect(result.failureIdentities).toEqual([]);
    const unsupported = await runCheckRecorded(dir, commandFor("test runner failed\n"), 10_000, { runId: "run-identity" });
    expect(unsupported.failureIdentityStatus).toBe("unsupported");
  });

  it("uses a path-bound identity for file-level failures and rejects summaries with missing failure identities", async () => {
    const dir = await workdir();
    const fileFailure = await runCheckRecorded(dir, commandFor([
      "TAP version 13", "not ok 1 - tests/setup.test.mjs", "  ---", "  error: SyntaxError", "  message: unexpected token", "  ...",
      "# tests 1", "# pass 0", "# fail 1", "",
    ].join("\n")), 10_000, { runId: "run-identity" });
    expect(fileFailure.failureIdentityStatus).toBe("complete");
    expect(fileFailure.failureIdentities).toMatchObject([{ file: "tests/setup.test.mjs", testPath: [] }]);

    const unexplained = await runCheckRecorded(dir, commandFor("TAP version 13\n# tests 1\n# pass 0\n# fail 1\n"), 10_000, { runId: "run-identity" });
    expect(unexplained.failureIdentityStatus).toBe("ambiguous");
    expect(unexplained.failureIdentities).toEqual([]);
  });

  it("parses Node's own TAP for a nested failure and a top-level failure, ignoring suite summaries", () => {
    const real = [
      "TAP version 13", "# Subtest: auth", "    # Subtest: rejects invalid input", "    not ok 1 - rejects invalid input", "      ---",
      "      duration_ms: 0.7", "      type: 'test'", "      location: '/tmp/repo/tests/sample.test.mjs:4:3'",
      "      failureType: 'testCodeFailure'", "      error: |-", "        first line", "        second line", "",
      "        1 !== 2", "      code: 'ERR_ASSERTION'", "      expected: 2", "      actual: 1", "      operator: 'strictEqual'",
      "      ...", "    1..1", "not ok 1 - auth", "  ---", "  duration_ms: 1.1", "  type: 'suite'",
      "  location: '/tmp/repo/tests/sample.test.mjs:3:1'", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  code: 'ERR_TEST_FAILURE'", "  ...",
      "# Subtest: top level fails", "not ok 2 - top level fails", "  ---", "  duration_ms: 0.1", "  type: 'test'",
      "  location: '/tmp/repo/tests/sample.test.mjs:8:1'", "  failureType: 'testCodeFailure'", "  error: 'top failure'", "  code: 'ERR_ASSERTION'",
      "  operator: 'fail'", "  ...", "1..2", "# tests 2", "# suites 1", "# pass 0", "# fail 2", "",
    ].join("\n");
    const parsed = failureIdentitiesOf(real, "node-test-tap-v1", "/tmp/repo");
    expect(parsed.parseStatus).toBe("complete");
    expect(parsed.identities.map((identity: { file: string; testPath: string[] }) => [identity.file, identity.testPath])).toEqual([
      ["tests/sample.test.mjs", ["auth", "rejects invalid input"]],
      ["tests/sample.test.mjs", ["top level fails"]],
    ]);
  });

  it("hashes the body of a block-scalar diagnostic, so two different messages are different identities", () => {
    const tap = (message: string) => ["TAP version 13", "# Subtest: tests/a.test.mjs", "    not ok 1 - one", "      ---",
      "      failureType: 'testCodeFailure'", "      error: |-", `        ${message}`, "      code: 'ERR_ASSERTION'", "      ...",
      "    1..1", "not ok 1 - tests/a.test.mjs", "  ---", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  ...",
      "# tests 1", "# pass 0", "# fail 1", ""].join("\n");
    const first = failureIdentitiesOf(tap("first message"), "node-test-tap-v1", "/repo");
    const second = failureIdentitiesOf(tap("second message"), "node-test-tap-v1", "/repo");
    expect(first.parseStatus).toBe("complete");
    expect(second.parseStatus).toBe("complete");
    expect(first.identities[0]!.key).not.toBe(second.identities[0]!.key);
  });

  it("accumulates red identities only under an exact repository, base, command, setup, and reporter key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-acceptance-baselines-"));
    dirs.push(dir);
    const store = await openControlStore({ stateDir: dir, now: () => 300 });
    try {
      const setupDigest = acceptanceSetupDigest(["npm ci", "npm run prepare"]);
      expect(setupDigest).not.toBe(acceptanceSetupDigest(["npm run prepare", "npm ci"]));
      const identity = { key: "a".repeat(64), file: "tests/login.test.mjs", testPath: ["authentication", "rejects invalid input"], diagnosticHash: "b".repeat(64) };
      const key = { repoId: "repo", base: "c".repeat(40), command: "npm test", setupDigest, reporter: "node-test-tap-v1" as const };
      recordAcceptanceFailureIdentities(store, { ...key, identities: [identity], source: "task-base-check", groupId: "g1", runId: "run-1", at: 100 });
      recordAcceptanceFailureIdentities(store, { ...key, identities: [identity], source: "group-acceptance", groupId: "g2", runId: "run-2", at: 200 });
      expect(readAcceptanceFailureIdentities(store, key)).toEqual([identity]);
      expect(readAcceptanceFailureIdentities(store, { ...key, command: "npm test -- --runInBand" })).toEqual([]);
      expect(readAcceptanceFailureIdentities(store, { ...key, repoId: "other-repo" })).toEqual([]);
      expect(readAcceptanceFailureIdentities(store, { ...key, base: "e".repeat(40) })).toEqual([]);
      expect(readAcceptanceFailureIdentities(store, { ...key, setupDigest: "d".repeat(64) })).toEqual([]);
      expect(store.db.prepare("SELECT source,group_id,run_id,first_seen_at,last_seen_at FROM acceptance_failure_baselines").all()).toEqual([
        { source: "task-base-check", group_id: "g1", run_id: "run-1", first_seen_at: 100, last_seen_at: 200 },
      ]);
    } finally { store.close(); }
  });
});
