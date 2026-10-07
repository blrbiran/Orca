import { homedir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVICE_LABEL, servicePaths } from "../../src/service/paths.js";

afterEach(() => { vi.unstubAllEnvs(); });

describe("service paths (spec §2, §3; Rule 17)", () => {
  it("defaults to the documented locations under HOME", () => {
    vi.stubEnv("HOME", "/home/ann");
    expect(homedir()).toBe("/home/ann");
    const p = servicePaths({});
    expect(p).toEqual({
      label: "dev.orca.panel", unit: "orca-panel",
      panelDir: "/home/ann/.orca/panel", logsDir: "/home/ann/.orca/panel/logs",
      configFile: "/home/ann/.orca/panel/service.json", envFile: "/home/ann/.orca/panel/service.env",
      runScript: "/home/ann/.orca/panel/run.sh", lockFile: "/home/ann/.orca/panel/panel.lock",
      panelJson: "/home/ann/.orca/panel/panel.json",
      outLog: "/home/ann/.orca/panel/logs/panel.out.log", errLog: "/home/ann/.orca/panel/logs/panel.err.log",
      plistFile: "/home/ann/Library/LaunchAgents/dev.orca.panel.plist",
      unitFile: "/home/ann/.config/systemd/user/orca-panel.service",
    });
    expect(servicePaths({ XDG_CONFIG_HOME: "/x" }).unitFile).toBe("/x/systemd/user/orca-panel.service");
  });

  it("relocates every path a criterion could otherwise write into a real home", () => {
    const p = servicePaths({ ORCA_PANEL_DIR: "/t/p", ORCA_LAUNCH_AGENTS_DIR: "/t/la", ORCA_SYSTEMD_USER_DIR: "/t/su", ORCA_SERVICE_LABEL: "dev.orca.panel.x", ORCA_SERVICE_UNIT: "orca-x" });
    expect([p.panelDir, p.plistFile, p.unitFile, p.label, p.unit]).toEqual(["/t/p", "/t/la/dev.orca.panel.x.plist", "/t/su/orca-x.service", "dev.orca.panel.x", "orca-x"]);
  });

  it("refuses a label or unit name that would escape its directory", () => {
    expect(() => servicePaths({ ORCA_SERVICE_LABEL: "../evil" })).toThrow(expect.objectContaining({ code: "service-name-invalid" }));
    expect(() => servicePaths({ ORCA_SERVICE_UNIT: "a/b" })).toThrow(expect.objectContaining({ code: "service-name-invalid" }));
  });

  it("refuses a relative directory variable: the service and its manager do not run in this shell's directory", () => {
    for (const env of [{ ORCA_PANEL_DIR: "p" }, { ORCA_LAUNCH_AGENTS_DIR: "la" }, { ORCA_SYSTEMD_USER_DIR: "./su" }, { XDG_CONFIG_HOME: "cfg" }]) {
      expect(() => servicePaths(env), JSON.stringify(env)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
    }
    // XDG_CONFIG_HOME only matters when ORCA_SYSTEMD_USER_DIR does not override it.
    expect(servicePaths({ XDG_CONFIG_HOME: "cfg", ORCA_SYSTEMD_USER_DIR: "/t/su" }).unitFile).toBe("/t/su/orca-panel.service");
  });

  it("every test process runs with the service relocated away from the real home (setup file)", () => {
    const p = servicePaths(process.env);
    expect(p.label).not.toBe(DEFAULT_SERVICE_LABEL);
    for (const path of [p.panelDir, p.plistFile, p.unitFile]) expect(path.startsWith(homedir())).toBe(false);
  });
});
