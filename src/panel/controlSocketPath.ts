import { join } from "node:path";

/** Agent entry spec §3: the panel's second listener, for agents on this machine. Auth is the file mode. */
export const CONTROL_SOCKET_NAME = "control.sock";
/** sun_path including its NUL: 104 on macOS, 108 on Linux. */
const SUN_PATH_BYTES = process.platform === "darwin" ? 104 : 108;

export const controlSocketPath = (stateDir: string): string => join(stateDir, CONTROL_SOCKET_NAME);
export const socketPathTooLong = (path: string): boolean => Buffer.byteLength(path) >= SUN_PATH_BYTES;
