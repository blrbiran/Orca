import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORRECTIONS_FILE_MODE, correctionsFile } from "../../src/corrections/paths.js";
import { withStoreLock } from "../../src/corrections/storeLock.js";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import {
  CORRECTION_ALREADY_RECORDED,
  DUPLICATE_CORRECTION_ID,
  appendCorrectionLocked,
  readCorrections,
  recordCorrection,
} from "../../src/corrections/store.js";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-store-"));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function correction(overrides: Partial<Correction> = {}): Correction {
  const base = {
    projectKey: "github.com/biran/orca",
    decisionId: "orca-dev-1/1",
    kind: "not_my_taste" as const,
    chose_instead: "改用文件租约",
    because: "进程内互斥跨进程无效",
    at: "2026-09-07T00:00:00.000Z",
    by: "amy",
    ...overrides,
  };
  return { id: deriveCorrectionId(base), ...base };
}

describe("corrections store (spec §4, §4.1, §14.6, §14.7)", () => {
  it("appends a row and reads it back", async () => {
    const dir = await tempDir();
    const row = correction();
    await recordCorrection(dir, row, { again: false });
    expect(await readCorrections(dir)).toEqual([row]);
  });

  // E10a, part 1: the semantic duplicate check, and the id it points at.
  it("refuses a second correction on the same decision by the same person", async () => {
    const dir = await tempDir();
    const first = correction();
    await recordCorrection(dir, first, { again: false });

    const second = correction({ at: "2026-09-07T00:00:01.000Z", because: "另一句理由" });
    const error = await recordCorrection(dir, second, { again: false }).then(
      () => { throw new Error("recorded a second correction that should have been refused"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain(first.id);
    expect((error as CorrectRejection).code).toBe(CORRECTION_ALREADY_RECORDED);
    expect(await readCorrections(dir)).toHaveLength(1);
  });

  // E10a, part 2 — the half that pins `projectKey` in the key (§14.6). A
  // decision id carries no repository identity and is itself derived, so the
  // same `<run>/<n>` shows up in every clone and fork; without projectKey a
  // person correcting the same decision id in a second repository is told
  // "already corrected" and pushed towards --again, which turns the whole
  // guard off.
  it("allows the same decision id in a different project", async () => {
    const dir = await tempDir();
    await recordCorrection(dir, correction(), { again: false });
    const elsewhere = correction({ projectKey: "github.com/biran/ccloop" });
    await recordCorrection(dir, elsewhere, { again: false });
    expect(await readCorrections(dir)).toHaveLength(2);
  });

  // E10b
  it("records a second one when --again is explicit, and keeps both", async () => {
    const dir = await tempDir();
    const first = correction();
    await recordCorrection(dir, first, { again: false });
    const second = correction({ at: "2026-09-07T00:00:01.000Z" });
    await recordCorrection(dir, second, { again: true });

    const rows = await readCorrections(dir);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  // E10c. ⚠️ The fixture pins BOTH `--again` and a byte-identical `at`:
  // without --again the semantic check refuses first and this criterion would
  // prove nothing about the id check; without pinning `at` the two ids differ
  // by construction and the criterion goes red against the UNMUTATED
  // implementation too (third seat).
  it("refuses the very same row replayed, even with --again", async () => {
    const dir = await tempDir();
    const row = correction();
    await recordCorrection(dir, row, { again: false });
    const error = await recordCorrection(dir, { ...row }, { again: true }).then(
      () => { throw new Error("recorded the same row twice"); },
      (e: unknown) => e,
    );
    expect((error as CorrectRejection).code).toBe(DUPLICATE_CORRECTION_ID);
    expect(await readCorrections(dir)).toHaveLength(1);
  });

  // E9 (corrections half)
  it("does not glue a row onto a file that has no trailing newline", async () => {
    const dir = await tempDir();
    const existing = correction({ by: "bob" });
    await writeFile(correctionsFile(dir), JSON.stringify(existing), { mode: CORRECTIONS_FILE_MODE });

    await recordCorrection(dir, correction(), { again: false });

    const lines = (await readFile(correctionsFile(dir), "utf8")).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  // E17 (file half). umask pinned and restored, same reasoning as Task 3.
  it("creates the corrections file 0600 whatever the umask is", async () => {
    const dir = await tempDir();
    const previousUmask = process.umask(0o022);
    try {
      await recordCorrection(dir, correction(), { again: false });
      // 🔴 Round-4 review, item 5: the literal, not CORRECTIONS_FILE_MODE.
      // Comparing against the constant under test only proves the constant
      // reached appendFile -- it stays green even if the constant itself is
      // changed to something looser (measured: setting CORRECTIONS_FILE_MODE
      // = 0o644 left this criterion green). spec §14.17 requires 0600 on this
      // user-data file; that requirement is what must be pinned.
      expect((await stat(correctionsFile(dir))).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  });

  // 🔴 E10d — the read and the judgement are inside the SAME lock hold.
  //
  // ⚠️ The barrier is one-sided on purpose (§14.7): in the unmutated
  // implementation the read happens under the lock, so the two sides can never
  // both be past it at the same time, and a rendezvous barrier would deadlock
  // the correct implementation. P1 holds the lock, signals, sleeps, and only
  // THEN appends — so P2's early (mutated) read sees an empty store.
  //
  // ⚠️ P1's sleep is well under STORE_LOCK_TIMEOUT_MS: if it were longer, the
  // unmutated run would be let through by the timeout (exit 4) rather than by
  // the duplicate check, and this criterion would be green for the wrong
  // reason. The assertion names the duplicate rejection for that reason.
  it("holds the lock across the read, the judgement and the append", async () => {
    const dir = await tempDir();
    const first = correction();
    const second = correction({ at: "2026-09-07T00:00:01.000Z" });

    let signal!: () => void;
    const p1InLock = new Promise<void>((resolve) => { signal = resolve; });

    const p1 = withStoreLock(dir, async () => {
      signal();
      await sleep(200);
      await appendCorrectionLocked(dir, first);
    });

    await p1InLock;
    const p2 = recordCorrection(dir, second, { again: false }).then(
      () => { throw new Error("the second writer got past a check that should have refused it"); },
      (e: unknown) => e,
    );

    await p1;
    const error = await p2;
    expect((error as Error).message).toContain(first.id);
    expect((error as CorrectRejection).code).toBe(CORRECTION_ALREADY_RECORDED);
    expect(await readCorrections(dir)).toHaveLength(1);
  });
});
