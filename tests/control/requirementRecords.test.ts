import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { insertClarifyingGroup, latestRound, newDraft, newRound, readDraft, readRequirementGroup, readRound, writeDraft, writeRound } from "../../src/control/requirementRecords.js";
import { readWebGroup } from "../../src/control/webService.js";
import { REQUIREMENT_LIMIT_DEFAULT, clarifyingInput } from "./fixtures/requirement.js";
import { openTestStore } from "./fixtures/store.js";

// N1 spec §4.2 and Review Focus 1: two tables keyed by group_id; an existing store gains them and loses nothing.
describe("requirement records (N1 spec §4)", () => {
  it("migrates a version-5 store by adding the two tables, leaving every existing row byte-identical", async () => {
    const h = await openTestStore();
    try {
      // A run row standing for a stored estimate run: phase "estimate", exactly as an older build wrote it (DR1).
      h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('old',0,1,0,'{\"groupId\":\"old\"}')").run();
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-old','old','estimate-x',1,0,'{\"phase\":\"estimate\"}')").run();
      h.store.db.exec("DROP TABLE requirement_rounds; DROP TABLE requirement_drafts");
      // N2 task 1: a pre-v7 store has no commands.client; the downgrade must drop it too, or the 6-to-7 step meets a column already there.
      h.store.db.exec("ALTER TABLE commands DROP COLUMN client");
      h.store.db.prepare("UPDATE meta SET value='5' WHERE key='schemaVersion'").run();
      const rowsBefore = h.store.db.prepare("SELECT id,body FROM runs ORDER BY id").all();
      h.store.close();
      const reopened = await openControlStore({ stateDir: h.store.stateDir });
      try {
        expect(reopened.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe(schemaVersion);
        // Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.
        // D9 correction (controller ruling, 2026-10-09; verify_usage_retry_round at e7df5df): the current migration target is schema 10.
        expect(schemaVersion).toBe("10");
        expect(reopened.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('requirement_rounds','requirement_drafts') ORDER BY name").all().map(row => row.name)).toEqual(["requirement_drafts", "requirement_rounds"]);
        expect(reopened.db.prepare("SELECT id,body FROM runs ORDER BY id").all()).toEqual(rowsBefore);
      } finally { reopened.close(); }
    } finally { await rm(h.root, { recursive: true, force: true }); }
  });

  it("inserts a clarifying group whose ledger mirror a Web reader accepts, with no plan, proposal or work items", async () => {
    const h = await openTestStore();
    try {
      insertClarifyingGroup(h.store, clarifyingInput("r"));
      const group = readWebGroup(h.store, "r");
      expect(group).toMatchObject({ status: "clarifying", stopped: false, limit: REQUIREMENT_LIMIT_DEFAULT, used: { tokens: 0 }, reserved: { tokens: 0 } });
      expect(group.ledger.explicitUnallocatedReserve).toEqual(REQUIREMENT_LIMIT_DEFAULT);
      expect(group).not.toHaveProperty("planHash");
      expect(group).not.toHaveProperty("proposal");
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id='r'").get()!.n).toBe(0);
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM budget_proposals WHERE group_id='r'").get()!.n).toBe(0);
      expect(readRequirementGroup(h.store, "r").requirement).toMatchObject({ repoId: "repo", slug: null, contentLanguage: "en", consensus: null, export: { state: "not-due" } });
    } finally { await h.dispose(); }
  });

  it("round-trips a round and a draft, and refuses a row whose state column disagrees with its body", async () => {
    const h = await openTestStore();
    try {
      insertClarifyingGroup(h.store, clarifyingInput("r"));
      writeRound(h.store, "r", newRound(1));
      writeDraft(h.store, "r", newDraft(1, 0));
      expect(readRound(h.store, "r", 1)).toEqual(newRound(1));
      expect(latestRound(h.store, "r")!.roundNo).toBe(1);
      expect(readDraft(h.store, "r", 1)).toEqual(newDraft(1, 0));
      h.store.db.prepare("UPDATE requirement_rounds SET state='answered' WHERE group_id='r' AND round_no=1").run();
      expect(() => readRound(h.store, "r", 1)).toThrow("recovery-blocked");
      expect(() => h.store.db.prepare("UPDATE requirement_rounds SET state='bogus' WHERE group_id='r'").run()).toThrow();
    } finally { await h.dispose(); }
  });
});
