import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { shutdownCommandId } from "../../src/panel/controlLifecycle.js";

/**
 * Assembly plan Task 7 (spec §6). A shutdown writes one identity for the epoch. "One" is judged by
 * counting the ledger rows that carry that identity, never by the log or by the return value alone:
 * an implementation that reorders its logging would pass the second and fail the first.
 */

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function runtime(epoch = "epoch-shutdown") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-shutdown-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const repos = [{ projectKey: "proj", path: repo }];
  const { rejection, ...control } = resolveControlOptions(["--by", "t"], { ORCA_CONTROL_DIR: join(root, "control") }, repos);
  expect(rejection).toBe(null);
  const assembled = await assembleControlRuntime({ control, repos, epoch, env: {} });
  expect(assembled).not.toBe(null);
  return assembled!;
}

const commandRows = (control: Awaited<ReturnType<typeof runtime>>, id: string): number =>
  Number(control.store.db.prepare("SELECT count(*) AS n FROM commands WHERE id=?").get(id)?.n ?? 0);

describe("a panel shuts its control plane down once per epoch", () => {
  it("writes exactly one command row for the epoch's shutdown identity", async () => {
    const control = await runtime();
    try {
      expect(await control.shutdown()).toBe(true);
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
    } finally { control.close(); }
  });

  it("does not write a second identity when a second signal arrives", async () => {
    const control = await runtime();
    try {
      const [first, second] = await Promise.all([control.shutdown(), control.shutdown()]);
      // Row count first, return value second: the count is what a duplicate would actually corrupt.
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
      expect([first, second].filter(Boolean)).toHaveLength(1);
    } finally { control.close(); }
  });

  it("does not write a second identity for a signal that arrives after the first finished", async () => {
    // Different from the racing case above: a latch that only guards concurrent calls would pass
    // that one and fail this one.
    const control = await runtime();
    try {
      expect(await control.shutdown()).toBe(true);
      expect(await control.shutdown()).toBe(false);
      expect(commandRows(control, shutdownCommandId("epoch-shutdown"))).toBe(1);
    } finally { control.close(); }
  });

  it("gives a different epoch its own identity, because a restart is not the same shutdown", async () => {
    const a = await runtime("epoch-a");
    try { await a.shutdown(); } finally { a.close(); }
    const b = await runtime("epoch-b");
    try {
      await b.shutdown();
      expect(commandRows(b, shutdownCommandId("epoch-b"))).toBe(1);
      expect(shutdownCommandId("epoch-a")).not.toBe(shutdownCommandId("epoch-b"));
    } finally { b.close(); }
  });

  it("stops the wake pump, so nothing keeps writing after the gate has closed", async () => {
    const control = await runtime();
    try {
      expect(control.startPump(1_000)).toBe(true);
      await control.shutdown();
      // Armed again means the timer really was cleared: startPump answers false while one is live.
      expect(control.startPump(1_000)).toBe(true);
    } finally { control.close(); }
  });
});

import { spawn } from "node:child_process";
import { openControlStore } from "../../src/control/store.js";

/**
 * The plan's Task 7 Step 1: a real signal delivered to a real process. The judgements above exercise
 * `shutdown()`; this one exercises the handler, which is the part a wrong `process.on` would break
 * while every one of them stayed green.
 */
describe("a real SIGTERM to a real panel", () => {
  it("makes it exit cleanly, having written one shutdown row for its epoch", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-signal-")));
    roots.push(root);
    const repo = join(root, "repo");
    const controlRoot = join(root, "control");
    await mkdir(repo, { recursive: true });
    await mkdir(join(root, "corrections"), { recursive: true });

    const child = spawn("./node_modules/.bin/tsx", ["src/cli.ts", "panel", "--by", "tester", "--repo", `proj=${repo}`, "--port", "0"], {
      cwd: process.cwd(),
      env: { ...process.env, ORCA_CONTROL_DIR: controlRoot, ORCA_CORRECTIONS_DIR: join(root, "corrections") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      // The child's stderr is carried into the failure message. "exited 1 before ready" names
      // nothing, and a criterion whose failure tells the reader nothing costs a debugging round.
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ready line within 30s; stderr: ${stderr}`)), 30_000);
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("orca-panel ready")) { clearTimeout(timer); resolve(); }
        });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`exited ${code} before ready; stderr: ${stderr}`)); });
      });

      const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
      child.kill("SIGTERM");
      // A second signal immediately after, which must not add an identity. The process may already
      // be gone by the time it lands; that is fine, the row count is what is being judged.
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }

    // Opened after the child is gone, so this is reading what it left behind rather than racing it.
    const store = await openControlStore({ stateDir: join(controlRoot, controlRepoKey("proj")), recovery: true });
    try {
      const rows = store.db.prepare("SELECT id FROM commands WHERE id LIKE 'shutdown-%'").all();
      expect(rows).toHaveLength(1);
    } finally { store.close(); }
  }, 60_000);
});
