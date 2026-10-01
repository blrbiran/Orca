import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { privateDirectory } from "./paths.js";
import { QUIET_GIT, unsetInheritedGitEnv } from "./workspace.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;
/** Every git child that reads the commit (rev-parse, ls-tree, the documents' cat-file) is killed after this long. */
const GIT_READ_TIMEOUT_MS = 30_000;

export interface OverviewLimits {
  maxPaths: number; maxListBytes: number; maxDocBytes: number; maxDocsBytes: number;
  maxExportBytes: number; maxStructureBytes: number; structureTimeoutMs: number;
}
/** N1 spec §6: the caps, verbatim. Criteria may lower them; production never passes any. */
export const OVERVIEW_LIMITS: Readonly<OverviewLimits> = Object.freeze({
  maxPaths: 4_000, maxListBytes: 120 * 1024, maxDocBytes: 16 * 1024, maxDocsBytes: 48 * 1024,
  maxExportBytes: 50 * 1024 * 1024, maxStructureBytes: 120 * 1024, structureTimeoutMs: 30_000,
});
/** DR22: the files whose exported symbols ast-grep's built-in outline rules list. */
export const OUTLINE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "swift", "rb", "php", "cs", "c", "h", "cc", "cpp", "hpp", "scala", "lua"] as const;
const ROOT_DOCUMENT = /^(README[^/]*|CLAUDE\.md|AGENTS\.md|CONTRIBUTING\.md)$/;
/** Orca's own ast-grep project config (Task 0a measured that this content is accepted); the target's is never read. */
const OWN_SGCONFIG = "ruleDirs: []\n";

export type StructureStatus = "ok" | "unavailable" | "skipped-too-large" | "timeout" | "failed";
export interface RepositoryOverview {
  schema: "orca-repository-overview-v1";
  commit: string;
  files: { status: "ok"; total: number; listed: string[]; cut: boolean; directories: Array<{ directory: string; files: number }> | null };
  docs: { status: "ok"; entries: Array<{ path: string; text: string; cut: boolean }>; skipped: Array<{ path: string; reason: "binary" | "non-utf8" | "over-budget" }> };
  structure: { status: StructureStatus; detail: string | null; files: Array<{ path: string; symbols: Array<{ name: string; kind: string }> }>; cut: boolean };
}
interface TreeEntry { path: string; mode: string; oid: string; size: number }

const run = async (repo: string, args: string[]): Promise<string> =>
  (await execFileAsync("git", [...QUIET_GIT, ...args], { cwd: repo, env: { ...process.env, ...unsetInheritedGitEnv() }, maxBuffer: MAX_BUFFER, timeout: GIT_READ_TIMEOUT_MS, killSignal: "SIGKILL" })).stdout;

class ChildTimeout extends Error {}

/**
 * The raw bytes of each blob, in order, through ONE `git cat-file --batch`: no filter, attribute or textconv is ever
 * applied, so nothing the target configures (smudge drivers, git-lfs) runs. At most `keep` bytes of each blob are held;
 * the rest is read and dropped. The child is killed after `timeoutMs` (ChildTimeout).
 */
function readBlobs(repo: string, oids: string[], keep: number, timeoutMs: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...QUIET_GIT, "cat-file", "--batch"], { cwd: repo, env: { ...process.env, ...unsetInheritedGitEnv() }, stdio: ["pipe", "pipe", "pipe"] });
    const blobs: Buffer[] = [];
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); } else resolve(blobs);
    };
    const timer = setTimeout(() => settle(new ChildTimeout(`git cat-file exceeded ${timeoutMs} ms`)), timeoutMs);
    let header = Buffer.alloc(0), remaining = -1, parts: Buffer[] = [], held = 0, stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      let at = 0;
      while (at < chunk.length && !settled) {
        if (remaining < 0) {
          const newline = chunk.indexOf(10, at);
          header = Buffer.concat([header, chunk.subarray(at, newline === -1 ? chunk.length : newline)]);
          if (newline === -1) return;
          at = newline + 1;
          const [, type, size] = header.toString("utf8").split(" ");
          if (type !== "blob" || size === undefined) { settle(new Error(`git cat-file: ${header.toString("utf8")}`)); return; }
          header = Buffer.alloc(0); remaining = Number(size) + 1; parts = []; held = 0;
        }
        const take = Math.min(remaining, chunk.length - at);
        const content = chunk.subarray(at, at + Math.min(take, Math.max(0, remaining - 1)));
        if (held < keep) { const part = content.subarray(0, keep - held); parts.push(Buffer.from(part)); held += part.length; }
        at += take; remaining -= take;
        if (remaining === 0) { blobs.push(Buffer.concat(parts)); remaining = -1; }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => settle(error));
    child.on("close", (code) => settle(code === 0 && blobs.length === oids.length ? null : new Error(`git cat-file exit ${String(code)}: ${stderr.trim()}`)));
    child.stdin.end(oids.map((oid) => `${oid}\n`).join(""));
  });
}

/** The text after the last dot of the file name; null without a dot. */
function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : name.slice(dot + 1);
}

/** Spec §6: `ORCA_AST_GREP_BIN`, else the pinned npm dependency's binary (Task 0a: `@ast-grep/cli/ast-grep`), else none. */
export function resolveAstGrepBin(env: NodeJS.ProcessEnv): string | null {
  if (env.ORCA_AST_GREP_BIN) return env.ORCA_AST_GREP_BIN;
  try {
    const bin = join(dirname(createRequire(import.meta.url).resolve("@ast-grep/cli/package.json")), "ast-grep");
    return existsSync(bin) ? bin : null;
  } catch { return null; }
}

/** `git ls-tree -r -l -z`: every blob of the commit, with its mode, id and size; never the working tree or the index. */
async function treeOf(repo: string, commit: string): Promise<TreeEntry[]> {
  const out = await run(repo, ["ls-tree", "-r", "-l", "-z", commit]);
  return out.split("\0").filter((line) => line.length > 0).flatMap((line) => {
    const tab = line.indexOf("\t");
    const [mode, type, oid, size] = line.slice(0, tab).split(/\s+/);
    return type === "blob" ? [{ path: line.slice(tab + 1), mode: mode!, oid: oid!, size: Number(size) }] : [];
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function filesPart(paths: string[], limits: OverviewLimits): RepositoryOverview["files"] {
  const listed: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path, "utf8") + 1;
    if (listed.length >= limits.maxPaths || bytes + size > limits.maxListBytes) break;
    listed.push(path); bytes += size;
  }
  const cut = listed.length < paths.length;
  if (!cut) return { status: "ok", total: paths.length, listed, cut, directories: null };
  const counts = new Map<string, number>();
  for (const path of paths) { const top = path.includes("/") ? path.slice(0, path.indexOf("/")) : "."; counts.set(top, (counts.get(top) ?? 0) + 1); }
  const directories = [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([directory, files]) => ({ directory, files }));
  return { status: "ok", total: paths.length, listed, cut, directories };
}

function truncateUtf8(text: string, maxBytes: number): string {
  let out = "", bytes = 0;
  for (const char of text) { const size = Buffer.byteLength(char, "utf8"); if (bytes + size > maxBytes) break; out += char; bytes += size; }
  return out;
}

/** A prefix cut inside a UTF-8 sequence loses that incomplete trailing sequence, so the rest decodes strictly. */
function withoutIncompleteTail(bytes: Buffer): Buffer {
  for (let back = 1; back <= Math.min(4, bytes.length); back += 1) {
    const byte = bytes[bytes.length - back]!;
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return length > back ? bytes.subarray(0, bytes.length - back) : bytes;
  }
  return bytes;
}

async function docsPart(repo: string, tree: TreeEntry[], limits: OverviewLimits): Promise<RepositoryOverview["docs"]> {
  const entries: RepositoryOverview["docs"]["entries"] = [], skipped: RepositoryOverview["docs"]["skipped"] = [];
  const documents = tree.filter((entry) => !entry.path.includes("/") && ROOT_DOCUMENT.test(entry.path));
  // Review fix 3: the tree's sizes say which documents are cut; no more than the cap (+3 bytes, to finish a character
  // straddling it) of any document is held in memory.
  const contents = documents.length === 0 ? [] : await readBlobs(repo, documents.map((entry) => entry.oid), limits.maxDocBytes + 3, GIT_READ_TIMEOUT_MS);
  let total = 0;
  documents.forEach((entry, index) => {
    const { path } = entry;
    const cut = entry.size > limits.maxDocBytes;
    const bytes = cut ? withoutIncompleteTail(contents[index]!) : contents[index]!;
    if (bytes.includes(0)) { skipped.push({ path, reason: "binary" }); return; }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { skipped.push({ path, reason: "non-utf8" }); return; }
    if (cut) text = truncateUtf8(text, limits.maxDocBytes);
    const size = Buffer.byteLength(text, "utf8");
    if (total + size > limits.maxDocsBytes) { skipped.push({ path, reason: "over-budget" }); return; }
    total += size; entries.push({ path, text, cut });
  });
  return { status: "ok", entries, skipped };
}

/**
 * Final review finding 2: a tree path is data, and git stores (and a clone brings in) entries named `..`, so `ls-tree -r`
 * can print `../../x.js`. A path is written into the export only when none of its components is empty, `.` or `..`
 * and it resolves to a place under the export root.
 */
function insideExport(exported: string, path: string): boolean {
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  const rel = relative(exported, resolve(exported, path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The supported regular files (symlinks and submodules are not exported) whose outline the structure part lists. */
function outlineInput(tree: TreeEntry[]): TreeEntry[] {
  const outlined = new Set<string>(OUTLINE_EXTENSIONS);
  return tree.filter((entry) => (entry.mode === "100644" || entry.mode === "100755") && outlined.has(extensionOf(entry.path) ?? ""));
}

async function structurePart(input: { repo: string; tree: TreeEntry[]; root: string; runId: string; bin: string | null; limits: OverviewLimits }): Promise<RepositoryOverview["structure"]> {
  const none = (status: StructureStatus, detail: string | null): RepositoryOverview["structure"] => ({ status, detail, files: [], cut: false });
  if (input.bin === null) return none("unavailable", "ast-grep-not-installed");
  const wanted = outlineInput(input.tree);
  if (wanted.reduce((sum, entry) => sum + entry.size, 0) > input.limits.maxExportBytes) return none("skipped-too-large", null);
  if (wanted.length === 0) return none("ok", null);
  // Spec §6: one 30 s budget covers the export and the ast-grep run.
  const deadline = Date.now() + input.limits.structureTimeoutMs;
  const work = privateDirectory(join(input.root, `tmp-${input.runId}`));
  try {
    // PR-I3: ast-grep discovers sgconfig.yml in its working directory and every ancestor, so Orca's own lives in a
    // sibling of the exported tree, never on that path; `-c` names it explicitly.
    const config = join(privateDirectory(join(work, "config")), "sgconfig.yml");
    const exported = privateDirectory(join(work, "tree"));
    await writeFile(config, OWN_SGCONFIG, { mode: 0o600, flag: "wx" });
    // Review fix 1: the blobs' raw bytes (never `git archive`, which runs the target's smudge filters), each written
    // 0600 in 0700 directories (PR-I6); no worktree is registered and nothing is written in .git.
    let blobs: Buffer[];
    try { blobs = await readBlobs(input.repo, wanted.map((entry) => entry.oid), Number.POSITIVE_INFINITY, input.limits.structureTimeoutMs); }
    catch (error) { if (error instanceof ChildTimeout) return none("timeout", null); throw error; }
    // A tree with any path that is not safely inside the export is not exported at all: structure `failed`, named.
    const unsafe = wanted.find((entry) => !insideExport(exported, entry.path));
    if (unsafe !== undefined) return none("failed", `unsafe-path:${JSON.stringify(unsafe.path).slice(0, 180)}`);
    const made = new Set<string>();
    wanted.forEach((entry, index) => {
      const parent = dirname(join(exported, entry.path));
      if (!made.has(parent)) { privateDirectory(parent); made.add(parent); }
      writeFileSync(join(exported, entry.path), blobs[index]!, { mode: 0o600, flag: "wx" });
    });
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(input.bin, ["-c", config, "outline", "--json=stream", "--items", "exports", "-j", "1", "."],
        { cwd: exported, timeout: Math.max(1, deadline - Date.now()), killSignal: "SIGKILL", maxBuffer: MAX_BUFFER }));
    } catch (error) {
      const failure = error as { killed?: boolean; signal?: string | null; code?: unknown };
      if (failure.killed || failure.signal === "SIGKILL") return none("timeout", null);
      return none("failed", `exit:${String(failure.code ?? "unknown")}`);
    }
    const files: RepositoryOverview["structure"]["files"] = [];
    for (const line of stdout.split("\n").filter((l) => l.trim().length > 0)) {
      const parsed = JSON.parse(line) as { path: string; items: Array<{ name: string; symbolType: string; isExported?: boolean }> };
      const symbols = parsed.items.filter((item) => item.isExported !== false).map((item) => ({ name: item.name, kind: item.symbolType }));
      files.push({ path: parsed.path.replace(/^\.\//, ""), symbols });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const kept: typeof files = [];
    let bytes = 2;
    for (const file of files) { const size = canonicalBytes(file).length + 1; if (bytes + size > input.limits.maxStructureBytes) break; kept.push(file); bytes += size; }
    return { status: "ok", detail: null, files: kept, cut: kept.length < files.length };
  } catch (error) {
    return none("failed", error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : String(error));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The cached overview when the entry is whole and canonical for this commit; null otherwise (rebuilt and overwritten). */
async function cachedOverview(cacheFile: string, commit: string): Promise<RepositoryOverview | null> {
  if (!existsSync(cacheFile)) return null;
  try {
    const text = await readFile(cacheFile, "utf8");
    const overview = JSON.parse(text) as RepositoryOverview;
    return overview.commit === commit && canonicalBytes(overview).toString("utf8") === text ? overview : null;
  } catch { return null; }
}

/**
 * N1 spec §6: the canonical overview of HEAD's commit, cached per (repository, commit) under the state directory.
 * Only an `ok` structure is reused; any other status is built again on the next call, over the cached files and docs.
 */
export async function buildRepositoryOverview(input: {
  repo: string; repoId: string; stateDir: string; runId: string; astGrepBin: string | null; limits?: Partial<OverviewLimits>;
}): Promise<{ overview: RepositoryOverview; canonicalJson: string; hash: string }> {
  const limits: OverviewLimits = { ...OVERVIEW_LIMITS, ...input.limits };
  const root = privateDirectory(`${input.stateDir}.overview`);
  // Spec §13: a crashed build's export directory is removed by the next build (the driver builds one overview at a time).
  for (const name of readdirSync(root)) if (name.startsWith("tmp-")) await rm(join(root, name), { recursive: true, force: true });
  const commit = (await run(input.repo, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const cacheFile = join(privateDirectory(join(root, input.repoId, commit)), "overview.json");
  const finish = (overview: RepositoryOverview) => ({ overview, canonicalJson: canonicalBytes(overview).toString("utf8"), hash: sha256Canonical(overview) });
  const cached = await cachedOverview(cacheFile, commit);
  if (cached !== null && cached.structure.status === "ok") return finish(cached);
  const tree = await treeOf(input.repo, commit);
  const built = finish({
    schema: "orca-repository-overview-v1", commit,
    files: cached?.files ?? filesPart(tree.map((entry) => entry.path), limits),
    docs: cached?.docs ?? await docsPart(input.repo, tree, limits),
    structure: await structurePart({ repo: input.repo, tree, root, runId: input.runId, bin: input.astGrepBin, limits }),
  });
  await writeFile(cacheFile, built.canonicalJson, { mode: 0o600 });
  return built;
}

/**
 * DR19 (spec §8.3.4): a target path exists in the commit, or lies under a directory that does. `**` always passes;
 * `<prefix>/**` needs `<prefix>` to be a directory; an exact path needs the file, or its parent directory (the root counts).
 */
export async function overviewPathExists(repo: string, commit: string, entry: string): Promise<boolean> {
  const typeOf = async (path: string): Promise<string | null> => {
    try { return (await run(repo, ["cat-file", "-t", `${commit}:${path}`])).trim(); } catch { return null; }
  };
  if (entry === "**") return true;
  if (entry.endsWith("/**")) return (await typeOf(entry.slice(0, -3))) === "tree";
  if ((await typeOf(entry)) === "blob") return true;
  const parent = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
  return parent === "" || (await typeOf(parent)) === "tree";
}
