import { type ExecFileException, execFile } from "node:child_process";
import { constants } from "node:fs";
import { constants as osConstants } from "node:os";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MemoryError, type MemoryAdapter, type MemoryHealth, type MemoryPage, type MemoryRecord, type MemoryScope, type MemorySearchOptions } from "./adapter.js";
import { type CcmemList, type CcmemScoredRecord, type CcmemScope, parseCcmemExport, parseCcmemList, parseCcmemShow } from "./ccmemExport.js";
import { searchRecords } from "./search.js";

/**
 * Memory tab spec §3, read path revised by issue #418. The only code in Orca that starts ccmem, and it only ever reads:
 * `list --json` for a page, `show --json` for one record, and `export --json` only as the fallback for an older ccmem.
 * Starting ccmem opens its database and may migrate it (spec §4, accepted by ruling Q2), so nothing here runs ccmem
 * unless ORCA_CCMEM_BIN names it, and health() never runs it at all.
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

interface FailureContext {
  bin: string;
  what: string;
  maxBuffer: number;
  timeout: number;
  stderr: string;
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

  const runCcmem = (bin: string, argv: string[], cwd: string, what: string): Promise<string> => new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(bin, argv, { cwd, env: options.env, encoding: "utf8", timeout, maxBuffer }, (error, stdout, stderr) => {
        if (error === null) resolve(stdout);
        else reject(ccmemFailure(error, { bin, what, maxBuffer, timeout, stderr: String(stderr) }));
      });
    } catch (err) {
      // Node throws, instead of calling back, for most spawn errnos (ENOTDIR for a cwd that is a file, ENOEXEC, EPERM;
      // v22.13.1). Those are ccmem failing to start; anything else (an invalid option) is not, and stays a throw.
      if ((err as NodeJS.ErrnoException).syscall !== "spawn") throw err;
      reject(ccmemFailure(err as ExecFileException, { bin, what, maxBuffer, timeout, stderr: "" }));
      return;
    }
    child.stdin?.end();
  });

  const runExport = (bin: string, scope: CcmemScope, cwd: string): Promise<string> =>
    runCcmem(bin, ["export", "--json", "--scope", scope], cwd, `ccmem export --scope ${scope}`);

  /** One after the other, never together (spec §3.3): the first may migrate, and two would contend for ccmem's write lock. */
  const visible = async (scope: MemoryScope): Promise<MemoryRecord[]> => {
    const bin = usableBin();
    const global = parseCcmemExport(await runExport(bin, "global", scope.repoPath), "global");
    const project = parseCcmemExport(await runExport(bin, "project", scope.repoPath), "project");
    return [...global, ...project];
  };

  /**
   * Issue #418: one `list --json` per request. With a query ccmem ranks by its retrieval score, so the page is a slice
   * of the same order the agent sees; without one it is the pinned/updated order the panel always showed. An older
   * ccmem that does not know `--json` prints text (or exits 64), and the two-export path answers instead.
   */
  const readPage = async (scope: MemoryScope, searchOptions: MemorySearchOptions): Promise<MemoryPage> => {
    const bin = usableBin();
    const query = searchOptions.query.trim();
    const offset = searchOptions.offset ?? 0;
    const argv = ["list", ...(query === "" ? [] : [query]), "--json", "--limit", String(searchOptions.limit), "--offset", String(offset)];
    let listed: CcmemList;
    try {
      listed = parseCcmemList(await runCcmem(bin, argv, scope.repoPath, "ccmem list"));
    } catch (err) {
      if (isOlderCcmem(err)) return searchRecords(await visible(scope), searchOptions);
      throw err;
    }

    const rows = query === "" ? listed.rows : [...listed.rows].sort(compareScored);
    const records = rows.map((row) => row.record);
    return {
      records,
      total: listed.total,
      truncated: listed.total > records.length,
      offset,
      hasMore: offset + records.length < listed.total,
    };
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
    search: (scope, searchOptions) => readPage(scope, searchOptions),
    get: async (scope, ref) => {
      const bin = usableBin();
      try {
        return parseCcmemShow(await runCcmem(bin, ["show", ref, "--json"], scope.repoPath, "ccmem show"));
      } catch (err) {
        // ccmem's text mode exits 2 for a missing id; the JSON mode answers `memory: null` instead.
        if (err instanceof MemoryError && err.code === "ccmem-failed:2") return null;
        if (isOlderCcmem(err)) return (await visible(scope)).find((record) => record.ref === ref) ?? null;
        throw err;
      }
    },
  };
}

/** Score first, then the fixed key the panel uses for everything else (see search.ts `compareRecords`). */
function compareScored(a: CcmemScoredRecord, b: CcmemScoredRecord): number {
  const fused = (b.score?.fused ?? 0) - (a.score?.fused ?? 0);
  if (fused !== 0) return fused;
  if (a.record.pinned !== b.record.pinned) return a.record.pinned ? -1 : 1;
  if (a.record.updatedAt !== b.record.updatedAt) return a.record.updatedAt < b.record.updatedAt ? 1 : -1;
  return Number(b.record.ref) - Number(a.record.ref);
}

/**
 * An older ccmem has no `--json` for list/show: it either exits 64 (a usage error) or ignores the flag and prints its
 * text form, which the strict JSON parser refuses. Both mean "fall back to exports", and the export parser still
 * validates whatever the fallback returns.
 */
function isOlderCcmem(err: unknown): boolean {
  return err instanceof MemoryError && (err.code === "ccmem-failed:64" || err.code === "ccmem-output-invalid");
}

/** Same shape as src/control/ccloopPort.ts's mapping. A maxBuffer overrun is recognised by its code (Node does not set `killed` for it, v22.13.1); testing it before `killed` only keeps the mapping explicit. */
function ccmemFailure(error: ExecFileException, ctx: FailureContext): MemoryError {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "EACCES") return new MemoryError("ccmem-missing", `${ctx.bin}: ${code} (${ctx.what})`);
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new MemoryError("ccmem-output-too-large", `${ctx.what} wrote more than ${ctx.maxBuffer} bytes`);
  if (error.killed === true) return new MemoryError("ccmem-timeout", `${ctx.what} did not finish within ${ctx.timeout} ms`);
  // A string errno other than the ones above (ENOTDIR, ENOEXEC, EMFILE...) is named, not collapsed to "unknown".
  const status = typeof code === "number" ? String(code) : typeof code === "string" ? errnoName(code, error.errno) : (error.signal ?? "unknown");
  const detail = ctx.stderr === "" ? error.message : ctx.stderr.slice(0, STDERR_EXCERPT_BYTES);
  return new MemoryError(`ccmem-failed:${status}`, `${ctx.what} exited ${status}: ${detail}`);
}

/**
 * libuv has no name for some errnos and Node then sets `code` to its message, "Unknown system error -8" for ENOEXEC
 * (v22.13.1, macOS), which would put spaces in a wire code. The number is still there, so name it from os.constants.
 */
function errnoName(code: string, errno: number | undefined): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  const name = errno === undefined ? undefined : Object.entries(osConstants.errno).find(([, value]) => value === Math.abs(errno))?.[0];
  return name ?? "unknown";
}