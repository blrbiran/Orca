import { randomBytes } from "node:crypto";
import { linkSync, unlinkSync, writeFileSync } from "node:fs";
import { readTextOrNull, writePrivateFile } from "./privateFiles.js";
import { ServiceRejection } from "./rejection.js";

export interface LockBody { pid: number; startTime: string }
export type LockOutcome = { kind: "acquired"; release(): void } | { kind: "held"; holder: LockBody };

function parseLock(text: string): LockBody | null {
  try {
    const value = JSON.parse(text) as Partial<LockBody>;
    return Number.isInteger(value.pid) && typeof value.startTime === "string" ? { pid: value.pid!, startTime: value.startTime } : null;
  } catch { return null; }
}
const unlinkQuiet = (file: string): void => { try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };

/**
 * Spec §5 and plan D10. link() from a complete temp file is the O_EXCL create: no reader sees a half-written lock.
 * A holder is live only if its pid still has the start time it recorded; anything else is stale and is removed if
 * its bytes are still the ones judged. That re-read narrows the window but is check-then-unlink, not atomic: two
 * instances taking over the same stale lock at once could both acquire. Only the service manager starts `--service`,
 * one instance at a time, and the loser would then exit 78 on the shared port.
 */
export function acquirePanelLock(file: string, self: LockBody, probe: { startTimeOf(pid: number): string | null }): LockOutcome {
  const body = JSON.stringify(self);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const temp = `${file}.${self.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
    try {
      linkSync(temp, file);
      return { kind: "acquired", release: () => { if (readTextOrNull(file) === body) unlinkQuiet(file); } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally { unlinkQuiet(temp); }
    const seen = readTextOrNull(file);
    if (seen === null) continue;
    const holder = parseLock(seen);
    if (holder !== null && probe.startTimeOf(holder.pid) === holder.startTime) return { kind: "held", holder };
    if (readTextOrNull(file) === seen) unlinkQuiet(file);
  }
  throw new ServiceRejection("panel-lock-contended", `${file} changed hands three times while this panel tried to take it`);
}

export interface PanelJsonV1 { pid: number; startTime: string; url: string; socketPath: string | null; version: string }

export function readPanelJson(file: string): { kind: "missing" } | { kind: "invalid"; reason: string } | { kind: "valid"; body: PanelJsonV1 } {
  const text = readTextOrNull(file);
  if (text === null) return { kind: "missing" };
  try {
    const v = JSON.parse(text) as Partial<PanelJsonV1>;
    if (Number.isInteger(v.pid) && typeof v.startTime === "string" && typeof v.url === "string" && (v.socketPath === null || typeof v.socketPath === "string") && typeof v.version === "string") {
      return { kind: "valid", body: { pid: v.pid!, startTime: v.startTime, url: v.url, socketPath: v.socketPath, version: v.version } };
    }
    return { kind: "invalid", reason: "missing or mistyped fields" };
  } catch (error) { return { kind: "invalid", reason: String(error) }; }
}

export function writePanelJson(file: string, body: PanelJsonV1): void { writePrivateFile(file, `${JSON.stringify(body)}\n`); }

export function removePanelJsonIfOurs(file: string, pid: number): void {
  const read = readPanelJson(file);
  if (read.kind === "valid" && read.body.pid === pid) unlinkQuiet(file);
}
