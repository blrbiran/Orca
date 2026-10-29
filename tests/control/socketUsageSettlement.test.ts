import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";
import { hasValidUsageSettlement } from "../../src/control/usageSettlement.js";
import { settle, unknownFailure } from "./fixtures/unknownFailure.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// Socket usage settlement spec 2026-10-29 §2, §4: the command ledger records the person token's account beside a socket
// command's principal (`commands.person_principal`, schema 20 -> 21), so `orca task settle-usage` can settle a run's unknown
// usage. The socket path itself is pinned in testerStuckStates.test.ts (#103). Temp stores only.

describe("schema 20 -> 21: commands.person_principal", () => {
  it("a v20 store opens at 21 with the column; its existing rows keep every value and read NULL; one backup precedes the step", async () => {
    const root = await mkdtemp(join(tmpdir(), "s21-"));
    const dir = join(root, "s");
    try {
      (await openControlStore({ stateDir: dir, now: () => 1000 })).close();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      raw.exec("ALTER TABLE commands DROP COLUMN person_principal");
      raw.prepare("INSERT INTO commands(group_id,id,payload_hash,result,client,principal) VALUES ('g','c1','h','{}','web','user:owner')").run();
      raw.prepare("UPDATE meta SET value='20' WHERE key='schemaVersion'").run();
      raw.close();
      const store = await openControlStore({ stateDir: dir, now: () => 2000 });
      try {
        expect(schemaVersion).toBe("21");
        expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21");
        expect(store.db.prepare("SELECT group_id,id,payload_hash,result,client,principal,person_principal FROM commands").all())
          .toEqual([{ group_id: "g", id: "c1", payload_hash: "h", result: "{}", client: "web", principal: "user:owner", person_principal: null }]);
      } finally { store.close(); }
      expect((await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-"))).toEqual(["control.sqlite.pre-v20-2000"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("a Web owner's settlement is unchanged by the column", () => {
  it("its row's person_principal is NULL and readers accept its marker", async () => {
    const { t, runId } = await unknownFailure();
    try {
      const command = t.h.command("settle-unknown-usage" as never, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" }) as { commandId: string };
      expect(await settle(t, runId, command)).not.toHaveProperty("error");
      expect(t.h.store.db.prepare("SELECT client,principal,person_principal FROM commands WHERE id=?").get(command.commandId)).toEqual({ client: "web", principal: "user:owner", person_principal: null });
      expect(hasValidUsageSettlement(t.h.store, t.body(runId))).toBe(true);
    } finally { await t.h.dispose(); }
  });
});
