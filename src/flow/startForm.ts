/**
 * Gaps spec §8.4, §14 (plan Task 10-B): the two reads the Web's flow start dialog needs -- the built-in templates with
 * their params (so the dialog offers a choice and one field per param, typed by the param), and the image files of the
 * chosen folder for an `image` param's picker.
 *
 * The folder is listed the way a start imports it (vault/snapshot.ts): by git itself, `ls-files -o --exclude-standard`
 * against a throw-away repository, with the vault's shared defaults and the template's own `workspace.excludes`, so the
 * picker never offers a file the run would not see. Only regular files (never a link) whose path a start accepts
 * (`imageValueProblem`, folder-relative) are listed, in path order, at most `FOLDER_IMAGE_LIMIT`; past that the answer
 * says it was cut. Nothing is written into the folder; the throw-away repository lives under the OS temp dir (as the
 * snapshot's scratch index does) and is removed before the answer.
 *
 * Bounded on work, not only on output (Task 10-B fix I1): git's listing is read as it streams and stopped once it names
 * more than `FOLDER_ENTRY_LIMIT` entries or runs longer than `FOLDER_LIST_MS` -- a pause after typing `/` must not walk
 * the disk. Such a folder is refused `flow-folder-too-large` (FolderTooLarge), never "not a folder". The stream is why
 * this does not use scheduler/gitExec.ts's `git` (which buffers the whole output and cannot stop early).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { lstat, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUIET_GIT, unsetInheritedGitEnv } from "../control/workspace.js";
import { git } from "../scheduler/gitExec.js";
import { imageValueProblem } from "./params.js";
import type { FlowParam } from "./template/schema.js";
import { BUILTIN_ROOT, loadBuiltin, TEMPLATE_FILE } from "./template/load.js";
import { DEFAULT_EXCLUDES } from "./vault/vault.js";

/** §8.4: the picker lists at most this many image files. */
export const FOLDER_IMAGE_LIMIT = 200;
/** Task 10-B fix I1: the most entries (of any kind) git may list before the folder is refused as too large. */
export const FOLDER_ENTRY_LIMIT = 20_000;
/** Task 10-B fix I1: the longest the listing may take before the folder is refused as too large. */
export const FOLDER_LIST_MS = 5_000;

/** A folder too large (or too slow) to list for the picker; the person types the path instead. */
export class FolderTooLarge extends Error {
  readonly code = "flow-folder-too-large";
  constructor(readonly dir: string, readonly why: "entries" | "time", limit: number) {
    super(why === "entries" ? `${dir} holds more than ${limit} files; type the image's path instead` : `listing ${dir} took longer than ${limit} ms; type the image's path instead`);
    this.name = "FolderTooLarge";
  }
}

export interface FolderListCaps { images: number; entries: number; ms: number }
const CAPS: FolderListCaps = { images: FOLDER_IMAGE_LIMIT, entries: FOLDER_ENTRY_LIMIT, ms: FOLDER_LIST_MS };

/** `git ls-files -z` output read as it streams: stopped (child killed) past `entries` paths or `ms` milliseconds. */
function streamPaths(dir: string, args: string[], caps: FolderListCaps): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { env: { ...process.env, ...unsetInheritedGitEnv() }, stdio: ["ignore", "pipe", "ignore"] });
    const paths: string[] = [];
    let rest = Buffer.alloc(0);
    let done = false;
    const stop = (error: Error | null): void => {
      if (done) return;
      done = true; clearTimeout(timer); child.kill("SIGKILL");
      if (error === null) resolve(paths); else reject(error);
    };
    const timer = setTimeout(() => stop(new FolderTooLarge(dir, "time", caps.ms)), caps.ms);
    child.stdout.on("data", (chunk: Buffer) => {
      rest = Buffer.concat([rest, chunk]);
      for (let at = rest.indexOf(0); at >= 0; at = rest.indexOf(0)) {
        paths.push(rest.subarray(0, at).toString("utf8"));
        rest = rest.subarray(at + 1);
        if (paths.length > caps.entries) { stop(new FolderTooLarge(dir, "entries", caps.entries)); return; }
      }
    });
    child.on("error", (error) => stop(error));
    child.on("close", (code) => stop(code === 0 ? null : new Error(`git ls-files exited ${code}`)));
  });
}

export interface FlowTemplateParamRead extends Omit<FlowParam, "required"> { id: string; required: boolean }
export interface FlowTemplatesRead {
  schema: "orca-flow-templates-v1";
  templates: Array<{ id: string; version: number | null; title: { en?: string; zh?: string } | null; params: FlowTemplateParamRead[]; excludes: string[] }>;
}

/** Every built-in this install ships, its params in the template's own order. */
export function readBuiltinTemplates(root: string = BUILTIN_ROOT): FlowTemplatesRead {
  const ids = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, e.name, TEMPLATE_FILE))).map((e) => e.name).sort() : [];
  return {
    schema: "orca-flow-templates-v1",
    templates: ids.map((id) => {
      const { template } = loadBuiltin(id, root);
      const title = (template as { title?: { en?: string; zh?: string } }).title ?? null;
      return {
        id, version: template.version ?? null, title,
        params: Object.entries(template.params ?? {}).map(([paramId, param]) => ({ ...param, id: paramId, required: param.required === true })),
        excludes: [...(template.workspace.excludes ?? [])],
      };
    }),
  };
}

export interface FolderImagesRead { schema: "orca-flow-folder-images-v1"; dir: string; files: string[]; truncated: boolean; limit: number }

/** §8.4: the image files of `dir` a start could name, excludes applied, bounded. Throws when `dir` is not a directory. */
export async function listFolderImages(dir: string, excludes: readonly string[], caps: Partial<FolderListCaps> = {}): Promise<FolderImagesRead> {
  const bound: FolderListCaps = { ...CAPS, ...caps };
  const limit = bound.images;
  const real = await realpath(dir);
  if (!(await stat(real)).isDirectory()) throw new Error(`${dir} is not a directory`);
  const scratch = await mkdtemp(join(tmpdir(), "orca-flow-images-"));
  try {
    const env = unsetInheritedGitEnv();
    await git(scratch, [...QUIET_GIT, "init", "-q", "--bare", scratch], { env });
    const args = [...QUIET_GIT, "-c", "core.precomposeUnicode=true", "--git-dir", scratch, "--work-tree", real, "ls-files", "-z", "-o", "--exclude-standard",
      ...[...DEFAULT_EXCLUDES, ...excludes].map((pattern) => `--exclude=${pattern}`)];
    const listed = (await streamPaths(dir, args, bound)).filter((p) => p.length > 0 && !p.endsWith("/") && imageValueProblem(p, false) === null);
    const files: string[] = [];
    for (const rel of listed.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      // A start opens the file without following a link (params.ts openInsideFolder): a link is never offered.
      if (!(await lstat(join(real, rel))).isFile()) continue;
      files.push(rel);
      // One past the bound is enough to say the list was cut.
      if (files.length > limit) break;
    }
    return { schema: "orca-flow-folder-images-v1", dir, files: files.slice(0, limit), truncated: files.length > limit, limit };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
