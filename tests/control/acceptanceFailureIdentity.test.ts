import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
    "  type: 'suite'", "  failureType: 'subtestsFailed'",
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

  it("marks duplicate failure paths inside one TAP block as ambiguous instead of collapsing them", async () => {
    const dir = await workdir();
    const output = [
      "TAP version 13", "# Subtest: tests/login.test.mjs", "    # Subtest: authentication",
      "        # Subtest: rejects invalid input", "        not ok 1 - rejects invalid input", "          ---",
      "          error: AssertionError", "          actual: 1", "          expected: 2", "          operator: strictEqual",
      "          location: '/private/tmp/run-1/tests/login.test.mjs:3:4'", "          ...",
      "        # Subtest: rejects invalid input", "        not ok 2 - rejects invalid input", "          ---",
      "          error: AssertionError", "          actual: 1", "          expected: 2", "          operator: strictEqual",
      "          location: '/private/tmp/run-1/tests/login.test.mjs:8:4'", "          ...", "      1..2", "    1..1",
      "not ok 1 - tests/login.test.mjs", "  ---", "  error: 1 subtest failed", "  type: 'suite'",
      "  failureType: 'subtestsFailed'", "  location: '/private/tmp/run-1/tests/login.test.mjs:1:1'", "  ...",
      "# tests 1", "# pass 0", "# fail 1", "",
    ].join("\n");
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
      "  location: '/tmp/repo/tests/sample.test.mjs:3:1'", "  type: 'suite'", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  code: 'ERR_TEST_FAILURE'", "  ...",
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

  it("parses repeated TAP blocks independently and de-duplicates the same failure across retries", () => {
    const block = tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4" });
    const parsed = failureIdentitiesOf(`${block}${block}`, "node-test-tap-v1", "/private/tmp/run-1");
    expect(parsed).toMatchObject({ parseStatus: "complete", reportedFailures: 2, blockCount: 2 });
    expect(parsed.identities).toHaveLength(1);
  });

  it("keeps a malformed repeated TAP block non-comparable", () => {
    const good = tapFailure({ ordinal: 1, duration: "3.4", location: "/private/tmp/run-1/tests/login.test.mjs:3:4" });
    const malformed = "TAP version 13\nnot ok 1 - missing context\n# fail 1\n";
    const parsed = failureIdentitiesOf(`${good}${malformed}`, "node-test-tap-v1", "/private/tmp/run-1");
    expect(parsed.parseStatus).toBe("ambiguous");
    expect(parsed.blockCount).toBe(2);
  });

  it("normalizes absolute TAP locations through a symlinked cwd and rejects unresolved paths", async () => {
    const dir = await workdir();
    await mkdir(join(dir, "tests"));
    const alias = `${dir}-alias`;
    await symlink(dir, alias, "dir");
    dirs.push(alias);
    const tapAt = (location: string) => [
      "TAP version 13", "# Subtest: application", "    not ok 1 - fails", "      ---", "      error: AssertionError",
      "      actual: 1", "      expected: 2", `      location: '${location}:3:4'`, "      ...", "not ok 1 - application",
      "  ---", "  error: 1 subtest failed", "  type: 'suite'", `  location: '${location}:3:1'`, "  failureType: 'subtestsFailed'", "  ...", "# tests 1", "# pass 0", "# fail 1", "",
    ].join("\n");
    const real = failureIdentitiesOf(tapAt(join(dir, "tests", "missing.test.js")), "node-test-tap-v1", dir);
    const linked = failureIdentitiesOf(tapAt(join(alias, "tests", "missing.test.js")), "node-test-tap-v1", dir);
    expect(real).toMatchObject({ reportedFailures: 1, blockCount: 1, identities: [{ file: "tests/missing.test.js" }] });
    expect(linked).toMatchObject({ reportedFailures: 1, blockCount: 1, identities: [{ file: "tests/missing.test.js" }] });
    expect(real.parseStatus).toBe("complete");
    expect(linked.parseStatus).toBe("complete");
    expect(linked.identities.map((item) => item.key)).toEqual(real.identities.map((item) => item.key));
    const unresolved = failureIdentitiesOf(tapAt("/path/that/does/not/exist/missing.test.js"), "node-test-tap-v1", dir);
    expect(unresolved.parseStatus).toBe("ambiguous");
  });

  it("executes an exact same-suite retry as two separately evidenced branches", async () => {
    const dir = await workdir();
    const counter = join(dir, "count");
    const failed = tapFailure({ ordinal: 1, duration: "3.4", location: join(dir, "tests", "login.test.mjs") + ":3:4" });
    const passed = "TAP version 13\n1..1\n# tests 1\n# pass 1\n# fail 0\n";
    const runner = [
      `import { readFileSync, writeFileSync } from "node:fs";`,
      `const counter = ${JSON.stringify(counter)};`,
      `let count = 0; try { count = Number(readFileSync(counter, "utf8")); } catch {}`,
      `writeFileSync(counter, String(count + 1));`,
      `if (count === 0) { process.stdout.write(${JSON.stringify(failed)}); process.exitCode = 1; }`,
      `else process.stdout.write(${JSON.stringify(passed)});`,
    ].join("\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node runner.mjs" } }));
    await writeFile(join(dir, "runner.mjs"), runner);

    const answer = await runCheckRecorded(dir, "npm test || npm test", 10_000, { runId: "run-retry" });
    const recorded = answer as typeof answer & { identityAttempts?: Array<{ exit: string; failureIdentityStatus?: string; failureIdentities?: unknown[]; reportedFailures?: number | null; blockCount?: number; tests?: number | null }> };
    expect(answer.exit).toBe("0");
    expect(recorded.identityAttempts).toMatchObject([
      { exit: "1", failureIdentityStatus: "complete", reportedFailures: 1, blockCount: 1, tests: 1, tail: expect.stringContaining("rejects invalid input"), failureIdentities: [{ testPath: ["authentication", "rejects invalid input"] }] },
      { exit: "0", reportedFailures: 0, blockCount: 1, tests: 1 },
    ]);
  });

  it("keeps an unsupported red branch visible after a later green retry branch", async () => {
    const dir = await workdir();
    const counter = join(dir, "count");
    const runner = [
      `import { readFileSync, writeFileSync } from "node:fs";`,
      `const counter = ${JSON.stringify(counter)};`,
      `let count = 0; try { count = Number(readFileSync(counter, "utf8")); } catch {}`,
      `writeFileSync(counter, String(count + 1));`,
      `if (count === 0) { process.stdout.write("plain runner failure\\n"); process.exitCode = 1; }`,
      `else process.stdout.write("TAP version 13\\n1..1\\n# tests 1\\n# pass 1\\n# fail 0\\n");`,
    ].join("\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node runner.mjs" } }));
    await writeFile(join(dir, "runner.mjs"), runner);

    const answer = await runCheckRecorded(dir, "npm test || npm test", 10_000, { runId: "run-retry-unsupported" });
    expect(answer.exit).toBe("0");
    expect(answer.failureIdentityStatus).toBe("unsupported");
    expect(answer.identityAttempts?.map((attempt) => attempt.exit)).toEqual(["1", "0"]);
    expect(answer.identityAttempts?.[0]?.failureIdentityStatus).toBe("unsupported");
  });

  it("shares one timeout budget across retry branches", async () => {
    const dir = await workdir();
    const counter = join(dir, "count");
    const runner = [
      `import { readFileSync, writeFileSync } from "node:fs";`,
      `const counter = ${JSON.stringify(counter)};`,
      `let count = 0; try { count = Number(readFileSync(counter, "utf8")); } catch {}`,
      `writeFileSync(counter, String(count + 1));`,
      `if (count === 0) { await new Promise((resolve) => setTimeout(resolve, 250)); process.stdout.write("TAP version 13\\n# tests 1\\n# pass 0\\n# fail 1\\n"); process.exitCode = 1; }`,
      `else await new Promise((resolve) => setTimeout(resolve, 1500));`,
    ].join("\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node runner.mjs" } }));
    await writeFile(join(dir, "runner.mjs"), runner);

    const answer = await runCheckRecorded(dir, "npm test || npm test", 1000, { runId: "run-retry-budget" });
    expect(answer.identityAttempts?.[0]?.exit).toBe("1");
    const timedOut = /^timeout (\d+) ms$/.exec(answer.identityAttempts?.[1]?.exit ?? "");
    expect(timedOut).not.toBeNull();
    expect(Number(timedOut![1])).toBeLessThan(1000);
  });

  it("hashes the body of a block-scalar diagnostic, so two different messages are different identities", () => {
    const tap = (message: string) => ["TAP version 13", "# Subtest: tests/a.test.mjs", "    not ok 1 - one", "      ---",
      "      failureType: 'testCodeFailure'", "      error: |-", `        ${message}`, "      code: 'ERR_ASSERTION'", "      ...",
      "    1..1", "not ok 1 - tests/a.test.mjs", "  ---", "  type: 'suite'", "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", "  ...",
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
