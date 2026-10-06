/**
 * Project filtering spec §11 R3: every Agree or Correct is a request record -- its owner `(projectKey, decisionId)`,
 * its verb, an independent copy of the exact payload it sent, and a browser correlation id -- and every answer updates
 * only its own record. The record is what a result is shown under and what "Record another" re-sends, so neither the
 * selected detail nor the form on screen can change which decision a result or a retry belongs to.
 *
 * `requestId` is only a browser correlation token: it is never sent, it is not an idempotency key, and it promises
 * nothing about how the server treats a retry. Pure, App-owned memory: bounded, never persisted.
 */
import type { PanelRefusal, RecordCorrectionInput } from "./api.js";
import { correctionKey } from "./detailDrafts.js";

export type RecordedKey = "decisions.recordedReviewed" | "decisions.correctionRecorded";
export type RequestStatus = { kind: "pending" } | { kind: "recorded"; text: RecordedKey } | { kind: "refused"; refusal: PanelRefusal };
export interface DecisionRequest {
  requestId: string; // browser correlation token only (spec §11 R3)
  owner: { projectKey: string; decisionId: string };
  verb: "agree" | "correct";
  payload: RecordCorrectionInput | null; // an independent copy; null for agree
  status: RequestStatus;
  dismissed: boolean;
}
/** `active`: correctionKey(owner) -> the requestId of that owner's latest request. */
export interface DecisionRequests { records: DecisionRequest[]; active: Record<string, string> }
export const MAX_RECORDS = 20;
export const EMPTY_REQUESTS: DecisionRequests = { records: [], active: {} };

const ownerKey = (owner: DecisionRequest["owner"]): string => correctionKey(owner.projectKey, owner.decisionId);

/**
 * A new pending request, now its owner's active one. Over MAX_RECORDS only settled records are evicted, oldest first
 * within each class: dismissed ones, then recorded ones, then refusals (an unseen refusal is the last thing to lose).
 * A pending record is never evicted -- its answer must still land -- so with nothing settled the list may exceed the bound.
 */
export function startRequest(all: DecisionRequests, record: Omit<DecisionRequest, "status" | "dismissed">): DecisionRequests {
  const started: DecisionRequest = {
    requestId: record.requestId,
    owner: { ...record.owner },
    verb: record.verb,
    payload: record.payload === null ? null : { ...record.payload },
    status: { kind: "pending" },
    dismissed: false,
  };
  const records = [...all.records, started];
  const active = { ...all.active, [ownerKey(started.owner)]: started.requestId };
  while (records.length > MAX_RECORDS) {
    const index = evictable(records);
    if (index === -1) break;
    const [dropped] = records.splice(index, 1);
    const key = ownerKey(dropped!.owner);
    if (active[key] === dropped!.requestId) delete active[key];
  }
  return { records, active };
}

/** The oldest settled record to evict: dismissed first, then recorded, then refused; -1 when every record is pending. */
function evictable(records: DecisionRequest[]): number {
  const settled = (entry: DecisionRequest): boolean => entry.status.kind !== "pending";
  for (const pick of [
    (entry: DecisionRequest) => settled(entry) && entry.dismissed,
    (entry: DecisionRequest) => entry.status.kind === "recorded",
    (entry: DecisionRequest) => entry.status.kind === "refused",
  ]) {
    const index = records.findIndex(pick);
    if (index !== -1) return index;
  }
  return -1;
}

/** The answer to one request: that record only. */
export function settleRequest(all: DecisionRequests, requestId: string, status: Exclude<RequestStatus, { kind: "pending" }>): DecisionRequests {
  if (!all.records.some((entry) => entry.requestId === requestId)) return all;
  return { ...all, records: all.records.map((entry) => (entry.requestId === requestId ? { ...entry, status } : entry)) };
}

export function dismissRequest(all: DecisionRequests, requestId: string): DecisionRequests {
  return { ...all, records: all.records.map((entry) => (entry.requestId === requestId ? { ...entry, dismissed: true } : entry)) };
}

/** The record shown inline under the selected decision: only that owner's ACTIVE request. */
export function inlineRequest(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest | null {
  if (selected === null) return null;
  const id = all.active[correctionKey(selected.projectKey, selected.id)];
  const found = all.records.find((entry) => entry.requestId === id);
  return found === undefined || found.dismissed ? null : found;
}

/**
 * Every record not dismissed except the one shown inline (spec §11 R3 global notice). Fix round 1 (I1): this departs
 * from the plan brief's "owned by anything but the selected decision" -- an older, non-active request of the OPEN owner
 * (e.g. its refusal while a newer request is pending) would otherwise be shown nowhere. Controller ruling: spec §8 wins.
 */
export function noticeRequests(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest[] {
  const shown = inlineRequest(all, selected)?.requestId;
  return all.records.filter((entry) => !entry.dismissed && entry.requestId !== shown);
}

/** "Record another": a copy of THIS record's payload with again:true, or null when it has none. */
export function retryPayload(record: DecisionRequest): RecordCorrectionInput | null {
  return record.payload === null ? null : { ...record.payload, again: true };
}
