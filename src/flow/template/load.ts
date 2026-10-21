/**
 * Flow engine spec §3.3 (save path) and §17 package 1 (built-in loader).
 *
 * `parseTemplateDraft` is all a save does: the text must be YAML, nothing more -- a broken draft can be saved and
 * fixed later (R §5). `loadBuiltin` reads `flows/builtin/<id>/template.yaml` from the repository this module belongs
 * to (resolved from the module URL, never from the working directory), runs the static checklist and refuses a
 * template that fails it with `flow-template-invalid`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { checkTemplate, isInsidePath, type AssetReader } from "./checklist.js";
import { flowTemplateSchema, type FlowTemplate } from "./schema.js";

/** src/flow/template (or dist/flow/template) -> the repository root -> flows/builtin. */
export const BUILTIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "flows", "builtin");
export const TEMPLATE_FILE = "template.yaml";

export function parseTemplateDraft(yamlText: string): { ok: true; raw: unknown } | { ok: false; error: string } {
  try { return { ok: true, raw: parse(yamlText) as unknown }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

/** Assets of a template directory; a path outside it is reported missing, never read (the checklist names it first). */
export function directoryAssets(dir: string): AssetReader {
  const file = (rel: string): string | null => {
    if (!isInsidePath(rel)) return null;
    const path = join(dir, rel);
    try { return statSync(path).isFile() ? path : null; } catch { return null; }
  };
  return {
    exists: (rel) => file(rel) !== null,
    read: (rel) => {
      const path = file(rel);
      if (path === null) throw new Error(`asset ${rel} is not a file of the template`);
      return readFileSync(path, "utf8");
    },
  };
}

export interface LoadedTemplate { template: FlowTemplate; bytes: Buffer; sha256: string; assets: AssetReader }

export function loadBuiltin(id: string, root: string = BUILTIN_ROOT): LoadedTemplate {
  const invalid = (detail: string): never => { throw new Error(`flow-template-invalid: ${detail}`); };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) invalid(`${JSON.stringify(id)} is not a template id`);
  const dir = join(root, id);
  const path = join(dir, TEMPLATE_FILE);
  if (!existsSync(path)) invalid(`no built-in template ${id} (${path})`);
  const bytes = readFileSync(path);
  const draft = parseTemplateDraft(bytes.toString("utf8"));
  if (!draft.ok) return invalid(`${id}: ${draft.error}`);
  const assets = directoryAssets(dir);
  const { errors } = checkTemplate(draft.raw, assets, { builtinEffectSkills: new Set() });
  if (errors.length > 0) invalid(errors.map((finding) => `${finding.code} at ${finding.path}: ${finding.message}`).join("; "));
  return { template: flowTemplateSchema.parse(draft.raw), bytes, sha256: createHash("sha256").update(bytes).digest("hex"), assets };
}
