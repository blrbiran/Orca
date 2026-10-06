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

/** A new pending request, now its owner's active one. Over MAX_RECORDS, the oldest settled record goes first. */
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
    const settled = records.findIndex((entry) => entry.status.kind !== "pending");
    const [dropped] = records.splice(settled === -1 ? 0 : settled, 1);
    const key = ownerKey(dropped!.owner);
    if (active[key] === dropped!.requestId) delete active[key];
  }
  return { records, active };
}

/** The answer to one request: that record only. */
export function settleRequest(all: DecisionRequests, requestId: string, status: Exclude<RequestStatus, { kind: "pending" }>): DecisionRequests {
  if (!all.records.some((entry) => entry.requestId === requestId)) return all;
  return { ...all, records: all.records.map((entry) => (entry.requestId === requestId ? { ...entry, status } : entry)) };
}

export function dismissRequest(all: DecisionRequests, requestId: string): DecisionRequests {
  return { ...all, records: all.records.map((entry) => (entry.requestId === requestId ? { ...entry, dismissed: true } : entry)) };
}

const isSelected = (entry: DecisionRequest, selected: { projectKey: string; id: string } | null): boolean =>
  selected !== null && ownerKey(entry.owner) === correctionKey(selected.projectKey, selected.id);

/** The record shown inline under the selected decision: only that owner's ACTIVE request. */
export function inlineRequest(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest | null {
  if (selected === null) return null;
  const id = all.active[correctionKey(selected.projectKey, selected.id)];
  const found = all.records.find((entry) => entry.requestId === id);
  return found === undefined || found.dismissed ? null : found;
}

/** Records owned by anything but the selected decision, not dismissed (spec §11 R3 global notice). */
export function noticeRequests(all: DecisionRequests, selected: { projectKey: string; id: string } | null): DecisionRequest[] {
  return all.records.filter((entry) => !entry.dismissed && !isSelected(entry, selected));
}

/** "Record another": a copy of THIS record's payload with again:true, or null when it has none. */
export function retryPayload(record: DecisionRequest): RecordCorrectionInput | null {
  return record.payload === null ? null : { ...record.payload, again: true };
}
