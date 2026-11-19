import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { initialPlacement } from "../../../src/control/dirGroup.js";
import { vaultKeyOf } from "../../../src/flow/vault/paths.js";
import { git } from "./driverHarness.js";
import type { ReviewWorld } from "./reviewWorld.js";

/**
 * #337 (spec 2026-11-19 §11.1): reviewWorld's group "g" as a folder (dir) group -- its body carries the frozen
 * `dirWorkspace` and the export's first `placement` record, and `orca/g` already exists (the export makes it, DIR §6.4).
 * The harness resolves every repo id onto its one real repository, which stands for the folder's vault here; the folder
 * itself is an empty directory under the fixture's root (Rule 17), never placed into by these criteria.
 */
export function makeDirGroup(w: ReviewWorld, options: { withheld?: string[] } = {}): string {
  const folder = join(w.t.h.root, "notes");
  mkdirSync(folder, { recursive: true });
  const dir = realpathSync(folder).normalize("NFC");
  const base = git(w.t.repo, "rev-parse", "main");
  git(w.t.repo, "branch", "orca/g", base);
  editGroup(w, (body) => {
    body.dirWorkspace = { dir, vaultId: vaultKeyOf(dir) };
    body.placement = { ...initialPlacement({ base, landedTip: base, at: 0 }),
      withheld: (options.withheld ?? []).map((path) => ({ path, reason: "the person's own edit", toEntry: "absent" })) };
  });
  return dir;
}

export function groupBodyOf(w: ReviewWorld): Record<string, unknown> {
  return JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
}

export function editGroup(w: ReviewWorld, edit: (body: Record<string, unknown>) => void): void {
  const body = groupBodyOf(w);
  edit(body);
  w.t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
}

/**
 * Holds the review pass off the group (no requirement block: reviewRequired is false) while its tasks run, so a criterion
 * can set the state the pass then meets; `release` puts the block back.
 */
export function holdReview(w: ReviewWorld): { release(): void } {
  const requirement = groupBodyOf(w).requirement;
  editGroup(w, (body) => { delete body.requirement; });
  return { release: () => editGroup(w, (body) => { body.requirement = requirement; }) };
}

export function reviewActivities(w: ReviewWorld): Array<Record<string, unknown>> {
  return w.t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind='requirement-review' ORDER BY rowid").all()
    .map((row) => JSON.parse(String(row.body)) as Record<string, unknown>);
}
