import { z } from "zod";
import { landedGroups } from "../integrationCheck.js";
import type { ControlStore } from "../store.js";
import type { Git } from "./range.js";
import { EMPTY_CHECK_STATE, readCheckState, writeCheckState, type CheckLast } from "./state.js";

/**
 * Checks spec 2026-10-22 §5.1 (lazy, not SQL: it needs git): the integration check's pre-16 state, the `meta` row
 * `integration-check:<repo>` (`covered` = group → the integrated commit the last finished check covered), becomes one
 * `check_state` row per target at the pump's first evaluation of the repository. The watermark is derived so that no
 * landed-but-unchecked group is skipped (over-include, never skip). The row is written and the `meta` row deleted in one
 * transaction: a crash before the commit leaves the old row, and the conversion is repeatable. A target whose history
 * cannot be read keeps the `meta` row (its covered map is the only record of what was checked): the readable targets are
 * converted, and the rest is retried at a later evaluation -- over a state row that has no watermark yet (the pass's own
 * `target unreadable` record), never over one that has. A landed group off the target's first-parent history cannot be
 * ordered; it is named in the record's detail rather than dropped silently.
 */
const legacySchema = z.object({
  lastAt: z.number().int().nullable(),
  covered: z.record(z.string(), z.string()),
  last: z.object({
    state: z.enum(["running", "passed", "failed", "errored"]), at: z.number().int(), commit: z.string().nullable(), groups: z.array(z.string()),
    detail: z.string().nullable(), debugGroupId: z.string().nullable(),
  }).strict().nullable(),
}).strict();
export const legacyMetaKey = (repoId: string): string => `integration-check:${repoId}`;

export async function migrateIntegrationMeta(store: ControlStore, git: Git, repo: string, repoId: string, hooks: { beforeCommit?: () => void } = {}): Promise<boolean> {
  const row = store.db.prepare("SELECT value FROM meta WHERE key=?").get(legacyMetaKey(repoId));
  if (row === undefined) return false;
  const legacy = legacySchema.parse(JSON.parse(String(row.value)));
  const byTarget = new Map<string, ReturnType<typeof landedGroups>>();
  for (const group of landedGroups(store, repoId)) byTarget.set(group.target, [...(byTarget.get(group.target) ?? []), group]);
  const states: Array<{ target: string; watermark: string | null; detail: string | null }> = [];
  let unreadable = false;
  for (const [target, groups] of byTarget) {
    // 1. Ordered by the target's first-parent history of their integrated commits.
    const chain = await git(repo, ["rev-list", "--first-parent", "--reverse", `refs/heads/${target}`]);
    if (chain.code !== 0) { unreadable = true; continue; }
    const order = new Map(chain.stdout.split("\n").filter((line) => line !== "").map((commit, index) => [commit, index]));
    const ordered = groups.filter((group) => order.has(group.integratedCommit)).sort((a, b) => order.get(a.integratedCommit)! - order.get(b.integratedCommit)!);
    const off = groups.filter((group) => !order.has(group.integratedCommit)).map((group) => group.groupId);
    const offDetail = off.length === 0 ? null : `off first-parent history: ${off.join(",")}`.slice(0, 500);
    const withOff = (detail: string | null) => detail === null ? offDetail : offDetail === null ? detail : `${detail}; ${offDetail}`;
    if (ordered.length === 0) { states.push({ target, watermark: null, detail: offDetail }); continue; } // 4. none landed: unset
    const firstUncovered = ordered.findIndex((group) => legacy.covered[group.groupId] !== group.integratedCommit);
    if (firstUncovered === -1) { states.push({ target, watermark: ordered.at(-1)!.integratedCommit, detail: offDetail }); continue; } // 2.
    // 3. The first parent of the earliest uncovered group's commit; covered groups after it are checked again.
    const parent = await git(repo, ["rev-parse", "--verify", `${ordered[firstUncovered]!.integratedCommit}^1`]);
    const recovered = ordered.slice(firstUncovered + 1).filter((group) => legacy.covered[group.groupId] === group.integratedCommit).length;
    states.push({ target, watermark: parent.code === 0 ? parent.stdout.trim() : null, detail: withOff(`migrated: re-covers ${recovered} groups`) });
  }
  const old = legacy.last;
  const last = (detail: string | null): CheckLast | null => old === null && detail === null ? null : {
    state: old === null ? "migrated" : old.state === "running" ? "errored" : old.state, at: old?.at ?? store.now(),
    from: null, to: old?.commit ?? null, groups: old?.groups ?? [],
    detail: detail ?? (old?.state === "running" ? "interrupted: Orca stopped while it ran" : old?.detail ?? null),
    reviewGroupId: null, debugGroupIds: old?.debugGroupId ? [old.debugGroupId] : [], recordHash: null,
  };
  store.transaction(() => {
    for (const entry of states) {
      const existing = readCheckState(store, repoId, "integration-check", entry.target);
      if (existing !== null && existing.watermark !== null) continue;
      writeCheckState(store, repoId, "integration-check", entry.target, { ...(existing ?? EMPTY_CHECK_STATE), watermark: entry.watermark, lastStartAt: legacy.lastAt, last: last(entry.detail) });
    }
    hooks.beforeCommit?.();
    if (!unreadable) store.db.prepare("DELETE FROM meta WHERE key=?").run(legacyMetaKey(repoId));
  });
  return !unreadable;
}
