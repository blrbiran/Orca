/**
 * Checks spec 2026-10-22 §4.4, criterion 10 (plan Task 4, Review Focus 1): the integration-check setter is removed with
 * no alias (P1) -- no source, Web or skill file names it but the retired list -- while a ledger row written before the
 * removal stays readable: an old command id looked up again must answer its stored body, never
 * `control-command-result-invalid`, or history of a real panel database becomes unreadable on upgrade.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RETIRED_VERBS } from "../../src/control/checks/retired.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { openControlStore } from "../../src/control/store.js";
import { commandVerbSchema, rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";

const VERB = "set-integration-check";

describe("the removed integration-check setter", () => {
  it("is named nowhere in src, web/src or skills but the retired list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "removed-verb-"));
    try {
      const out = join(dir, "grep.txt");
      const grep = spawnSync("sh", ["-c", `grep -rn "${VERB}" src web/src skills > "${out}"; echo $? >> "${out}"`], { encoding: "utf8" });
      expect(grep.status).toBe(0);
      const lines = (await readFile(out, "utf8")).trim().split("\n");
      const code = lines.pop();
      // grep's own exit code: 0 = matches found (the retired list must be one), anything else is not a clean answer.
      expect(code).toBe("0");
      expect(lines.map((line) => line.split(":")[0]).sort()).toEqual(["src/control/checks/retired.ts"]);
      expect(RETIRED_VERBS).toEqual([VERB]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("is refused as a new command by the raw schema (no alias)", () => {
    expect(commandVerbSchema.safeParse(VERB).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({
      schema: "orca-raw-command-v1", commandId: "c-new", actorId: "owner", expectedRevision: 0, verb: VERB,
      target: { kind: "repository", repoId: "repo" }, payload: { enabled: true, command: null },
    }).success).toBe(false);
  });

  it("keeps a stored success row of it readable by its command id (GET groups/@repository:<r>/commands/<id>)", async () => {
    const root = await mkdtemp(join(tmpdir(), "removed-verb-db-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      const target = { kind: "repository", repoId: "repo" };
      const raw = { schema: "orca-raw-command-v1", commandId: "old-ic-1", actorId: "owner", expectedRevision: 0, verb: VERB, target, payload: { enabled: true, command: "npm test" } };
      const effective = { ...raw, schema: "orca-authority-command-v1" };
      const body = {
        schema: "orca-command-success-v1", commandId: "old-ic-1", actorId: "owner", verb: VERB, target, commandRevision: 1, projectionSeq: null,
        effectivePayloadHash: sha256Canonical(raw.payload), authorityCommandHash: sha256Canonical(effective),
        result: { kind: "integration-check-set", repoId: "repo", integrationCheck: { enabled: true, command: "npm test" } },
      };
      const json = canonicalBytes(body).toString("utf8");
      // The row as the ledger wrote it before the removal (commandLedger.ts persistCommandOutcome's columns).
      store.db.prepare(`INSERT INTO commands(group_id,id,payload_hash,result,ledger_version,scope_kind,scope_id,actor_id,verb,target_json,expected_revision,
        raw_request_json,raw_request_hash,effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash,
        original_status,body_json,response_bytes,command_revision,projection_seq,client,principal) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        "@repository:repo", "old-ic-1", sha256Canonical(raw), json, "repository", "repo", "owner", VERB, canonicalBytes(target).toString("utf8"), 0,
        canonicalBytes(raw).toString("utf8"), sha256Canonical(raw), canonicalBytes(raw.payload).toString("utf8"), sha256Canonical(raw.payload),
        canonicalBytes(effective).toString("utf8"), sha256Canonical(effective), 200, json, Buffer.from(json, "utf8"), 1, null, null, null,
      );
      expect(lookupCommandResult(store, "@repository:repo", "old-ic-1")).toEqual({ schema: "orca-command-lookup-v1", originalStatus: 200, body });
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
