/**
 * Gaps spec §8 (G8): a template's params as code checks them -- at start (given > project default > global default >
 * template default, §8.2) and at a `params` change (§8.3) -- and the `image` type (§8.1).
 *
 * An `image` value is a path naming a png/jpg/jpeg/gif/webp file of at most 20 MiB. Orca reads it once (at start or at the
 * change), refuses it unless its bytes are an image, and stores the bytes content-addressed in the run's file store
 * (`storeImage`, the §4.7 store). The run records `{source, sha256, ext}`; the params identity (`params_sha256`) takes the
 * bytes' hash in place of the path, so other bytes at the same path move it and the same bytes under a new path do not.
 *
 * ⚠️ §8.1 items 3-4 (a copy into each attempt workspace at `.orca/params/<id>.<ext>`, the variable expanding to it) are NOT
 * built: the premise failed with the real driver (spec §21 entries 2 and 3). `{{param.<id>}}` of an image expands to its
 * value as written. A folder-relative value names a file of the person's folder, which reaches the attempt through the
 * import (as a `path` param's file does); an absolute value -- only a settings preset may carry one -- cannot reach it,
 * so a step that would use it is refused before it starts (`unreachableImageParam`).
 */
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { sha256Canonical } from "../control/canonicalJson.js";
import { storeImage, type ImageExt } from "./feedback/attachments.js";
import { FlowRefusal } from "./kernel.js";
import type { LoadedRun } from "./kinds/registry.js";
import { isInsidePath } from "./template/checklist.js";
import type { FlowParam, FlowStep, FlowTemplate } from "./template/schema.js";
import { varRefs } from "./template/vars.js";
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

/** §8.1: read the file once, refuse it unless its bytes are an image, store the bytes; what the run records. */
export function resolveImage(env: NodeJS.ProcessEnv, id: string, value: ParamValue, folder: string | null, source: ParamSource): ResolvedImage {
  const problem = imageValueProblem(value, source === "project" || source === "global");
  if (problem !== null) refuse(id, problem);
  const path = value as string;
  const file = isAbsolute(path) ? path : folder === null ? refuse(id, "a folder-relative image needs the run's folder") : join(folder, path);
  let bytes: Buffer;
  try {
    const stat = lstatSync(file);
    // A link is not followed: the folder's import keeps it as a link, so the step would not see the bytes checked here.
    if (!stat.isFile()) refuse(id, `${path} is not a file`);
    if (stat.size > IMAGE_PARAM_MAX_BYTES) refuse(id, `larger than ${IMAGE_PARAM_MAX_BYTES} bytes`);
    bytes = readFileSync(file);
  } catch (error) {
    if (error instanceof FlowRefusal) throw error;
    return refuse(id, `${path} does not exist`);
  }
  const stored = storeImage(env, bytes, { maxBytes: IMAGE_PARAM_MAX_BYTES, exts: IMAGE_EXTS, refusal: `flow-param-invalid:${id}` });
  return { source: path, sha256: stored.sha256, ext: stored.ext };
}

/** §8.1 item 2: the params identity, with each image's bytes hash in place of its path. */
export function paramsIdentity(params: Readonly<Record<string, ParamValue>>, images: Readonly<Record<string, ResolvedImage>>): string {
  const byBytes = Object.fromEntries(Object.entries(images).map(([id, image]) => [id, { image: image.sha256 }]));
  return sha256Canonical({ ...params, ...byBytes });
}

/**
 * §8.2: the start's params. A value given > the project's default > the global default > the template's `derive` or
 * `default`. Each value is checked against its type; an image is read and stored (§8.1).
 */
export function resolveStartParams(template: FlowTemplate, given: Record<string, ParamValue>, opts: {
  now: Date; env: NodeJS.ProcessEnv; folder: string | null; project: ParamDefaults; global: ParamDefaults;
  derive(kind: "slug-of-idea" | "today", params: Readonly<Record<string, ParamValue | undefined>>, now: Date): string;
}): { params: Record<string, ParamValue>; images: Record<string, ResolvedImage> } {
  const declared = template.params ?? {};
  for (const id of Object.keys(given)) if (!(id in declared)) refuse(id, "not a parameter of the template");
  const params: Record<string, ParamValue> = {};
  const images: Record<string, ResolvedImage> = {};
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
    if (param.type === "image") images[id] = resolveImage(opts.env, id, value, opts.folder, source);
    params[id] = param.type === "image" ? value : checkParamValue(id, param, value);
  }
  return { params, images };
}

/** §8.3: a `params` change as checked when it arrives (values as given: folder-relative only; `null` unsets). */
export interface ParamsChange { set: Record<string, ParamValue>; unset: string[]; images: Record<string, ResolvedImage> }
export function resolveParamsChange(env: NodeJS.ProcessEnv, run: LoadedRun, set: Record<string, unknown>): ParamsChange {
  const declared = run.template.params ?? {};
  const out: ParamsChange = { set: {}, unset: [], images: {} };
  for (const [id, value] of Object.entries(set)) {
    const param = declared[id];
    if (param === undefined) refuse(id, "not a parameter of the template");
    if (value === null) {
      if (param!.required === true) refuse(id, "required");
      out.unset.push(id);
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") refuse(id, "must be text, a number or true/false");
    if (param!.type === "image") out.images[id] = resolveImage(env, id, value as ParamValue, run.body.dir, "given");
    out.set[id] = param!.type === "image" ? value as ParamValue : checkParamValue(id, param!, value as ParamValue);
  }
  return out;
}

/** The run's params and images after a change. */
export function applyParamsChange(params: Readonly<Record<string, ParamValue>>, images: Readonly<Record<string, ResolvedImage>>, change: ParamsChange): { params: Record<string, ParamValue>; images: Record<string, ResolvedImage> } {
  const nextParams: Record<string, ParamValue> = { ...params, ...change.set };
  const nextImages: Record<string, ResolvedImage> = { ...images, ...change.images };
  for (const id of change.unset) { delete nextParams[id]; delete nextImages[id]; }
  return { params: nextParams, images: nextImages };
}

/** Every text of a step that may carry a variable: its prompt-like assets, `vars`, checks and tool rules. */
function stepTexts(run: LoadedRun, step: FlowStep): string[] {
  const texts: string[] = [];
  const asset = (rel: string | undefined): void => { if (rel !== undefined && run.assets[rel] !== undefined) texts.push(run.assets[rel]!); };
  if ("prompt" in step) asset(step.prompt);
  if (step.kind === "clarify") asset(step.background);
  if (step.kind === "review") asset(step.rubric);
  if ("vars" in step && step.vars !== undefined) texts.push(...Object.values(step.vars));
  if ("acceptance" in step && step.acceptance !== undefined) texts.push(...step.acceptance.checks.map((c) => c.run));
  if ("tools" in step && step.tools?.commands !== undefined) texts.push(...step.tools.commands.map((r) => ("exact" in r ? r.exact : r.prefix)));
  return texts;
}

/**
 * Controller ruling (Task 6, spec §21 entry 3): an absolute image value (a settings preset) is a path outside the step's
 * workspace, which the step cannot be shown -- the id of the first such param the step uses, else null. The kernel
 * refuses the step before it starts (`flow-param-unreachable:<id>`): no effect gate, no draw, no child.
 */
export function unreachableImageParam(run: LoadedRun, step: FlowStep): string | null {
  const declared = run.template.params ?? {};
  for (const text of stepTexts(run, step)) {
    for (const ref of varRefs(text)) {
      if (ref.kind !== "param" || declared[ref.id]?.type !== "image") continue;
      const value = run.params[ref.id];
      if (typeof value === "string" && isAbsolute(value)) return ref.id;
    }
  }
  return null;
}
