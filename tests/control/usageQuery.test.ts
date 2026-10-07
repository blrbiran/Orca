import { describe, expect, it } from "vitest";
import { usedTokens } from "../../src/control/usageQuery.js";
import { openTestStore } from "./fixtures/store.js";

describe("usedTokens (spec §5.1: what a total or a cap counts)", () => {
  it("honors each bound on its own and never counts a breakdown-mismatch row", async () => {
    const t = await openTestStore();
    try {
      const insert = t.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,tokens,quality) VALUES (?,?,?,?,?,?,?,?)");
      insert.run(100, "g", "x", null, "run-work", null, 1, "unattributed");
      insert.run(200, "g", "x", null, "run-work", null, 2, "unattributed");
      insert.run(300, "g", "y", null, "run-work", null, 4, "unattributed");
      insert.run(200, "g", "x", null, "run-work", "m", 1000, "breakdown-mismatch");
      expect(usedTokens(t.store, "all", null, null)).toBe(7);
      expect(usedTokens(t.store, "all", 200, null)).toBe(6);
      expect(usedTokens(t.store, "all", null, 200)).toBe(1);
      expect(usedTokens(t.store, "all", 100, 300)).toBe(3);
      expect(usedTokens(t.store, "repo:x", null, null)).toBe(3);
    } finally { await t.dispose(); }
  });
});
