// CLI v2 spec §11 (plan Task 13): every control verb the panel knows has a registry command, or is named on the explicit
// escape-hatch-only list -- so a new verb cannot silently miss the CLI, the generated references and the MCP tool.
import { describe, expect, it } from "vitest";
import { ESCAPE_HATCH_ONLY, REGISTRY } from "../../src/commands/registry.js";
import { VERB_ACCESS } from "../../src/panel/humanOnly.js";

describe("verb coverage (spec §11)", () => {
  it("every verb in VERB_ACCESS has a registry row or is escape-hatch only", () => {
    const mapped = new Set(REGISTRY.flatMap((def) => (def.mapsTo.kind === "verb" ? [def.mapsTo.verb] : [])));
    const missing = Object.keys(VERB_ACCESS).filter((verb) => !mapped.has(verb as never) && !(ESCAPE_HATCH_ONLY as readonly string[]).includes(verb));
    expect(missing).toEqual([]);
  });

  it("the escape-hatch list names only real verbs that have no command (it cannot hide a mapped verb)", () => {
    expect([...ESCAPE_HATCH_ONLY]).toEqual(["shutdown", "system-debug-open"]);
    const mapped = new Set(REGISTRY.flatMap((def) => (def.mapsTo.kind === "verb" ? [def.mapsTo.verb] : [])));
    for (const verb of ESCAPE_HATCH_ONLY) {
      expect(Object.keys(VERB_ACCESS)).toContain(verb);
      expect(mapped.has(verb as never)).toBe(false);
    }
  });
});
