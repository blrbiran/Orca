/**
 * Tester round 2 spec §9.2 (ruling H11, C30): the hash route codec. Every shape it can write reads back as itself, with
 * parts that need encoding ('/', space, '#', CJK); anything else falls back -- an unknown section to Overview, a known
 * section with a malformed tail to that section alone -- and parsing never throws.
 */
import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute, sectionFromHash, type Route } from "../src/sections.js";

const odd = "a/b c#d任务";
const ROUTES: Route[] = [
  { kind: "section", section: "tasks" },
  { kind: "section", section: "global-settings" },
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
  });

  it.each([
    ["", "overview"], ["#", "overview"], ["#nowhere", "overview"], ["#nowhere/g", "overview"], ["#Tasks", "overview"],
    ["#tasks/", "tasks"], ["#tasks/g/nowhere", "tasks"], ["#tasks/g/runs/t/extra", "tasks"], ["#tasks/%E0%A4%A", "tasks"],
    ["#tasks//runs", "tasks"], ["#requirements/a/b", "requirements"], ["#decisions/only", "decisions"], ["#decisions/a/b/c", "decisions"],
    ["#board/flow", "board"], ["#board/other/f", "board"], ["#board/flow/%ZZ", "board"], ["#metrics/x", "metrics"],
    ["#tasks/.", "tasks"], ["#tasks/g/runs/..", "tasks"], ["#requirements/..", "requirements"], ["#board/flow/%2E%2E", "board"], ["#decisions/p/.", "decisions"],
  ] as const)("falls back for %j to the bare %s section, without throwing", (hash, section) => {
    expect(parseRoute(hash)).toEqual({ kind: "section", section });
    expect(sectionFromHash(hash)).toBe(section);
  });
});
