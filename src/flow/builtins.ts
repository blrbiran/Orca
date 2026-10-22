/**
 * Flow engine spec §11.3 and §17 package 8 (plan Task 14): the built-in templates shipped under `flows/builtin/` are
 * indexed in `flow_templates` (layer `builtin`) by upsert on every panel start, so the index always names the bytes
 * this install ships. A built-in that fails its checklist, or carries no version, stops the seeding loudly: shipping a
 * broken built-in is a release bug, never something to skip.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ControlStore } from "../control/store.js";
import { upsertTemplateIndex } from "./store.js";
import { BUILTIN_ROOT, loadBuiltin, TEMPLATE_FILE } from "./template/load.js";

export function seedBuiltinTemplates(store: ControlStore, at: number, root: string = BUILTIN_ROOT): Array<{ id: string; version: number; sha256: string }> {
  const ids = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, e.name, TEMPLATE_FILE))).map((e) => e.name).sort() : [];
  const seeded = ids.map((id) => {
    const loaded = loadBuiltin(id, root);
    const version = loaded.template.version;
    if (version === undefined) throw new Error(`flow-template-invalid: built-in ${id} has no version`);
    return { id, version, sha256: loaded.sha256, path: join(root, id, TEMPLATE_FILE) };
  });
  store.transaction(() => {
    for (const row of seeded) upsertTemplateIndex(store, { layer: "builtin", ...row, publishedBy: "orca", publishedAt: at });
  });
  return seeded.map(({ id, version, sha256 }) => ({ id, version, sha256 }));
}
