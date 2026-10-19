import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Spec 2026-10-20 §4.2/§4.3: the full gate runs only for a tagged release, and inside it the suite runs once carrying
 * what the removed re-runs carried. An agent that runs `npm run verify` without the release tag must be refused by
 * the gate itself (no prompt reaches the human); the single pass must still be a formal control run inside a chain
 * session, or a missing isolateChainEnv() and a skipped real-ccloop file stop being visible.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-")));
  roots.push(root);
  return root;
}

// Every run gets an explicit environment so the caller's shell (which may hold a release tag or chain variables)
// cannot decide the verdict.
function run(script: string, env: Record<string, string>, cwd = process.cwd(), args: string[] = []) {
  const r = spawnSync(process.execPath, [resolve("scripts", script), ...args], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const REFUSAL = "verify is the release gate: run it only when the human asked for a tagged release (ORCA_RELEASE_TAG=<tag> npm run verify). For iterations, fix rounds, merges, push or installing the panel service run: npm test";

describe("scripts/check-release-gate.mjs", () => {
  it("refuses with exit 2 and names the command to run instead when no release tag is set", () => {
    const r = run("check-release-gate.mjs", {});
    expect(r.code).toBe(2);
    expect(r.out).toContain(REFUSAL);
  });

  it("refuses an empty tag the same way: an exported-but-empty variable is not a release", () => {
    const r = run("check-release-gate.mjs", { ORCA_RELEASE_TAG: "" });
    expect(r.code).toBe(2);
    expect(r.out).toContain(REFUSAL);
  });

  it("lets a named release through", () => {
    const r = run("check-release-gate.mjs", { ORCA_RELEASE_TAG: "v0.2.0" });
    expect(r.code, r.out).toBe(0);
  });
});

describe("scripts/check-gate-env.mjs (the up-front refusal verify:control had, now in front of the single pass)", () => {
  it("refuses when either variable is unset, so the formal control file cannot be reached without them", () => {
    const root = tempRoot();
    const file = join(root, "f");
    writeFileSync(file, "");
    expect(run("check-gate-env.mjs", {}).code).toBe(1);
    expect(run("check-gate-env.mjs", { ORCA_CCLOOP_BIN: file }).code).toBe(1);
    expect(run("check-gate-env.mjs", { ORCA_AGENTS_TABLE: file }).code).toBe(1);
  });

  it("refuses a set but unresolvable path instead of letting the suite fail an hour later", () => {
    const root = tempRoot();
    const file = join(root, "f");
    writeFileSync(file, "");
    const r = run("check-gate-env.mjs", { ORCA_CCLOOP_BIN: join(root, "missing", "cli.js"), ORCA_AGENTS_TABLE: file });
    expect(r.code).toBe(1);
    expect(r.out).toContain("ENOENT");
  });

  it("passes when both resolve", () => {
    const root = tempRoot();
    const file = join(root, "f");
    writeFileSync(file, "");
    const r = run("check-gate-env.mjs", { ORCA_CCLOOP_BIN: file, ORCA_AGENTS_TABLE: file });
    expect(r.code, r.out).toBe(0);
  });
});

// Records what the one vitest it spawns was given, then exits with FAKE_VITEST_EXIT.
const FAKE_VITEST = String.raw`#!/usr/bin/env node
const fs = require("fs");
const keys = ["ORCA_CONTROL_VERIFY", "ORCA_CHAIN_ID", "ORCA_CHAIN_SESSION"];
const env = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null]));
fs.appendFileSync(process.env.FAKE_VITEST_LOG, JSON.stringify({ argv: process.argv.slice(2), env }) + "\n");
process.exit(Number(process.env.FAKE_VITEST_EXIT || 0));
`;

describe("scripts/verify-suite.mjs", () => {
  function fixture(): { root: string; log: string } {
    const root = tempRoot();
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", "vitest"), FAKE_VITEST, { mode: 0o755 });
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
    return { root, log: join(root, "vitest.log") };
  }
  const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; env: Record<string, string | null> });

  it("runs vitest exactly once over the whole suite with formal control and a chain session's two variables set", () => {
    const { root, log } = fixture();
    const r = run("verify-suite.mjs", { FAKE_VITEST_LOG: log }, root);
    expect(r.code, r.out).toBe(0);
    expect(calls(log)).toEqual([{
      argv: ["run"],
      env: { ORCA_CONTROL_VERIFY: "1", ORCA_CHAIN_ID: "chain-deadbeef", ORCA_CHAIN_SESSION: "deadbeef-0000-4000-8000-000000000000" },
    }]);
  });

  it("forwards its arguments, so one file can be run under the gate's conditions, and carries vitest's exit code", () => {
    const { root, log } = fixture();
    const r = run("verify-suite.mjs", { FAKE_VITEST_LOG: log, FAKE_VITEST_EXIT: "3" }, root, ["tests/checkpoint/write.test.ts"]);
    expect(r.code).toBe(3);
    expect(calls(log).map((c) => c.argv)).toEqual([["run", "tests/checkpoint/write.test.ts"]]);
  });
});
