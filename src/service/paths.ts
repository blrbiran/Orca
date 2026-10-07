import { homedir } from "node:os";
import { join } from "node:path";
import { ServiceRejection } from "./rejection.js";

export const DEFAULT_SERVICE_LABEL = "dev.orca.panel";
export const DEFAULT_SERVICE_UNIT = "orca-panel";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface ServicePaths {
  label: string; unit: string;
  panelDir: string; logsDir: string;
  configFile: string; envFile: string; runScript: string;
  lockFile: string; panelJson: string;
  outLog: string; errLog: string;
  plistFile: string; unitFile: string;
}

const given = (value: string | undefined): string | undefined => (value !== undefined && value.length > 0 ? value : undefined);

/** Spec §3/§5: ~/.orca/panel, relocated by ORCA_PANEL_DIR (Rule 17). Computed per call; never frozen at import. */
export function panelDir(env: NodeJS.ProcessEnv): string {
  return given(env.ORCA_PANEL_DIR) ?? join(homedir(), ".orca", "panel");
}

export function servicePaths(env: NodeJS.ProcessEnv): ServicePaths {
  const label = given(env.ORCA_SERVICE_LABEL) ?? DEFAULT_SERVICE_LABEL;
  const unit = given(env.ORCA_SERVICE_UNIT) ?? DEFAULT_SERVICE_UNIT;
  for (const [name, value] of [["ORCA_SERVICE_LABEL", label], ["ORCA_SERVICE_UNIT", unit]] as const) {
    if (!NAME.test(value)) throw new ServiceRejection("service-name-invalid", `${name} ${JSON.stringify(value)} must match ${NAME}`);
  }
  const dir = panelDir(env);
  const logsDir = join(dir, "logs");
  const agents = given(env.ORCA_LAUNCH_AGENTS_DIR) ?? join(homedir(), "Library", "LaunchAgents");
  const units = given(env.ORCA_SYSTEMD_USER_DIR) ?? join(given(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config"), "systemd", "user");
  return {
    label, unit, panelDir: dir, logsDir,
    configFile: join(dir, "service.json"), envFile: join(dir, "service.env"), runScript: join(dir, "run.sh"),
    lockFile: join(dir, "panel.lock"), panelJson: join(dir, "panel.json"),
    outLog: join(logsDir, "panel.out.log"), errLog: join(logsDir, "panel.err.log"),
    plistFile: join(agents, `${label}.plist`), unitFile: join(units, `${unit}.service`),
  };
}
