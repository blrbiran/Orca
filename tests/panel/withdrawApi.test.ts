import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withdrawalsFile } from "../../src/corrections/paths.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import type { NewCorrectionInput } from "../../src/corrections/record.js";
import type { Correction } from "../../src/corrections/schema.js";
import { CORRECTION_NOT_FOUND, CORRECTION_TARGET_NOT_A_DECISION } from "../../src/corrections/store.js";
import { CORRECTIONS_STORE_BUSY, acquireStoreLock } from "../../src/corrections/storeLock.js";
import {
  CORRECTION_ALREADY_WITHDRAWN,
  CORRECTION_CLOSED,
  CORRECTION_NOT_YOURS,
  CORRECTION_WITHDRAWALS_UNREADABLE,
} from "../../src/corrections/withdrawals.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { appendEvent } from "../../src/ledger/writer.js";
import { REVIEW_HAS_OPEN_CORRECTION, REVIEW_NOT_ACTIVE } from "../../src/panel/api.js";
import { DECISION_NOT_FOUND } from "../../src/panel/listProjection.js";
import { reviewsFile } from "../../src/panel/paths.js";
import { REVIEWS_STORE_BUSY, acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { ORIGINAL, git, makeTargetRepo, withCorrectionsDir } from "../corrections/harness.js";
import type { TargetRepo } from "../corrections/harness.js";
import { sessionFor } from "./fixtures/auth.js";

/**
 * Decisions review withdraw spec §4.4, §5.2, §5.4, §5.5: the two withdraw routes and the review state the detail
 * answers. Same harness shape as correctApi.test.ts / decisionsApi.test.ts (one server, one ORCA_CORRECTIONS_DIR and
 * one target repo per `it`), file-local so those files stay untouched.
 */
const get = async (started: StartedPanel, path: string): Promise<Response> => (await sessionFor(started)).fetch(path);

const post = async (started: StartedPanel, path: string, body: unknown): Promise<Response> =>
  (await sessionFor(started)).fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function makeDistFixture(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "orca-panel-dist-"));
  const dist = join(root, "dist");
  const outside = join(root, "secret");
  await mkdir(dist, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "passwd.txt"), "root:x:0:0\n");
  await writeFile(join(dist, "index.html"), "<!doctype html><html><body></body></html>");
  await writeFile(join(dist, "index.js"), "console.log(1)\n");
  await symlink(join(outside, "passwd.txt"), join(dist, "linked.txt"));
  return { dir: dist, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const PK = "proj";
const D1 = ORIGINAL.id; // "orca-dev-1/1"
const D2 = "orca-dev-1/2";
const ME = "tester";

/** A clock the criterion moves by hand, so every `at` in an answer is a value the criterion chose. */
class Clock {
  private ms = Date.parse("2026-10-01T00:00:00.000Z");
  now = (): Date => new Date(this.ms);
  iso = (): string => new Date(this.ms).toISOString();
  tick = (): string => {
    this.ms += 60_000;
    return this.iso();
  };
}

interface Ctx {
  started: StartedPanel;
  dir: string;
  repo: TargetRepo;
  clock: Clock;
}

/**
 * Two high-tier decisions (D1 from the fixture, D2 added here). `seed` runs before the server starts, because the
 * reviews writer loads its state once at startup.
 */
async function withPanel(
  fn: (ctx: Ctx) => Promise<void>,
  seed: (ctx: Omit<Ctx, "started">) => Promise<void> = async () => {},
): Promise<void> {
  await withCorrectionsDir(async (dir) => {
    const repo = await makeTargetRepo();
    const dist = await makeDistFixture();
    try {
      const second: DecisionEvent = { ...ORIGINAL, id: D2, at: "2026-09-01T00:01:00.000Z" };
      await appendEvent(repo.decisionsDir, "orca-dev-1", second);
      await git(repo.path, ["add", "-A"]);
      await git(repo.path, ["commit", "-m", "seed a second decision"]);
      const clock = new Clock();
      await seed({ dir, repo, clock });
      const opts = parsePanelArgs(["--by", ME, "--repo", `${PK}=${repo.path}`, "--dist", dist.dir], {
        ...process.env,
        ORCA_CORRECTIONS_DIR: dir,
      });
      const started = await createPanelServer({ ...opts, now: clock.now });
      try {
        await fn({ started, dir, repo, clock });
      } finally {
        await started.close();
      }
    } finally {
      await dist.cleanup();
      await repo.cleanup();
    }
  });
}

/** A correction recorded straight into the store (not through the panel): someone else's, or a pending-target one. */
async function seedCorrection(dir: string, clock: Clock, input: Partial<NewCorrectionInput>, again = false): Promise<Correction> {
  const row = correctionRowFrom(
    { projectKey: PK, decisionId: D1, kind: "wrong", because: "seeded", by: ME, ...input } as NewCorrectionInput,
    () => new Date(clock.tick()),
  );
  return recordNewCorrection(dir, row, { again });
}

/**
 * Closes a correction the way metrics see a close: an overturned row naming it in a ledger file. Written raw, as
 * tests/metrics/buildFixture.ts does, because the ledger writer wants the replacement decision in the same file and
 * this criterion only needs the overturned row `currentMetrics` scans for.
 */
async function closeInLedger(repo: TargetRepo, correction: Correction, at: string): Promise<void> {
  const row = {
    ev: "overturned",
    id: correction.decisionId,
    correctionId: correction.id,
    replacedBy: "orca-fix-1/1",
    at,
    run: "orca-fix-1",
  };
  await appendFile(join(repo.decisionsDir, "orca-fix-1.jsonl"), `${JSON.stringify(row)}\n`);
}

const readOr = (path: string): Promise<string> => readFile(path, "utf8").catch(() => "<absent>");

interface ReviewState {
  reviewers: Array<{ by: string; at: string }>;
  mine: "reviewed" | "none";
  corrections: Array<Record<string, unknown>>;
}

async function detail(started: StartedPanel, decisionId = D1): Promise<ReviewState> {
  const res = await get(started, `/api/decision?projectKey=${encodeURIComponent(PK)}&decisionId=${encodeURIComponent(decisionId)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { review: ReviewState }).review;
}

async function todoIds(started: StartedPanel): Promise<string[]> {
  const res = await get(started, "/api/todo");
  expect(res.status).toBe(200);
  return ((await res.json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
}

async function correct(started: StartedPanel, again = false, because = "前提不成立"): Promise<Correction> {
  const res = await post(started, "/api/corrections", { projectKey: PK, decisionId: D1, kind: "wrong", because, again });
  expect(res.status).toBe(200);
  return ((await res.json()) as { correction: Correction }).correction;
}

describe("GET /api/decision's review state (spec §4.4, §5.3, §7)", () => {
  it("answers no reviewers, mine none and no corrections for an untouched decision", async () => {
    await withPanel(async ({ started }) => {
      expect(await detail(started)).toStrictEqual({ reviewers: [], mine: "none", corrections: [] });
    });
  });

  it("lists each ACTIVE reviewer with the at of their LATEST reviewed row, and mine for the caller only", async () => {
    await withPanel(
      async ({ started, clock }) => {
        const t1 = clock.tick();
        expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
        expect((await detail(started)).reviewers).toStrictEqual([
          { by: "amy", at: "2026-09-20T00:00:00.000Z" },
          { by: ME, at: t1 },
        ]);
        expect((await detail(started)).mine).toBe("reviewed");

        clock.tick();
        expect((await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 })).status).toBe(200);
        // A withdrawn reviewer leaves the list; another person's agree stays (spec §4.4's last line).
        expect(await detail(started)).toStrictEqual({
          reviewers: [{ by: "amy", at: "2026-09-20T00:00:00.000Z" }],
          mine: "none",
          corrections: [],
        });

        // Re-review: the at is the latest reviewed row's, not the first one's.
        const t3 = clock.tick();
        expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
        expect((await detail(started)).reviewers).toStrictEqual([
          { by: "amy", at: "2026-09-20T00:00:00.000Z" },
          { by: ME, at: t3 },
        ]);
        expect(t3).not.toBe(t1);
      },
      async ({ dir }) => {
        // amy reviewed D1 and withdrew D2 — rows the panel itself never wrote.
        await mkdir(dir, { recursive: true });
        const rows = [
          { decisionId: D1, projectKey: PK, action: "reviewed", by: "amy", at: "2026-09-20T00:00:00.000Z" },
          { decisionId: D2, projectKey: PK, action: "reviewed", by: "amy", at: "2026-09-20T00:01:00.000Z" },
          { decisionId: D2, projectKey: PK, action: "withdrawn", by: "amy", at: "2026-09-20T00:02:00.000Z" },
        ];
        await writeFile(reviewsFile(dir), rows.map((r) => `${JSON.stringify(r)}\n`).join(""), { mode: 0o600 });
      },
    );
  });

  it("lists this decision's corrections in file order with state open / withdrawn / closed, mine and withdrawable", async () => {
    let amys: Correction;
    let closedMine: Correction;
    await withPanel(
      async ({ started, repo, clock }) => {
        const open = await correct(started, true, "第一条");
        expect((await detail(started)).mine).toBe("reviewed");
        const toWithdraw = await correct(started, true, "第二条");
        clock.tick();
        const res = await post(started, "/api/corrections/withdraw", { correctionId: toWithdraw.id });
        expect(res.status).toBe(200);
        await closeInLedger(repo, closedMine, clock.tick());
        // Spec §5.2's accepted window: a close landing after the withdrawal leaves both marks; withdrawn wins.
        await closeInLedger(repo, toWithdraw, clock.tick());

        const row = (c: Correction, state: string, mine: boolean, withdrawable: boolean) => ({
          id: c.id,
          kind: c.kind,
          because: c.because,
          ...(c.chose_instead === undefined ? {} : { chose_instead: c.chose_instead }),
          by: c.by,
          at: c.at,
          state,
          mine,
          withdrawable,
        });
        expect((await detail(started)).corrections).toStrictEqual([
          row(amys, "open", false, false),
          row(closedMine, "closed", true, false),
          row(open, "open", true, true),
          row(toWithdraw, "withdrawn", true, false),
        ]);
        // Only D1's corrections: D2's detail lists none.
        expect((await detail(started, D2)).corrections).toStrictEqual([]);
      },
      async ({ dir, clock }) => {
        amys = await seedCorrection(dir, clock, { by: "amy", kind: "not_my_taste", chose_instead: "文件租约" });
        closedMine = await seedCorrection(dir, clock, { because: "已闭环" });
      },
    );
  });
});

describe("POST /api/reviews/withdraw (spec §4.4)", () => {
  it("withdraws the caller's review: the decision is back on /api/todo and unreviewed in /api/decisions", async () => {
    await withPanel(async ({ started }) => {
      expect(await todoIds(started)).toStrictEqual([D1, D2]);
      expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
      expect(await todoIds(started)).toStrictEqual([D2]);

      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ result: "written" });
      expect(await todoIds(started)).toStrictEqual([D1, D2]);
      const list = (await (await get(started, "/api/decisions")).json()) as { rows: Array<{ id: string; reviewed: boolean }> };
      expect(list.rows.find((r) => r.id === D1)?.reviewed).toBe(false);
    });
  });

  it("refuses 409 review-not-active when the caller has nothing to withdraw, and writes nothing", async () => {
    await withPanel(async ({ started, dir }) => {
      const before = await readOr(reviewsFile(dir));
      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe(REVIEW_NOT_ACTIVE);
      expect(await readOr(reviewsFile(dir))).toBe(before);

      // And after a withdraw: a second withdraw has nothing active either.
      expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
      expect((await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 })).status).toBe(200);
      const after = await readOr(reviewsFile(dir));
      const again = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(again.status).toBe(409);
      expect(((await again.json()) as { code: string }).code).toBe(REVIEW_NOT_ACTIVE);
      expect(await readOr(reviewsFile(dir))).toBe(after);
    });
  });

  it("refuses 409 review-has-open-correction while the caller's own correction is open, and the decision stays reviewed", async () => {
    await withPanel(async ({ started, dir }) => {
      await correct(started);
      const before = await readOr(reviewsFile(dir));
      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe(REVIEW_HAS_OPEN_CORRECTION);
      expect(await readOr(reviewsFile(dir))).toBe(before);
      expect((await detail(started)).mine).toBe("reviewed");
    });
  });

  it("is not blocked by someone else's open correction, nor by the caller's withdrawn or closed one", async () => {
    let closedMine: Correction;
    await withPanel(
      async ({ started, repo, clock }) => {
        const mine = await correct(started, true);
        expect((await post(started, "/api/corrections/withdraw", { correctionId: mine.id })).status).toBe(200);
        await closeInLedger(repo, closedMine, clock.tick());
        expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);

        const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
        expect(res.status).toBe(200);
        expect(await res.json()).toStrictEqual({ result: "written" });
        expect((await detail(started)).mine).toBe("none");
      },
      async ({ dir, clock }) => {
        await seedCorrection(dir, clock, { by: "amy" });
        closedMine = await seedCorrection(dir, clock, { because: "已闭环" });
      },
    );
  });

  it("withdraws a review a second panel process (same --by) wrote after this one loaded: the refusal re-reads the file first", async () => {
    await withPanel(async ({ started, dir, clock }) => {
      // Another process's writer: appends never change the file's identity, so this server's writer is not told.
      const other = new ReviewsWriter(dir);
      await other.load();
      expect(await other.append({ decisionId: D1, projectKey: PK, action: "reviewed", by: ME, at: clock.tick() })).toBe("written");
      // The detail reads the disk: it says reviewed, so the web disables Agree and offers Withdraw review.
      expect((await detail(started)).mine).toBe("reviewed");

      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({ result: "written" });
      expect((await detail(started)).mine).toBe("none");
    });
  });

  it("answers 409 correction-withdrawals-unreadable (not 500) when the withdrawals file has a bad line, writing nothing", async () => {
    await withPanel(async ({ started, dir }) => {
      expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
      await appendFile(withdrawalsFile(dir), "{not json\n");
      const before = await readOr(reviewsFile(dir));

      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: D1 });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe(CORRECTION_WITHDRAWALS_UNREADABLE);
      expect(body.message).toMatch(/^The correction withdrawals file cannot be read/);
      expect(await readOr(reviewsFile(dir))).toBe(before);
      expect((await detail(started)).mine).toBe("reviewed");
    });
  });

  it("answers 404 decision-not-found for a decision the panel does not list, writing nothing", async () => {
    await withPanel(async ({ started, dir }) => {
      const res = await post(started, "/api/reviews/withdraw", { projectKey: PK, decisionId: "orca-dev-1/99" });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);
      expect(await readOr(reviewsFile(dir))).toBe("<absent>");
    });
  });
});

describe("POST /api/corrections/withdraw (spec §5.2, §5.4, §5.5)", () => {
  it("agree, then correct, then withdraw the correction: review written, the decision unreviewed again", async () => {
    await withPanel(async ({ started, dir }) => {
      expect((await post(started, "/api/reviews", { projectKey: PK, decisionId: D1 })).status).toBe(200);
      const c = await correct(started);
      const correctionsBefore = await readFile(join(dir, "corrections.jsonl"));

      const res = await post(started, "/api/corrections/withdraw", { correctionId: c.id });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { withdrawal: Record<string, unknown>; review: string };
      expect(body.review).toBe("written");
      expect(body.withdrawal).toStrictEqual({ correctionId: c.id, projectKey: PK, by: ME, at: body.withdrawal.at });
      expect(await todoIds(started)).toContain(D1);
      expect((await detail(started)).mine).toBe("none");
      // Append-only: corrections.jsonl is byte-identical across the withdrawal.
      expect((await readFile(join(dir, "corrections.jsonl"))).equals(correctionsBefore)).toBe(true);
      const reviewRows = (await readFile(reviewsFile(dir), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { action: string });
      // detail() appends an "opened" row after answering, un-awaited, so it may land last: read the last review-state row.
      expect(reviewRows.filter((r) => r.action !== "opened").at(-1)?.action).toBe("withdrawn");
    });
  });

  it("two open corrections (the second via again), withdraw one: review skipped, the decision still reviewed", async () => {
    await withPanel(async ({ started, dir }) => {
      const first = await correct(started);
      await correct(started, true, "另一条");
      const reviewsBefore = await readFile(reviewsFile(dir), "utf8");

      const res = await post(started, "/api/corrections/withdraw", { correctionId: first.id });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { review: string }).review).toBe("skipped");
      expect(await readFile(reviewsFile(dir), "utf8")).toBe(reviewsBefore);
      expect((await detail(started)).mine).toBe("reviewed");
      expect(await todoIds(started)).not.toContain(D1);
    });
  });

  it("skips the review when the caller's state is not reviewed (they withdrew it some other way)", async () => {
    let seeded: Correction;
    await withPanel(
      async ({ started, dir }) => {
        const reviewsBefore = await readOr(reviewsFile(dir));
        const res = await post(started, "/api/corrections/withdraw", { correctionId: seeded.id });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { review: string }).review).toBe("skipped");
        expect(await readOr(reviewsFile(dir))).toBe(reviewsBefore);
      },
      async ({ dir, clock }) => {
        // Recorded straight into the store: no reviewed row came with it.
        seeded = await seedCorrection(dir, clock, {});
      },
    );
  });

  it("withdraws the review with the correction when a second panel process (same --by) wrote that review", async () => {
    let seeded: Correction;
    await withPanel(
      async ({ started, dir, clock }) => {
        const other = new ReviewsWriter(dir);
        await other.load();
        expect(await other.append({ decisionId: D1, projectKey: PK, action: "reviewed", by: ME, at: clock.tick() })).toBe("written");

        const res = await post(started, "/api/corrections/withdraw", { correctionId: seeded.id });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { review: string }).review).toBe("written");
        expect((await detail(started)).mine).toBe("none");
      },
      async ({ dir, clock }) => {
        seeded = await seedCorrection(dir, clock, {});
      },
    );
  });

  it("answers 409 naming both when the withdrawal landed but the review could not be withdrawn with it", async () => {
    await withPanel(async ({ started, dir }) => {
      const c = await correct(started);
      const reviewsBefore = await readFile(reviewsFile(dir), "utf8");
      const held = await acquireReviewsLock(dir);
      let res: Response;
      try {
        res = await post(started, "/api/corrections/withdraw", { correctionId: c.id });
      } finally {
        await held.release();
      }
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; message: string; withdrawal?: { correctionId: string } };
      expect(body.code).toBe(REVIEWS_STORE_BUSY);
      expect(body.message).toContain(c.id);
      expect(body.withdrawal?.correctionId).toBe(c.id);
      // The withdrawal is on disk; the review is not withdrawn.
      expect(await readFile(withdrawalsFile(dir), "utf8")).toContain(c.id);
      expect(await readFile(reviewsFile(dir), "utf8")).toBe(reviewsBefore);
      expect((await detail(started)).mine).toBe("reviewed");
    });
  });

  it("answers each Task 3 refusal with its code over HTTP, and writes no withdrawal", async () => {
    let amys: Correction;
    let pending: Correction;
    let closed: Correction;
    await withPanel(
      async ({ started, dir, repo, clock }) => {
        // again: the seeded `closed` row is the caller's open correction on D1 until the ledger closes it.
        const mine = await correct(started, true);
        expect((await post(started, "/api/corrections/withdraw", { correctionId: mine.id })).status).toBe(200);
        await closeInLedger(repo, closed, clock.tick());

        const expectRefusal = async (correctionId: string, status: number, code: string): Promise<void> => {
          const before = await readOr(withdrawalsFile(dir));
          const res = await post(started, "/api/corrections/withdraw", { correctionId });
          const body = (await res.json()) as { code: string; message: string };
          expect({ status: res.status, code: body.code }).toStrictEqual({ status, code });
          // The panel's own sentence: never the CLI's flags.
          expect(body.message).not.toMatch(/--/);
          expect(await readOr(withdrawalsFile(dir))).toBe(before);
        };
        await expectRefusal("c_nosuchid", 404, CORRECTION_NOT_FOUND);
        await expectRefusal(pending.id, 409, CORRECTION_TARGET_NOT_A_DECISION);
        await expectRefusal(amys.id, 409, CORRECTION_NOT_YOURS);
        await expectRefusal(mine.id, 409, CORRECTION_ALREADY_WITHDRAWN);
        await expectRefusal(closed.id, 409, CORRECTION_CLOSED);

        const lock = await acquireStoreLock(dir);
        try {
          await expectRefusal(closed.id, 409, CORRECTIONS_STORE_BUSY);
        } finally {
          await lock.release();
        }

        await appendFile(withdrawalsFile(dir), "{not json\n");
        await expectRefusal(closed.id, 409, CORRECTION_WITHDRAWALS_UNREADABLE);
      },
      async ({ dir, clock }) => {
        amys = await seedCorrection(dir, clock, { by: "amy" });
        pending = await seedCorrection(dir, clock, { decisionId: undefined, runId: "orca-run-1", pendingId: "p1" });
        closed = await seedCorrection(dir, clock, { because: "已闭环" }, true);
      },
    );
  });

  it("answers 404 decision-not-found for a correction on a decision the panel does not list, and writes no line", async () => {
    let unlisted: Correction;
    await withPanel(
      async ({ started, dir }) => {
        const reviewsBefore = await readOr(reviewsFile(dir));
        const res = await post(started, "/api/corrections/withdraw", { correctionId: unlisted.id });
        expect(res.status).toBe(404);
        expect(((await res.json()) as { code: string }).code).toBe(DECISION_NOT_FOUND);
        expect(await readOr(withdrawalsFile(dir))).toBe("<absent>");
        expect(await readOr(reviewsFile(dir))).toBe(reviewsBefore);
      },
      async ({ dir, clock }) => {
        unlisted = await seedCorrection(dir, clock, { decisionId: "orca-dev-1/99" });
      },
    );
  });
});
