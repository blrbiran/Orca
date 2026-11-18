// Tester #376 (plan 2026-11-18 tester batch D, V2): the server now counts a task whose run landed and waits for its settle
// as `settling`, not `running`. Such a task is still under way: the list, the board light and the archive gate must read
// it as they read a running task before the split.
import { describe, expect, it } from "vitest";
import { cardArchivePending } from "../src/GroupActionsMenu.js";
import { groupCategory, groupLed } from "../src/groupCategory.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const g = (over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId: "g", repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 2 }, counts: { idle: 1, running: 0, waiting: 0, blocked: 0, done: 0, settling: 1 }, ...over,
});

describe("a settling task is under way (#376)", () => {
  // mutation: drop `settling` from groupCategory's running sum -> not-started, red
  it("the list puts the group under running", () => expect(groupCategory(g())).toBe("running"));
  // mutation: drop `settling` from groupLed's running count -> waiting, red
  it("the board light is running", () => expect(groupLed(g({ executionPending: true }))).toBe("running"));
  // mutation: drop `settling` from cardArchivePending -> false, red
  it("archive waits for it", () => expect(cardArchivePending(g())).toBe(true));
});
