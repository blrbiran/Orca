import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePrivateDir, writeServiceFiles } from "../../src/service/files.js";
import { renderUnit } from "../../src/service/render.js";
import { systemd, systemdEnv } from "../../src/service/systemd.js";
import { fakeContext, fakeTools, sampleConfig, testPaths } from "./fixtures/fakeTools.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
const uid = process.getuid!();
async function setup(linger = "Linger=yes\n") {
  const r = await mkdtemp(join(tmpdir(), "sd-"));
  roots.push(r);
  const fake = await fakeTools(r);
  await fake.output("loginctl", "show-user", linger);
  const paths = testPaths(r);
  writeServiceFiles(paths, sampleConfig(paths));
  // XDG_RUNTIME_DIR is a directory this test owns, so the preflight keeps it.
  const { ctx, out, err } = fakeContext(fake, paths, { uid, env: { ...process.env, ...fake.env, XDG_RUNTIME_DIR: r } });
  return { fake, paths, ctx, out, err };
}

describe("systemd preflight (spec §4)", () => {
  const probe = (owner: number | null, bus: boolean) => ({ ownerOf: () => owner, exists: () => bus });
  it("sets XDG_RUNTIME_DIR when unset or not ours, and DBUS when the bus exists and it is unset", () => {
    expect(systemdEnv({}, 1000, probe(null, false)).XDG_RUNTIME_DIR).toBe("/run/user/1000");
    expect(systemdEnv({ XDG_RUNTIME_DIR: "/run/user/0" }, 1000, probe(0, false)).XDG_RUNTIME_DIR).toBe("/run/user/1000");
    expect(systemdEnv({ XDG_RUNTIME_DIR: "/r" }, 1000, probe(1000, false)).XDG_RUNTIME_DIR).toBe("/r");
    expect(systemdEnv({}, 1000, probe(null, true)).DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/run/user/1000/bus");
    expect(systemdEnv({ DBUS_SESSION_BUS_ADDRESS: "x" }, 1000, probe(null, true)).DBUS_SESSION_BUS_ADDRESS).toBe("x");
    expect(systemdEnv({}, 1000, probe(null, false)).DBUS_SESSION_BUS_ADDRESS).toBeUndefined();
  });
});

describe("systemd (spec §4, Linux table)", () => {
  it("install writes the unit, checks linger, daemon-reloads, enables and restarts (a re-install replaces a running panel)", async () => {
    const s = await setup();
    expect(await systemd.install(s.ctx)).toBe(0);
    expect(readFileSync(s.paths.unitFile, "utf8")).toBe(renderUnit(sampleConfig(s.paths), s.paths));
    expect(await s.fake.calls()).toEqual(["loginctl show-user ann -p Linger", "systemctl --user daemon-reload", "systemctl --user enable orca-panel-test",
      "systemctl --user restart orca-panel-test"]);
  });

  it("a failed enable stops install before the restart", async () => {
    const s = await setup();
    await s.fake.codes("systemctl", "enable", [1]);
    expect(await systemd.install(s.ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.includes("restart"))).toBe(false);
    expect(s.err.join("\n")).toContain(`enable orca-panel-test exited 1`);
  });

  it("status and logs never turn linger on: they say it is off (install, start and restart may)", async () => {
    const s = await setup("Linger=no\n");
    systemd.state(s.ctx);
    systemd.logs(s.ctx, { follow: false, lines: 5 });
    expect((await s.fake.calls()).some((c) => c.includes("enable-linger"))).toBe(false);
    expect(s.err).toEqual(Array(2).fill("orca panel: linger is off for ann, so the panel stops at logout. Run: sudo loginctl enable-linger ann"));
    expect(await systemd.start(s.ctx)).toBe(0);
    expect(await s.fake.calls()).toContain("loginctl enable-linger ann");
  });

  it("turns linger on when it is off, and prints the sudo line (never runs sudo) when it cannot", async () => {
    const s = await setup("Linger=no\n");
    await s.fake.codes("loginctl", "enable-linger", [1]);
    expect(await systemd.install(s.ctx)).toBe(0);
    const calls = await s.fake.calls();
    expect(calls.slice(0, 2)).toEqual(["loginctl show-user ann -p Linger", "loginctl enable-linger ann"]);
    expect(calls.some((c) => c.startsWith("sudo"))).toBe(false);
    expect(s.err.join("\n")).toContain("sudo loginctl enable-linger ann");
  });

  it.each(["start", "stop"] as const)("%s is systemctl --user %s <unit>", async (verb) => {
    const s = await setup();
    expect(await systemd[verb](s.ctx)).toBe(0);
    expect((await s.fake.calls()).at(-1)).toBe(`systemctl --user ${verb} orca-panel-test`);
  });


  it("restart always daemon-reloads before restarting, and rewrites the unit only when it changed", async () => {
    const s = await setup();
    ensurePrivateDir(dirname(s.paths.unitFile)); // the unit directory does not exist until install or restart creates it
    writeFileSync(s.paths.unitFile, renderUnit(sampleConfig(s.paths), s.paths));
    const mtime = (): number => statSync(s.paths.unitFile).mtimeMs;
    const before = mtime();
    expect(await systemd.restart(s.ctx)).toBe(0);
    expect((await s.fake.calls()).slice(1)).toEqual(["systemctl --user daemon-reload", "systemctl --user restart orca-panel-test"]);
    expect(mtime()).toBe(before);
    writeFileSync(s.paths.unitFile, "[Unit]\n");
    expect(await systemd.restart(s.ctx)).toBe(0);
    expect((await s.fake.calls()).slice(4)).toEqual(["systemctl --user daemon-reload", "systemctl --user restart orca-panel-test"]);
    expect(readFileSync(s.paths.unitFile, "utf8")).toBe(renderUnit(sampleConfig(s.paths), s.paths));
  });

  it("a failed daemon-reload stops install before enable and restart before restart, with the error shown", async () => {
    const s = await setup();
    await s.fake.codes("systemctl", "daemon-reload", [1]);
    expect(await systemd.install(s.ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.includes("enable"))).toBe(false);
    expect(s.err.join("\n")).toContain("systemctl --user daemon-reload exited 1");
    await s.fake.codes("systemctl", "daemon-reload", [1]);
    expect(await systemd.restart(s.ctx)).toBe(1);
    expect((await s.fake.calls()).some((c) => c.includes("restart"))).toBe(false);
  });

  it("any non-zero systemctl exit is 1, whatever the code", async () => {
    const s = await setup();
    await s.fake.codes("systemctl", "start", [5]);
    expect(await systemd.start(s.ctx)).toBe(1);
    expect(s.err.join("\n")).toContain("exited 5");
  });

  it("uninstall carries on after a failed disable: removes the unit, reloads, reports the error", async () => {
    const s = await setup();
    await systemd.install(s.ctx);
    await s.fake.codes("systemctl", "disable", [1]);
    expect(await systemd.uninstall(s.ctx)).toBe(0);
    expect(existsSync(s.paths.unitFile)).toBe(false);
    expect((await s.fake.calls()).at(-1)).toBe("systemctl --user daemon-reload");
    expect(s.err.join("\n")).toContain("disable --now orca-panel-test exited 1");
  });

  it("state is not loaded on a failing show and has no pid for MainPID=0; logs -f passes through", async () => {
    const s = await setup();
    await s.fake.codes("systemctl", "show", [1]);
    expect(systemd.state(s.ctx)).toEqual({ loaded: false, state: "not loaded", pid: null });
    await s.fake.output("systemctl", "show", "ActiveState=inactive\nSubState=dead\nMainPID=0\nNRestarts=0\n");
    expect(systemd.state(s.ctx).pid).toBeNull();
    expect(systemd.logs(s.ctx, { follow: true, lines: 5 })).toBe(0);
    expect(await s.fake.calls()).toContain("journalctl --user -u orca-panel-test -n 5 -f");
  });

  it("state reads ActiveState/SubState/MainPID/NRestarts; logs is journalctl; uninstall disables, removes, reloads", async () => {
    const s = await setup();
    await s.fake.output("systemctl", "show", "ActiveState=active\nSubState=running\nMainPID=777\nNRestarts=2\n");
    expect(systemd.state(s.ctx)).toEqual({ loaded: true, state: "active/running restarts=2", pid: 777 });
    expect(systemd.logs(s.ctx, { follow: false, lines: 30 })).toBe(0);
    await systemd.install(s.ctx);
    expect(await systemd.uninstall(s.ctx)).toBe(0);
    expect(existsSync(s.paths.unitFile)).toBe(false);
    const calls = await s.fake.calls();
    expect(calls).toContain("systemctl --user show orca-panel-test -p ActiveState,SubState,MainPID,NRestarts");
    expect(calls).toContain("journalctl --user -u orca-panel-test -n 30");
    expect(calls.slice(-2)).toEqual(["systemctl --user disable --now orca-panel-test", "systemctl --user daemon-reload"]);
  });
});
