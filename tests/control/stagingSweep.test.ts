// Tester #364 (b): `<stateDir>/staging` holds an artifact publication's temp files and staged directories (archive.ts,
// snapshot.ts). A publication's own `finally` removes them (#364 a), but a killed panel (SIGKILL mid-archive) never runs
// it, so they stayed for ever (in the field 13,323 entries, 447 MB). Opening the store -- the panel's start -- now removes
// every staging entry, once the store's service lock is this process's: archives write staging only through an open
// store, a second open of the same state directory is refused while one is open, and a previous owner is proved dead
// before its lock is retired. So no live archive can own an entry when the sweep runs.
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { stagingSweepLine, sweepStaging } from "../../src/control/stagingSweep.js";

function stateRoot(): { root: string; stateDir: string; staging: string; dispose: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-sweep-")));
  const stateDir = join(root, "state");
  return { root, stateDir, staging: join(stateDir, "staging"), dispose: () => rmSync(root, { recursive: true, force: true }) };
}
/** What a killed archive leaves: a temp file (archiveFile/writeArtifact), a staged directory (publish), a bundle (snapshot). */
function leftovers(staging: string): void {
  mkdirSync(join(staging, "0b6f-staged"), { recursive: true, mode: 0o700 });
  writeFileSync(join(staging, "0b6f-staged", "data"), Buffer.alloc(300), { mode: 0o600 });
  writeFileSync(join(staging, "1c2d-temp"), Buffer.alloc(200), { mode: 0o600 });
  writeFileSync(join(staging, "2e3f.bundle"), Buffer.alloc(100), { mode: 0o600 });
}

describe("staging entries a killed archive left are removed when the store opens (#364 b)", () => {
  it("removes every entry, counts entries and bytes, and an empty staging stays empty", async () => {
    const s = stateRoot();
    try {
      mkdirSync(s.stateDir, { mode: 0o700 }); mkdirSync(s.staging, { mode: 0o700 });
      leftovers(s.staging);
      const store = await openControlStore({ stateDir: s.stateDir, recovery: true });
      try {
        // mutation: drop the sweep from openControlStore -> 3 entries, red
        expect(readdirSync(s.staging)).toEqual([]);
        expect(store.stagingSweep).toEqual({ removed: 3, bytes: 600, left: 0, failed: 0, skipped: null });
        // The panel's one start-up line (controlAssembly.ts), with the counts; none when there was nothing.
        expect(stagingSweepLine("/s/staging", store.stagingSweep!)).toBe("orca-panel: removed 3 entries (600 bytes) an interrupted archive left in /s/staging\n");
      } finally { store.close(); }
      const again = await openControlStore({ stateDir: s.stateDir, recovery: true });
      try {
        expect(again.stagingSweep).toEqual({ removed: 0, bytes: 0, left: 0, failed: 0, skipped: null });
        expect(stagingSweepLine("/s/staging", again.stagingSweep!)).toBeNull();
      } finally { again.close(); }
    } finally { s.dispose(); }
  });

  it("never runs while another open store (a live archive's) holds the state directory", async () => {
    const s = stateRoot();
    try {
      const live = await openControlStore({ stateDir: s.stateDir, recovery: true });
      try {
        // An archive in flight in the live store: its temp file in staging.
        mkdirSync(s.staging, { recursive: true, mode: 0o700 });
        writeFileSync(join(s.staging, "in-flight"), "bytes", { mode: 0o600 });
        // A second panel on the same state directory is refused (its owner is alive) and must not have swept first.
        await expect(openControlStore({ stateDir: s.stateDir, recovery: true })).rejects.toMatchObject({ code: "control-writer-active" });
        // mutation: sweep before the service lock is taken -> in-flight removed, red
        expect(readdirSync(s.staging)).toEqual(["in-flight"]);
      } finally { live.close(); }
    } finally { s.dispose(); }
  });

  it("never follows a symlink out of staging: a link entry goes, its target stays; a staging that is a link is not swept", () => {
    const s = stateRoot();
    try {
      const outside = join(s.root, "outside");
      mkdirSync(outside); writeFileSync(join(outside, "keep"), Buffer.alloc(5000));
      mkdirSync(s.staging, { recursive: true });
      symlinkSync(outside, join(s.staging, "link-to-outside"));
      // mutation: size entries with stat (follows the link) -> bytes 5000, red
      expect(sweepStaging(s.stateDir)).toEqual({ removed: 1, bytes: 0, left: 0, failed: 0, skipped: null });
      expect(readdirSync(outside)).toEqual(["keep"]);
      rmSync(s.staging, { recursive: true });
      symlinkSync(outside, s.staging);
      // mutation: drop the staging-is-a-link guard -> readdir through the link removes outside/keep, red
      expect(sweepStaging(s.stateDir)).toEqual({ removed: 0, bytes: 0, left: 0, failed: 0, skipped: "staging-not-a-directory" });
      expect(readdirSync(outside)).toEqual(["keep"]);
      expect(lstatSync(s.staging).isSymbolicLink()).toBe(true);
    } finally { s.dispose(); }
  });

  it("is bounded: at most maxEntries per start, the rest counted as left for the next", () => {
    const s = stateRoot();
    try {
      mkdirSync(s.staging, { recursive: true });
      for (let i = 0; i < 5; i += 1) writeFileSync(join(s.staging, `t-${i}`), Buffer.alloc(10));
      // mutation: ignore the bound -> removed 5, left 0, red
      expect(sweepStaging(s.stateDir, 3)).toEqual({ removed: 3, bytes: 30, left: 2, failed: 0, skipped: null });
      expect(readdirSync(s.staging)).toHaveLength(2);
      // No staging directory at all: nothing to do.
      rmSync(s.staging, { recursive: true });
      expect(sweepStaging(s.stateDir)).toEqual({ removed: 0, bytes: 0, left: 0, failed: 0, skipped: null });
    } finally { s.dispose(); }
  });
});
