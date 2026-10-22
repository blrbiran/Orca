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

/** The rounds on the active chain, in chain order. */
export function chainRounds<T extends { roundNo: number; revises?: number }>(rows: readonly T[]): T[] {
  const byNo = new Map(rows.map((row) => [row.roundNo, row]));
  return activeChain(rows).chain.map((roundNo) => byNo.get(roundNo)!);
}
