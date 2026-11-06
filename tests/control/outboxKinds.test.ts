import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTBOX_QUEUE_KINDS, OUTBOX_RECORD_KINDS } from "../../src/control/outboxKinds.js";

// Issue #119: every outbox kind written with a literal kind and a pending bit of 0 is named as a queue or a record, and
// every reader of `delivered=0` outbox rows reads a queue kind. Source scan (code, Rule 5); fails on a new kind.
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
});
const source = files("src").map((path) => readFileSync(path, "utf8")).join("\n");

describe("outbox kinds (#119)", () => {
  it("every literal kind inserted into the outbox is a queue kind or a record kind, never both", () => {
    const inserted = new Set([...source.matchAll(/INSERT INTO outbox(?:\(id,kind,body,delivered\))? VALUES \(\?,\s*'([a-z-]+)'/g)].map((match) => match[1]!));
    // The scan sees the kinds it must (a scanner that finds nothing would pass vacuously).
    expect(inserted.has("group-handoff") && inserted.has("work-claim")).toBe(true);
    // mutation: drop "landing" from OUTBOX_QUEUE_KINDS -> unclassified ["landing"], red
    expect([...inserted].filter((kind) => !OUTBOX_QUEUE_KINDS.includes(kind) && !OUTBOX_RECORD_KINDS.includes(kind))).toEqual([]);
    expect(OUTBOX_QUEUE_KINDS.filter((kind) => OUTBOX_RECORD_KINDS.includes(kind))).toEqual([]);
  });

  it("every kind read as pending (delivered=0) is a queue kind", () => {
    const read = [...source.matchAll(/FROM outbox WHERE kind(?:='([a-z-]+)'| IN \(([^)]*)\)) AND delivered=0/g)]
      .flatMap((match) => match[1] !== undefined ? [match[1]] : match[2]!.split(",").map((kind) => kind.trim().replace(/'/g, "")));
    expect(read).toContain("landing");
    // mutation: move "cleanup" to OUTBOX_RECORD_KINDS -> ["cleanup"], red
    expect(read.filter((kind) => !OUTBOX_QUEUE_KINDS.includes(kind))).toEqual([]);
  });
});
