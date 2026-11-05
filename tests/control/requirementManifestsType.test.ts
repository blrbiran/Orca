import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { packageOf } from "../../src/control/requirementManifests.js";

// Issue #135 (session 3cfc2e73; task setup spec, Correction §11): the split has no tools and saw only a package's name,
// scripts and workspaces, so it guessed the module system and wrote `node -e "require(...)"` checks in an ESM repository
// (`"type": "module"`), which then failed. The package's `type` is now sent when the package gives it; a package without
// one is sent exactly as before, so its bytes (and the overview hash) do not move.
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("the split's manifests carry the package's module type (#135)", () => {
  it("sends type when the package gives it", () => {
    expect(packageOf(bytes({ name: "m", type: "module", scripts: { test: "node --test" }, dependencies: { a: "1" } })))
      .toEqual({ name: "m", scripts: { test: "node --test" }, workspaces: null, type: "module" });
    expect(packageOf(bytes({ name: "c", type: "commonjs" }))?.type).toBe("commonjs");
  });

  it("control: a package without type, or with a non-string type, is sent with the same bytes as before", () => {
    const before = { name: "p", scripts: { test: "vitest" }, workspaces: null };
    expect(canonicalBytes(packageOf(bytes({ name: "p", scripts: { test: "vitest" } })))).toEqual(canonicalBytes(before));
    expect(packageOf(bytes({ name: "p", scripts: { test: "vitest" }, type: 1 }))).toEqual(before);
  });
});
