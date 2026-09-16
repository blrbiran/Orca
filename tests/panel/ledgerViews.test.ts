import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";
import type { DiscoveredRepo } from "../../src/metrics/discover.js";
import { classifyReviews } from "../../src/panel/compactClassify.js";
import type { LineClass } from "../../src/panel/compactClassify.js";
import { buildLedgerViews } from "../../src/panel/ledgerViews.js";

const PK = "github.com/biran/target";

const decisionLine = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ev: "decision",
    id,
    at: "2026-01-01T00:00:00.000Z",
    run: id.slice(0, id.lastIndexOf("/")),
    question: "q",
    chose: "a",
    alternatives: [{ option: "b", why_not: "no" }],
    because: "r",
    // An executable undo.how, so validateLine answers ok rather than downgraded
    // (tests/metrics/buildFixture.ts measured the difference).
    undo: { how: "git revert abc123 -- src/foo.ts", cost: "low", blast_radius: "one file" },
    scope: "repo",
    kind: "interface",
    ...over,
  });

const reviewLine = (decisionId: string): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at: "2026-09-10T00:00:00.000Z" });

describe("buildLedgerViews + classifyReviews (reviews compaction spec section 3.1, ruling R-E)", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-ledger-views-"));
    repoPath = join(root, "repo");
    await mkdir(join(repoPath, ".decisions"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const put = async (rel: string, lines: string[]): Promise<void> => {
    await mkdir(dirname(join(repoPath, rel)), { recursive: true });
    await writeFile(join(repoPath, rel), lines.map((l) => `${l}\n`).join(""));
  };

  const classesFor = async (repos: DiscoveredRepo[], decisionId: string): Promise<LineClass[]> => {
    const text = `${reviewLine(decisionId)}\n`;
    const views = await buildLedgerViews(repos, [{ projectKey: PK, decisionId }]);
    return classifyReviews(text, views).lines.map((l) => l.cls);
  };

  it("C3 leaves a repository that was not discovered alone, and the same row is an orphan once it is", async () => {
    await put(".decisions/archive/2026/orca-dev-9.jsonl", [decisionLine("orca-dev-9/1")]);
    expect(await classesFor([], "orca-dev-9/1")).toEqual([
      { kind: "not-judged", reason: "repo-not-discovered", projectKey: PK, decisionId: "orca-dev-9/1" },
    ]);
    expect(await classesFor([{ projectKey: PK, path: repoPath }], "orca-dev-9/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4 leaves a repository with a bad top-level ledger line alone, and the same row is an orphan without it", async () => {
    await put(".decisions/archive/2026/orca-dev-9.jsonl", [decisionLine("orca-dev-9/1")]);
    // A bad top-level line could be hiding the very id being looked for.
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1"), "{not json"]);
    const repos = [{ projectKey: PK, path: repoPath }];
    expect(await classesFor(repos, "orca-dev-9/1")).toEqual([
      { kind: "not-judged", reason: "ledger-has-malformed-lines", projectKey: PK, decisionId: "orca-dev-9/1" },
    ]);
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    expect(await classesFor(repos, "orca-dev-9/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4b counts a top-level decision the validator rejects as present, and the same row is an orphan once its file is archived", async () => {
    // JSON.stringify drops an undefined value, so `because` is really absent.
    const rejectedLine = decisionLine("orca-dev-1/1", { because: undefined });
    // Fixture sanity, read from the validator rather than from this test's own input.
    expect(validateLine(rejectedLine).verdict).toBe("rejected");
    const repos = [{ projectKey: PK, path: repoPath }];

    await put(".decisions/orca-dev-1.jsonl", [rejectedLine]);
    // The exact class: under the "only validated decisions count" mutation this
    // row falls into decision-not-found, which is ALSO not an orphan.
    expect(await classesFor(repos, "orca-dev-1/1")).toEqual([{ kind: "kept" }]);

    await rm(join(repoPath, ".decisions", "orca-dev-1.jsonl"));
    await put(".decisions/archive/2026/orca-dev-1.jsonl", [rejectedLine]);
    expect(await classesFor(repos, "orca-dev-1/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4c leaves a row whose decision is in neither place alone, and the same row is an orphan once its run file is archived", async () => {
    const repos = [{ projectKey: PK, path: repoPath }];
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    expect(await classesFor(repos, "orca-dev-7/1")).toEqual([
      { kind: "not-judged", reason: "decision-not-found", projectKey: PK, decisionId: "orca-dev-7/1" },
    ]);
    await put(".decisions/archive/2025/orca-dev-7.jsonl", [decisionLine("orca-dev-7/1")]);
    expect(await classesFor(repos, "orca-dev-7/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4d finds nothing for a decision id whose run part climbs out of the archive", async () => {
    // The decision id comes from reviews.jsonl, which is data. Its run part
    // becomes a file name under archive/<YYYY>/, so a "/" in it would read a
    // file outside the archive. A real decision file sits exactly where the
    // climb lands, so only the guard stands between it and a false orphan.
    const climbing = "../../../outside/1";
    await mkdir(join(repoPath, ".decisions", "archive", "2026"), { recursive: true });
    await put("outside.jsonl", [decisionLine(climbing)]);
    expect(await classesFor([{ projectKey: PK, path: repoPath }], climbing)).toEqual([
      { kind: "not-judged", reason: "decision-not-found", projectKey: PK, decisionId: climbing },
    ]);
  });
});
