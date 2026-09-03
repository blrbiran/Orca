import { describe, expect, it } from "vitest";
import { normalizeClaim, type ClaimedPath } from "../../src/scheduler/writeSet.js";
import { intersect } from "../../src/scheduler/pathTrie.js";

function c(declared: string): ClaimedPath {
  return normalizeClaim(declared);
}

describe("intersect (spec 3.2)", () => {
  it("reports equal claims", () => {
    expect(intersect([c("src/a.ts")], [c("src/a.ts")])[0].kind).toBe("equal");
  });

  it("reports a directory that contains someone else's leaf", () => {
    // Naive set intersection answers "disjoint" here — and spec 3.1 marks that
    // direction as the unsafe one. This is the single judgement M-TRIE deletes.
    expect(intersect([c("src/a.ts")], [c("src/**")])[0].kind).toBe("new-contains-old");
  });

  it("reports a leaf that falls inside someone else's directory", () => {
    expect(intersect([c("src/**")], [c("src/a.ts")])[0].kind).toBe("new-inside-old");
  });

  it("does not confuse a sibling whose name is a string prefix", () => {
    // src/ab.ts starts with "src/a" as a string, but is not inside it as a
    // path. A startsWith implementation passes every test above and fails this
    // one — which is the whole reason this test exists.
    expect(intersect([c("src/a")], [c("src/ab.ts")])).toEqual([]);
  });

  it("says a bare ** intersects everything", () => {
    expect(intersect([c("**")], [c("anything/at/all.txt")]).length).toBe(1);
  });

  it("says an empty-string claim intersects everything, like a bare **", () => {
    // A task that declares no restriction at all is the repository-root
    // case, same as "**" — it must not be read as claiming nothing.
    expect(intersect([c("")], [c("anything/at/all.txt")]).length).toBe(1);
  });

  it("resolves a leading ./ so it intersects the same claim written without it", () => {
    // ./src/** and src/** name the same directory. Before fix round 1, the
    // leading "./" survived normalization verbatim, so the two segment lists
    // never matched and this pair was answered "disjoint" — the unsafe
    // direction spec 3.1 warns against.
    expect(intersect([c("./src/**")], [c("src/a.ts")]).length).toBe(1);
  });

  it("resolves .. so a claim that walks out and back in intersects its real target", () => {
    // src/foo/../bar/x.ts and src/bar/x.ts name the same file. Before fix
    // round 1, contains() compared raw segments (["src","foo","..","bar",
    // "x.ts"] vs ["src","bar"]) and never matched — a genuinely overlapping
    // pair answered "disjoint".
    expect(intersect([c("src/foo/../bar/x.ts")], [c("src/bar/**")]).length).toBe(1);
  });

  it("lists every conflicting path, not just the first", () => {
    const conflicts = intersect([c("src/a.ts"), c("src/b.ts")], [c("src/**")]);
    expect(conflicts.length).toBe(2);
  });

  it("answers disjoint for genuinely disjoint sets", () => {
    expect(intersect([c("src/a.ts")], [c("docs/b.md")])).toEqual([]);
  });
});
