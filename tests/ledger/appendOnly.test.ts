import { describe, expect, it } from "vitest";
import { checkAppendOnly } from "../../src/ledger/appendOnly.js";

const PURE_APPEND = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
index 1111111..2222222 100644
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3,0 +4 @@
+{"ev":"bound","id":"run-7c/3"}
`;

const HAS_REMOVAL = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
index 1111111..2222222 100644
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3 +3 @@
-{"ev":"decision","id":"run-7c/3","chose":"串行"}
+{"ev":"decision","id":"run-7c/3","chose":"并行"}
`;

const NEW_FILE = `diff --git a/.decisions/run-9a.jsonl b/.decisions/run-9a.jsonl
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/.decisions/run-9a.jsonl
@@ -0,0 +1 @@
+{"ev":"decision","id":"run-9a/1"}
`;

const PURE_RENAME = `diff --git a/.decisions/run-7c.jsonl b/.decisions/archive/2026/run-7c.jsonl
similarity index 100%
rename from .decisions/run-7c.jsonl
rename to .decisions/archive/2026/run-7c.jsonl
`;

describe("checkAppendOnly — spec §3.8 check 6", () => {
  it("pure append passes", () => {
    expect(checkAppendOnly(PURE_APPEND)).toEqual({ ok: true });
  });

  it("rejects when a removal line is present", () => {
    const result = checkAppendOnly(HAS_REMOVAL);
    expect(result.ok).toBe(false);
  });

  it("new file passes (--- /dev/null is not a removal line)", () => {
    expect(checkAppendOnly(NEW_FILE)).toEqual({ ok: true });
  });

  it("empty diff passes", () => {
    expect(checkAppendOnly("")).toEqual({ ok: true });
  });

  it("pure rename passes — spec §3.7.1 archiving is just git mv, content unchanged", () => {
    expect(checkAppendOnly(PURE_RENAME)).toEqual({ ok: true });
  });

  // Why this assertion exists: proves the hunk gate isn't dead code.
  // The file header line `--- a/...` also starts with -; without gating on
  // being inside a hunk, it would be misread as a removal line and this would fail.
  it("the file header line --- a/... does not count as a removal", () => {
    const result = checkAppendOnly(PURE_APPEND);
    expect(result).toEqual({ ok: true });
  });

  // Why this assertion exists: the gate cannot be implemented as "skip lines
  // starting with ---". A removed record whose content itself starts with --
  // renders in the diff as `---...` too.
  it("deleting a line whose content starts with -- still counts as a removal", () => {
    const diff = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3 +2,0 @@
---{"ev":"decision"}
`;
    expect(checkAppendOnly(diff).ok).toBe(false);
  });

  it("rejection reports which line", () => {
    const result = checkAppendOnly(HAS_REMOVAL);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reasons.join("\n")).toContain("串行");
  });
});

describe("checkAppendOnly — a ledger with no trailing newline must not be permanently wedged", () => {
  // Legitimate case: appending to a file whose last byte was not a newline.
  // Git renders the old last line as removed (with the no-newline marker)
  // immediately followed by the same content re-added with a newline now
  // attached, plus the genuinely new line. Byte-identical content either
  // side of the marker ⇒ this must be treated as an append, not a removal.
  // Mutation that reddens this: delete the `isNoNewlineAppend` exemption in
  // src/ledger/appendOnly.ts (or replace it with `false`) — with the
  // exemption gone, this diff's `-` line is flagged as a removal and this
  // test fails (expected { ok: true }, got { ok: false, reasons: [...] }).
  it("byte-identical content across a no-newline marker is an append, not a removal", () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "index 1111111..2222222 100644",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1 +1,2 @@",
      '-{"ev":"decision","id":"fx/1"}',
      "\\ No newline at end of file",
      '+{"ev":"decision","id":"fx/1"}',
      '+{"ev":"bound","id":"fx/1"}',
    ].join("\n");
    expect(checkAppendOnly(diff)).toEqual({ ok: true });
  });

  // Hostile case: same shape (a `-` line, then the no-newline marker, then a
  // `+` line) but the content actually changed. This must still be rejected —
  // the exemption is narrow on purpose. Mutation that reddens this: drop the
  // `nextLine.slice(1) === line.slice(1)` byte-identity requirement (e.g.
  // always treat a `-` line followed by the marker as an append regardless
  // of what follows) — with that check gone, this test's tampered line would
  // be waved through and the assertion `.ok` to be `false` would fail.
  it("content that differs across a no-newline marker is still a removal and is rejected", () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "index 1111111..2222222 100644",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1 +1 @@",
      '-{"ev":"decision","id":"fx/1"}',
      "\\ No newline at end of file",
      '+{"ev":"decision","id":"fx/1","tampered":true}',
    ].join("\n");
    const result = checkAppendOnly(diff);
    expect(result.ok).toBe(false);
  });
});
