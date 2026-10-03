import { type ExecFileException, execFile } from "node:child_process";
import { constants as osConstants } from "node:os";
import { isAbsolute } from "node:path";
import { z } from "zod";

/**
 * Syncskill integration spec §4.5 and §10. The only code in Orca that starts syncskill. Two calls: a read-only profile
 * lookup (`profile ls --no-refresh`, because without the flag syncskill runs its manifest auto-refresh and writes under
 * its sync dir, §10.3) and the per-run injection. Nothing runs unless the caller hands in an absolute ORCA_SYNCSKILL_BIN.
 */
export const SYNCSKILL_TIMEOUT_MS = 30_000;
export const SYNCSKILL_MAX_BUFFER = 16 * 1024 * 1024;
const STDERR_EXCERPT_BYTES = 2048;

export interface SyncskillOptions {
  /** Absolute path from ORCA_SYNCSKILL_BIN; null when unset. */
  bin: string | null;
  /** Passed to syncskill as is (SYNCSKILL_DIR, HOME, PATH). */
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export interface LockSkill {
  name: string;
  source: { name: string; type: string; url: string; branch?: string } | null;
  resolved_commit: string | null;
  content_md5: string;
}

export class SyncskillError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SyncskillError";
  }
}

export const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Spec §10.4: syncskill's own isSafeSkillName (src/inject.ts) plus no `,` and no edge whitespace. The extra two matter
 * because `inject --skills` splits on `,` and trims, so a name that passed here could inject a different skill.
 */
export function isSafeSkillName(name: string): boolean {
  if (name === "" || name.startsWith(".") || /[/\\\0,]/.test(name)) return false;
  return name === name.trim();
}

const lockSkillSchema = z.object({
  name: z.string(),
  source: z.object({ name: z.string(), type: z.string(), url: z.string(), branch: z.string().optional() }).strict().nullable(),
  resolved_commit: z.string().nullable(),
  content_md5: z.string(),
}).strict();
const profileSummarySchema = z.object({ profiles: z.record(z.array(z.string())) });
const injectSummarySchema = z.object({ skills: z.array(lockSkillSchema) });

export async function profileMembers(o: SyncskillOptions, profile: string): Promise<string[]> {
  if (!PROFILE_NAME_PATTERN.test(profile)) throw new SyncskillError("skills-shape", `profile name ${JSON.stringify(profile)} does not match ${PROFILE_NAME_PATTERN}`);
  const summary = await run(o, ["--json", "--no-refresh", "profile", "ls", profile], `syncskill profile ls ${profile}`);
  const parsed = profileSummarySchema.safeParse(summary);
  const members = parsed.success ? parsed.data.profiles[profile] : undefined;
  if (members === undefined) throw new SyncskillError("syncskill-output-invalid", `syncskill profile ls ${profile}: the result has no members for the profile`);
  const normalised = [...new Set(members)].sort();
  if (normalised.length === 0) throw new SyncskillError("skills-profile-empty", `profile ${profile} has no skills`);
  const bad = normalised.find((name) => !isSafeSkillName(name));
  if (bad !== undefined) throw new SyncskillError("skills-shape", `profile ${profile} holds a skill name that breaks the name rule: ${JSON.stringify(bad)}`);
  return normalised;
}

export async function injectSkills(o: SyncskillOptions, names: readonly string[], target: string): Promise<LockSkill[]> {
  if (names.length === 0) throw new SyncskillError("skills-shape", "no skill names to inject");
  const bad = names.find((name) => !isSafeSkillName(name));
  if (bad !== undefined) throw new SyncskillError("skills-shape", `skill name breaks the name rule: ${JSON.stringify(bad)}`);
  const summary = await run(o, ["--json", "inject", "--skills", names.join(","), "--target", target], "syncskill inject");
  const parsed = injectSummarySchema.safeParse(summary);
  if (!parsed.success) throw new SyncskillError("syncskill-output-invalid", `syncskill inject: the result does not match the lock entry shape: ${parsed.error.message.slice(0, STDERR_EXCERPT_BYTES)}`);
  return parsed.data.skills;
}

/** Runs syncskill and returns the `summary` of its `result` event. */
async function run(o: SyncskillOptions, args: string[], what: string): Promise<unknown> {
  const bin = o.bin;
  if (bin === null) throw new SyncskillError("syncskill-unconfigured", "ORCA_SYNCSKILL_BIN is not set; Orca never starts syncskill without it");
  // Same reasoning as ccmem (spec §10 D5): a relative path would be resolved against the cwd, which could plant its own syncskill.
  if (!isAbsolute(bin)) throw new SyncskillError("syncskill-missing", `ORCA_SYNCSKILL_BIN must be an absolute path, got ${JSON.stringify(bin)}`);
  const timeout = o.timeoutMs ?? SYNCSKILL_TIMEOUT_MS;
  const maxBuffer = o.maxBufferBytes ?? SYNCSKILL_MAX_BUFFER;
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let child: ReturnType<typeof execFile>;
    try {
      child = execFile(bin, args, { env: o.env, encoding: "utf8", timeout, maxBuffer }, (error, out, err) => {
        if (error === null) resolve({ stdout: out, stderr: err });
        else reject(failure(error, { bin, what, maxBuffer, timeout, stdout: String(out), stderr: String(err) }));
      });
    } catch (err) {
      // Node throws, instead of calling back, for most spawn errnos (ENOTDIR, ENOEXEC, EPERM; v22.13.1). Those are
      // syncskill failing to start; anything else (an invalid option) is not, and stays a throw.
      if ((err as NodeJS.ErrnoException).syscall !== "spawn") throw err;
      reject(failure(err as ExecFileException, { bin, what, maxBuffer, timeout, stdout: "", stderr: "" }));
      return;
    }
    child.stdin?.end();
  });
  const results = events(stdout, stderr).filter((event) => event.type === "result");
  const result = results[results.length - 1];
  if (result === undefined || !("summary" in result)) throw new SyncskillError("syncskill-output-invalid", `${what}: no result event in the output`);
  return result.summary;
}

/** Events may arrive on either stream (spec §4.5 task note); a line that is not a JSON object is not an event. */
function events(stdout: string, stderr: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) out.push(value as Record<string, unknown>);
    } catch { /* not an event */ }
  }
  return out;
}

function failure(error: ExecFileException, ctx: { bin: string; what: string; maxBuffer: number; timeout: number; stdout: string; stderr: string }): SyncskillError {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "EACCES") return new SyncskillError("syncskill-missing", `${ctx.bin}: ${code} (${ctx.what})`);
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new SyncskillError("syncskill-output-too-large", `${ctx.what} wrote more than ${ctx.maxBuffer} bytes`);
  if (error.killed === true) return new SyncskillError("syncskill-timeout", `${ctx.what} did not finish within ${ctx.timeout} ms`);
  const named = events(ctx.stdout, ctx.stderr).find((event) => event.type === "error" && typeof event.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(event.code));
  const status = typeof code === "number" ? String(code) : typeof code === "string" ? errnoName(code, error.errno) : (error.signal ?? "unknown");
  const detail = ctx.stderr === "" ? error.message : ctx.stderr.slice(0, STDERR_EXCERPT_BYTES);
  if (named !== undefined) return new SyncskillError(`syncskill-failed:${named.code as string}`, `${ctx.what} exited ${status}: ${String(named.message ?? detail)}`);
  return new SyncskillError(`syncskill-failed:${status}`, `${ctx.what} exited ${status}: ${detail}`);
}

/** libuv has no name for some errnos (ENOEXEC on macOS): name them from os.constants rather than put spaces in a code. */
function errnoName(code: string, errno: number | undefined): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  const name = errno === undefined ? undefined : Object.entries(osConstants.errno).find(([, value]) => value === Math.abs(errno))?.[0];
  return name ?? "unknown";
}
