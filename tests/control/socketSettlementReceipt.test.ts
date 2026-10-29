import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { settlementReceipt } from "../../src/control/savedResultRecovery.js";
import { settle, unknownFailure } from "./fixtures/unknownFailure.js";

// Session b999cc81 (2026-10-29): the saved-result receipt copies the settlement's ledger row and ccloop checks it against
// the marker (ccloop `fix(control): a socket settlement's receipt backs the marker by its personPrincipal …`). A socket
// row's principal is `agent:cli`; the person who settled is its `person_principal`, so the receipt must carry it or a
// socket-settled run can never pass saved-result recovery. A Web receipt must stay byte-identical: its hash is evidence.
const receiptOf = (t: Awaited<ReturnType<typeof unknownFailure>>["t"], runId: string) => canonicalBytes(settlementReceipt(t.h.store, t.body(runId)));

describe("the saved-result receipt of a settlement", () => {
  it("over the socket with a person token, it names the token's account as personPrincipal beside the agent principal", async () => {
    const { t, runId } = await unknownFailure();
    try {
      const command = { ...(t.h.command as (verb: string, payload: unknown) => Record<string, unknown>)("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" }), commandId: "settle-token" };
      const context = { client: "cli", principal: "agent:cli", personAuthority: true, personPrincipal: "user:u-owner" };
      expect(await withCommandContext("settle-token", context, () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<unknown> }).settleUnknownUsage(command))).not.toHaveProperty("error");
      expect(JSON.parse(receiptOf(t, runId).toString())).toMatchObject({ principal: "agent:cli", client: "cli", personPrincipal: "user:u-owner", commandId: "settle-token" });
    } finally { await t.h.dispose(); }
  });

  it("on the Web, its bytes are exactly the row copy they were before: no personPrincipal key", async () => {
    const { t, runId } = await unknownFailure();
    try {
      const command = t.h.command("settle-unknown-usage" as never, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" }) as { commandId: string };
      expect(await settle(t, runId, command)).not.toHaveProperty("error");
      const row = t.h.store.db.prepare("SELECT body_json FROM commands WHERE id=?").get(command.commandId)!;
      const before = { principal: "user:owner", client: "web", verb: "settle-unknown-usage", commandId: command.commandId, result: JSON.parse(String(row.body_json)).result };
      expect(receiptOf(t, runId).equals(canonicalBytes(before))).toBe(true);
    } finally { await t.h.dispose(); }
  });
});
