import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import type { BuiltOverview } from "./requirementCalls.js";
import { GIT_READ_TIMEOUT_MS, readBlobs, treeOf, type TreeEntry } from "./requirementOverview.js";

/**
 * Task setup spec §4.1: what the split is told about how the repository builds -- for the root and every directory a
 * root `package.json` names in `workspaces`, that package's `name`, `scripts` and `workspaces` (nothing else), which
 * lockfile is there and which other build manifests are there. Entries are in directory order, the root (`""`) first.
 */
export type ManifestsPart = {
  status: "ok";
  entries: Array<{ dir: string; package: { name: string | null; scripts: Record<string, string>; workspaces: string[] | null } | null; lockfiles: string[]; present: string[] }>;
  cut: boolean;
};
type ManifestEntry = ManifestsPart["entries"][number];

const LOCKFILES: ReadonlySet<string> = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"]);
const OTHER_MANIFEST = /^(pyproject\.toml|requirements[^/]*\.txt|Makefile|Cargo\.toml|go\.mod)$/;
/** A package.json larger than this is not read whole, so it is listed as no package (it would not parse). */
const MAX_PACKAGE_BYTES = 1024 * 1024;

const dirOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const manifestPath = (dir: string): string => (dir === "" ? "package.json" : `${dir}/package.json`);

/** The three fields the split is sent; null when the blob is not a JSON object. Non-string scripts and workspaces are left out. */
function packageOf(bytes: Buffer): ManifestEntry["package"] {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return null; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { name, scripts, workspaces } = parsed as Record<string, unknown>;
  const scriptsOut: Record<string, string> = {};
  if (scripts !== null && typeof scripts === "object" && !Array.isArray(scripts)) {
    for (const [key, body] of Object.entries(scripts as Record<string, unknown>)) if (typeof body === "string") scriptsOut[key] = body;
  }
  return {
    name: typeof name === "string" ? name : null,
    scripts: scriptsOut,
    workspaces: Array.isArray(workspaces) ? workspaces.filter((entry): entry is string => typeof entry === "string") : null,
  };
}

/** One path segment against one pattern segment: `*` any run of characters, `?` one; nothing crosses a `/`. */
function segmentMatches(pattern: string, segment: string): boolean {
  const source = pattern.split("").map((char) => (char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${source}$`).test(segment);
}
/** A workspace pattern against a directory, segment by segment; a `**` segment matches any number of segments, none included. */
function globMatches(pattern: string[], dir: string[]): boolean {
  if (pattern.length === 0) return dir.length === 0;
  if (pattern[0] === "**") return globMatches(pattern.slice(1), dir) || (dir.length > 0 && globMatches(pattern, dir.slice(1)));
  return dir.length > 0 && segmentMatches(pattern[0]!, dir[0]!) && globMatches(pattern.slice(1), dir.slice(1));
}
const segmentsOf = (pattern: string): string[] => pattern.replace(/^(\.\/)+/, "").replace(/\/+$/, "").split("/").filter((segment) => segment.length > 0 && segment !== ".");

/**
 * Review Focus 2: the root's `workspaces` patterns expanded against the commit's tree (never the disk) -- each directory
 * other than the root that has a committed package.json and matches a pattern, less those a `!` pattern matches.
 */
function workspaceDirs(patterns: string[], tree: TreeEntry[]): string[] {
  const positive = patterns.filter((pattern) => !pattern.startsWith("!")).map(segmentsOf);
  const negative = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => segmentsOf(pattern.slice(1)));
  return tree.filter((entry) => nameOf(entry.path) === "package.json").map((entry) => dirOf(entry.path)).filter((dir) => {
    if (dir === "") return false;
    const segments = dir.split("/");
    return positive.some((pattern) => globMatches(pattern, segments)) && !negative.some((pattern) => globMatches(pattern, segments));
  });
}

/**
 * The manifests of `commit` (spec §4.1): read from its tree through `git cat-file --batch`, as the overview's documents
 * are. Bounded (controller's call): whole entries are kept in directory order while the part's canonical JSON fits in
 * `maxBytes`; `cut` says whether any was left out.
 */
export async function buildManifests(repo: string, commit: string, maxBytes = 32 * 1024): Promise<ManifestsPart> {
  const tree = await treeOf(repo, commit);
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const namesIn = new Map<string, string[]>();
  for (const entry of tree) {
    const dir = dirOf(entry.path);
    namesIn.set(dir, [...(namesIn.get(dir) ?? []), nameOf(entry.path)]);
  }
  const packagesOf = async (dirs: string[]): Promise<Map<string, ManifestEntry["package"]>> => {
    const found = dirs.filter((dir) => byPath.has(manifestPath(dir)));
    const blobs = found.length === 0 ? [] : await readBlobs(repo, found.map((dir) => byPath.get(manifestPath(dir))!.oid), MAX_PACKAGE_BYTES + 1, GIT_READ_TIMEOUT_MS);
    return new Map(found.map((dir, index) => [dir, blobs[index]!.length > MAX_PACKAGE_BYTES ? null : packageOf(blobs[index]!)]));
  };
  const rootPackage = (await packagesOf([""])).get("") ?? null;
  const dirs = workspaceDirs(rootPackage?.workspaces ?? [], tree).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const packages = await packagesOf(dirs);
  packages.set("", rootPackage);
  const entries: ManifestEntry[] = ["", ...dirs].map((dir) => {
    const names = [...(namesIn.get(dir) ?? [])].sort();
    return { dir, package: packages.get(dir) ?? null, lockfiles: names.filter((name) => LOCKFILES.has(name)), present: names.filter((name) => OTHER_MANIFEST.test(name)) };
  });
  const kept: ManifestEntry[] = [];
  let bytes = canonicalBytes({ status: "ok", entries: [], cut: false }).length;
  for (const entry of entries) {
    const size = canonicalBytes(entry).length + (kept.length === 0 ? 0 : 1);
    if (bytes + size > maxBytes) break;
    kept.push(entry); bytes += size;
  }
  return { status: "ok", entries: kept, cut: kept.length < entries.length };
}

/**
 * Spec §4.1: the split's view of the overview -- a single repository's overview with `manifests` added; the hash and bytes
 * are of what is sent (as `withoutStructure` does for clarify), so the stored record, the run's `overview.hash` and the
 * delimiter nonce all name it. A multi-directory project's overview is returned as it is (setup is refused there, §5.4).
 */
export function withManifests(built: BuiltOverview, manifests: ManifestsPart): BuiltOverview {
  if (built.kind !== "repository") return built;
  // Added to the bytes already being sent, not to `built.overview`, so it composes with another view (withoutStructure).
  const sent = { ...(JSON.parse(built.canonicalJson) as Record<string, unknown>), manifests };
  return { ...built, canonicalJson: canonicalBytes(sent).toString("utf8"), hash: sha256Canonical(sent) };
}
