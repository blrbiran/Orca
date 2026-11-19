// Working-tree delivery spec 2026-11-19 §4.6, §6 (#365): what `group brief` says about a working-tree group -- pending,
// written, blocked (with its next step) -- from the integration record alone. Any other delivery prints nothing new.
import { describe, expect, it } from "vitest";
import { workingTreeLines } from "../../src/commands/domains/verbs.js";

const WT = { scheme: { delivery: "working-tree" }, state: "idle", reason: null, lastIntegrated: null };
const TIP = "a".repeat(40);

describe("group brief's working-tree lines (spec §4.6)", () => {
  it("says nothing for any other delivery or no record", () => {
    expect(workingTreeLines("g", { state: "done" }, undefined)).toEqual([]);
    expect(workingTreeLines("g", { state: "done" }, { ...WT, scheme: { delivery: "local" } })).toEqual([]);
  });
  it("pending before the group is done; not written yet once done; written once lastIntegrated is the accepted tip", () => {
    expect(workingTreeLines("g", { state: "running" }, WT)).toEqual(["delivery: working-tree -- will be written into your working tree once the group is accepted"]);
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, WT)).toEqual(["delivery: working-tree -- not written yet; a driver round writes it into your working tree"]);
    // mutation: drop the lastIntegrated == tip comparison -> an older delivery reads as written, red
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, { ...WT, lastIntegrated: "b".repeat(40) }))
      .toEqual(["delivery: working-tree -- not written yet; a driver round writes it into your working tree"]);
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, { ...WT, lastIntegrated: TIP })).toEqual([
      "delivery: working-tree -- written into your working tree (uncommitted, tip aaaaaaaaaaaa), including Orca's decision records under .decisions/",
      "  review: git status", "  the same files: git diff --name-only HEAD...orca/g"]);
  });
  it("blocked: the reason as recorded, and its next step (written paths included for write-failed)", () => {
    expect(workingTreeLines("g", { state: "done" }, { ...WT, state: "blocked", reason: "integration-working-tree-conflict:a.txt" })).toEqual([
      "delivery: working-tree blocked: integration-working-tree-conflict:a.txt",
      "  next: commit, move or discard your copies of these paths, then Retry; or take the files yourself: git checkout orca/g -- <path>; or orca group set-integration g --delivery keep; orca group retry-integration g"]);
    expect(workingTreeLines("g", { state: "done" }, { ...WT, state: "blocked", reason: "integration-working-tree-write-failed:n2.txt:ENOSPC:written 1 (n1.txt)" })).toEqual([
      "delivery: working-tree blocked: integration-working-tree-write-failed:n2.txt:ENOSPC:written 1 (n1.txt)",
      "  next: fix the cause, then Retry; files already written are kept and skipped; orca group retry-integration g"]);
  });
});
