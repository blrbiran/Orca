import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistRecoveryArtifact, prepareRecoverySource } from "../../src/control/savedResultRecoveryPackage.js";
import { openTestStore } from "./fixtures/store.js";

// Issue #261: ccloop (and Orca's own assertPrivateRecoveryDirectory) accept a saved-result package only at a canonical
// path. On macOS the default TMPDIR is /var/folders/..., which resolves to /private/var/..., so a package built under the
// literal tmpdir() was refused `saved-result-package-path-invalid` for every eligibility check. The paired tests force a
// TMPDIR with no symlink in it, which hid this; this criterion runs in the plain suite with a TMPDIR reached through a link.
describe("saved-result source package path (#261)", () => {
  it("builds the package at a canonical path when TMPDIR is reached through a symlink", async () => {
    const h = await openTestStore();
    const outer = await realpath(await mkdtemp(join(tmpdir(), "orca-261-")));
    const real = join(outer, "real"), link = join(outer, "link");
    const oldTmp = process.env.TMPDIR;
    try {
      await mkdir(real, { mode: 0o700 });
      await symlink(real, link);
      const ref = persistRecoveryArtifact(h.store, { probe: 261 });
      process.env.TMPDIR = link;
      expect(tmpdir()).toBe(link);
      const prepared = prepareRecoverySource(h.store, ref, "execution-format-failure-v1");
      try {
        expect(prepared.packagePath.startsWith(real + "/")).toBe(true);
        expect(await realpath(prepared.packagePath)).toBe(prepared.packagePath);
        expect(await readdir(prepared.packagePath)).toContain("package.json");
      } finally { prepared.dispose(); }
    } finally {
      if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
      await rm(outer, { recursive: true, force: true });
      await h.dispose();
    }
  });
});
