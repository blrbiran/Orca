import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PanelRejection } from "../panel/rejection.js";
import { acquirePanelLock, removePanelJsonIfOurs, writePanelJson } from "./instance.js";
import { LOG_KEEP, LOG_MAX_BYTES, rotateLogs } from "./logRotate.js";
import type { ServiceIo } from "./manager.js";
import { servicePaths } from "./paths.js";
import { ensurePrivateDir } from "./privateFiles.js";
import { processStartTime } from "./processInfo.js";
import { ServiceRejection } from "./rejection.js";

const orcaVersion = (): string =>
  (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")) as { version: string }).version;

/** Spec §5/§6: what the service manager runs. Lock → panel → panel.json → (closed) → remove panel.json → release. */
export async function runServicePanel(args: string[], env: NodeJS.ProcessEnv, io: ServiceIo): Promise<number> {
  try {
    const paths = servicePaths(env);
    ensurePrivateDir(paths.panelDir);
    rotateLogs([paths.outLog, paths.errLog], { maxBytes: LOG_MAX_BYTES, keep: LOG_KEEP });
    const startTime = processStartTime(process.pid);
    if (startTime === null) { io.stderr("orca-panel: cannot read this process's start time (ps -o lstart=); not taking the lock\n"); return 1; }
    const self = { pid: process.pid, startTime };
    const lock = acquirePanelLock(paths.lockFile, self, { startTimeOf: processStartTime });
    if (lock.kind === "held") {
      // Spec §5: exit 0 parks the job under launchd (SuccessfulExit:false) and is success under systemd (D1).
      io.stderr(`orca-panel: another panel (pid ${lock.holder.pid}) holds ${paths.lockFile}; this one exits\n`);
      return 0;
    }
    try {
      const { panelReadyLines, startPanelFromArgs } = await import("../panel/server.js");
      const started = await startPanelFromArgs(args, { service: true });
      writePanelJson(paths.panelJson, { ...self, url: started.url, socketPath: started.socketPath, version: orcaVersion() });
      const lines = panelReadyLines(started);
      io.stdout(lines.stdout);
      io.stderr(lines.stderr);
      await started.closed;
      removePanelJsonIfOurs(paths.panelJson, process.pid);
      return 0;
    } finally { lock.release(); }
  } catch (error) {
    if (error instanceof PanelRejection || error instanceof ServiceRejection) {
      io.stderr(`rejected: ${error.code}: ${error.message}\n`);
      return error instanceof PanelRejection ? error.exitCode : 1;
    }
    throw error;
  }
}
