/**
 * Multi-directory projects spec §9.4, §12: the group summary's `multiDir`. Each directory's state is what the landing
 * did -- not what accept seeded into `lastLanded` (every directory's export base) -- and `landedKeys` is the journal's
 * list, which the region prints as "Updated in this landing" while a landing is stopped. A `keep` directory is never
 * carried, so it is never landed.
 */
import { describe, expect, it } from "vitest";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { webFixture } from "../control/fixtures/web.js";

const MAIN = "a".repeat(40), ALPHA = "b".repeat(40);
const RECORD = {
  delivery: [{ key: "main", scheme: { delivery: "local", trigger: "task", method: "merge", target: "main" } },
    { key: "alpha", scheme: { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" } }],
  state: "idle", pending: null, lastLanded: { main: MAIN, alpha: ALPHA },
  reason: null, detail: null, failedKey: null, movedBeforeAny: 0, resolution: null, at: 7,
};

async function multiSummary(landing: unknown) {
  const h = await webFixture();
  try {
    const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
    h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, multiDir: {
      project: "multi", dirs: [{ key: "main", repoId: "repo", kind: "repo" }, { key: "alpha", repoId: "alpha", kind: "repo" }], landing,
    } }));
    const summary = readGroupSummary(h.store, "g").multiDir;
    if (summary === undefined) throw new Error("the summary carried no multiDir");
    return summary;
  } finally { await h.dispose(); }
}

describe("the group summary's multiDir (spec §12, M16's server half)", () => {
  it("keeps every directory 'not landed yet' at idle, though accept seeded lastLanded with each base", async () => {
    const summary = await multiSummary({ ...RECORD });
    // mutation: derive `landed` from lastLanded's presence -> both true at idle, red
    expect(summary.dirs.map((dir) => [dir.key, dir.primary, dir.delivery, dir.lastLanded, dir.landed, dir.failed]))
      .toEqual([["main", true, "local", MAIN, false, false], ["alpha", false, "push-target", ALPHA, false, false]]);
    expect(summary.landing).toMatchObject({ state: "idle", landedKeys: [], reason: null });
  });

  it("names what a stopped landing landed and which directory failed", async () => {
    const summary = await multiSummary({ ...RECORD, state: "partial", pending: { plan: [], landed: ["main"], startedAt: 8 },
      reason: "multi-dir-target-missing:alpha", failedKey: "alpha" });
    // mutation: mark a pending directory landed too -> alpha true, red
    expect(summary.dirs.map((dir) => [dir.key, dir.landed, dir.failed])).toEqual([["main", true, false], ["alpha", false, true]]);
    expect(summary.landing).toMatchObject({ state: "partial", landedKeys: ["main"], failedKey: "alpha", reason: "multi-dir-target-missing:alpha" });
  });

  it("marks every carried directory landed once the landing completes, and keeps the journal's list empty", async () => {
    const summary = await multiSummary({ ...RECORD, state: "landed" });
    expect(summary.dirs.map((dir) => [dir.key, dir.landed, dir.failed])).toEqual([["main", true, false], ["alpha", true, false]]);
    expect(summary.landing).toMatchObject({ state: "landed", landedKeys: [] });
  });

  it("leaves a kept directory not landed, since a keep scheme is never carried", async () => {
    const summary = await multiSummary({ ...RECORD, state: "landed", delivery: [
      { key: "main", scheme: { delivery: "keep" } },
      { key: "alpha", scheme: { delivery: "local", trigger: "task", method: "merge", target: "main" } },
    ] });
    // mutation: count every directory landed at state "landed" -> main true, red
    expect(summary.dirs.map((dir) => [dir.key, dir.delivery, dir.landed])).toEqual([["main", "keep", false], ["alpha", "local", true]]);
    expect(summary.landing).toMatchObject({ state: "landed", landedKeys: [] });
  });

  it("sends a null landing before accept freezes one", async () => {
    const summary = await multiSummary(null);
    expect(summary.dirs.map((dir) => [dir.key, dir.delivery, dir.landed])).toEqual([["main", null, false], ["alpha", null, false]]);
    expect(summary.landing).toBeNull();
  });
});
