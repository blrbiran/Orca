/**
 * Off-plan writes #346, W4 (plan Task 5): a v4 run stopped because it wrote into a parallel sibling's frozen claim is
 * diagnosed `parallel-claim`, naming the sibling(s) -- the cause Task 6's `retry-task --after <sibling>` and the orca-auto
 * pass key on. Two stops say so: ccloop's denylist gate (`denylist match: <path>`, `denylist match: <key>:<path>` for an
 * extra repository, key relative to the receiving task) and Orca's own harvest bound at collect (`out-of-bounds:<paths>`,
 * `out-of-bounds:<key>:<paths>;...` in a multi-directory group). A stop on a protected path only keeps today's diagnosis,
 * and so does a v3 run (it has no frozen siblings).
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { SiblingClaims } from "../../src/control/parallelClaims.js";
import type { ControlStore } from "../../src/control/store.js";
import { parallelClaimOf } from "../../src/control/parallelClaims.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import type { taskContractSchema } from "../../src/scheduler/planFile.js";

type TaskContract = z.infer<typeof taskContractSchema>;

// The receiver: primary repository plus one extra keyed `web`; `.github/**` is protected, the rest are frozen claims.
const CONTRACT = {
  context: { repoPath: "/r", targetPaths: ["src/a.ts"], additionalRepos: [{ key: "web", repoPath: "/w", targetPaths: ["app.ts"], allowlistPaths: [], denylistPaths: ["**"] }] },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [".github/**", "b.ts", "docs/a:b.md", "src/board/**"], maxFilesTouched: 5, humanGateConditions: [] },
} as unknown as TaskContract;
const SIBLINGS: SiblingClaims[] = [
  { siblingId: "all", claims: [{ repoKey: "web", path: "**" }] },
  { siblingId: "b", claims: [{ repoKey: null, path: "b.ts" }] },
  { siblingId: "board", claims: [{ repoKey: null, path: "src/board/**" }] },
  { siblingId: "colon", claims: [{ repoKey: null, path: "docs/a:b.md" }] },
];

describe("parallelClaimOf: ccloop's denylist stop", () => {
  it("a sibling's exact claim; a near miss is not one", () => {
    // mutation: the repoKey is not compared -> `all`'s claim in `web` also matches the primary's b.ts, red
    expect(parallelClaimOf("denylist match: b.ts", CONTRACT, SIBLINGS)).toEqual({ path: "b.ts", repoKey: null, siblingIds: ["b"] });
    expect(parallelClaimOf("denylist match: b.tsx", CONTRACT, SIBLINGS)).toBe(null);
  });

  it("a sibling's `<dir>/**` claim matches by prefix, as ccloop's matcher does", () => {
    expect(parallelClaimOf("denylist match: src/board/cli.js", CONTRACT, SIBLINGS)).toEqual({ path: "src/board/cli.js", repoKey: null, siblingIds: ["board"] });
    expect(parallelClaimOf("denylist match: src/boardx.js", CONTRACT, SIBLINGS)).toBe(null);
  });

  it("an extra repository's stop is keyed by the receiver's key, and a `:` in a path is not read as a key", () => {
    // `web` is the receiver's own extra key: the path after it may hold a `:` of its own.
    expect(parallelClaimOf("denylist match: web:src/x:y.ts", CONTRACT, SIBLINGS)).toEqual({ path: "src/x:y.ts", repoKey: "web", siblingIds: ["all"] });
    // `docs/a` is no key of the receiver's: the whole is a primary path.
    // mutation: drop the key check (any prefix before `:` is a key) -> repoKey `docs/a`, path `b.md`, no sibling, null, red
    expect(parallelClaimOf("denylist match: docs/a:b.md", CONTRACT, SIBLINGS)).toEqual({ path: "docs/a:b.md", repoKey: null, siblingIds: ["colon"] });
  });

  it("a protected path only is not a parallel claim; nor is any other stop", () => {
    // mutation: drop the protected-path exclusion (a denied path no sibling claims still answers) -> an answer, red
    expect(parallelClaimOf("denylist match: .github/workflows/ci.yml", CONTRACT, SIBLINGS)).toBe(null);
    expect(parallelClaimOf("allowlist miss: b.ts", CONTRACT, SIBLINGS)).toBe(null);
    expect(parallelClaimOf(undefined, CONTRACT, SIBLINGS)).toBe(null);
    expect(parallelClaimOf("denylist match: b.ts", CONTRACT, [])).toBe(null);
  });
});

describe("parallelClaimOf: Orca's harvest bound at collect", () => {
  it("one directory: `out-of-bounds:<paths>`, the first path a sibling claims", () => {
    // mutation: the out-of-bounds form is not read -> null, red
    expect(parallelClaimOf("out-of-bounds:.github/x.yml,src/board/a.ts,b.ts", CONTRACT, SIBLINGS)).toEqual({ path: "src/board/a.ts", repoKey: null, siblingIds: ["board"] });
    expect(parallelClaimOf("out-of-bounds:.github/x.yml", CONTRACT, SIBLINGS)).toBe(null);
    // A primary path holding `:` stays whole: without the multi-directory key there is no key to read.
    expect(parallelClaimOf("out-of-bounds:docs/a:b.md", CONTRACT, SIBLINGS)).toEqual({ path: "docs/a:b.md", repoKey: null, siblingIds: ["colon"] });
  });

  it("multi-directory: `out-of-bounds:<key>:<paths>;...`, the run's first directory is the receiver's primary", () => {
    // mutation: the primary's directory key is not mapped to null -> no claim matches, null, red
    expect(parallelClaimOf("out-of-bounds:main:b.ts", CONTRACT, SIBLINGS, "main")).toEqual({ path: "b.ts", repoKey: null, siblingIds: ["b"] });
    // mutation: segments are not split on `;` -> one segment keyed `main`, path `.github/x;web:src/x:y.ts`, null, red
    expect(parallelClaimOf("out-of-bounds:main:.github/x;web:src/x:y.ts", CONTRACT, SIBLINGS, "main")).toEqual({ path: "src/x:y.ts", repoKey: "web", siblingIds: ["all"] });
    // mutation: a key that is neither the primary's nor the receiver's extra is read as the primary -> b.ts matches, red
    expect(parallelClaimOf("out-of-bounds:other:b.ts", CONTRACT, SIBLINGS, "main")).toBe(null);
  });
});

const LADEN = { groupId: "g", workItemId: "a", taskId: "a", runId: "r1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: null,
  phase: "work" as const, progress: null, providerAttemptOrdinal: 1, failureCode: null };
const run = (drive: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...LADEN, ...extra, drive });
const STOPPED = { blockedAt: "C", blockedReason: "terminal:blocked_waiting_human", stopReason: "denylist match: b" };
const CLAIM = { path: "b", repoKey: null, siblingIds: ["b"] };

// Fix round 1 (controller ruling, Orca session 4389b15f, 2026-11-18): the claim is classified once, when the driver records
// the block, and kept on the drive record (`drive.parallelClaim`); the view reads only that. These criteria replace this
// task's first-round ones, which read the confirmed execution per view. `{}` is a store with no database: any read throws.
describe("readRunDiagnosis reads the claim the driver stored, and nothing else", () => {
  it("a stored claim is parallel-claim naming its siblings, with no store read", () => {
    // mutation: readRunDiagnosis never sets parallel-claim (or drops `siblings`) -> red
    expect(readRunDiagnosis({} as ControlStore, run({ ...STOPPED, parallelClaim: CLAIM })))
      .toEqual({ phase: "work", step: null, cause: "parallel-claim", siblings: ["b"], attempt: 1 });
  });

  it("a run blocked before the claim was stored keeps today's diagnosis (no backfill)", () => {
    expect(readRunDiagnosis({} as ControlStore, run(STOPPED))).toEqual({ phase: "work", step: null, cause: "unknown", attempt: 1 });
  });

  it("the claim wins over observed allowlist misses; an evidence-backed cause stays", () => {
    // A sibling's claim is the reason, so a retry allowing the misses would stop again.
    // mutation: path-policy is decided first -> path-policy, red
    expect(readRunDiagnosis({} as ControlStore, run({ ...STOPPED, parallelClaim: CLAIM, pathPolicyMisses: [{ repoKey: null, path: "x" }] })).cause).toBe("parallel-claim");
    // mutation: parallel-claim overrides any cause -> parallel-claim, red
    expect(readRunDiagnosis({} as ControlStore, run({ ...STOPPED, parallelClaim: CLAIM }, { failureCode: "usage-unsettled" })).cause).toBe("usage-unsettled");
  });
});
