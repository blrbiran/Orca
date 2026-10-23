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
 */
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
export async function listFolderImages(dir: string, excludes: readonly string[], limit: number = FOLDER_IMAGE_LIMIT): Promise<FolderImagesRead> {
  const real = await realpath(dir);
  if (!(await stat(real)).isDirectory()) throw new Error(`${dir} is not a directory`);
  const scratch = await mkdtemp(join(tmpdir(), "orca-flow-images-"));
  try {
    const env = unsetInheritedGitEnv();
    await git(scratch, [...QUIET_GIT, "init", "-q", "--bare", scratch], { env });
    const args = [...QUIET_GIT, "-c", "core.precomposeUnicode=true", "--git-dir", scratch, "--work-tree", real, "ls-files", "-z", "-o", "--exclude-standard",
      ...[...DEFAULT_EXCLUDES, ...excludes].map((pattern) => `--exclude=${pattern}`)];
    const listed = (await git(scratch, args, { env })).split("\0").filter((p) => p.length > 0 && !p.endsWith("/") && imageValueProblem(p, false) === null);
    const files: string[] = [];
    for (const rel of listed.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      // A start opens the file without following a link (params.ts openInsideFolder): a link is never offered.
      if (!(await lstat(join(real, rel))).isFile()) continue;
      files.push(rel);
    }
    return { schema: "orca-flow-folder-images-v1", dir, files: files.slice(0, limit), truncated: files.length > limit, limit };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
