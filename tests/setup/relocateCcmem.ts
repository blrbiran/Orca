import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { ccmemRootDiff, ccmemRootNames } from "./ccmemRoot.js";

/**
 * Spec §6.2 (memory tab), CLAUDE.md Rule 17. Layer 1: every test file runs with CCMEM_DATA_ROOT in a temp directory,
 * so a child that inherits process.env lands there. Layer 3: the real data root's names are compared after the file,
 * flagging only what §10 D2 names. Its blind spot is registered in the spec: opening an existing database without
 * migrating it changes no name. Layer 2 (the adapter has no default path) is what covers that.
 */
const relocated = mkdtempSync(join(tmpdir(), "orca-ccmem-"));
process.env.CCMEM_DATA_ROOT = relocated;

const REAL_ROOT = join(homedir(), ".claude", "ccmem");
const before = ccmemRootNames(REAL_ROOT);

afterAll(() => {
  rmSync(relocated, { recursive: true, force: true });
  expect(ccmemRootDiff(before, ccmemRootNames(REAL_ROOT)), "this test file changed the real ~/.claude/ccmem (Rule 17)").toEqual([]);
});
