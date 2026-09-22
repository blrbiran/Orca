import { describe, expect, it, vi } from "vitest";
import { runControlPanelStartup } from "../../src/panel/controlLifecycle.js";

/**
 * Assembly plan Task 6 (spec §6, ruling R4). The ordering, judged as an ordering.
 *
 * A criterion that asserted "recover was called" would also pass when listen came first, which is
 * precisely the bug: a connection accepted while reconciliation is in flight can dispatch against
 * run state this process has not reconciled. So what is recorded here is the sequence, and the
 * recovery deliberately resolves only after an await, so that "started first" is not enough to pass.
 */
describe("a panel recovers before it listens", () => {
  it("resolves recovery strictly before the listen callback runs, not merely first", async () => {
    const order: string[] = [];
    await runControlPanelStartup({
      recover: async () => {
        order.push("recover:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        await Promise.resolve();
        order.push("recover:done");
      },
      listen: async () => { order.push("listen"); },
    });
    expect(order).toEqual(["recover:start", "recover:done", "listen"]);
  });

  it("never opens the socket at all when recovery throws", async () => {
    // Fail closed: a panel that could not reconcile must not accept a connection it would then
    // answer from unreconciled state.
    const listen = vi.fn(async () => undefined);
    await expect(runControlPanelStartup({
      recover: async () => { throw new Error("reconcile failed"); },
      listen,
    })).rejects.toThrow("reconcile failed");
    expect(listen).not.toHaveBeenCalled();
  });
});

import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function runtime() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-pump-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  const { rejection, ...control } = resolveControlOptions(["--by", "t"], { ORCA_CONTROL_DIR: join(root, "control") }, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const assembled = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-pump", env: {} });
  expect(assembled).not.toBe(null);
  return assembled!;
}

describe("the wake pump belongs to the process, not to a request", () => {
  it("runs one pass at a time: a re-entrant call joins the pass in flight instead of starting a second", async () => {
    const control = await runtime();
    try {
      // Same promise identity, not merely "both resolved": two passes racing the single-writer gate
      // for the rows the first is already draining is the shape this prevents.
      const first = control.pump();
      const second = control.pump();
      expect(second).toBe(first);
      await Promise.all([first, second]);
    } finally { control.close(); }
  });

  it("is available again once the pass in flight has finished", async () => {
    const control = await runtime();
    try {
      const first = control.pump();
      await first;
      expect(control.pump()).not.toBe(first);
      await control.pump();
    } finally { control.close(); }
  });

  it("stops when the runtime closes, so a closed panel is not still writing", async () => {
    const control = await runtime();
    control.startPump(5);
    control.close();
    // close() is the only stop: there is no other handle on the timer, so if it did not clear it
    // the interval would outlive the store it writes to.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => control.store.db.prepare("SELECT 1").get()).toThrow();
  });

  it("arms the timer only once, however many times it is asked", async () => {
    const control = await runtime();
    try {
      // Measured, not assumed: a second timer would double every delivery pass for the life of the
      // process, and nothing else in the system would notice.
      expect([control.startPump(1_000), control.startPump(1_000), control.startPump(1_000)]).toEqual([true, false, false]);
    } finally { control.close(); }
  });

  it("can be armed again after a close, because a restart is a new process's business", async () => {
    const control = await runtime();
    expect(control.startPump(1_000)).toBe(true);
    control.close();
    expect(control.startPump(1_000)).toBe(true);
    control.close();
  });
});
