import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePrivateDir, writeServiceFiles } from "../../src/service/files.js";
import { launchd } from "../../src/service/launchd.js";
import { renderPlist } from "../../src/service/render.js";
import { fakeContext, fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function setup(aqua = true) {
  const r = await mkdtemp(join(tmpdir(), "sl-"));
  roots.push(r);
  const fake = await fakeTools(r);
  if (aqua) await fake.output("launchctl", "managername", "Aqua\n");
  const paths = testPaths(r);
  return { fake, paths, target: "gui/501/dev.orca.panel.test", plist: paths.plistFile };
}

describe("launchd (spec §4, macOS table)", () => {
  it("install writes the plist 0600, then bootout (ignored), enable, bootstrap — in that order", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootout", [113]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(0);
    expect(readFileSync(s.plist, "utf8")).toBe(renderPlist(s.paths));
    expect(statSync(s.plist).mode & 0o777).toBe(0o600);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl bootout ${s.target}`, `launchctl enable ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
  });

  it("uses user/<uid> when the manager is not Aqua (ssh, no GUI session)", async () => {
    const s = await setup(false);
    await s.fake.output("launchctl", "managername", "Background\n");
    const { ctx } = fakeContext(s.fake, s.paths);
    await launchd.install(ctx);
    expect((await s.fake.calls()).at(-1)).toBe(`launchctl bootstrap user/501 ${s.plist}`);
  });

  it("retries a bootstrap that exits 5 (label still draining) after a bootout, until it succeeds", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [5, 5, 0]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(0);
    expect((await s.fake.calls()).slice(3)).toEqual([
      `launchctl bootstrap gui/501 ${s.plist}`, `launchctl bootout ${s.target}`,
      `launchctl bootstrap gui/501 ${s.plist}`, `launchctl bootout ${s.target}`,
      `launchctl bootstrap gui/501 ${s.plist}`,
    ]);
  });

  it("gives up on exit 5 at the deadline and says so", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [5, 5, 5, 5, 5, 5, 5, 5]);
    const { ctx, err } = fakeContext(s.fake, s.paths, { bootstrapDeadlineMs: 1_000 });
    expect(await launchd.install(ctx)).toBe(1);
    expect(err.join("\n")).toContain("exited 5");
    expect((await s.fake.calls()).filter((c) => c.startsWith("launchctl bootstrap"))).toHaveLength(3);
  });

  it("does not retry another bootstrap failure", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "bootstrap", [1]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(1);
    expect((await s.fake.calls()).filter((c) => c.startsWith("launchctl bootstrap"))).toHaveLength(1);
  });

  it("start is kickstart, and only when it is not loaded", async () => {
    const s = await setup();
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart ${s.target}`]);
  });

  it.each([3, 113, 125])("start bootstraps when kickstart exits %i (not loaded)", async (code) => {
    const s = await setup();
    await s.fake.codes("launchctl", "kickstart", [code]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
  });

  it("start does not bootstrap over another kickstart failure", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "kickstart", [1]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.start(ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.startsWith("launchctl bootstrap"))).toBe(false);
  });

  it("stop is bootout (KeepAlive would revive a merely stopped job); not loaded counts as stopped", async () => {
    const s = await setup();
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.stop(ctx)).toBe(0);
    await s.fake.codes("launchctl", "bootout", [113]);
    expect(await launchd.stop(ctx)).toBe(0);
    expect((await s.fake.calls()).filter((c) => c.includes("bootout"))).toEqual([`launchctl bootout ${s.target}`, `launchctl bootout ${s.target}`]);
  });

  it("restart with an unchanged plist is kickstart -k", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, renderPlist(s.paths));
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.restart(ctx)).toBe(0);
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl kickstart -k ${s.target}`]);
  });

  it("restart with an unchanged plist bootstraps when kickstart -k says not loaded", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, renderPlist(s.paths));
    await s.fake.codes("launchctl", "kickstart", [113]);
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(await launchd.restart(ctx)).toBe(0);
    expect((await s.fake.calls()).at(-1)).toBe(`launchctl bootstrap gui/501 ${s.plist}`);
  });

  it("any other launchctl failure is a named failure, not swallowed: enable, stop, uninstall", async () => {
    const s = await setup();
    await s.fake.codes("launchctl", "enable", [1]);
    const { ctx, err } = fakeContext(s.fake, s.paths);
    expect(await launchd.install(ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.startsWith("launchctl bootstrap"))).toBe(false);
    await s.fake.codes("launchctl", "bootout", [1, 1]);
    expect(await launchd.stop(ctx)).toBe(1);
    expect(await launchd.uninstall(ctx)).toBe(1);
    expect(existsSync(s.plist)).toBe(true); // a service launchd may still run keeps its plist
    expect(err).toHaveLength(3);
    expect(err.join("\n")).toContain("launchctl enable exited 1");
    await s.fake.codes("launchctl", "bootout", [113]);
    expect(await launchd.uninstall(ctx)).toBe(0); // not loaded is already the uninstalled state
    expect(existsSync(s.plist)).toBe(false);
  });

  it("restart with a changed plist rewrites it, boots out, waits for the pid, bootstraps (kickstart -k would keep the old plist)", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, "<old/>");
    await s.fake.output("launchctl", "print", `${s.target} = {\n\tstate = running\n\tpid = 4242\n}\n`);
    let polls = 0;
    const { ctx } = fakeContext(s.fake, s.paths, { isAlive: (pid) => pid === 4242 && ++polls < 3 });
    expect(await launchd.restart(ctx)).toBe(0);
    expect(readFileSync(s.plist, "utf8")).toBe(renderPlist(s.paths));
    expect(await s.fake.calls()).toEqual(["launchctl managername", `launchctl print ${s.target}`, `launchctl bootout ${s.target}`, `launchctl bootstrap gui/501 ${s.plist}`]);
    expect(polls).toBe(3);
  });

  it("restart does not bootstrap over a pid that never exits", async () => {
    const s = await setup();
    ensurePrivateDir(join(s.plist, ".."));
    writeFileSync(s.plist, "<old/>");
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { ctx, err } = fakeContext(s.fake, s.paths, { isAlive: () => true, exitWaitMs: 1_000 });
    expect(await launchd.restart(ctx)).toBe(1);
    expect(err.join("\n")).toContain("did not exit");
    expect((await s.fake.calls()).some((c) => c.startsWith("launchctl bootstrap"))).toBe(false);
  });

  it("state reads launchctl print; a print failure is not loaded", async () => {
    const s = await setup();
    await s.fake.output("launchctl", "print", "\tstate = running\n\tpid = 4242\n");
    const { ctx } = fakeContext(s.fake, s.paths);
    expect(launchd.state(ctx)).toEqual({ loaded: true, state: "running", pid: 4242 });
    await s.fake.codes("launchctl", "print", [113]);
    expect(launchd.state(ctx)).toEqual({ loaded: false, state: "not loaded", pid: null });
  });

  it("logs tails both files; uninstall boots out and removes plist and run.sh but keeps service.json and logs", async () => {
    const s = await setup();
    writeServiceFiles(s.paths, sampleConfig(s.paths));
    const { ctx } = fakeContext(s.fake, s.paths);
    await launchd.install(ctx);
    expect(launchd.logs(ctx, { follow: true, lines: 50 })).toBe(0);
    // Without --follow there is no -F, and tail's own exit code is the answer (the CLI maps it, Ruling T11b).
    await s.fake.codes("tail", "-n", [2]);
    expect(launchd.logs(ctx, { follow: false, lines: 5 })).toBe(2);
    expect(await launchd.uninstall(ctx)).toBe(0);
    expect([existsSync(s.plist), existsSync(s.paths.runScript), existsSync(s.paths.configFile), existsSync(s.paths.errLog)]).toEqual([false, false, true, true]);
    const calls = await s.fake.calls();
    expect(calls).toContain(`tail -n 50 -F ${s.paths.outLog} ${s.paths.errLog}`);
    expect(calls).toContain(`tail -n 5 ${s.paths.outLog} ${s.paths.errLog}`);
    expect(calls.at(-1)).toBe(`launchctl bootout ${s.target}`);
  });
});
