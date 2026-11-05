import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Session 3cfc2e73 D7 (tester issue #158, Orca half): when an omp execute answer fails ccloop's strict shape, the run fails
 * and the attempt's work survives only as the commit ccloop's cleanup pins under refs/ccloop/.../attempts/<n>. ccloop
 * (from 963b856) names those refs in `<runDir>/execute-format-failure.json`. This reads that file and, read-only, what
 * each ref changed against the attempt's base, so a person can recover the work by hand. Diagnosis only: nothing is
 * recovered. An absent file (an older ccloop pin) or a malformed one is no diagnosis, never an error.
 */
export interface FormatFailureWork {
  attempt: number;
  attemptBase: string | null;
  refs: Array<{ ref: string; commit: string | null; files: string[]; filesMore: boolean; stat: string[] }>;
  issues: Array<{ path: string; message: string }>;
}

export const FORMAT_FAILURE_FILE = "execute-format-failure.json";
const FILE_MAX_BYTES = 64 * 1024;
const REFS_MAX = 4, FILES_MAX = 50, STAT_LINES_MAX = 60, ISSUES_MAX = 5, TEXT_MAX = 200, GIT_MAX_BYTES = 256 * 1024;

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
// A ref is passed to git as one argument: only ccloop's own namespace, no option-looking or `..` text.
const attemptRef = z.string().max(400).regex(/^refs\/ccloop\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/).refine((ref) => !ref.includes(".."));
const fileSchema = z.object({
  schema: z.literal("ccloop-omp-execute-format-failure-v1"),
  attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  attemptRefs: z.array(attemptRef).max(16),
  attemptBase: sha.nullable(),
  normalization: z.object({ issues: z.array(z.object({ path: z.string(), message: z.string() }).passthrough()).optional() }).passthrough().optional(),
}).passthrough();

const clip = (text: string): string => (text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX - 1)}…`);

function readBounded(path: string): { text: string; stamp: string } | null {
  let fd: number;
  try { fd = openSync(path, "r"); } catch { return null; }
  try {
    const stat = fstatSync(fd);
    if (stat.size > FILE_MAX_BYTES) return null;
    const buffer = Buffer.alloc(FILE_MAX_BYTES);
    const read = readSync(fd, buffer, 0, FILE_MAX_BYTES, 0);
    return { text: buffer.subarray(0, read).toString("utf8"), stamp: `${stat.mtimeMs}:${stat.size}` };
  } catch { return null; } finally { closeSync(fd); }
}

// The group view is polled: a finished answer (every ref resolved) is kept per file version, so git runs once for it. A
// ref not there yet (ccloop names it before cleanup publishes the commit) is asked again next time.
const settled = new Map<string, FormatFailureWork>();

/** Read-only git in the target repository; null on any failure (no repo, unknown ref, timeout). */
function git(repo: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, "--no-pager", ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000, maxBuffer: GIT_MAX_BYTES,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
  } catch { return null; }
}

function refWork(repo: string | null, ref: string, base: string | null): FormatFailureWork["refs"][number] {
  const commit = repo === null ? null : git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])?.trim() ?? null;
  if (repo === null || commit === null || !sha.safeParse(commit).success || base === null) return { ref, commit: commit !== null && sha.safeParse(commit).success ? commit : null, files: [], filesMore: false, stat: [] };
  const names = (git(repo, ["diff", "--no-ext-diff", "--no-color", "--name-only", base, commit]) ?? "").split("\n").filter((line) => line.length > 0);
  const stat = (git(repo, ["diff", "--no-ext-diff", "--no-color", "--stat=120", base, commit]) ?? "").split("\n").filter((line) => line.length > 0);
  return { ref, commit, files: names.slice(0, FILES_MAX).map(clip), filesMore: names.length > FILES_MAX, stat: (stat.length > STAT_LINES_MAX ? [...stat.slice(0, STAT_LINES_MAX - 1), stat.at(-1)!] : stat).map(clip) };
}

/** `runDir` is ccloop's run directory (`<drive sourceDir>/run`); `repo` the run's target repository, where the refs live. */
export function readFormatFailureWork(runDir: string, repo: string | null): FormatFailureWork | null {
  const read = readBounded(join(runDir, FORMAT_FAILURE_FILE));
  if (read === null) return null;
  const key = `${runDir}\0${repo ?? ""}\0${read.stamp}`;
  const known = settled.get(key);
  if (known !== undefined) return known;
  let parsed: z.infer<typeof fileSchema>;
  try {
    const result = fileSchema.safeParse(JSON.parse(read.text));
    if (!result.success) return null;
    parsed = result.data;
  } catch { return null; }
  const work: FormatFailureWork = {
    attempt: parsed.attempt,
    attemptBase: parsed.attemptBase,
    refs: parsed.attemptRefs.slice(0, REFS_MAX).map((ref) => refWork(repo, ref, parsed.attemptBase)),
    issues: (parsed.normalization?.issues ?? []).slice(0, ISSUES_MAX).map((issue) => ({ path: clip(issue.path), message: clip(issue.message) })),
  };
  if (work.refs.every((ref) => ref.commit !== null)) {
    if (settled.size >= 200) settled.clear();
    settled.set(key, work);
  }
  return work;
}
