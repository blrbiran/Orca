/**
 * Gaps spec §8 (G8): a template's params as code checks them -- at start (given > project default > global default >
 * template default, §8.2) and at a `params` change (§8.3) -- and the `image` type (§8.1).
 *
 * An `image` value is a path naming a png/jpg/jpeg/gif/webp file of at most 20 MiB. Orca reads it once (at start or at the
 * change), refuses it unless its bytes are an image, and stores the bytes content-addressed in the run's file store
 * (`storeImage`, the §4.7 store). The run records `{source, sha256, ext}`; the params identity (`params_sha256`) takes the
 * bytes' hash in place of the path, so other bytes at the same path move it and the same bytes under a new path do not.
 *
 * §8.1 items 3-4 as built after the human's choice (a) (spec §21 entry 4; the workspace copy's premise failed, entries 2
 * and 3): `{{param.<id>}}` of an image expands, in prompts and commands, to the absolute path of its stored copy
 * `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>` -- the bytes that were hashed, outside the workspace, so never
 * committed -- whether the value was folder-relative or a preset (`expansionParams`).
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { sha256Canonical } from "../control/canonicalJson.js";
import { attachmentPath, sniffImage, storeImage, type ImageExt } from "./feedback/attachments.js";
import { FlowRefusal } from "./kernel.js";
import type { LoadedRun } from "./kinds/registry.js";
import { isInsidePath } from "./template/checklist.js";
import type { FlowParam, FlowTemplate } from "./template/schema.js";
import type { ParamValue } from "./template/when.js";

export const IMAGE_PARAM_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTS: readonly ImageExt[] = ["png", "jpg", "gif", "webp"];
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;
/** §8.1: what the run records for an `image` param. */
export interface ResolvedImage { source: string; sha256: string; ext: ImageExt }
/** Where a value came from; only a settings layer may name an absolute image (§8.1, human-only writes). */
export type ParamSource = "given" | "project" | "global" | "template";
export type ParamDefaults = Readonly<Record<string, ParamValue>>;

const refuse = (id: string, why: string): never => { throw new FlowRefusal(`flow-param-invalid:${id}`, why); };

/** The shape of an `image` value, without reading the file (settings check this at write time, §8.2). */
export function imageValueProblem(value: unknown, absoluteAllowed: boolean): string | null {
  if (typeof value !== "string" || value === "" || value.includes("'") || /[\0\n\r]/.test(value)) return "must be the path of an image file";
  if (!IMAGE_NAME.test(value)) return "must name a png, jpg, jpeg, gif or webp file";
  if (isAbsolute(value)) return absoluteAllowed ? null : "must be folder-relative (an absolute path only from the settings' paramDefaults)";
  return isInsidePath(value) ? null : "must stay inside the folder";
}

/** A non-image value checked against its type; the value as the run keeps it (an enum as text). */
export function checkParamValue(id: string, param: FlowParam, value: ParamValue): ParamValue {
  const bad = (why: string): never => refuse(id, why);
  switch (param.type) {
    case "text": case "longtext": if (typeof value !== "string") bad("must be text"); return value;
    case "bool": if (typeof value !== "boolean") bad("must be true or false"); return value;
    case "int": if (typeof value !== "number" || !Number.isInteger(value)) bad("must be an integer"); return value;
    case "enum": if (!param.options!.includes(String(value))) bad(`must be one of ${param.options!.join(", ")}`); return String(value);
    case "slug": if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) bad("must be a slug"); return value;
    // Review Focus 1-2: a path stays inside the workspace and holds no quote, NUL or newline.
    case "path": if (typeof value !== "string" || !isInsidePath(value) || value.includes("'")) bad("must be a workspace-relative path"); return value;
    case "image": { const problem = imageValueProblem(value, true); if (problem !== null) bad(problem); return value; }
  }
}

/** An image read and checked, not yet stored: `storeImages` writes it once every other check has passed. */
export interface ReadImage extends ResolvedImage { bytes: Buffer }

/**
 * Open a folder-relative file without passing through a link: every parent directory is lstat'ed (a link or a
 * non-directory is refused, as copy-back refuses them, vault/copyBack.ts), the file itself is opened O_NOFOLLOW (and
 * O_NONBLOCK, so a FIFO opens at once and fails the regular-file check instead of blocking the thread), and the
 * opened file must be the one the folder's real path holds (closes a parent swapped between the walk and the open).
 */
function openInsideFolder(id: string, folder: string, rel: string): number {
  let cursor = folder;
  for (const part of rel.split("/").slice(0, -1)) {
    cursor = join(cursor, part);
    let stat;
    try { stat = lstatSync(cursor); } catch { return refuse(id, `${rel} does not exist`); }
    if (!stat.isDirectory()) refuse(id, `${rel} passes through ${stat.isSymbolicLink() ? "a link" : "a non-directory"} (${relative(folder, cursor)})`);
  }
  let fd: number;
  try { fd = openSync(join(folder, rel), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { return refuse(id, (error as NodeJS.ErrnoException).code === "ELOOP" ? `${rel} is a link` : `${rel} does not exist`); }
  try {
    const real = realpathSync(join(folder, rel));
    const opened = fstatSync(fd), there = statSync(real);
    if (!real.startsWith(`${realpathSync(folder)}${sep}`) || opened.ino !== there.ino || opened.dev !== there.dev) refuse(id, `${rel} is not a file inside the folder`);
  } catch (error) { closeSync(fd); throw error instanceof FlowRefusal ? error : new FlowRefusal(`flow-param-invalid:${id}`, `${rel} is not a file inside the folder`); }
  return fd;
}

/**
 * §8.1: read the file once and refuse it unless it is a regular file of at most 20 MiB whose bytes are an image. Nothing
 * is written here (a later refusal must leave nothing behind); `storeImages` stores what passed.
 */
export function readImage(id: string, value: ParamValue, folder: string | null, source: ParamSource): ReadImage {
  const problem = imageValueProblem(value, source === "project" || source === "global");
  if (problem !== null) refuse(id, problem);
  const path = value as string;
  let fd: number;
  if (isAbsolute(path)) {
    // Only a settings preset (the person's own write) names an absolute file; it is read where it is. O_NONBLOCK: a FIFO
    // opens at once and fails the regular-file check below instead of blocking the panel's thread in open().
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); } catch { return refuse(id, `${path} does not exist`); }
  } else {
    if (folder === null) refuse(id, "a folder-relative image needs the run's folder");
    fd = openInsideFolder(id, folder!, path);
  }
  let bytes: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) refuse(id, `${path} is not a file`);
    if (stat.size > IMAGE_PARAM_MAX_BYTES) refuse(id, `larger than ${IMAGE_PARAM_MAX_BYTES} bytes`);
    bytes = readFileSync(fd);
  } finally { closeSync(fd); }
  if (bytes.length > IMAGE_PARAM_MAX_BYTES) refuse(id, `larger than ${IMAGE_PARAM_MAX_BYTES} bytes`);
  const ext = sniffImage(bytes);
  if (ext === null || !IMAGE_EXTS.includes(ext)) refuse(id, "not a png, jpg, gif or webp image by its bytes");
  return { source: path, sha256: createHash("sha256").update(bytes).digest("hex"), ext: ext!, bytes };
}

/** Store what `readImage` read (the §4.7 store); what the run records. */
export function storeImages(env: NodeJS.ProcessEnv, read: Readonly<Record<string, ReadImage>>): Record<string, ResolvedImage> {
  return Object.fromEntries(Object.entries(read).map(([id, image]) => {
    const stored = storeImage(env, image.bytes, { maxBytes: IMAGE_PARAM_MAX_BYTES, exts: IMAGE_EXTS, refusal: `flow-param-invalid:${id}` });
    return [id, { source: image.source, sha256: stored.sha256, ext: stored.ext }];
  }));
}

/** §8.1 item 2: the params identity, with each image's bytes hash in place of its path. */
export function paramsIdentity(params: Readonly<Record<string, ParamValue>>, images: Readonly<Record<string, ResolvedImage>>): string {
  const byBytes = Object.fromEntries(Object.entries(images).map(([id, image]) => [id, { image: image.sha256 }]));
  return sha256Canonical({ ...params, ...byBytes });
}

/**
 * §8.2: the start's params. A value given > the project's default > the global default > the template's `derive` or
 * `default`. Each value is checked against its type; an image is read and checked (§8.1) -- the caller stores it
 * (`storeImages`) after its own remaining checks, so a refused start writes nothing.
 */
export function resolveStartParams(template: FlowTemplate, given: Record<string, ParamValue>, opts: {
  now: Date; folder: string | null; project: ParamDefaults; global: ParamDefaults;
  derive(kind: "slug-of-idea" | "today", params: Readonly<Record<string, ParamValue | undefined>>, now: Date): string;
}): { params: Record<string, ParamValue>; images: Record<string, ReadImage> } {
  const declared = template.params ?? {};
  for (const id of Object.keys(given)) if (!(id in declared)) refuse(id, "not a parameter of the template");
  const params: Record<string, ParamValue> = {};
  const images: Record<string, ReadImage> = {};
  for (const [id, param] of Object.entries(declared)) {
    const picked: Array<[ParamSource, ParamValue | undefined]> = [
      ["given", given[id]], ["project", opts.project[id]], ["global", opts.global[id]],
      ["template", param.derive === undefined ? undefined : opts.derive(param.derive, { ...given, ...params }, opts.now)], ["template", param.default],
    ];
    const found = picked.find(([, value]) => value !== undefined);
    if (found === undefined) {
      if (param.required === true) refuse(id, "required");
      continue;
    }
    const [source, value] = found as [ParamSource, ParamValue];
    if (param.type === "image") images[id] = readImage(id, value, opts.folder, source);
    params[id] = param.type === "image" ? value : checkParamValue(id, param, value);
  }
  return { params, images };
}

/** §8.3: a `params` change as checked when it arrives (values as given: folder-relative only; `null` unsets). */
export interface ParamsChange { set: Record<string, ParamValue>; unset: string[]; images: Record<string, ResolvedImage> }
export function resolveParamsChange(env: NodeJS.ProcessEnv, run: LoadedRun, set: Record<string, unknown>): ParamsChange {
  const declared = run.template.params ?? {};
  const out: ParamsChange = { set: {}, unset: [], images: {} };
  const read: Record<string, ReadImage> = {};
  for (const [id, value] of Object.entries(set)) {
    const param = declared[id];
    if (param === undefined) refuse(id, "not a parameter of the template");
    if (value === null) {
      if (param!.required === true) refuse(id, "required");
      out.unset.push(id);
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") refuse(id, "must be text, a number or true/false");
    if (param!.type === "image") read[id] = readImage(id, value as ParamValue, run.body.dir, "given");
    out.set[id] = param!.type === "image" ? value as ParamValue : checkParamValue(id, param!, value as ParamValue);
  }
  // Stored only once every key of the change passed.
  out.images = storeImages(env, read);
  return out;
}

/** The run's params and images after a change. */
export function applyParamsChange(params: Readonly<Record<string, ParamValue>>, images: Readonly<Record<string, ResolvedImage>>, change: ParamsChange): { params: Record<string, ParamValue>; images: Record<string, ResolvedImage> } {
  const nextParams: Record<string, ParamValue> = { ...params, ...change.set };
  const nextImages: Record<string, ResolvedImage> = { ...images, ...change.images };
  for (const id of change.unset) { delete nextParams[id]; delete nextImages[id]; }
  return { params: nextParams, images: nextImages };
}

/**
 * §8.1 "always a copy" (spec §21 entry 4): the params a prompt or a command expands -- each stored image as the absolute
 * path of its copy in the run's file store, never the path as given. Fields that name a file of the workspace (an ask's
 * `writeTo`, `hints.equals`) keep the value as written.
 */
export function expansionParams(env: NodeJS.ProcessEnv, run: Pick<LoadedRun, "params" | "body">): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...run.params };
  for (const [id, image] of Object.entries(run.body.images ?? {})) if (id in out) out[id] = attachmentPath(env, `${image.sha256}.${image.ext}`);
  return out;
}
