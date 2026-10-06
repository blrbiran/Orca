import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_PATTERN, commandClientFor, withCommandClient } from "../../src/control/commandClient.js";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore } from "../../src/control/store.js";

// Vite cannot resolve the bare node:sqlite specifier; load it the way the store and store.test.ts do.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function stateDir() { const root = await mkdtemp(join(tmpdir(), "cc-")); roots.push(root); return join(root, "s"); }

describe("command client context (spec §6)", () => {
  it("answers the client only for the commandId it was set for", async () => {
    await withCommandClient("cmd-a", "cli:claude", async () => {
      expect(commandClientFor("cmd-a")).toBe("cli:claude");
      // Background work started inside the call inherits the context; it must not stamp another command's row.
      expect(commandClientFor("cmd-b")).toBe(null);
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(commandClientFor("cmd-a")).toBe("cli:claude");
    });
    expect(commandClientFor("cmd-a")).toBe(null);
  });

  it("accepts exactly the documented header values", () => {
    for (const ok of ["cli", "mcp", "cli:claude-code", "mcp:Codex_1.2", "cli:a"]) expect(CLIENT_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "web", "cli:", "cli:-x", "mcp:a b", "cli:" + "a".repeat(65), "CLI", "cli:x:y"]) expect(CLIENT_PATTERN.test(bad), bad).toBe(false);
  });
});

describe("schema 6 to 7 (spec §6)", () => {
  it("a fresh store has commands.client and version 7", async () => {
    const store = await openControlStore({ stateDir: await stateDir() });
    try {
      expect(schemaVersion).toBe("7");
      const columns = store.db.prepare("PRAGMA table_info(commands)").all().map((row) => String(row.name));
      expect(columns).toContain("client");
    } finally { store.close(); }
  });

  it("a version-6 store upgrades, and a row written before keeps client null", async () => {
    const dir = await stateDir();
    (await openControlStore({ stateDir: dir })).close();
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.exec("ALTER TABLE commands DROP COLUMN client");
    raw.prepare("INSERT INTO commands(group_id,id,payload_hash,result) VALUES ('g','old','h','{}')").run();
    raw.prepare("UPDATE meta SET value='6' WHERE key='schemaVersion'").run();
    raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()).toMatchObject({ value: "7" });
      expect(store.db.prepare("SELECT client FROM commands WHERE id='old'").get()).toMatchObject({ client: null });
    } finally { store.close(); }
  });
});
