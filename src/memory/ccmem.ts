import { type ExecFileException, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MemoryError, type MemoryAdapter, type MemoryHealth, type MemoryRecord, type MemoryScope } from "./adapter.js";
import { type CcmemScope, parseCcmemExport } from "./ccmemExport.js";
import { searchRecords } from "./search.js";

/**
 * Memory tab spec §3. The only code in Orca that starts ccmem, and it only ever runs `export`: `list` and `show`
 * write to ccmem's database (spec §3.1). Starting ccmem opens its database and may migrate it (spec §4, accepted by
 * ruling Q2), so nothing here runs ccmem unless ORCA_CCMEM_BIN names it, and health() never runs it at all.
 */
export const CCMEM_TIMEOUT_MS = 30_000; // spec §3.3: estimated, never measured on real data (ruling Q6)
export const CCMEM_MAX_BUFFER = 64 * 1024 * 1024;
const STDERR_EXCERPT_BYTES = 2048;

export interface CcmemAdapterOptions {
  /** Absolute path from ORCA_CCMEM_BIN; null when unset. */
  ccmemBin: string | null;
  /** The env the panel was started with, passed to ccmem as is (CCMEM_DATA_ROOT, HOME, PATH, CCMEM_CONFIG_PATH). */
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export function createCcmemAdapter(options: CcmemAdapterOptions): MemoryAdapter {
  const timeout = options.timeoutMs ?? CCMEM_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? CCMEM_MAX_BUFFER;

  /** Spec §10 D5: a relative path would be resolved against the target repository, which could plant its own ccmem. */
  const usableBin = (): string => {
    const bin = options.ccmemBin;
    if (bin === null) throw new MemoryError("ccmem-missing", "ORCA_CCMEM_BIN is not set; the panel never starts ccmem without it");
    if (!isAbsolute(bin)) throw new MemoryError("ccmem-missing", `ORCA_CCMEM_BIN must be an absolute path, got ${JSON.stringify(bin)}`);
    return bin;
  };

  const runExport = (bin: string, scope: CcmemScope, cwd: string): Promise<string> => new Promise((resolve, reject) => {
    const child = execFile(bin, ["export", "--json", "--scope", scope], { cwd, env: options.env, encoding: "utf8", timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(exportFailure(error, { bin, scope, maxBuffer, timeout, stderr: String(stderr) }));
    });
    child.stdin?.end();
  });

  /** One after the other, never together (spec §3.3): the first may migrate, and two would contend for ccmem's write lock. */
  const visible = async (scope: MemoryScope): Promise<MemoryRecord[]> => {
    const bin = usableBin();
    const global = parseCcmemExport(await runExport(bin, "global", scope.repoPath), "global");
    const project = parseCcmemExport(await runExport(bin, "project", scope.repoPath), "project");
    return [...global, ...project];
  };

  return {
    id: "ccmem",
    capabilities: () => ({ search: true, get: true, recordCorrection: false }),
    health: async (): Promise<MemoryHealth> => {
      try {
        const bin = usableBin();
        const info = await stat(bin).catch((err: NodeJS.ErrnoException) => { throw new MemoryError("ccmem-missing", `${bin}: ${err.code ?? err.message}`); });
        if (!info.isFile()) throw new MemoryError("ccmem-missing", `${bin}: not a regular file`);
        await access(bin, constants.X_OK).catch(() => { throw new MemoryError("ccmem-missing", `${bin}: not executable`); });
        return { status: "ok" };
      } catch (err) {
        if (err instanceof MemoryError) return { status: "unavailable", code: err.code, message: err.message };
        throw err;
      }
    },
    search: async (scope, searchOptions) => searchRecords(await visible(scope), searchOptions),
    get: async (scope, ref) => (await visible(scope)).find((record) => record.ref === ref) ?? null,
  };
}

/** Same shape as src/control/ccloopPort.ts's mapping. Order matters: a maxBuffer overrun also sets `killed`. */
function exportFailure(error: ExecFileException, ctx: { bin: string; scope: CcmemScope; maxBuffer: number; timeout: number; stderr: string }): MemoryError {
  const what = `ccmem export --scope ${ctx.scope}`;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "EACCES") return new MemoryError("ccmem-missing", `${ctx.bin}: ${code} (${what})`);
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new MemoryError("ccmem-output-too-large", `${what} wrote more than ${ctx.maxBuffer} bytes`);
  if (error.killed === true) return new MemoryError("ccmem-timeout", `${what} did not finish within ${ctx.timeout} ms`);
  const status = typeof code === "number" ? String(code) : (error.signal ?? "unknown");
  return new MemoryError(`ccmem-failed:${status}`, `${what} exited ${status}: ${ctx.stderr.slice(0, STDERR_EXCERPT_BYTES)}`);
}
