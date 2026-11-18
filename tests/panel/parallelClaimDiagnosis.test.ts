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
import { parallelClaimOf, readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import type { taskContractSchema } from "../../src/scheduler/planFile.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

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
const STOPPED = { blockedAt: "C", blockedReason: "terminal:blocked_waiting_human" };

describe("readRunDiagnosis: a stop on a frozen sibling claim is parallel-claim", { timeout: 60_000 }, () => {
  it("v4: ccloop's denylist stop and Orca's out-of-bounds stop on b's claim name b; a protected path does not", async () => {
    // a and b run in parallel: b's claim `b` is frozen into a's denylist; `.env` is a's own protected path.
    const t = await driverHarness([{ taskId: "a", safetyPolicy: { denylistPaths: [".env"] } }, { taskId: "b" }]); try {
      // mutation: readRunDiagnosis never sets parallel-claim (or drops `siblings`) -> red
      expect(readRunDiagnosis(t.h.store, run({ ...STOPPED, stopReason: "denylist match: b" })))
        .toEqual({ phase: "work", step: null, cause: "parallel-claim", siblings: ["b"], attempt: 1 });
      // mutation: only stopReason is read (blockedReason's out-of-bounds form is not) -> unknown, red
      expect(readRunDiagnosis(t.h.store, run({ blockedAt: "C", blockedReason: "out-of-bounds:b" })))
        .toEqual({ phase: "work", step: null, cause: "parallel-claim", siblings: ["b"], attempt: 1 });
      // A multi-directory run's form, keyed by its first directory (its primary).
      // mutation: the run's drive.dirs[0].key is not passed -> `main:b` read as one primary path, unknown, red
      expect(readRunDiagnosis(t.h.store, run({ blockedAt: "C", blockedReason: "out-of-bounds:main:b", dirs: [{ key: "main" }] })).siblings).toEqual(["b"]);
      expect(readRunDiagnosis(t.h.store, run({ ...STOPPED, stopReason: "denylist match: .env" }))).toEqual({ phase: "work", step: null, cause: "unknown", attempt: 1 });
      // A sibling's claim is the reason, so it wins over observed allowlist misses (a retry allowing them would stop again).
      // mutation: path-policy is decided first -> path-policy, red
      expect(readRunDiagnosis(t.h.store, run({ ...STOPPED, stopReason: "denylist match: b", pathPolicyMisses: [{ repoKey: null, path: "x" }] })).cause).toBe("parallel-claim");
      // A cause already read from evidence stays.
      // mutation: parallel-claim overrides any cause -> parallel-claim, red
      expect(readRunDiagnosis(t.h.store, run({ ...STOPPED, stopReason: "denylist match: b" }, { failureCode: "usage-unsettled" })).cause).toBe("usage-unsettled");
    } finally { await t.h.dispose(); }
  });

  it("v3: a denylist stop on the same path keeps today's cause (a v3 task has no frozen siblings)", async () => {
    const t = await driverHarness([{ taskId: "a", safetyPolicy: { allowlistPaths: ["a"], denylistPaths: ["b"] } }, { taskId: "b" }]); try {
      expect(readRunDiagnosis(t.h.store, run({ ...STOPPED, stopReason: "denylist match: b" }))).toEqual({ phase: "work", step: null, cause: "unknown", attempt: 1 });
    } finally { await t.h.dispose(); }
  });

  it("a group with no confirmed execution answers unknown, never throws", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b" }]); try {
      // mutation: the confirmed-execution read is not guarded -> throws group-state-invalid, red
      expect(readRunDiagnosis(h.store, run({ ...STOPPED, stopReason: "denylist match: b" })).cause).toBe("unknown");
    } finally { await h.dispose(); }
  });

  it("a stop of no claim-bearing shape reads no confirmed execution", () => {
    // `{}` has no database: any read throws a TypeError, which the guard does not swallow.
    // mutation: the read is not gated on the stop's shape -> TypeError, red
    expect(readRunDiagnosis({} as ControlStore, run({ ...STOPPED, stopReason: "allowlist miss: b" })).cause).toBe("unknown");
    expect(readRunDiagnosis({} as ControlStore, run({ ...STOPPED, stopReason: "denylist match: b" }, { taskId: null })).cause).toBe("unknown");
  });
});
