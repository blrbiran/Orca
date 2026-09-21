import { describe, expect, it } from "vitest";
import { initialControlState, reduceControlState } from "../src/controlState.js";
import type { ControlClientEvent, ControlClientState, UncertainCommand } from "../src/controlState.js";
import type { ControlSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

const groupSummary = { groupId: "g", state: "ready", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 } as const;

const summary = (over: Partial<ControlSummaryV1> = {}): ControlSummaryV1 => ({
  schema: "orca-control-summary-v1",
  epoch: "epoch-a",
  changeSeq: 1,
  resetRequired: false,
  dispatchBlocked: false,
  groups: [groupSummary],
  ...over,
});

const recovery = (over: Partial<RecoveryViewV1> = {}): RecoveryViewV1 => ({
  schema: "orca-control-recovery-v1",
  epoch: "epoch-a",
  dispatchBlocked: false,
  blockers: [],
  ...over,
});

const groupView = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  schema: "orca-control-group-v1",
  epoch: "epoch-a",
  changeSeq: 1,
  summary: groupSummary,
  graphVersion: 1,
  plan: { repoId: "r", planId: "p", planHash: "a".repeat(64), goal: "goal", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 1, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: "b".repeat(64) },
  ledger: {
    groupLimit: { tokens: 1000, activeMs: 0, attempts: 0, sessions: 0 },
    used: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
    committedRemaining: { tokens: 1000, activeMs: 0, attempts: 0, sessions: 0 },
    explicitUnallocatedReserve: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
    budgetDeficit: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 },
    usageUnknown: false,
  },
  allocations: [],
  workItems: [],
  estimates: [],
  runs: [],
  checkpoints: [],
  handoffRequests: [],
  stop: null,
  recoveryBlockers: [],
  recentCommandIds: [],
  ...over,
});

function apply(state: ControlClientState, ...events: ControlClientEvent[]): ControlClientState {
  return events.reduce(reduceControlState, state);
}

/** A cache holding a summary, one canonical group, one recovery view, an unsaved draft and an uncertain command. */
function populatedState(): ControlClientState {
  return apply(
    initialControlState(),
    { type: "summary", value: summary() },
    { type: "group", value: groupView() },
    { type: "recovery", value: recovery() },
    { type: "draft", key: "g:task/a/work/tokens", text: "123" },
    { type: "command-uncertain", value: { groupId: "g", commandId: "cmd-1" } },
  );
}

describe("control client state machine", () => {
  it("drops canonical caches on epoch change but keeps unsaved drafts and uncertain command ids", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, { type: "summary", value: summary({ epoch: "new" }) });
    expect(next.epoch).toBe("new");
    expect(next.canonical).toEqual({});
    expect(next.recovery).toBeNull();
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.uncertainCommandIds).toEqual(populated.uncertainCommandIds);
    expect(next.refetchRequired).toBe(true);
  });

  it("treats a server resetRequired the same as an epoch change", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, { type: "summary", value: summary({ changeSeq: 2, resetRequired: true }) });
    expect(next.canonical).toEqual({});
    expect(next.resetRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
  });

  it("ignores a summary whose changeSeq is older than the cache", () => {
    const populated = reduceControlState(populatedState(), { type: "summary", value: summary({ changeSeq: 9 }) });
    expect(reduceControlState(populated, { type: "summary", value: summary({ changeSeq: 4 }) })).toBe(populated);
  });

  it("marks a projection gap for refetch instead of quietly merging past it", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, { type: "summary", value: summary({ changeSeq: 30 }) });
    expect(next.changeSeq).toBe(30);
    expect(next.refetchRequired).toBe(true);
    expect(next.canonical).toEqual({});
    expect(Object.keys(next.groups)).toEqual(["g"]);
  });

  it("keeps the newer canonical body when an older group read arrives late", () => {
    const state = apply(initialControlState(), { type: "summary", value: summary() }, { type: "group", value: groupView({ changeSeq: 7 }) });
    const next = reduceControlState(state, { type: "group", value: groupView({ changeSeq: 5 }) });
    expect(next.canonical.g?.changeSeq).toBe(7);
  });

  it("drops the canonical cache of a group a complete summary no longer lists", () => {
    const state = apply(initialControlState(), { type: "summary", value: summary() }, { type: "group", value: groupView() });
    const next = reduceControlState(state, { type: "summary", value: summary({ changeSeq: 2, groups: [] }) });
    expect(next.canonical).toEqual({});
    expect(next.groups).toEqual({});
  });

  it("keeps untouched caches through a partial (sinceChangeSeq) summary", () => {
    const state = apply(initialControlState(), { type: "summary", value: summary() }, { type: "group", value: groupView() });
    const next = reduceControlState(state, { type: "summary", value: summary({ changeSeq: 2, groups: [] }), partial: true });
    expect(Object.keys(next.canonical)).toEqual(["g"]);
    expect(next.refetchRequired).toBe(false);
  });

  it("clears the conflicted group cache on a revision conflict without touching drafts", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, {
      type: "refusal",
      groupId: "g",
      value: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 },
    });
    expect(next.canonical).toEqual({});
    expect(next.refetchRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.refusal?.code).toBe("revision-conflict");
    expect(next.refusal?.commandRevision).toBe(8);
  });

  it("retains an uncertain command id through lookup and removes it only when resolved", () => {
    const uncertain: UncertainCommand = { groupId: "g", commandId: "cmd-9" };
    const start = reduceControlState(initialControlState(), { type: "summary", value: summary() });
    const pending = reduceControlState(start, { type: "command-uncertain", value: uncertain });
    expect(pending.uncertainCommandIds).toEqual([uncertain]);
    expect(reduceControlState(pending, { type: "command-uncertain", value: uncertain }).uncertainCommandIds).toEqual([uncertain]);
    expect(reduceControlState(pending, { type: "command-resolved", value: uncertain }).uncertainCommandIds).toEqual([]);
  });

  it("never applies a command result locally: only server reads move group state", () => {
    const populated = populatedState();
    const command: UncertainCommand = { groupId: "g", commandId: "cmd-2" };
    const pending = reduceControlState(populated, { type: "command-uncertain", value: command });
    expect(pending.groups).toEqual(populated.groups);
    expect(pending.canonical).toEqual(populated.canonical);
    const resolved = reduceControlState(pending, { type: "command-resolved", value: command });
    expect(resolved.groups).toEqual(populated.groups);
    expect(resolved.canonical).toEqual(populated.canonical);
    expect(resolved.changeSeq).toBe(populated.changeSeq);
  });

  it("purges for a foreign-epoch canonical body instead of caching it", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, { type: "group", value: groupView({ epoch: "epoch-b" }) });
    expect(next.epoch).toBe("epoch-b");
    expect(next.canonical).toEqual({});
    expect(next.drafts).toEqual(populated.drafts);
  });
});
