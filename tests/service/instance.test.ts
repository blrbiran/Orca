import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquirePanelLock, readPanelJson, removePanelJsonIfOurs, writePanelJson } from "../../src/service/instance.js";
import { rotateLogs } from "../../src/service/logRotate.js";
import { isProcessAlive, processStartTime } from "../../src/service/processInfo.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "si-")); roots.push(r); return r; }
const self = { pid: 1111, startTime: "Mon Oct  5 10:00:00 2026" };

describe("the single-instance lock (spec §5)", () => {
  it("is created 0600 with the holder's pid and start time, and released only by its holder", async () => {
    const file = join(await root(), "panel.lock");
    const outcome = acquirePanelLock(file, self, { startTimeOf: () => null });
    expect(outcome.kind).toBe("acquired");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(self);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeFileSync(file, JSON.stringify({ pid: 2222, startTime: "x" }));
    if (outcome.kind === "acquired") outcome.release();
    expect(existsSync(file)).toBe(true);
  });

  it("a live holder (same start time) keeps it", async () => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, JSON.stringify(self));
    expect(acquirePanelLock(file, { pid: 3333, startTime: "y" }, { startTimeOf: (pid) => (pid === 1111 ? self.startTime : null) })).toEqual({ kind: "held", holder: self });
  });

  it.each([
    ["a dead pid", () => null],
    ["a reused pid (start time differs)", () => "Tue Oct  6 09:00:00 2026"],
  ])("is taken over from %s", async (_name, startTimeOf) => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, JSON.stringify(self));
    const mine = { pid: 4444, startTime: "z" };
    expect(acquirePanelLock(file, mine, { startTimeOf }).kind).toBe("acquired");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(mine);
  });

  it("is taken over from a body no panel wrote", async () => {
    const file = join(await root(), "panel.lock");
    writeFileSync(file, "not json");
    expect(acquirePanelLock(file, self, { startTimeOf: () => "anything" }).kind).toBe("acquired");
  });
});

describe("panel.json (spec §5)", () => {
  it("round-trips, is 0600, and is removed only by the pid it names", async () => {
    const file = join(await root(), "panel.json");
    const body = { pid: 1111, startTime: "s", url: "http://127.0.0.1:7777", socketPath: "/s/control.sock", version: "0.1.0" };
    expect(readPanelJson(file)).toEqual({ kind: "missing" });
    writePanelJson(file, body);
    expect(readPanelJson(file)).toEqual({ kind: "valid", body });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    removePanelJsonIfOurs(file, 2222);
    expect(existsSync(file)).toBe(true);
    removePanelJsonIfOurs(file, 1111);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "{");
    expect(readPanelJson(file).kind).toBe("invalid");
  });
});

describe("log rotation (spec §6, plan D11)", () => {
  it("copy-truncates a log over the limit and keeps three", async () => {
    const r = await root();
    const log = join(r, "panel.err.log");
    for (const [suffix, text] of [["", "now".repeat(10)], [".1", "one"], [".2", "two"], [".3", "three"]] as const) writeFileSync(`${log}${suffix}`, text);
    rotateLogs([log, join(r, "absent.log")], { maxBytes: 20, keep: 3 });
    expect([readFileSync(log, "utf8"), readFileSync(`${log}.1`, "utf8"), readFileSync(`${log}.2`, "utf8"), readFileSync(`${log}.3`, "utf8")]).toEqual(["", "now".repeat(10), "one", "two"]);
    expect(existsSync(`${log}.4`)).toBe(false);
    expect(statSync(`${log}.1`).mode & 0o777).toBe(0o600);
  });

  it("leaves a log under the limit alone", async () => {
    const log = join(await root(), "panel.out.log");
    writeFileSync(log, "small");
    rotateLogs([log], { maxBytes: 20, keep: 3 });
    expect([readFileSync(log, "utf8"), existsSync(`${log}.1`)]).toEqual(["small", false]);
  });
});

describe("process identity (plan D9)", () => {
  it("reads this process's start time and none for a dead pid", () => {
    expect(processStartTime(process.pid)).toMatch(/\d{4}$/);
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(processStartTime(2 ** 22 - 3)).toBe(null);
  });
});
