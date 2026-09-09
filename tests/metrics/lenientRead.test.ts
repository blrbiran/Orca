import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { readCorrectionsLeniently, readLedgerLeniently } from "../../src/metrics/lenientRead.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-metrics-lenient-"));

const GOOD = JSON.stringify({
  id: "c_0000000000000001", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/1",
  kind: "wrong", because: "证据不对", at: "2026-09-01T00:00:00.000Z", by: "amy",
});
const GOOD2 = JSON.stringify({
  id: "c_0000000000000002", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/2",
  kind: "stale", because: "世界变了", at: "2026-09-02T00:00:00.000Z", by: "amy",
});
/** JSON 合法、schema 不合法 —— 让变异 21 可被观测的那种夹具。 */
const JSON_OK_SCHEMA_BAD = JSON.stringify({ id: "c_x", projectKey: "k" });

describe("lenient read (E2 spec §5.2, §5.3)", () => {
  it("names a MIDDLE bad line instead of throwing, and keeps every good row", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${GOOD}\n{ not json\n${GOOD2}\n`);

    const read = await readCorrectionsLeniently(file);

    expect(read.rows.map((r) => r.id)).toEqual(["c_0000000000000001", "c_0000000000000002"]);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].line).toBe(2);
    expect(read.malformed[0].file).toBe(file);
    expect(read.malformed[0].bytes).toBe(Buffer.byteLength("{ not json", "utf8"));
    expect(read.malformed[0].torn).toBe(false);
  });

  it("marks a torn LAST line torn, and a middle one not — they get different exit codes", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${GOOD}\n${GOOD2.slice(0, 40)}`);

    const read = await readCorrectionsLeniently(file);

    expect(read.rows.map((r) => r.id)).toEqual(["c_0000000000000001"]);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].torn).toBe(true);
    expect(read.malformed[0].reason).toContain("still being written");
  });

  it("a JSON-valid line that is not a correction is malformed, not silently kept", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${JSON_OK_SCHEMA_BAD}\n${GOOD}\n`);

    const read = await readCorrectionsLeniently(file);
    expect(read.rows).toHaveLength(1);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].line).toBe(1);
    expect(read.malformed[0].reason).toContain("decisionId");
  });

  // 🔴 变异 21 的【正向对照】。「store.ts 没被改」是「什么都没发生」,不可能直接红。
  it("leaves store.ts strict: readCorrections still throws on a schema-invalid line", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "corrections.jsonl"), `${JSON_OK_SCHEMA_BAD}\n${GOOD}\n`);

    const error = await readCorrections(dir).then(
      () => {
        throw new Error("readCorrections accepted a schema-invalid line — the strict reader was loosened");
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("the strict reader was loosened");
  });

  it("a missing file reads as empty, not as an error — a repo with no corrections is normal", async () => {
    const dir = await tempDir();
    const read = await readCorrectionsLeniently(join(dir, "corrections.jsonl"));
    expect(read.rows).toEqual([]);
    expect(read.malformed).toEqual([]);
  });

  // 🔴 C2:宽容读取器对 decision 只认 ev,不做 schema 判决。
  it("hands every ev=decision line through with its raw text, judging none of them", async () => {
    const dir = await tempDir();
    const file = join(dir, "run.jsonl");
    const bad = JSON.stringify({ ev: "decision", id: "orca-dev-1/9" });
    await writeFile(file, `${bad}\n`);

    const read = await readLedgerLeniently(file);
    expect(read.malformed).toEqual([]);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0].kind).toBe("decision");
  });

  it("skips bound and superseded without calling them malformed", async () => {
    const dir = await tempDir();
    const file = join(dir, "run.jsonl");
    await writeFile(file, `${JSON.stringify({ ev: "bound", id: "orca-dev-1/1", taskId: "T1", runId: "r" })}\n`);

    const read = await readLedgerLeniently(file);
    expect(read.rows).toEqual([]);
    expect(read.malformed).toEqual([]);
  });

  // 第二席 Minor 6:一行 null 不许让整条命令崩。
  it("reports a bare null line as malformed instead of throwing a TypeError", async () => {
    const dir = await tempDir();
    const file = join(dir, "run.jsonl");
    await writeFile(file, `null\n`);

    const read = await readLedgerLeniently(file);
    expect(read.rows).toEqual([]);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].reason).toContain("not a JSON object");
  });
});
