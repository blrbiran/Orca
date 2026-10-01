import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { privateDirectory } from "./paths.js";
import { QUIET_GIT } from "./workspace.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

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
interface TreeEntry { path: string; size: number }

const run = async (repo: string, args: string[]): Promise<string> =>
  (await execFileAsync("git", [...QUIET_GIT, ...args], { cwd: repo, maxBuffer: MAX_BUFFER })).stdout;

/** The text after the last dot of the file name, as git's `*.<ext>` glob sees it; null without a dot. */
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

/** `git ls-tree -r -l -z`: every blob of the commit, with its size; never the working tree or the index. */
async function treeOf(repo: string, commit: string): Promise<TreeEntry[]> {
  const out = await run(repo, ["ls-tree", "-r", "-l", "-z", commit]);
  return out.split("\0").filter((line) => line.length > 0).flatMap((line) => {
    const tab = line.indexOf("\t");
    const [, type, , size] = line.slice(0, tab).split(/\s+/);
    return type === "blob" ? [{ path: line.slice(tab + 1), size: Number(size) }] : [];
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

async function docsPart(repo: string, commit: string, paths: string[], limits: OverviewLimits): Promise<RepositoryOverview["docs"]> {
  const entries: RepositoryOverview["docs"]["entries"] = [], skipped: RepositoryOverview["docs"]["skipped"] = [];
  let total = 0;
  for (const path of paths.filter((p) => !p.includes("/") && ROOT_DOCUMENT.test(p))) {
    const { stdout } = await execFileAsync("git", [...QUIET_GIT, "show", `${commit}:${path}`], { cwd: repo, encoding: "buffer", maxBuffer: MAX_BUFFER });
    if (stdout.includes(0)) { skipped.push({ path, reason: "binary" }); continue; }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(stdout); } catch { skipped.push({ path, reason: "non-utf8" }); continue; }
    const cut = Buffer.byteLength(text, "utf8") > limits.maxDocBytes;
    if (cut) text = truncateUtf8(text, limits.maxDocBytes);
    const size = Buffer.byteLength(text, "utf8");
    if (total + size > limits.maxDocsBytes) { skipped.push({ path, reason: "over-budget" }); continue; }
    total += size; entries.push({ path, text, cut });
  }
  return { status: "ok", entries, skipped };
}

/** PR-I6: `git archive` writes into a file Orca opened 0600 itself, so the archive never takes the umask's mode. */
async function archiveInto(repo: string, tar: string, args: string[]): Promise<void> {
  const handle = await open(tar, "wx", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", [...QUIET_GIT, "archive", "--format=tar", ...args], { cwd: repo, stdio: ["ignore", handle.fd, "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git archive exit ${String(code)}: ${stderr.trim()}`))));
    });
  } finally { await handle.close(); }
}

async function structurePart(input: { repo: string; commit: string; tree: TreeEntry[]; root: string; runId: string; bin: string | null; limits: OverviewLimits }): Promise<RepositoryOverview["structure"]> {
  const none = (status: StructureStatus, detail: string | null): RepositoryOverview["structure"] => ({ status, detail, files: [], cut: false });
  if (input.bin === null) return none("unavailable", "ast-grep-not-installed");
  const outlined = new Set<string>(OUTLINE_EXTENSIONS);
  const wanted = input.tree.filter((entry) => outlined.has(extensionOf(entry.path) ?? ""));
  if (wanted.reduce((sum, entry) => sum + entry.size, 0) > input.limits.maxExportBytes) return none("skipped-too-large", null);
  if (wanted.length === 0) return none("ok", null);
  const work = privateDirectory(join(input.root, `tmp-${input.runId}`));
  try {
    // PR-I3: ast-grep discovers sgconfig.yml in its working directory and every ancestor, so Orca's own lives in a
    // sibling of the exported tree, never on that path; `-c` names it explicitly.
    const config = join(privateDirectory(join(work, "config")), "sgconfig.yml");
    const tar = join(work, "export.tar"), exported = privateDirectory(join(work, "tree"));
    await writeFile(config, OWN_SGCONFIG, { mode: 0o600, flag: "wx" });
    const extensions = [...new Set(wanted.map((entry) => extensionOf(entry.path)!))].sort();
    // Spec §6: git archive into a private directory; no worktree is registered and nothing is written in .git.
    await archiveInto(input.repo, tar, [input.commit, "--", ...extensions.map((ext) => `:(glob)**/*.${ext}`)]);
    // PR-I6: extraction creates files and directories, so it runs under umask 077 (0600 / 0700).
    await execFileAsync("/bin/sh", ["-c", 'umask 077 && exec tar -xf "$1" -C "$2"', "sh", tar, exported]);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(input.bin, ["-c", config, "outline", "--json=stream", "--items", "exports", "-j", "1", "."],
        { cwd: exported, timeout: input.limits.structureTimeoutMs, killSignal: "SIGKILL", maxBuffer: MAX_BUFFER }));
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

/** N1 spec §6: the canonical overview of HEAD's commit, cached per (repository, commit) under the state directory. */
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
  if (cached !== null) return finish(cached);
  const tree = await treeOf(input.repo, commit);
  const paths = tree.map((entry) => entry.path);
  const built = finish({
    schema: "orca-repository-overview-v1", commit,
    files: filesPart(paths, limits),
    docs: await docsPart(input.repo, commit, paths, limits),
    structure: await structurePart({ repo: input.repo, commit, tree, root, runId: input.runId, bin: input.astGrepBin, limits }),
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
