import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { carryProfileBindings } from "../../src/control/profileCarryOver.js";
import { createExecutionProfileRouter, legacyProfileHash, resolveProfile } from "../../src/control/profiles.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot } from "./fixtures/web.js";

// #381 (session 3ba26002, human ruling 6, alias approved 「同意」): at panel start each loaded profile's legacy
// (whole-snapshot) hash is recorded as an alias of its binding hash, after one backup of the control database, so a group
// bound before the change still resolves after the file's unbound fields are edited. Every criterion runs on a state
// directory under the scoped TMPDIR (Rule 17), never a real ~/.orca.

const roots: string[] = [];
const stores: ControlStore[] = [];
afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
async function store(at = 1_000): Promise<ControlStore> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-carry-")));
  roots.push(root);
  const opened = await openControlStore({ stateDir: join(root, "state"), now: () => at });
  stores.push(opened);
  return opened;
}
const backups = async (s: ControlStore) => (await readdir(s.stateDir)).filter((name) => name.startsWith("control.sqlite.bak.")).sort();
const edited = (edit: (s: ExecutionProfileSnapshotV1) => void): ExecutionProfileSnapshotV1 => { const s = profileSnapshot(); edit(s); return s; };

describe("profile binding carry-over at panel start (#381)", () => {
  it("records the legacy hash as an alias after one 0600 backup, and a second start writes and copies nothing", async () => {
    const s = await store();
    const profile = resolveProfile(profileSnapshot());
    const first = carryProfileBindings(s, [profile]);
    expect(first.backup).toBe(join(s.stateDir, "control.sqlite.bak.1000"));
    expect((await stat(first.backup!)).mode & 0o777).toBe(0o600);
    expect([...first.aliases]).toEqual([[legacyProfileHash(profile.snapshot), profile.profileHash]]);
    expect(first.notes).toEqual([]);
    const second = carryProfileBindings(s, [profile]);
    expect([second.backup, second.notes, [...second.aliases]]).toEqual([null, [], [...first.aliases]]);
    expect(await backups(s)).toEqual(["control.sqlite.bak.1000"]);
  });

  it("keeps an earlier file's alias when the file's unbound fields change, so a record bound to it still resolves", async () => {
    const s = await store();
    const before = profileSnapshot();
    carryProfileBindings(s, [resolveProfile(before)]);
    const after = resolveProfile(edited((x) => { x.profile.estimatorPreflight!.instructionVersion = "4"; x.profile.estimatorPreflight!.framingTokenOverhead = 12_000; }));
    const carried = carryProfileBindings(s, [after]);
    expect(carried.backup).toBe(join(s.stateDir, "control.sqlite.bak.1000-1"));
    const router = createExecutionProfileRouter([after], { aliases: carried.aliases });
    expect(router.resolve("budget-estimate", "all", legacyProfileHash(before)).profileHash).toBe(after.profileHash);
    // A bound field changed: the old legacy hash still maps to the old binding, which is not this file's.
    const rebound = resolveProfile(edited((x) => { x.resolved.proofDocumentContentHashes = ["9".repeat(64)]; }));
    const third = carryProfileBindings(s, [rebound]);
    expect(() => createExecutionProfileRouter([rebound], { aliases: third.aliases }).resolve("budget-estimate", "all", legacyProfileHash(before))).toThrow("profile-changed");
  });

  it("notes a changed secret value once, naming the secret, and records nothing for an unchanged one", async () => {
    const s = await store();
    const withSecret = (value: string) => resolveProfile(edited((x) => { x.resolved.secretValueHashes = [{ name: "/a", valueHash: "a".repeat(64) }, { name: "/b", valueHash: value.repeat(64) }]; }));
    expect(carryProfileBindings(s, [withSecret("b")]).notes).toEqual([]);
    const changed = carryProfileBindings(s, [withSecret("c")]);
    expect(changed.notes).toEqual(["orca-control: profile all: secret values changed since the last start: /b"]);
    expect(changed.backup).not.toBe(null);
    expect(carryProfileBindings(s, [withSecret("c")])).toMatchObject({ notes: [], backup: null });
  });
});
