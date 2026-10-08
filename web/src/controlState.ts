/**
 * Task 9: the browser's entire control state, as a pure reducer.
 *
 * The client owns no execution authority: nothing here advances a group's state,
 * revision or budget. Every fact comes from a server read (summary, group,
 * recovery), and a command's only client-visible effect is the id it is waiting
 * on. What survives a purge is deliberately split: canonical caches are the
 * server's truth under an epoch, so an epoch change or a `resetRequired` answer
 * voids them; a typed draft and an unresolved command id are the person's own
 * context, so they are kept and re-sent or looked up after the reload.
 */
import type { ControlSummaryV1, GroupSummaryV1, GroupViewV1, RecoveryViewV1 } from "./controlTypes.js";

export interface UncertainCommand {
  groupId: string;
  commandId: string;
}

/** A refusal as the server answered it. `status` is null when no answer arrived at all. */
export interface ControlRefusal {
  status: number | null;
  code: string;
  message: string;
  commandRevision: number | null;
}

/** Where a refusal is shown (spec 2026-10-08 §2.2(d)). */
export type RefusalPlace = "group" | "import" | "panel";

export interface ControlClientState {
  epoch: string | null;
  changeSeq: number;
  resetRequired: boolean;
  /** The caches were voided; the visible groups must be re-read before another command. */
  refetchRequired: boolean;
  dispatchBlocked: boolean;
  groups: Record<string, GroupSummaryV1>;
  canonical: Record<string, GroupViewV1>;
  recovery: RecoveryViewV1 | null;
  drafts: Record<string, string>;
  uncertainCommandIds: UncertainCommand[];
  /** Spec 2026-10-08 §2.2(d): each group's last refusal, shown at the top of its view until a later success of that group. */
  refusals: Record<string, ControlRefusal>;
  /** The last import's refusal, shown in the import form until an import succeeds. */
  importRefusal: ControlRefusal | null;
  /** A refusal that belongs to no group and no import (a poll, the agents table, a repository's settings): the panel's own line. */
  panelRefusal: ControlRefusal | null;
}

export type ControlClientEvent =
  | { type: "summary"; value: ControlSummaryV1; partial?: boolean }
  | { type: "group"; value: GroupViewV1 }
  | { type: "recovery"; value: RecoveryViewV1 }
  | { type: "draft"; key: string; text: string }
  | { type: "command-uncertain"; value: UncertainCommand }
  | { type: "command-resolved"; value: UncertainCommand }
  // groupId on a panel refusal is the scope a revision conflict voids (e.g. @repository:<id>), never where it is shown.
  | { type: "refusal"; place: "group"; groupId: string; value: ControlRefusal }
  | { type: "refusal"; place: "import" | "panel"; groupId: string | null; value: ControlRefusal }
  | { type: "command-succeeded"; place: "group" | "import"; groupId: string };

export function initialControlState(): ControlClientState {
  return {
    epoch: null, changeSeq: 0, resetRequired: false, refetchRequired: false, dispatchBlocked: false,
    groups: {}, canonical: {}, recovery: null, drafts: {}, uncertainCommandIds: [], refusals: {}, importRefusal: null, panelRefusal: null,
  };
}

/**
 * The page's summary line: the client's projection of the server's own DTO. Only
 * rendered once a first answer has arrived, so `epoch` is never actually empty.
 */
export function summaryView(state: ControlClientState): ControlSummaryV1 {
  return {
    schema: "orca-control-summary-v1",
    epoch: state.epoch ?? "",
    changeSeq: state.changeSeq,
    resetRequired: state.resetRequired,
    dispatchBlocked: state.dispatchBlocked,
    groups: Object.values(state.groups),
  };
}

function purged(state: ControlClientState, epoch: string): ControlClientState {
  return { ...state, epoch, groups: {}, canonical: {}, recovery: null, refetchRequired: true };
}

function keyOf(command: UncertainCommand): string {
  return `${command.groupId}\0${command.commandId}`;
}

function summaries(values: readonly GroupSummaryV1[]): Record<string, GroupSummaryV1> {
  return Object.fromEntries(values.map((value) => [value.groupId, value]));
}

function withoutStale(canonical: Record<string, GroupViewV1>, listed: readonly GroupSummaryV1[]): Record<string, GroupViewV1> {
  const present = new Set(listed.map((value) => value.groupId));
  return Object.fromEntries(Object.entries(canonical).filter(([groupId]) => present.has(groupId)));
}

function reduceSummary(state: ControlClientState, event: Extract<ControlClientEvent, { type: "summary" }>): ControlClientState {
  const value = event.value;
  // The server answers every complete read with `resetRequired: true` (web-recoverable-control spec §3.2), so the
  // complete summary the refetch mark asked for is the reset itself, not a reason for another one: taking it as one
  // voided the cache on every tick, forever, and unmounted the whole control panel each time.
  const reread = event.partial !== true && state.refetchRequired;
  const purge = (state.epoch !== null && state.epoch !== value.epoch) || (value.resetRequired && !reread);
  if (!purge && value.changeSeq < state.changeSeq) return state;
  // A `sinceChangeSeq` answer lists every group that moved after N however far changeSeq went, and the server
  // itself says resetRequired when it can no longer tell; a jump past N + 1 there is a busy group, not a gap.
  const gap = !purge && !reread && event.partial !== true && value.changeSeq > state.changeSeq + 1;
  const base = purge ? purged(state, value.epoch) : { ...state, epoch: value.epoch };
  const canonical = purge || gap ? {} : event.partial ? base.canonical : withoutStale(base.canonical, value.groups);
  return {
    ...base,
    changeSeq: value.changeSeq,
    resetRequired: value.resetRequired,
    dispatchBlocked: value.dispatchBlocked,
    // Only a complete summary that itself neither purged nor gapped shows the projection whole again; a partial
    // one lists only what moved, so it cannot lift the mark.
    refetchRequired: purge || gap || (event.partial === true && base.refetchRequired),
    // A complete summary lists every group there is; a `sinceChangeSeq` answer lists
    // only the ones that moved, so the rest of the cache has to stay.
    groups: purge || !event.partial ? summaries(value.groups) : { ...base.groups, ...summaries(value.groups) },
    canonical,
  };
}

function reduceGroup(state: ControlClientState, value: GroupViewV1): ControlClientState {
  if (state.epoch !== null && state.epoch !== value.epoch) return purged(state, value.epoch);
  const cached = state.canonical[value.summary.groupId];
  if (cached && cached.changeSeq > value.changeSeq) return state;
  return { ...state, canonical: { ...state.canonical, [value.summary.groupId]: value } };
}

function reduceRecovery(state: ControlClientState, value: RecoveryViewV1): ControlClientState {
  // Project filtering spec §11 R1: a recovery view of a new epoch voids the caches like any epoch change, but it is
  // itself the new epoch's truth, so it is kept: its blockers stay visible, non-actionable until the complete re-read.
  if (state.epoch !== null && state.epoch !== value.epoch) return { ...purged(state, value.epoch), recovery: value, dispatchBlocked: value.dispatchBlocked };
  return { ...state, recovery: value, dispatchBlocked: value.dispatchBlocked };
}

export function reduceControlState(state: ControlClientState, event: ControlClientEvent): ControlClientState {
  switch (event.type) {
    case "summary":
      return reduceSummary(state, event);
    case "group":
      return reduceGroup(state, event.value);
    case "recovery":
      return reduceRecovery(state, event.value);
    case "draft": {
      const drafts = { ...state.drafts };
      if (event.text === "") delete drafts[event.key];
      else drafts[event.key] = event.text;
      return { ...state, drafts };
    }
    case "command-uncertain":
      return state.uncertainCommandIds.some((command) => keyOf(command) === keyOf(event.value))
        ? state
        : { ...state, uncertainCommandIds: [...state.uncertainCommandIds, event.value] };
    case "command-resolved":
      return { ...state, uncertainCommandIds: state.uncertainCommandIds.filter((command) => keyOf(command) !== keyOf(event.value)) };
    case "refusal": {
      const next: ControlClientState = event.place === "group"
        ? { ...state, refusals: { ...state.refusals, [event.groupId]: event.value } }
        : event.place === "import" ? { ...state, importRefusal: event.value } : { ...state, panelRefusal: event.value };
      // Another tab committed first: the cached revision is the server's older self, so
      // the only safe move is to drop it and re-read before offering the command again.
      if (event.value.code !== "revision-conflict" || event.groupId === null) return next;
      const canonical = { ...next.canonical };
      delete canonical[event.groupId];
      return { ...next, canonical, refetchRequired: true };
    }
    case "command-succeeded": {
      if (event.place === "import") return { ...state, importRefusal: null };
      if (!Object.prototype.hasOwnProperty.call(state.refusals, event.groupId)) return state;
      const refusals = { ...state.refusals };
      delete refusals[event.groupId];
      return { ...state, refusals };
    }
  }
}
