/**
 * Gaps spec §7 / §17 G6, pure part: `projectionOf` is what lets an unchanged-in-shape output stop the re-run cascade.
 * The reads are in-memory; a projection that cannot be computed is `null` (no cutoff), never an error.
 */
import { describe, expect, it } from "vitest";
import { projectionOf } from "../../src/flow/journal/projection.js";

const reader = (files: Record<string, string>) => (path: string): Buffer | null => (path in files ? Buffer.from(files[path]!) : null);

describe("projectionOf headings(<path>)", () => {
  const spec = "headings(a.outline.md)";
  const p = (text: string) => projectionOf(spec, reader({ "a.outline.md": text }), null);
  it("same headings with a different body are equal", () => {
    expect(p("# T\n\n正文一\n\n## S\n\n内容 A")).toBe(p("# T\n\n完全不同的正文\n\n## S\n\n内容 B"));
    expect(p("# T\n\n正文")).not.toBeNull();
  });
  it("a changed heading, level or order is different", () => {
    const base = p("# T\n\n## S");
    expect(p("# T\n\n## S2")).not.toBe(base);
    expect(p("# T\n\n### S")).not.toBe(base);
    expect(p("## S\n\n# T")).not.toBe(base);
  });
  it("headings inside a code fence or front matter do not count", () => {
    expect(p("---\n# x\n---\n# T\n\n```\n# not a heading\n```")).toBe(p("# T"));
  });
  it("is insensitive to markdown noise and spacing in the heading text (norm)", () => {
    expect(p("# **A** b")).toBe(p("#  a  B"));
  });
  it("a missing file or a file without headings is null (no cutoff)", () => {
    expect(projectionOf(spec, reader({}), null)).toBeNull();
    expect(p("just text")).toBeNull();
  });
});

describe("projectionOf json(<path>, <pointer>)", () => {
  const p = (spec: string, text: string | null) => projectionOf(spec, reader(text === null ? {} : { "r.json": text }), null);
  it("hashes the value at the pointer, not the document", () => {
    expect(p("json(r.json, /a/b)", '{"a":{"b":[1,2]},"z":1}')).toBe(p("json(r.json, /a/b)", '{"z":2,"a":{"b":[1,2]}}'));
    expect(p("json(r.json, /a/b)", '{"a":{"b":[1,2]}}')).not.toBe(p("json(r.json, /a/b)", '{"a":{"b":[1,3]}}'));
  });
  it("canonical: key order does not matter; array index and ~1 escapes work", () => {
    expect(p("json(r.json, /o)", '{"o":{"x":1,"y":2}}')).toBe(p("json(r.json, /o)", '{"o":{"y":2,"x":1}}'));
    expect(p("json(r.json, /l/1)", '{"l":[7,8]}')).toBe(p("json(r.json, /l/1)", '{"l":[0,8]}'));
    expect(p("json(r.json, /a~1b)", '{"a/b":5}')).not.toBeNull();
  });
  it("a missing file, bad JSON or a missing pointer is null", () => {
    expect(p("json(r.json, /a)", null)).toBeNull();
    expect(p("json(r.json, /a)", "{not json")).toBeNull();
    expect(p("json(r.json, /missing)", '{"a":1}')).toBeNull();
    expect(p("json(r.json, /l/5)", '{"l":[1]}')).toBeNull();
  });
});

describe("projectionOf verdict", () => {
  it("is the hash of the verdict; no verdict is null", () => {
    expect(projectionOf("verdict", () => null, "pass")).toBe(projectionOf("verdict", () => null, "pass"));
    expect(projectionOf("verdict", () => null, "pass")).not.toBe(projectionOf("verdict", () => null, "fail"));
    expect(projectionOf("verdict", () => null, null)).toBeNull();
  });
  it("an unknown spec is null", () => {
    expect(projectionOf("whatever(x)", () => Buffer.from("x"), null)).toBeNull();
  });
});
