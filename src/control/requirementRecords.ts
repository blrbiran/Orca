import { z } from "zod";
import { budgetBalance } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { amountSchema, canonicalTimestampSchema, idSchema, panelPartialSelectionSchema, safeInteger } from "./schema.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import { frozenSlotSchema, profileBindingSchema } from "./webProtocol.js";
import type { FrozenSlot } from "./agentSelection.js";
import {
  draftBodySchema, questionIdSchema, requirementExportSchema, roundBodySchema, SLUG_PATTERN,
  type DraftBody, type RoundBody,
} from "./requirementSchemas.js";

/** N1 spec §4.1: the requirement block a clarifying group (and later the group it became) carries. */
export const requirementBlockSchema = z.object({
  requirementId: z.string().regex(/^[a-f0-9]{32}$/), repoId: idSchema, slug: z.string().regex(SLUG_PATTERN).nullable(),
  contentLanguage: z.enum(["en", "zh"]), createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), idea: z.string().min(1),
  profile: profileBindingSchema, agentSlot: frozenSlotSchema,
  /** DR8: the profile's estimatorPreflight.maxOutputTokens, frozen at open; every call of this requirement asks for it. */
  maxOutputTokens: safeInteger.positive(),
  consensus: z.object({ roundNo: safeInteger.positive(), at: canonicalTimestampSchema, openBranches: z.array(z.string().min(1)), openQuestions: z.array(questionIdSchema) }).strict().nullable(),
  acceptedDraftNo: safeInteger.positive().nullable(),
  document: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), recordHash: z.string().regex(/^[a-f0-9]{64}$/), frozenAt: canonicalTimestampSchema }).strict().nullable(),
  export: requirementExportSchema,
}).strict();
export type RequirementBlock = z.infer<typeof requirementBlockSchema>;

export interface ClarifyingGroupInput {
  groupId: string; repoId: string; idea: string; limit: Amount; contentLanguage: "en" | "zh"; createdOn: string; requirementId: string;
  profile: { profileId: string; profileHash: string }; agentSlot: FrozenSlot; agentOverrides: { estimator?: z.infer<typeof panelPartialSelectionSchema> };
  maxOutputTokens: number;
}
type Ledger = { groupLimit: Amount; used: Amount; committedRemaining: Amount; explicitUnallocatedReserve: Amount; budgetDeficit: Amount; usageUnknown: boolean };
/** The fields of a group body this module reads and writes; the rest passes through untouched. */
export interface RequirementGroup {
  groupId: string; status: string; stopped: boolean; used: Amount; reserved: Amount; limit: Amount;
  ledger: Ledger; requirement: RequirementBlock; [key: string]: unknown;
}

const blocked = (detail: string): never => { throw new ControlError("recovery-blocked", detail); };

/**
 * PR-I5: the one place the clarifying ledger mirror is computed. At insert nothing is used or committed, so the whole
 * limit is unallocated; set-limit and usage booking (budget.ts syncRequirementLedger) pass what is used and committed.
 */
export function clarifyingLedger(limit: Amount, used: Amount = zero(), reserved: Amount = zero(), usageUnknown = false): Ledger {
  const { reserve, deficit } = budgetBalance(limit, used, reserved);
  return { groupLimit: limit, used, committedRemaining: reserved, explicitUnallocatedReserve: reserve, budgetDeficit: deficit, usageUnknown };
}

/** PR-I5: the one predicate for "this group body carries a requirement block" (a clarifying group, or the plan group it became). */
export function hasRequirementBlock(group: { requirement?: unknown }): boolean {
  return group.requirement !== undefined;
}

/** N1 spec §4.1, DR18: a clarifying group carries the Web ledger mirror (readWebGroup, readGroupBody), and no plan, proposal or work items. */
export function insertClarifyingGroup(store: ControlStore, input: ClarifyingGroupInput): void {
  amountSchema.parse(input.limit);
  const requirement: RequirementBlock = requirementBlockSchema.parse({
    requirementId: input.requirementId, repoId: input.repoId, slug: null, contentLanguage: input.contentLanguage, createdOn: input.createdOn,
    idea: input.idea, profile: input.profile, agentSlot: input.agentSlot, maxOutputTokens: input.maxOutputTokens, consensus: null, acceptedDraftNo: null, document: null,
    export: { state: "not-due", path: null, commit: null, parent: null, detail: null },
  });
  const firstLine = input.idea.split("\n").find((line) => line.trim().length > 0)?.trim().slice(0, 200) ?? input.groupId;
  const group = {
    groupId: input.groupId, projectKey: input.repoId, goal: firstLine, successConditions: [], budgetMode: "soft", limit: input.limit,
    reviewReserve: zero(), deadlineAt: null, revision: 0, commandRevision: 0, graphVersion: 1, stopped: false, status: "clarifying",
    used: zero(), reserved: zero(), reviewRemaining: zero(), budgetVersion: 1,
    ledger: clarifyingLedger(input.limit),
    agentOverrides: input.agentOverrides, estimatorSlot: null, reconcileSlot: null, requirement,
  };
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,?,0,?)").run(input.groupId, 0, 1, JSON.stringify(group));
}

/** A group that carries a requirement block, in any status (clarifying, or the plan group it became at accept). */
export function readRequirementGroup(store: ControlStore, groupId: string): RequirementGroup {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const group = JSON.parse(String(row.body)) as RequirementGroup;
  if (group.groupId !== groupId || !hasRequirementBlock(group)) throw new ControlError("group-state-invalid");
  const parsed = requirementBlockSchema.safeParse(group.requirement);
  if (!parsed.success) return blocked(`requirement-block:${parsed.error.issues[0]?.path.join(".") ?? "invalid"}`);
  return { ...group, requirement: parsed.data };
}

export function saveRequirementGroup(store: ControlStore, group: RequirementGroup): void {
  requirementBlockSchema.parse(group.requirement);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
  recordProjectionChange(store, [group.groupId]);
}

/**
 * N1 spec §11.1: set-limit on a clarifying group edits the reduced ledger. A limit below what is spent and in flight is
 * refused (group-budget-unavailable), and so is any decrease while usage is unknown (recovery-blocked), as a plan
 * group's set-limit refuses it (webService.ts setLimit; final review finding 7). A raise re-queues a call that waited
 * with requirement-budget-exhausted (spec §5.2).
 */
export function setRequirementLimit(store: ControlStore, groupId: string, limit: Amount): Amount {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") throw new ControlError("group-state-invalid");
  if (canonicalBytes(limit).equals(canonicalBytes(group.limit))) throw new ControlError("no-op-command");
  if (group.ledger.usageUnknown && dimensions.some((d) => limit[d] < group.limit[d])) throw new ControlError("recovery-blocked", "requirement-usage-unknown");
  const ledger = clarifyingLedger(limit, group.used, group.reserved, group.ledger.usageUnknown);
  if (dimensions.some((d) => ledger.budgetDeficit[d] > 0)) throw new ControlError("group-budget-unavailable");
  group.limit = limit;
  group.ledger = ledger;
  saveRequirementGroup(store, group);
  const waiting = latestDraft(store, groupId)?.waiting ?? latestRound(store, groupId)?.waiting ?? null;
  if (waiting !== null) queueRequirementCall(store, groupId, `limit-${sha256Canonical(limit).slice(0, 16)}`);
  return limit;
}

export function isClarifying(store: ControlStore, groupId: string): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row !== undefined && (JSON.parse(String(row.body)) as { status?: unknown }).status === "clarifying";
}

/** N1 spec §4.1 (DR6): every reader of a plan, proposal or work items refuses a clarifying group by name. */
export function refuseClarifying(store: ControlStore, groupId: string): void {
  if (isClarifying(store, groupId)) throw new ControlError("requirement-not-split");
}

export const newRound = (roundNo: number): RoundBody => ({
  roundNo, state: "drafting", retries: 0, lastInvalidReason: null, waiting: null, result: null, answers: null,
  glossaryDecisions: null, adrDecisions: null, answeredAt: null, closedByConsensus: false, reasonCode: null, calls: [],
});
export const newDraft = (draftNo: number, autoRetry: number): DraftBody => ({
  draftNo, state: "drafting", autoRetry, waiting: null, feedback: null, output: null, plan: null, draftHash: null,
  reasons: [], layers: null, implicitEdges: null, reasonCode: null, calls: [],
});

function parsedRound(groupId: string, state: unknown, body: unknown): RoundBody {
  const parsed = roundBodySchema.safeParse(JSON.parse(String(body)));
  if (!parsed.success || parsed.data.state !== state) return blocked(`requirement-round:${groupId}`);
  return parsed.data;
}
function parsedDraft(groupId: string, state: unknown, body: unknown): DraftBody {
  const parsed = draftBodySchema.safeParse(JSON.parse(String(body)));
  if (!parsed.success || parsed.data.state !== state) return blocked(`requirement-draft:${groupId}`);
  return parsed.data;
}

export function readRounds(store: ControlStore, groupId: string): RoundBody[] {
  return store.db.prepare("SELECT state,body FROM requirement_rounds WHERE group_id=? ORDER BY round_no").all(groupId).map((row) => parsedRound(groupId, row.state, row.body));
}
export function readRound(store: ControlStore, groupId: string, roundNo: number): RoundBody {
  const row = store.db.prepare("SELECT state,body FROM requirement_rounds WHERE group_id=? AND round_no=?").get(groupId, roundNo);
  if (!row) throw new ControlError("work-not-found", `round-${roundNo}`);
  return parsedRound(groupId, row.state, row.body);
}
export function latestRound(store: ControlStore, groupId: string): RoundBody | null {
  const row = store.db.prepare("SELECT state,body FROM requirement_rounds WHERE group_id=? ORDER BY round_no DESC LIMIT 1").get(groupId);
  return row ? parsedRound(groupId, row.state, row.body) : null;
}
export function writeRound(store: ControlStore, groupId: string, round: RoundBody): void {
  const body = canonicalBytes(roundBodySchema.parse(round)).toString("utf8");
  store.db.prepare("INSERT INTO requirement_rounds(group_id,round_no,state,body) VALUES (?,?,?,?) ON CONFLICT(group_id,round_no) DO UPDATE SET state=excluded.state, body=excluded.body")
    .run(groupId, round.roundNo, round.state, body);
  recordProjectionChange(store, [groupId]);
}
export function readDrafts(store: ControlStore, groupId: string): DraftBody[] {
  return store.db.prepare("SELECT state,body FROM requirement_drafts WHERE group_id=? ORDER BY draft_no").all(groupId).map((row) => parsedDraft(groupId, row.state, row.body));
}
export function readDraft(store: ControlStore, groupId: string, draftNo: number): DraftBody {
  const row = store.db.prepare("SELECT state,body FROM requirement_drafts WHERE group_id=? AND draft_no=?").get(groupId, draftNo);
  if (!row) throw new ControlError("work-not-found", `draft-${draftNo}`);
  return parsedDraft(groupId, row.state, row.body);
}
export function latestDraft(store: ControlStore, groupId: string): DraftBody | null {
  const row = store.db.prepare("SELECT state,body FROM requirement_drafts WHERE group_id=? ORDER BY draft_no DESC LIMIT 1").get(groupId);
  return row ? parsedDraft(groupId, row.state, row.body) : null;
}
export function writeDraft(store: ControlStore, groupId: string, draft: DraftBody): void {
  const body = canonicalBytes(draftBodySchema.parse(draft)).toString("utf8");
  store.db.prepare("INSERT INTO requirement_drafts(group_id,draft_no,state,body) VALUES (?,?,?,?) ON CONFLICT(group_id,draft_no) DO UPDATE SET state=excluded.state, body=excluded.body")
    .run(groupId, draft.draftNo, draft.state, body);
  recordProjectionChange(store, [groupId]);
}

/** DR14: a durable wake the pump's `requirement-call` handler claims (requirementCalls.ts). Idempotent per tag. */
export function queueRequirementCall(store: ControlStore, groupId: string, tag: string): string {
  const wakeId = `scheduler-wake:${groupId}:requirement-call:${tag}`;
  store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'requirement-call',?,0) ON CONFLICT(id) DO NOTHING")
    .run(wakeId, groupId, canonicalBytes({ groupId }).toString("utf8"));
  return wakeId;
}
