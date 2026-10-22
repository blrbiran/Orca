import { describe, expect, it } from "vitest";
import { activeChain, chainRounds } from "../../src/control/clarifyChain.js";

/**
 * Flow engine spec §10.3 (C10): a revision never overwrites a round; the active chain is computed. A revision of round k
 * takes k's position and drops every later one; the dropped rounds are superseded (shown collapsed, carried as earlier
 * answers). The caps count chain positions, so this is what decides whether another clarify call is due.
 */
describe("activeChain (spec §10.3)", () => {
  it("plain rounds form the chain in round order", () => {
    expect(activeChain([{ roundNo: 2 }, { roundNo: 1 }, { roundNo: 3 }])).toEqual({ chain: [1, 2, 3], superseded: [] });
  });

  it("revising round 2 of three: chain [1, 4], superseded [2, 3]", () => {
    expect(activeChain([{ roundNo: 1 }, { roundNo: 2 }, { roundNo: 3 }, { roundNo: 4, revises: 2 }])).toEqual({ chain: [1, 4], superseded: [2, 3] });
  });

  it("a round after a revision appends; revising the revision replaces it in turn", () => {
    const rows = [{ roundNo: 1 }, { roundNo: 2 }, { roundNo: 3, revises: 1 }, { roundNo: 4 }, { roundNo: 5, revises: 3 }];
    expect(activeChain(rows.slice(0, 4))).toEqual({ chain: [3, 4], superseded: [1, 2] });
    expect(activeChain(rows)).toEqual({ chain: [5], superseded: [1, 2, 3, 4] });
  });

  it("chainRounds returns the rows on the chain, in chain order", () => {
    const rows = [{ roundNo: 1, tag: "a" }, { roundNo: 2, tag: "b" }, { roundNo: 3, revises: 2, tag: "c" }];
    expect(chainRounds(rows).map((row) => row.tag)).toEqual(["a", "c"]);
  });
});
