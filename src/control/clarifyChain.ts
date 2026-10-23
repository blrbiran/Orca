import { canonicalBytes } from "./canonicalJson.js";
import type { RoundBody } from "./requirementSchemas.js";

/**
 * Flow engine spec §10.3 (Issue #76, W-76): a clarify step's rounds are never overwritten. A revision of round k is a new
 * row `{revises: k}`; the active chain is computed from the rows, never stored. Pure; shared by the requirement host
 * and the flow host.
 *
 * Rows are taken in `roundNo` order: a plain row appends to the chain; a `revises: k` row takes round k's position and
 * drops every later position. Rows not on the final chain are superseded.
 */
export function activeChain(rows: readonly { roundNo: number; revises?: number }[]): { chain: number[]; superseded: number[] } {
  const chain: number[] = [];
  for (const row of [...rows].sort((left, right) => left.roundNo - right.roundNo)) {
    if (row.revises === undefined) { chain.push(row.roundNo); continue; }
    const position = chain.indexOf(row.revises);
    // A revision of a round that is not on the chain is never written (the verb refuses it); read as a plain row.
    if (position === -1) { chain.push(row.roundNo); continue; }
    chain.splice(position, chain.length - position, row.roundNo);
  }
  const onChain = new Set(chain);
  const superseded = rows.map((row) => row.roundNo).filter((roundNo) => !onChain.has(roundNo)).sort((left, right) => left - right);
  return { chain, superseded };
}

/**
 * Spec §10.3: the rounds a next round's prompt carries as "earlier answers that may still apply" -- the superseded ones,
 * minus any a revision excluded. Shared by both hosts.
 */
export function supersededForPrompt<T extends { roundNo: number; revises?: number; exclude?: readonly number[] }>(rounds: readonly T[]): T[] {
  const { superseded } = activeChain(rounds);
  const excluded = new Set(rounds.flatMap((r) => r.exclude ?? []));
  return rounds.filter((r) => superseded.includes(r.roundNo) && !excluded.has(r.roundNo));
}

/** The rounds on the active chain, in chain order. */
export function chainRounds<T extends { roundNo: number; revises?: number }>(rows: readonly T[]): T[] {
  const byNo = new Map(rows.map((row) => [row.roundNo, row]));
  return activeChain(rows).chain.map((roundNo) => byNo.get(roundNo)!);
}

/** Spec §10.3: a revision's payload, as `requirement-revise` and a flow `edit` at a round carry it. */
export interface RevisionPayload {
  roundNo: number;
  answers: ReadonlyArray<{ id: string; kind: "recommended" } | { id: string; kind: "text"; text: string }>;
  glossaryDecisions: ReadonlyArray<{ id: string; accept: boolean }>; adrDecisions: ReadonlyArray<{ id: string; accept: boolean }>;
  reason?: string; exclude?: readonly number[];
}
/** Why a revision is refused, in the order the checks run. */
export type RevisionRefusal = "round-not-revisable" | "exclude" | "answers" | "glossary-decisions" | "adr-decisions" | "revision-unchanged";
/** The appended revision row and what re-advancing needs: round k, the chain before, and the chain length after. */
export interface Revision { revised: RoundBody; row: RoundBody; chainBefore: number[]; newChainLength: number }

const sameIds = (given: readonly string[], expected: readonly string[]) =>
  given.length === expected.length && new Set(given).size === given.length && expected.every((id) => given.includes(id));
/** The answers and decisions of a round as compared for `revision-unchanged`: answers in question order, decisions by id. */
const answeredForm = (answers: readonly { id: string; kind: string; text: string }[], glossary: readonly { id: string; accept: boolean }[], adrs: readonly { id: string; accept: boolean }[]) =>
  canonicalBytes({ answers, glossary: [...glossary].sort((a, b) => a.id.localeCompare(b.id)), adrs: [...adrs].sort((a, b) => a.id.localeCompare(b.id)) }).toString("utf8");

/**
 * Spec §10.3, shared by both hosts: check a revision of round `payload.roundNo` against one step execution's rows and
 * build the row it appends (n+1, `{revises: k}`, round k's result copied). Round k must be on the active chain and
 * answered; the payload covers exactly its ids and differs in at least one item. Pure: nothing is written here.
 */
export function reviseRound(rounds: readonly RoundBody[], payload: RevisionPayload, who: { at: string; by: string; via?: string }): { refusal: RevisionRefusal } | Revision {
  const { chain, superseded } = activeChain(rounds);
  const round = rounds.find((r) => r.roundNo === payload.roundNo);
  if (round === undefined || !chain.includes(round.roundNo) || round.state !== "answered" || round.result === null) return { refusal: "round-not-revisable" };
  // `exclude` may name only rounds this revision leaves off the chain: those already superseded, round k and its successors.
  const leftOff = [...superseded, ...chain.slice(chain.indexOf(round.roundNo))];
  if ((payload.exclude ?? []).some((roundNo) => !leftOff.includes(roundNo))) return { refusal: "exclude" };
  const result = round.result;
  if (!sameIds(payload.answers.map((a) => a.id), result.questions.map((q) => q.id))) return { refusal: "answers" };
  if (!sameIds(payload.glossaryDecisions.map((d) => d.id), result.glossary.map((e) => e.id))) return { refusal: "glossary-decisions" };
  if (!sameIds(payload.adrDecisions.map((d) => d.id), result.adrs.map((a) => a.id))) return { refusal: "adr-decisions" };
  const given = new Map(payload.answers.map((a) => [a.id, a]));
  const answers = result.questions.map((q) => {
    const a = given.get(q.id)!;
    return { id: q.id, kind: a.kind, text: a.kind === "text" ? a.text : q.recommendedAnswer };
  });
  const glossaryDecisions = payload.glossaryDecisions.map((d) => ({ id: d.id, accept: d.accept }));
  const adrDecisions = payload.adrDecisions.map((d) => ({ id: d.id, accept: d.accept }));
  if (answeredForm(answers, glossaryDecisions, adrDecisions) === answeredForm(round.answers ?? [], round.glossaryDecisions ?? [], round.adrDecisions ?? [])) {
    return { refusal: "revision-unchanged" };
  }
  const exclude = [...new Set(payload.exclude ?? [])].sort((a, b) => a - b);
  const row: RoundBody = {
    roundNo: Math.max(...rounds.map((r) => r.roundNo)) + 1, state: "answered", retries: 0, lastInvalidReason: null, waiting: null, result, answers,
    glossaryDecisions, adrDecisions, answeredAt: who.at, closedByConsensus: false, reasonCode: null, calls: [],
    revises: round.roundNo, ...(payload.reason === undefined ? {} : { reason: payload.reason }), by: who.by, ...(who.via === undefined ? {} : { via: who.via }),
    ...(exclude.length === 0 ? {} : { exclude }),
  };
  return { revised: round, row, chainBefore: chain, newChainLength: chain.indexOf(round.roundNo) + 1 };
}
