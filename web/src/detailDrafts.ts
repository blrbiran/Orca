/**
 * Project filtering spec §6 and §11 R2: the person's unsent detail inputs, owned by App so they outlive the detail that
 * shows them. Each slot is keyed by its owner's full identity, so selecting another owner restores only that owner's
 * draft (or its defaults) and never another's. Lifetime is the App instance: nothing is persisted or sent to a server.
 */
import type { CorrectionForm } from "./api.js";
import type { PanelLanguage } from "./i18n.js";

export type AnswerChoice = { kind: "recommended" } | { kind: "text"; text: string };
export interface NewRequirementDraft { idea: string; tokens: number; language: PanelLanguage; agent: string }
export interface AnswerDraft { choice: Record<string, AnswerChoice>; decisions: Record<string, boolean> }
export interface DetailDrafts {
  newRequirement: Record<string, NewRequirementDraft>; // key: repoId
  answer: Record<string, AnswerDraft>; // key: answerKey
  feedback: Record<string, string>; // key: feedbackKey
  limit: Record<string, number>; // key: limitKey
  correction: Record<string, CorrectionForm>; // key: correctionKey
}
export type DraftSlot = keyof DetailDrafts;
export const EMPTY_DRAFTS: DetailDrafts = { newRequirement: {}, answer: {}, feedback: {}, limit: {}, correction: {} };

/** How a component reads and writes the store; App's is the real owner, a standalone panel may hold its own. */
export interface EditableDrafts {
  drafts: DetailDrafts;
  onDraft: <S extends DraftSlot>(slot: S, key: string, value: DetailDrafts[S][string]) => void;
}

// JSON.stringify of a tuple is injective (DecisionList.tsx rowKey comment).
export const answerKey = (repoId: string, groupId: string, requirementId: string, roundNo: number): string => JSON.stringify([repoId, groupId, requirementId, roundNo]);
export const feedbackKey = (repoId: string, groupId: string, requirementId: string, draftNo: number): string => JSON.stringify([repoId, groupId, requirementId, draftNo]);
export const limitKey = (repoId: string, groupId: string): string => JSON.stringify([repoId, groupId]);
export const correctionKey = (projectKey: string, decisionId: string): string => JSON.stringify([projectKey, decisionId]);

export function setDraft<S extends DraftSlot>(all: DetailDrafts, slot: S, key: string, value: DetailDrafts[S][string]): DetailDrafts {
  return { ...all, [slot]: { ...all[slot], [key]: value } };
}

/** Spec §11 R2: clear only when the stored draft still equals what was submitted. */
export function clearIfUnchanged<S extends DraftSlot>(all: DetailDrafts, slot: S, key: string, submitted: DetailDrafts[S][string]): DetailDrafts {
  const stored = all[slot][key];
  if (stored === undefined || JSON.stringify(stored) !== JSON.stringify(submitted)) return all;
  const { [key]: _cleared, ...rest } = all[slot];
  return { ...all, [slot]: rest };
}
