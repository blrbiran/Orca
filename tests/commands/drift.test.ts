// CLI v2 spec §11 (plan Task 13): the references, the command section of docs/cli.md and the skill's `version:` are
// generated from the registry by `npm run gen:cli-docs`. Regenerated in memory here, every file must equal the committed
// one byte for byte; a hand edit of a generated file, or a registry change without regenerating, is red.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDocs, GENERATED_HEADER, generatorInputs } from "../../src/commands/generate.js";
import { REGISTRY } from "../../src/commands/registry.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const REFERENCES = join(ROOT, "skills", "orca-control", "references");

describe("generated CLI docs (spec §11)", () => {
  const generated = generateDocs(generatorInputs(ROOT));

  it("every generated file equals the committed one, byte for byte", () => {
    expect(generated.size).toBeGreaterThan(5);
    for (const [path, text] of generated) {
      expect(existsSync(join(ROOT, path)), `${path} is not committed; run npm run gen:cli-docs`).toBe(true);
      expect(readFileSync(join(ROOT, path), "utf8"), `${path} differs from the registry; run npm run gen:cli-docs`).toBe(text);
    }
  });

  it("no stale generated reference is left behind, and each generated reference starts with the header", () => {
    const onDisk = readdirSync(REFERENCES).filter((name) => readFileSync(join(REFERENCES, name), "utf8").startsWith(GENERATED_HEADER));
    const expected = [...generated.keys()].filter((path) => path.startsWith("skills/orca-control/references/")).map((path) => path.split("/").at(-1)!);
    expect(onDisk.sort()).toEqual(expected.sort());
    for (const name of ["troubleshooting.md", "escape-hatch.md"]) {
      expect(readFileSync(join(REFERENCES, name), "utf8").startsWith(GENERATED_HEADER), `${name} is hand-written`).toBe(false);
    }
  });

  it("a registry row change shows in the regenerated reference (the generator reads the registry, not a copy)", () => {
    const rows = REGISTRY.map((def) => (def.domain === "group" && def.action === "start" ? { ...def, summary: "SENTINEL summary" } : def));
    const changed = generateDocs({ ...generatorInputs(ROOT), registry: rows });
    expect(changed.get("skills/orca-control/references/group.md")).toContain("SENTINEL summary");
    expect(generated.get("skills/orca-control/references/group.md")).not.toContain("SENTINEL summary");
  });

  it("docs/cli.md keeps its hand-written text outside the markers", () => {
    const cli = generated.get("docs/cli.md")!;
    expect(cli.startsWith("# Orca CLI and development reference\n")).toBe(true);
    expect(cli).toContain("<!-- generated:commands -->");
    expect(cli).toContain("<!-- /generated:commands -->");
    expect(cli).toContain("## Tier 0 gate");
  });
});
