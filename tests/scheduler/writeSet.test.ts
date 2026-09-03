import { describe, expect, it } from "vitest";
import { normalizeClaim, writeSetOf } from "../../src/scheduler/writeSet.js";

describe("normalizeClaim (spec 3.3)", () => {
  it("normalizes a prefix glob to its directory prefix", () => {
    expect(normalizeClaim("src/**").normalized).toBe("src/");
  });

  it("normalizes a bare ** to the repository root", () => {
    // Load-bearing for the degradation warning in orca plan: a task claiming
    // ** intersects everyone, so the whole graph goes serial. That is correct
    // behaviour, and it must be visible rather than read as "parallelism is
    // broken".
    expect(normalizeClaim("**").normalized).toBe("");
  });

  it("keeps everything else whole and treats it as a prefix", () => {
    expect(normalizeClaim("src/a.ts").normalized).toBe("src/a.ts");
  });

  it("keeps the declared string for diagnostics", () => {
    // Without this, src/a.ts is reported as having claimed "src/a.ts/**", a
    // directory that does not exist, and the diagnosis reads as a tool bug.
    expect(normalizeClaim("src/**").declared).toBe("src/**");
  });

  it("treats an empty string as the repository root, like a bare **", () => {
    // A task that declares no restriction at all claims everything, same as
    // "**". This must be handled as its own case rather than falling through
    // to path.posix.normalize("") — that returns ".", which would turn
    // "claims the whole repository" into "claims a directory literally named
    // .", the unsafe direction (fix round 1, Important finding).
    expect(normalizeClaim("").normalized).toBe("");
  });
});

describe("writeSetOf (spec 3.1: context.targetPaths ∪ safetyPolicy.allowlistPaths)", () => {
  it("unions targetPaths and allowlistPaths, each normalized", () => {
    // ccloop's own evaluatePathPolicy never reads targetPaths and only checks
    // allowlistPaths after the fact (spec §3.1, prior-art research). A
    // scheduler that trusted targetPaths alone would be less careful than the
    // tool it schedules for — both fields must end up in the write set.
    const contract = {
      context: { targetPaths: ["src/a.ts"] },
      safetyPolicy: { allowlistPaths: ["docs/**"] },
    };
    const set = writeSetOf(contract);
    expect(set.map((c) => c.normalized).sort()).toEqual(["docs/", "src/a.ts"]);
  });

  it("defaults to an empty write set when both fields are missing", () => {
    // A contract is read here as an opaque unknown, before any schema for it
    // exists in this codebase (decision context #4) — a missing field must
    // not throw.
    expect(writeSetOf({})).toEqual([]);
  });
});
