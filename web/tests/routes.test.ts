/**
 * Tester round 2 spec §9.2 (ruling H11, C30): the hash route codec. Every shape it can write reads back as itself, with
 * parts that need encoding ('/', space, '#', CJK); anything else falls back -- an unknown section to Overview, a known
 * section with a malformed tail to that section alone -- and parsing never throws.
 */
import { describe, expect, it } from "vitest";
import { consumeOwnHash, formatRoute, parseRoute, rememberOwnHash, sectionFromHash, type Route } from "../src/sections.js";

const odd = "a/b c#d任务";
const ROUTES: Route[] = [
  { kind: "section", section: "tasks" },
  // H6(b): the two settings sections are one, with a category per hash. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
  { kind: "section", section: "settings" },
  { kind: "settings", section: "settings", category: "appearance" },
  { kind: "settings", section: "settings", category: "project" },
  { kind: "group", section: "tasks", groupId: odd, region: null, taskId: null },
  { kind: "group", section: "tasks", groupId: odd, region: "runs", taskId: null },
  { kind: "group", section: "tasks", groupId: odd, region: "preparation", taskId: `t ${odd}` },
  { kind: "requirement", section: "requirements", groupId: odd },
  { kind: "decision", section: "decisions", projectKey: `p${odd}`, decisionId: `run/${odd}/1` },
  { kind: "corrections", section: "decisions" },
  { kind: "flow-run", section: "board", flowRunId: odd },
];

describe("route codec (C30)", () => {
  it.each(ROUTES.map((route) => [route.kind, route] as const))("round-trips a %s route, and its hash", (_kind, route) => {
    const hash = formatRoute(route);
    expect(parseRoute(hash)).toEqual(route);
    expect(formatRoute(parseRoute(hash))).toBe(hash);
  });

  it("writes the grammar of §9.2", () => {
    expect(formatRoute({ kind: "group", section: "tasks", groupId: "g", region: "preparation", taskId: "t" })).toBe("#tasks/g/preparation/t");
    expect(formatRoute({ kind: "group", section: "tasks", groupId: "a/b", region: null, taskId: null })).toBe("#tasks/a%2Fb");
    expect(formatRoute({ kind: "flow-run", section: "board", flowRunId: "f1" })).toBe("#board/flow/f1");
    expect(formatRoute({ kind: "decision", section: "decisions", projectKey: "p", decisionId: "d" })).toBe("#decisions/p/d");
    expect(formatRoute({ kind: "settings", section: "settings", category: "agents" })).toBe("#settings/agents");
  });

  // Ruling H6(b) (session 7753e97d): a bookmark or a link written before the merge still lands on what it showed first.
  it.each([
    ["#global-settings", "appearance"], ["#project-settings", "project"], ["#global-settings/x", "appearance"], ["#project-settings/", "project"],
  ] as const)("reads the old settings hash %j as the %s category", (hash, category) => {
    // mutation: drop the old-hash mapping -> the hash is unknown, read as Overview, red
    expect(parseRoute(hash)).toEqual({ kind: "settings", section: "settings", category });
  });

  it.each([
    ["", "overview"], ["#", "overview"], ["#nowhere", "overview"], ["#nowhere/g", "overview"], ["#Tasks", "overview"],
    ["#tasks/", "tasks"], ["#tasks/g/nowhere", "tasks"], ["#tasks/g/runs/t/extra", "tasks"], ["#tasks/%E0%A4%A", "tasks"],
    ["#tasks//runs", "tasks"], ["#requirements/a/b", "requirements"], ["#decisions/only", "decisions"], ["#decisions/a/b/c", "decisions"],
    ["#board/flow", "board"], ["#board/other/f", "board"], ["#board/flow/%ZZ", "board"], ["#metrics/x", "metrics"], ["#settings/nowhere", "settings"], ["#settings/agents/x", "settings"], ["#settings/%61gents", "settings"],
    ["#tasks/.", "tasks"], ["#tasks/g/runs/..", "tasks"], ["#requirements/..", "requirements"], ["#board/flow/%2E%2E", "board"], ["#decisions/p/.", "decisions"],
  ] as const)("falls back for %j to the bare %s section, without throwing", (hash, section) => {
    expect(parseRoute(hash)).toEqual({ kind: "section", section });
    expect(sectionFromHash(hash)).toBe(section);
  });
});

describe("the page's own hashes (review minor 5)", () => {
  const two = rememberOwnHash(rememberOwnHash([], "#tasks/g"), "#tasks/g2");
  it("two quick pushes: each event drops its own hash, and the first one's event is the page's own", () => {
    expect(consumeOwnHash(two, "#tasks/g")).toEqual(["#tasks/g2"]);
    expect(consumeOwnHash(consumeOwnHash(two, "#tasks/g")!, "#tasks/g2")).toEqual([]);
  });
  it("a coalesced event for the newer hash drops the older one too, so the person's later visit to it is theirs", () => {
    const left = consumeOwnHash(two, "#tasks/g2")!;
    expect(left).toEqual([]);
    expect(consumeOwnHash(left, "#tasks/g")).toBeNull();
  });
  it("a hash the page did not write is the person's", () => {
    expect(consumeOwnHash(two, "#metrics")).toBeNull();
  });
});
