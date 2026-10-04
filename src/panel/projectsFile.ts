/**
 * Project registry spec §2/§3 (session 3d68f934): the person's project list, `~/.orca/projects.json`.
 *
 * Strict on purpose: an unknown key is a typo the person would otherwise never learn about. The path is read from
 * the env this process was given (Rule 17); the default is computed per call, never frozen at import.
 */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

export const PROJECT_ID_PATTERN = /^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_])?$/;

export interface ProjectEntryV1 { id: string; name: string; path: string }
export interface ProjectsFileV1 { version: 1; controlStateDir?: string; projects: ProjectEntryV1[] }
export interface FileSignature { mtimeNs: bigint; size: bigint; ino: bigint; ctimeNs: bigint }
export type ProjectsFileRead =
  | { kind: "missing"; signature: null; hash: null }
  | { kind: "valid"; config: ProjectsFileV1; signature: FileSignature; hash: string }
  | { kind: "invalid"; reason: string; signature: FileSignature | null; hash: string | null };

export function projectsFilePath(env: NodeJS.ProcessEnv): string {
  const override = env.ORCA_PROJECTS_FILE;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca", "projects.json");
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/** Derived once, at add time; never recomputed (spec §2). */
export function deriveProjectId(name: string, path: string, taken: ReadonlySet<string>): string {
  let base = slug(name);
  if (base === "") base = slug(basename(path));
  if (base === "") base = "project";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

const absolute = z.string().min(1).refine((value) => isAbsolute(value), "must be an absolute path");
const projectSchema = z.object({
  id: z.string().regex(PROJECT_ID_PATTERN, "id must match [a-z0-9._-] and start and end with [a-z0-9_]"),
  name: z.string().refine((value) => value.trim().length > 0, "name must not be blank"),
  path: absolute,
}).strict();
const fileSchema = z.object({ version: z.literal(1), controlStateDir: absolute.optional(), projects: z.array(projectSchema) }).strict()
  .superRefine((value, ctx) => {
    for (const field of ["id", "name", "path"] as const) {
      const seen = new Set<string>();
      for (const project of value.projects) {
        if (seen.has(project[field])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${field} ${JSON.stringify(project[field])}` });
        seen.add(project[field]);
      }
    }
  });

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");

function signatureOf(file: string): FileSignature | null {
  try {
    const stat = statSync(file, { bigint: true });
    return { mtimeNs: stat.mtimeNs, size: stat.size, ino: stat.ino, ctimeNs: stat.ctimeNs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function sameSignature(a: FileSignature | null, b: FileSignature | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeNs === b.mtimeNs && a.size === b.size && a.ino === b.ino && a.ctimeNs === b.ctimeNs;
}

export function readProjectsFile(file: string): ProjectsFileRead {
  const signature = signatureOf(file);
  if (signature === null) return { kind: "missing", signature: null, hash: null };
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { return { kind: "invalid", reason: `cannot read: ${(error as Error).message}`, signature, hash: null }; }
  const hash = hashText(text);
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (error) { return { kind: "invalid", reason: `not JSON: ${(error as Error).message}`, signature, hash }; }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { kind: "invalid", reason: `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`, signature, hash };
  }
  return { kind: "valid", config: parsed.data as ProjectsFileV1, signature, hash };
}

/**
 * Atomic: a temp file beside the target, fsync'd, then renamed over it. A new file is 0600 in a 0700 directory;
 * an existing file keeps its mode (the temp file is created with it), an existing directory is not touched.
 */
export function writeProjectsFile(file: string, config: ProjectsFileV1): { signature: FileSignature; hash: string } {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let mode = 0o600;
  try { mode = statSync(file).mode & 0o777; } catch { /* new file */ }
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const temp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const fd = openSync(temp, "wx", mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
  closeSync(fd);
  try { renameSync(temp, file); }
  catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
  return { signature: signatureOf(file)!, hash: hashText(text) };
}
