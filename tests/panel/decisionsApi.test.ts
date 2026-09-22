import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recordCorrection } from "../../src/corrections/store.js";
import type { Correction } from "../../src/corrections/schema.js";
import { acquireStoreLock } from "../../src/corrections/storeLock.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { appendEvent } from "../../src/ledger/writer.js";
import { collect } from "../../src/metrics/collect.js";
import { UNRESOLVED_PROJECT_KEYS } from "../../src/metrics/discover.js";
import { DECISION_NOT_FOUND, LIST_FIELDS, detailUrl } from "../../src/panel/listProjection.js";
import { REVIEWS_LOCK_TIMEOUT_MS, acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { readReviews } from "../../src/panel/reviewsStore.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import type { PanelOptions, StartedPanel } from "../../src/panel/server.js";
import { TOKEN_ANCHOR } from "../../src/panel/staticFiles.js";
import { ORIGINAL, git, makeTargetRepo, withCorrectionsDir } from "../corrections/harness.js";

// task 6 ruling H7: file-local copies of metricsApi.test.ts's small HTTP
// helpers, so this file stays isolated from that one -- metricsApi.test.ts is
// untouched and stays 12/12 under this task's diff.
const get = async (started: StartedPanel, path: string, token?: string): Promise<Response> =>
  fetch(`${started.url}${path}`, { headers: { "x-orca-token": token ?? started.token } });

async function makeDistFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "orca-panel-dist-"));
  const dist = join(root, "dist");
  const outside = join(root, "secret");
  await mkdir(dist, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "passwd.txt"), "root:x:0:0\n");
  await writeFile(join(dist, "index.html"), `<!doctype html><html><body>${TOKEN_ANCHOR}</body></html>`);
  await writeFile(join(dist, "index.js"), "console.log(1)\n");
  await symlink(join(outside, "passwd.txt"), join(dist, "linked.txt"));
  return { dir: dist, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/**
 * `opened` is written AFTER the response goes out (spec section 4.3.1), so a
 * criterion reading it back right away can observe it not-yet-landed. A fixed
 * `setTimeout` would make this pass or fail on machine speed; this polls to
 * the condition or a deadline instead.
 */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 2_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("the decisions endpoints (spec sections 4.2 and 4.3.1)", () => {
  it("returns list rows DEEP-EQUAL to the frozen projection, not merely lacking a summary", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        // A second decision in the same ledger, so the deep equality below is
        // over a real list, not a list of one (task 6 ruling H8).
        const second: DecisionEvent = { ...ORIGINAL, id: "orca-dev-1/2", at: "2026-09-01T00:01:00.000Z" };
        await appendEvent(repo.decisionsDir, "orca-dev-1", second);

        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const res = await get(started, "/api/decisions");
          expect(res.status).toBe(200);
          const body = (await res.json()) as { rows: Array<Record<string, unknown>> };

          // 🔴 (fix round 1, review Important I-1 / controller ruling R57)
          // The expected row is built from LIST_FIELDS, NOT by calling
          // projectForList: the earlier form -- `observations.decisions.map(
          // projectForList)` -- was a tautology under mutation L-3b, since the
          // mutation edits projectForList and both sides of the equality would
          // grow a `summary` field together and stay green.
          //
          // A single `toStrictEqual` is now the whole criterion. The earlier
          // draft ALSO kept a per-row `Object.keys(...).sort()` loop, labelled
          // "the load-bearing assertion" on the theory that it alone could
          // catch an extra field a looser equality might miss. Once the
          // tautology above was repaired, that reasoning stopped applying:
          // `expected` no longer moves with the implementation, so ANY extra
          // or missing key already fails the equality first, and review
          // measured that the Object.keys loop never reddens on its own --
          // the criterion always dies at the equality line before reaching
          // it. `toStrictEqual` (not `toEqual`) closes the one gap a plain
          // deep-equal has here too: it also rejects an extra key whose value
          // is `undefined`, which `toEqual` treats as absent.
          const observations = await collect({
            repos: [{ projectKey: "proj", path: repo.path }],
            correctionsDir: dir,
            now: () => new Date().toISOString(),
          });
          const expected = observations.decisions.map((d) =>
            Object.fromEntries(LIST_FIELDS.map((f) => [f, d[f]])),
          );
          expect(body.rows).toStrictEqual(expected);
          expect(body.rows.length).toBeGreaterThan(1);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("records NOTHING when the list is served", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const res = await get(started, "/api/decisions");
          // Positive observation the request actually happened -- "nothing
          // happened" without proof the request happened is empty (ruling H8).
          expect(res.status).toBe(200);
          const body = (await res.json()) as { rows: unknown[] };
          expect(body.rows.length).toBeGreaterThan(0);

          // 🔴 (fix round 1, mutation verifier finding / controller ruling
          // R59) Absence cannot be polled TO COMPLETION -- there is no event
          // that fires when nothing happens -- so this is instead a BOUNDED
          // OBSERVATION WINDOW: mutation L-3 (the list handler also
          // fire-and-forget appends an `opened` row per listed decision) was
          // measured fully green against this criterion's earlier
          // read-immediately-after-the-response form, because the mutated
          // write lands roughly 500ms after the response goes out. The window
          // is sized from the reviews lock's own retry
          // budget, REVIEWS_LOCK_TIMEOUT_MS (1000ms), plus a further 1000ms of
          // margin over that measured ~500ms landing time. `eventually`'s
          // early return only fires when this criterion is ABOUT TO FAIL --
          // when nothing lands, it waits out the whole window before the
          // assertion below runs; when mutation L-3's write is present, this
          // is what gives it time to land before that assertion runs.
          const rows = await eventually(
            () => readReviews(dir),
            (r) => r.length > 0,
            REVIEWS_LOCK_TIMEOUT_MS + 1_000,
          );
          expect(rows).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("records exactly one `opened` when a detail is served, and no `reviewed`", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const fixedNow = (): Date => new Date("2026-09-10T00:00:00.000Z");
      try {
        const opts: PanelOptions = {
          ...parsePanelArgs(["--by", "amy", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
          now: fixedNow,
        };
        const started = await createPanelServer(opts);
        try {
          const res = await get(started, detailUrl("proj", "orca-dev-1/1"));
          expect(res.status).toBe(200);

          // 🔴 Filtered by decisionId, not a total row count (ruling H9): an
          // unfiltered count would let a sibling criterion's rows in this same
          // store make this one flaky-red for a reason that has nothing to do
          // with what it names.
          const mine = (rows: ReviewRow[]) => rows.filter((r) => r.decisionId === "orca-dev-1/1");
          const rows = await eventually(() => readReviews(dir), (r) => mine(r).length === 1);
          expect(mine(rows)).toHaveLength(1);
          expect(mine(rows)[0]).toMatchObject({
            action: "opened",
            by: "amy",
            at: fixedNow().toISOString(),
          });
          expect(mine(rows).filter((r) => r.action === "reviewed")).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("serves the detail while the reviews lock is held, and the failed opened write is only a server-side warning", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const held = await acquireReviewsLock(dir);
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          // 🔴 This asserts res.status === 200, not "how fast". A synchronous
          // write while the lock is held would THROW, and the value that
          // matters is that the status is never anything but 200 for it.
          const res = await get(started, detailUrl("proj", "orca-dev-1/1"));
          expect(res.status).toBe(200);
          expect(((await res.json()) as { decision: { id: string } }).decision.id).toBe("orca-dev-1/1");

          // Budget 3000ms: the reviews lock's own retry budget is 1000ms
          // (REVIEWS_LOCK_TIMEOUT_MS), so the failed write's warning cannot
          // land before that elapses.
          const sawWarning = () =>
            stderrSpy.mock.calls.some(
              (call) =>
                typeof call[0] === "string" &&
                call[0].includes("could not record opened") &&
                call[0].includes("orca-dev-1/1"),
            );
          const seen = await eventually(() => Promise.resolve(sawWarning()), (v) => v, 3_000);
          expect(seen).toBe(true);

          const rows = await readReviews(dir);
          expect(rows.filter((r) => r.decisionId === "orca-dev-1/1")).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        stderrSpy.mockRestore();
        await held.release();
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("serves the detail even when the CORRECTIONS lock is held", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      const held = await acquireStoreLock(dir);
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const res = await get(started, detailUrl("proj", "orca-dev-1/1"));
          expect(res.status).toBe(200);
          expect(((await res.json()) as { decision: { id: string } }).decision.id).toBe("orca-dev-1/1");
        } finally {
          await started.close();
        }
      } finally {
        await held.release();
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("answers 404 for a decision it has never seen, and for a known id under an unconfigured projectKey", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          const neverSeen = await get(started, detailUrl("proj", "orca-dev-1/999"));
          expect(neverSeen.status).toBe(404);
          expect(((await neverSeen.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);

          const unconfigured = await get(started, detailUrl("some-other-project", "orca-dev-1/1"));
          expect(unconfigured.status).toBe(404);
          expect(((await unconfigured.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);

          // A 404 records nothing.
          expect(await readReviews(dir)).toHaveLength(0);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });

  it("returns each repository's own row when two repositories share a decision id", async () => {
    await withCorrectionsDir(async (dir) => {
      const repoA = await makeTargetRepo();
      const repoB = await makeTargetRepo({ remote: "https://github.com/biran/orca-b.git", seedDecision: false });
      const dist = await makeDistFixture();
      try {
        const bDecision: DecisionEvent = { ...ORIGINAL, question: "用哪种缓存" };
        await appendEvent(repoB.decisionsDir, "orca-dev-1", bDecision);
        await git(repoB.path, ["add", "-A"]);
        await git(repoB.path, ["commit", "-m", "seed b's own decision with the same id"]);

        const started = await createPanelServer(
          parsePanelArgs(
            [
      // Assembly plan Task 1 / design spec section 4: two --repo flags leave no project key to name a
      // control state directory after, so this multi-repository panel says it is not running work.
      // Argument list only; no assertion in this file moved.
      "--no-control",
      "--by", "tester", "--repo", `proj-a=${repoA.path}`, "--repo", `proj-b=${repoB.path}`, "--dist", dist.dir,
    ],
            { ORCA_CORRECTIONS_DIR: dir },
          ),
        );
        try {
          const resA = await get(started, detailUrl("proj-a", "orca-dev-1/1"));
          expect(resA.status).toBe(200);
          const bodyA = (await resA.json()) as { decision: { question: string } };
          expect(bodyA.decision.question).toBe(ORIGINAL.question);

          const resB = await get(started, detailUrl("proj-b", "orca-dev-1/1"));
          expect(resB.status).toBe(200);
          const bodyB = (await resB.json()) as { decision: { question: string } };
          expect(bodyB.decision.question).toBe("用哪种缓存");
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repoA.cleanup();
        await repoB.cleanup();
      }
    });
  });

  it("answers the detail with the gate's refusal when the gate is broken", async () => {
    await withCorrectionsDir(async (dir) => {
      const repo = await makeTargetRepo();
      const dist = await makeDistFixture();
      try {
        const started = await createPanelServer(
          parsePanelArgs(["--by", "tester", "--repo", `proj=${repo.path}`, "--dist", dist.dir], {
            ORCA_CORRECTIONS_DIR: dir,
          }),
        );
        try {
          // Recorded AFTER the server is up (same shape as metricsApi.test.ts's
          // broken-gate criterion): this proves the gate is re-evaluated per
          // request, not cached from startup.
          const ghost: Correction = {
            id: "ghost-correction-decision-detail",
            projectKey: "unresolvable-ghost-project",
            decisionId: "ghost-run/1",
            kind: "wrong",
            because: "unresolved on purpose, to prove the detail endpoint honours the gate",
            at: "2026-09-05T00:00:00.000Z",
            by: "tester",
          };
          await recordCorrection(dir, ghost, { again: false });

          const res = await get(started, detailUrl("proj", "orca-dev-1/1"));
          expect(res.status).toBe(409);
          const body = (await res.json()) as Record<string, unknown>;
          expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS);
          expect("decision" in body).toBe(false);
        } finally {
          await started.close();
        }
      } finally {
        await dist.cleanup();
        await repo.cleanup();
      }
    });
  });
});
