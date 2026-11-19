// Working-tree delivery spec 2026-11-19 §4.2, §10.1 (#365): "never chosen" is the repository default's absence, so the
// first-use question can be asked; `keep` set by a person is stored and recorded as a choice. Group copies keep R5.
import { describe, expect, it } from "vitest";
import { applySetIntegrationScheme, type SetIntegrationSchemeCommand } from "../../src/control/integrationCommands.js";
import { integrationChosen, readIntegrationDefault, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { openTestStore } from "./fixtures/store.js";

const cmd = (integration: IntegrationScheme, expectedRevision: number, commandId: string): SetIntegrationSchemeCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "human", verb: "set-integration-scheme",
  target: { kind: "repository", repoId: "repo" }, payload: { integration },
});
const code = (result: unknown): string => (result as { error?: { code: string } }).error?.code ?? "applied";

describe("the project's delivery choice (spec §4.2)", () => {
  it("is not chosen on a fresh repository; keep is applied and stored; keep again is a no-op; the default reads keep throughout", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: (id: string) => id === "repo" };
      expect(integrationChosen(h.store, "repo")).toBe(false);
      expect(readIntegrationDefault(h.store, "repo").scheme).toEqual({ delivery: "keep" });
      // mutation: revert the explicit-keep write (keep deletes the field) -> chosen stays false, red
      expect(code(applySetIntegrationScheme(deps, cmd({ delivery: "keep" }, 0, "k1")))).toBe("applied");
      expect(integrationChosen(h.store, "repo")).toBe(true);
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: { delivery: "keep" }, revision: 1 });
      expect(code(applySetIntegrationScheme(deps, cmd({ delivery: "keep" }, 1, "k2")))).toBe("no-op-command");
      expect(code(applySetIntegrationScheme(deps, cmd({ delivery: "working-tree" }, 1, "wt")))).toBe("applied");
      expect(readIntegrationDefault(h.store, "repo").scheme).toEqual({ delivery: "working-tree" });
      expect(integrationChosen(h.store, "repo")).toBe(true);
    } finally { await h.dispose(); }
  });
});
