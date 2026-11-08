import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

function documentStartingWith(prefix: string) {
  for (let n = 0; n < 1000; n++) {
    const doc = { schema: "orca-plan-v1", goal: `${prefix}-${n}`, successConditions: [], tasks: [] };
    const sha256 = sha256Canonical(doc);
    if (sha256.startsWith(prefix)) return { doc, sha256 };
  }
  throw new Error(`no document SHA begins with ${prefix}`);
}

const FIRST = documentStartingWith("a"), SECOND = documentStartingWith("1");
const ENTRY = "pl-1";
const routes = {
  [`GET plan-library/${ENTRY}`]: { status: 200, body: { schema: "orca-plan-library-entry-v1", entryId: ENTRY, projectId: "repo-1",
    head: { version: 2, sha256: SECOND.sha256 }, versions: [{ version: 1, sha256: FIRST.sha256 }, { version: 2, sha256: SECOND.sha256 }] } },
  [`GET plan-library/${ENTRY}/versions/${FIRST.sha256}`]: { status: 200, body: FIRST.doc },
  [`GET plan-library/${ENTRY}/versions/${SECOND.sha256}`]: { status: 200, body: SECOND.doc },
};

describe("plan library version selection (tester #181)", () => {
  it.each([
    ["1", FIRST], ["2", SECOND], ["sha256:1", SECOND], ["a", FIRST], [FIRST.sha256, FIRST],
  ])("show --version %s reads the requested document", async (version, selected) => {
    const w = await world({}, routes);
    const out = await cli(["plan", "show", ENTRY, "--version", version, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.json().body.document).toEqual(selected.doc);
    expect(w.requests.filter((r) => r.path.includes("/versions/")).map((r) => r.path)).toEqual([`plan-library/${ENTRY}/versions/${selected.sha256}`]);
  });

  it("export --version 1 writes the first document's canonical bytes", async () => {
    const w = await world({}, routes);
    const target = join(mkdtempSync(join(tmpdir(), "orca-version-")), "selected.json");
    const out = await cli(["plan", "export", ENTRY, "--version", "1", "--out", target, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(readFileSync(target)).toEqual(canonicalBytes(FIRST.doc));
    expect(out.json().body.sha256).toBe(FIRST.sha256);
  });

  it("export without --version writes the newest document and refuses an existing file", async () => {
    const w = await world({}, routes);
    const target = join(mkdtempSync(join(tmpdir(), "orca-version-")), "selected.json");
    const out = await cli(["plan", "export", ENTRY, "--out", target, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(readFileSync(target)).toEqual(canonicalBytes(SECOND.doc));
    writeFileSync(target, "mine");
    const again = await cli(["plan", "export", ENTRY, "--version", "1", "--out", target, "--json"], w.dir);
    expect([again.code, again.json().body.error?.message]).toEqual([1, "--out exists"]);
    expect(readFileSync(target, "utf8")).toBe("mine");
  });

  it("lists available version numbers and hashes when a number is missing", async () => {
    const w = await world({}, routes);
    const out = await cli(["plan", "show", ENTRY, "--version", "3"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('no version "3" in pl-1');
    expect(out.stderr).toContain(`1 (${FIRST.sha256.slice(0, 12)})`);
    expect(out.stderr).toContain(`2 (${SECOND.sha256.slice(0, 12)})`);
  });

  it("keeps ambiguous SHA prefixes rejected", async () => {
    const a = "ab" + "0".repeat(62), b = "ac" + "0".repeat(62);
    const w = await world({}, { [`GET plan-library/${ENTRY}`]: { status: 200, body: { entryId: ENTRY, projectId: "repo-1", head: { version: 2, sha256: b },
      versions: [{ version: 1, sha256: a }, { version: 2, sha256: b }] } } });
    const out = await cli(["plan", "show", ENTRY, "--version", "a", "--json"], w.dir);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "id-ambiguous"]);
    expect(w.requests.filter((r) => r.path.includes("/versions/"))).toEqual([]);
  });
});
