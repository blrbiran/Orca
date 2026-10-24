/**
 * Dir-requirements spec §8.4–§8.5 (journal, `pending` ref, CAS `placed`), criterion D7 (plan Task 5b; the two
 * `take-folder` crash points are Task 5c's). One landing of n = 3 paths (a modify, a delete, an add in a new directory);
 * the pass is killed at each crash point (the hook throws, as a process death: nothing is written after it), then a
 * restarted round runs. Each restarted round ends `idle` with every landing path equal to F′, no `.orca-*` name left (no
 * aside holds the person's bytes in these cases), `placed` = F′ and `refs/orca/group/g/pending` deleted. While `pending`
 * exists, F′ survives `git gc --prune=now` in the vault (the ref keeps it, review I4).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DirPlacementCrashPoint } from "../../src/control/dirPlacement.js";
import { orcaNames, placementWorld } from "./fixtures/dirPlacementWorld.js";

class Killed extends Error {}
const LANDING = { "a.md": "A, placed\n", "b.md": null, "sub/c.md": "C, new\n" };
const PATHS = ["a.md", "b.md", "sub/c.md"];

/** Kill the pass at the first `point` (for `after-path`, after the first path written: k = 1 of n = 3). */
async function crashThenRestart(point: DirPlacementCrashPoint): Promise<void> {
  const w = await placementWorld({ "a.md": "A\n", "b.md": "B\n" });
  try {
    w.land(LANDING);
    const seen: string[] = [];
    await expect(w.place((at, path) => {
      seen.push(`${at}:${path ?? ""}`);
      if (at === point) throw new Killed(point);
    })).rejects.toBeInstanceOf(Killed);
    // F′: what the journal names (the after-journal point is reached only once it is written).
    const fPrime = w.record().pending!.to;
    // review I4: while the journal names F′, the `pending` ref keeps it through a gc.
    w.git(["gc", "--prune=now", "--quiet"]);
    w.git(["cat-file", "-e", fPrime]);

    expect(await w.place()).toBe(true);
    const record = w.record();
    expect(record).toMatchObject({ state: "idle", pending: null, changed: [], unwritable: [], tip: w.tip() });
    expect(w.ref("refs/orca/group/g/placed")).toBe(fPrime);
    expect(w.ref("refs/orca/group/g/pending")).toBeNull();
    for (const path of PATHS) {
      const want = w.git(["ls-tree", "--full-tree", fPrime, "--", path]) === "" ? null : w.show(fPrime, path);
      if (want === null) expect(existsSync(join(w.folder, path))).toBe(false);
      else expect(readFileSync(join(w.folder, path), "utf8").trimEnd()).toBe(want);
    }
    expect(orcaNames(w.folder)).toEqual([]);
    // The crash point was reached where the criterion says.
    expect(seen.some((entry) => entry.startsWith(`${point}:`))).toBe(true);
  } finally { await w.dispose(); }
}

describe("the placement journal survives a crash at every point (D7)", () => {
  it("after the pending ref and the journal, before any write", () => crashThenRestart("after-journal"));
  it("after 1 of 3 paths written", () => crashThenRestart("after-path"));
  it("inside a write, the temporary created and half-filled", () => crashThenRestart("tmp-half-written"));
  it("after rename(p, a), before the comparison", () => crashThenRestart("after-aside"));
  it("after link(t, p), before unlink(a)", () => crashThenRestart("after-link"));
  it("after the placed CAS, before the body update", () => crashThenRestart("after-placed-cas"));
});
