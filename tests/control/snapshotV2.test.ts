import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { bundleHeader, captureSnapshotV2, snapshotV2Schema, verifySnapshotArtifacts, verifySnapshotInRepository } from "../../src/control/snapshotV2.js";
import { openTestStore } from "./fixtures/store.js";

/**
 * Change-sized runs spec 2026-11-19 §7 (P2; #363 #366): snapshot v2 is a pinned commit plus a range bundle, verified at two
 * levels (criterion P2-5). Verification names snapshot-base-unavailable, snapshot-bundle-heads-mismatch and
 * snapshot-tree-mismatch, and it never writes the target: its refs and `count-objects -v` are measured before and after.
 */
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
function target(files = 50) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-snapshot-v2-")));
  const repo = join(root, "target");
  execFileSync("git", ["init", "-q", repo]);
  for (let i = 0; i < files; i += 1) writeFileSync(join(repo, `f${i}.txt`), `file ${i}\n`);
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(repo, "f0.txt"), "changed\n");
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "attempt");
  const attempt = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "--detach", base);
  git(repo, "branch", "-q", "-D", ...git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/").split("\n").filter(Boolean));
  git(repo, "update-ref", "refs/orca/runs/run-1", attempt);
  git(repo, "reflog", "expire", "--expire=now", "--all");
  return { root, repo, base, attempt };
}
// P2 review: FETCH_HEAD counts too -- a fetch with no destination writes nothing else, and its objects may already be there.
const state = (repo: string) => ({ refs: git(repo, "for-each-ref", "--format=%(refname) %(objectname)"), objects: git(repo, "count-objects", "-v"), fetchHead: existsSync(join(repo, ".git", "FETCH_HEAD")) });

describe("snapshot v2 (§7, P2-5)", () => {
  it("captures one range bundle base..pin and verifies at both levels without writing the target", async () => {
    const h = await openTestStore();
    const t = target();
    const missing: string[] = [];
    const ref = await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: t.attempt, head: t.attempt, source: "ccloop-published" }, missing);
    const snapshot = snapshotV2Schema.parse(JSON.parse((await readArtifact(h.store, ref)).toString()));
    expect(snapshot).toMatchObject({ version: 2, objectFormat: "sha1", base: t.base, attempt: t.attempt, head: t.attempt, ref: "refs/orca/runs/run-1", source: "ccloop-published", missing: [] });
    expect(snapshot.tree).toBe(git(t.repo, "rev-parse", `${t.attempt}^{tree}`));
    const header = bundleHeader(await readArtifact(h.store, snapshot.bundle!))!;
    expect(header).toEqual({ prerequisites: [t.base], heads: [{ oid: t.attempt, ref: "refs/orca/runs/run-1" }] });
    // The bundle's staging copy is gone.
    expect(readdirSync(join(h.store.stateDir, "staging")).filter((name) => name.endsWith(".bundle"))).toEqual([]);
    const before = state(t.repo);
    await expect(verifySnapshotInRepository(h.store, ref, () => t.repo)).resolves.toMatchObject({ attempt: t.attempt });
    // Mutation: fetch the bundle into the target while it holds the attempt -> FETCH_HEAD appears, red.
    expect(state(t.repo)).toEqual(before);
    // With the pin deleted and the objects pruned, the attempt is read through a temporary alternates repository.
    git(t.repo, "update-ref", "-d", "refs/orca/runs/run-1");
    git(t.repo, "gc", "-q", "--prune=now");
    expect(() => git(t.repo, "cat-file", "-e", `${t.attempt}^{commit}`)).toThrow();
    const pruned = state(t.repo);
    await expect(verifySnapshotInRepository(h.store, ref, () => t.repo)).resolves.toMatchObject({ attempt: t.attempt });
    // Mutation: fetch the bundle into the target instead of the alternates repository -> objects grow, red.
    expect(state(t.repo)).toEqual(pruned);
    // Ruling (P2 review; human approval 「同意这样大改，并且同意改所有必要的判据」): `expect(before.refs).toContain(...)` stood
    // here. It read back the pin this test wrote before any verification, so it could never be red (Rule 9); the state
    // is now compared after the in-target verification above.
    expect(readdirSync(join(h.store.stateDir, "staging"))).toEqual([]);
  });

  // Mutation: skip `bundle verify` (or the base check) -> the alternates fetch fails with git's words instead, red.
  it("names a target that lost the base snapshot-base-unavailable", async () => {
    const h = await openTestStore();
    const t = target();
    const ref = await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: t.attempt, head: t.attempt, source: "ccloop-published" }, []);
    const fresh = join(t.root, "fresh");
    execFileSync("git", ["init", "-q", fresh]);
    writeFileSync(join(fresh, "x"), "x\n"); git(fresh, "add", "-A"); git(fresh, "commit", "-q", "-m", "other");
    const before = state(fresh);
    await expect(verifySnapshotInRepository(h.store, ref, () => fresh)).rejects.toThrow("snapshot-base-unavailable");
    expect(state(fresh)).toEqual(before);
    await expect(verifySnapshotInRepository(h.store, ref, () => join(t.root, "nowhere"))).rejects.toThrow("snapshot-repository-unavailable");
  });

  // Mutation: drop the header check -> a bundle with another head passes the artifact level, red.
  it("names a bundle whose head is not the attempt at the pin snapshot-bundle-heads-mismatch, with no repository", async () => {
    const h = await openTestStore();
    const t = target();
    const ref = await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: t.attempt, head: t.attempt, source: "ccloop-published" }, []);
    const snapshot = snapshotV2Schema.parse(JSON.parse((await readArtifact(h.store, ref)).toString()));
    git(t.repo, "update-ref", "refs/orca/runs/run-2", t.attempt);
    const other = join(t.root, "other.bundle");
    git(t.repo, "bundle", "create", "-q", other, `${t.base}..refs/orca/runs/run-2`);
    const forged = { ...snapshot, bundle: await writeArtifact(h.store, "forged-bundle", execFileSync("cat", [other])) };
    const forgedRef = await writeArtifact(h.store, "snapshot-forged", Buffer.from(JSON.stringify(forged)));
    await expect(verifySnapshotArtifacts(h.store, forgedRef)).rejects.toThrow("snapshot-bundle-heads-mismatch");
    await expect(verifySnapshotArtifacts(h.store, ref)).resolves.toMatchObject({ snapshot: { attempt: t.attempt } });
  });

  // Mutation: drop the tree comparison -> red.
  it("names a recorded tree that is not the attempt's snapshot-tree-mismatch", async () => {
    const h = await openTestStore();
    const t = target();
    const ref = await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: t.attempt, head: t.attempt, source: "ccloop-published" }, []);
    const snapshot = snapshotV2Schema.parse(JSON.parse((await readArtifact(h.store, ref)).toString()));
    const lying = await writeArtifact(h.store, "snapshot-lying", Buffer.from(JSON.stringify({ ...snapshot, tree: git(t.repo, "rev-parse", `${t.base}^{tree}`) })));
    await expect(verifySnapshotInRepository(h.store, lying, () => t.repo)).rejects.toThrow("snapshot-tree-mismatch");
  });

  // P2-4 at the snapshot level: one bundle artifact and one snapshot artifact whatever the tracked-file count.
  // Mutation: archive every tracked blob (v1's index walk) -> the artifact count grows with the files, red.
  it("adds exactly two artifacts for a one-file change, at 2,000 and at 4,000 tracked files", async () => {
    for (const files of [2000, 4000]) {
      const h = await openTestStore();
      const t = target(files);
      const count = () => Number(h.store.db.prepare("SELECT count(*) AS n FROM artifacts").get()!.n);
      const before = count();
      await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: t.attempt, head: t.attempt, source: "ccloop-published" }, []);
      expect(count() - before).toBe(2);
    }
  }, 240_000);

  it("archives a run with no attempt as its base, with no bundle", async () => {
    const h = await openTestStore();
    const t = target();
    const ref = await captureSnapshotV2(h.store, { runId: "run-1", targetRepo: t.repo, base: t.base, attempt: null, head: t.base, source: "ccloop-live" }, ["attempt-unavailable:record-failed"]);
    const snapshot = snapshotV2Schema.parse(JSON.parse((await readArtifact(h.store, ref)).toString()));
    expect(snapshot).toMatchObject({ attempt: t.base, bundle: null, source: "base", missing: ["attempt-unavailable:record-failed"] });
    await expect(verifySnapshotArtifacts(h.store, ref)).rejects.toThrow("snapshot-partial");
  });
});
