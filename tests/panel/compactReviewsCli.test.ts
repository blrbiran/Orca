import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { correctionsDir } from "../../src/corrections/paths.js";
import { APPLIED_LAST_LINE } from "../../src/panel/compactReviews.js";
import { reviewsArchiveFile, reviewsFile } from "../../src/panel/paths.js";
import { captureStreams, withCorrectionsDir } from "../corrections/harness.js";

const PK = "github.com/biran/target";

const decisionLine = (id: string, at = "2026-01-01T00:00:00.000Z"): string =>
  JSON.stringify({
    ev: "decision", id, at, run: id.slice(0, id.lastIndexOf("/")), question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: { how: "git revert abc123 -- src/foo.ts", cost: "low", blast_radius: "one file" },
    scope: "repo", kind: "interface",
  });
const rl = (decisionId: string, at = "2026-09-10T00:00:00.000Z"): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at });

const KEPT = rl("orca-dev-1/1");
const DUP = rl("orca-dev-1/1", "2026-09-12T00:00:00.000Z");
const ORPHAN = rl("orca-dev-8/1");
const NOT_FOUND = rl("orca-dev-7/1");
const STORE = `${KEPT}\n${DUP}\n${ORPHAN}\n${NOT_FOUND}\n`;

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    out[name] = (await stat(path)).isDirectory() ? "dir" : createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return out;
}

describe("orca compact-reviews (reviews compaction spec section 3)", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-compact-cli-"));
    repoPath = join(root, "repo");
    const put = async (rel: string, lines: string[]): Promise<void> => {
      await mkdir(dirname(join(repoPath, rel)), { recursive: true });
      await writeFile(join(repoPath, rel), lines.map((l) => `${l}\n`).join(""));
    };
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    await put(".decisions/archive/2026/orca-dev-8.jsonl", [decisionLine("orca-dev-8/1")]);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Rule 17 guard: every store path below must resolve under the temp dir.
  const inStore = async <T>(fn: (store: string) => Promise<T>): Promise<T> =>
    withCorrectionsDir(async (store) => {
      expect(correctionsDir(process.env)).toBe(store);
      expect(store.startsWith(tmpdir())).toBe(true);
      return fn(store);
    });

  it("refuses an unknown argument and a malformed --repo by name with exit 1", async () => {
    await inStore(async () => {
      const unknown = await captureStreams(() => main(["compact-reviews", "--bogus"]));
      expect(unknown.result).toBe(1);
      expect(unknown.stderr).toContain('unknown argument "--bogus"');
      const badRepo = await captureStreams(() => main(["compact-reviews", "--repo", "no-equals-sign"]));
      expect(badRepo.result).toBe(1);
      expect(badRepo.stderr).toContain("--repo wants <projectKey>=<path>");
    });
  });

  it("treats a null line and a row with a non-string decisionId as unreadable instead of crashing", async () => {
    await inStore(async (store) => {
      const odd = `null\n${JSON.stringify({ decisionId: 7, projectKey: PK, action: "reviewed", by: "amy", at: "2026-09-10T00:00:00.000Z" })}\n`;
      await writeFile(reviewsFile(store), odd + STORE);
      const run = await captureStreams(() => main(["compact-reviews", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(0);
      expect(run.stdout).toContain("  unreadable  2");
    });
  });

  it("without --apply prints the report and leaves the store byte for byte as it was", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      const before = await snapshot(store);
      const run = await captureStreams(() => main(["compact-reviews", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(0);
      expect(run.stdout).toBe(
        [
          `orca compact-reviews: ${reviewsFile(store)}`,
          "  kept        1",
          "  duplicate   1",
          "  orphan      1",
          "  unreadable  0",
          "  not-judged  1",
          "orphans:",
          `  ${PK} orca-dev-8/1`,
          "not judged:",
          `  decision-not-found ${PK} orca-dev-7/1`,
          "dry run; nothing was written. Pass --apply to write.",
          "",
        ].join("\n"),
      );
      expect(await snapshot(store)).toEqual(before);
    });
  });

  it("with --apply compacts and says a running panel needs no restart", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      const run = await captureStreams(() => main(["compact-reviews", "--apply", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(0);
      expect(run.stdout.trimEnd().split("\n").at(-1)).toBe(APPLIED_LAST_LINE);
      expect(await readFile(reviewsFile(store), "utf8")).toBe(`${KEPT}\n${NOT_FOUND}\n`);
      expect(await readFile(reviewsArchiveFile(store), "utf8")).toBe(`${ORPHAN}\n`);
    });
  });

  it("passes collect()'s refusal through by name with exit 1 and writes nothing", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      // A decision dated after now, with no --as-of: collect() refuses the
      // whole command (spec section 1.7), and compaction inherits that.
      await writeFile(join(repoPath, ".decisions", "future.jsonl"), `${decisionLine("orca-dev-2/1", "2099-01-01T00:00:00.000Z")}\n`);
      const before = await snapshot(store);
      const run = await captureStreams(() => main(["compact-reviews", "--apply", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(1);
      expect(run.stderr).toContain("rejected: future-rows-without-as-of");
      expect(await snapshot(store)).toEqual(before);
    });
  });

  it("lists compact-reviews in the usage text", async () => {
    const { stderr } = await captureStreams(() => main([]));
    expect(stderr).toContain("orca compact-reviews [--apply]");
  });
});
