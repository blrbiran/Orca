import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionObservation } from "../../src/metrics/types.js";
import { computePanelCoverage, reviewedKeys } from "../../src/panel/coverage.js";
import { reviewsFile } from "../../src/panel/paths.js";
import { acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { activeReviewers, keyOf, reviewStates } from "../../src/panel/reviewState.js";
import { ReviewsWriter, readReviews } from "../../src/panel/reviewsStore.js";
import type { ReviewAction, ReviewRow } from "../../src/panel/reviewsStore.js";

// decisions review withdraw spec sections 4.2 and 4.3: a person's review state
// is their LATEST reviewed/withdrawn row in file order, and a state row is a
// duplicate only when it equals that state. Before this spec a decision was
// reviewed forever once any `reviewed` row existed, and the writer's dedupe
// key (pk, id, by, action) would have refused the re-review of a
// reviewed -> withdrawn -> reviewed cycle.
const PK = "github.com/biran/orca";
const ID = "orca-dev-1/1";
const row = (action: ReviewAction, by = "amy", over: Partial<ReviewRow> = {}): ReviewRow => ({
  decisionId: ID,
  projectKey: PK,
  action,
  by,
  at: "2026-10-18T00:00:00.000Z",
  ...over,
});

describe("review state (decisions review withdraw spec section 4.2)", () => {
  it("is the latest state row per person, so a withdraw ends a review and a re-review starts it again", () => {
    const withdrawn = reviewStates([row("reviewed"), row("withdrawn")]);
    expect(withdrawn.get(keyOf(PK, ID))?.get("amy")).toBe("withdrawn");
    const again = reviewStates([row("reviewed"), row("withdrawn"), row("reviewed")]);
    expect(again.get(keyOf(PK, ID))?.get("amy")).toBe("reviewed");
  });

  it("ignores opened rows: an arrow key through the table is not a state", () => {
    const states = reviewStates([row("reviewed"), row("opened")]);
    expect(states.get(keyOf(PK, ID))?.get("amy")).toBe("reviewed");
    expect(reviewStates([row("opened")]).size).toBe(0);
  });

  it("lists active reviewers in first-seen order, without the ones who withdrew", () => {
    const states = reviewStates([row("reviewed", "bob"), row("reviewed", "amy"), row("reviewed", "cy"), row("withdrawn", "amy")]);
    expect(activeReviewers(states, PK, ID)).toEqual(["bob", "cy"]);
    expect(activeReviewers(states, PK, "orca-dev-1/9")).toEqual([]);
  });

  it("reviewedKeys drops a decision whose only reviewer withdrew, and keeps one another person still holds", () => {
    expect(reviewedKeys([row("reviewed"), row("withdrawn")]).size).toBe(0);
    const held = reviewedKeys([row("reviewed"), row("reviewed", "bob"), row("withdrawn")]);
    expect(held.has(keyOf(PK, ID))).toBe(true);
  });

  it("coverage does not count a high-tier decision whose review was withdrawn", () => {
    const decision: DecisionObservation = {
      projectKey: PK,
      id: ID,
      at: "2026-01-01T00:00:00.000Z",
      kind: "interface",
      scope: "repo",
      verdict: "ok",
    };
    // The positive control first: without it, a coverage that ignored reviews
    // entirely would satisfy the zero below.
    expect(computePanelCoverage([decision], [row("reviewed")]).reviewed_high_tier).toBe(1);
    expect(computePanelCoverage([decision], [row("reviewed"), row("withdrawn")]).reviewed_high_tier).toBe(0);
  });
});

describe("the reviews writer's state dedupe (decisions review withdraw spec section 4.3)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-review-state-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a reviewed -> withdrawn -> reviewed cycle and skips only rows that change nothing", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row("reviewed"))).toBe("written");
    expect(await writer.append(row("reviewed"))).toBe("duplicate");
    expect(await writer.append(row("withdrawn"))).toBe("written");
    expect(writer.stateOf(PK, ID, "amy")).toBe("withdrawn");
    expect(await writer.append(row("withdrawn"))).toBe("duplicate");
    expect(await writer.append(row("reviewed"))).toBe("written");
    expect(writer.stateOf(PK, ID, "amy")).toBe("reviewed");
    expect(writer.stateOf(PK, ID, "bob")).toBeUndefined();
    // The literal count: the re-review is the third line.
    const text = await readFile(reviewsFile(dir), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(3);
    expect((await readReviews(dir)).map((r) => r.action)).toEqual(["reviewed", "withdrawn", "reviewed"]);
  });

  it("keeps the first-per-key rule for opened rows", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row("opened"))).toBe("written");
    expect(await writer.append(row("opened"))).toBe("duplicate");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("resolves two concurrent withdraws as one written and one duplicate (two tabs pressing Withdraw)", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row("reviewed"))).toBe("written");
    const [a, b] = await Promise.all([writer.append(row("withdrawn")), writer.append(row("withdrawn"))]);
    expect([a, b].sort()).toEqual(["duplicate", "written"]);
    expect((await readReviews(dir)).filter((r) => r.action === "withdrawn")).toHaveLength(1);
  });

  it("re-reads the state after reviews.jsonl was replaced, so a re-review the new file needs is written", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row("reviewed"))).toBe("written");
    // Another process withdrew; the file was replaced by rename (compaction's
    // shape), so the identity changed and the in-memory `reviewed` is stale.
    const replacement = join(dir, "replacement");
    await writeFile(replacement, `${JSON.stringify(row("reviewed"))}\n${JSON.stringify(row("withdrawn"))}\n`);
    await rename(replacement, reviewsFile(dir));
    expect(await writer.append(row("reviewed"))).toBe("written");
    expect((await readReviews(dir)).map((r) => r.action)).toEqual(["reviewed", "withdrawn", "reviewed"]);
  });

  it("gives back the previous state when a write fails, so the retry of that click is written", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row("reviewed"))).toBe("written");
    const held = await acquireReviewsLock(dir);
    try {
      await expect(writer.append(row("withdrawn"))).rejects.toMatchObject({ code: "reviews-store-busy" });
    } finally {
      await held.release();
    }
    expect(writer.stateOf(PK, ID, "amy")).toBe("reviewed");
    expect(await writer.append(row("withdrawn"))).toBe("written");
    expect((await readReviews(dir)).map((r) => r.action)).toEqual(["reviewed", "withdrawn"]);
  });
});
