import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const A = "a".repeat(64), B = "b".repeat(64);

describe("plan version misses name the versions that exist (tester #181)", () => {
  it("lists the entry's versions in the refusal", async () => {
    const w = await world({}, {
      "GET plan-library/pl-1": { status: 200, body: { entryId: "pl-1", projectId: "repo-1", head: { sha256: A }, versions: [{ sha256: A }, { sha256: B }] } },
    });
    const out = await cli(["plan", "show", "pl-1", "--version", "nope"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain(`no version "nope" in pl-1; it has 2 version(s): ${A.slice(0, 12)}, ${B.slice(0, 12)}`);
  });
});
