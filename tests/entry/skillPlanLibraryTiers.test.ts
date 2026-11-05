import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { socketTier } from "../../src/panel/humanOnly.js";

// Issue #155 (session 3cfc2e73): SKILL.md core rule 6 said every plan-library and schedule write is refused without a
// person token, so an agent asked the person for a token it did not need (a new save, an archive) or never tried a
// disable. The tiers are the code's (src/panel/humanOnly.ts SOCKET_TIER; spec 2026-10-24 §11.1-§11.2) and stay as they
// are; the skill now says which writes need the token and which do not.
const skill = readFileSync("skills/orca-control/SKILL.md", "utf8").replace(/\s+/g, " ");

describe("SKILL.md rule 6 matches the socket tiers of the plan-library and schedule writes (#155)", () => {
  it("the writes the skill says need no person token are open on the socket", () => {
    expect(socketTier("plan-library-save", { source: { kind: "group", groupId: "g" }, name: "n" })).toBe("open");
    expect(socketTier("plan-library-archive", { entryId: "pl-1" })).toBe("open");
    expect(socketTier("schedule-enable", { scheduleId: "s", enabled: false })).toBe("open");
    expect(socketTier("schedule-remove", { scheduleId: "s" })).toBe("open");
    expect(socketTier("schedule-resume", { scheduleId: "s" })).toBe("open");
    expect(skill).toContain("A new `plan save`, `plan archive` and disabling, removing or resuming a schedule need no person token.");
  });

  it("the writes the skill lists as a person's are token on the socket", () => {
    expect(socketTier("plan-library-save", { source: { kind: "group", groupId: "g" }, name: "n", entryId: "pl-1" })).toBe("token");
    expect(socketTier("plan-library-import", { projectId: "p", name: "n", doc: {}, provenance: {} })).toBe("token");
    expect(socketTier("schedule-set", { projectId: "p" })).toBe("token");
    expect(socketTier("schedule-from-group", { groupId: "g" })).toBe("token");
    expect(socketTier("schedule-enable", { scheduleId: "s", enabled: true })).toBe("token");
    expect(skill).toContain("appending a plan-library version (`plan save --entry`) or importing a file into the library, setting a schedule, making one from a group or enabling one");
    expect(skill).not.toContain("plan-library and schedule writes, orchestration limits");
  });
});
