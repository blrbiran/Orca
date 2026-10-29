# `orca task settle-usage` over the socket: the ledger records the person token's account

Session 2026-10-29 (controller). Human ruling on the registered item (recovery CLI spec
`2026-10-28-recovery-cli-design.md` §4): 「要你定做不做：让 orca task settle-usage 能走 CLI，需要给命令台账加一列记 person
token 的账号，这是 schema 变更。 => 同意」.

## 1. Problem

A task run's `settle-unknown-usage` writes a marker (`run.usageSettlement`, `principal: user:<id>`) that every reader
validates against the command's ledger row (`hasValidUsageSettlement`, `src/control/usageSettlement.ts`): the row must be
`client === "web"` with `principal === marker.principal`. A socket row records `principal = agent:<client>`, so a
socket settlement would book the charge and leave a marker every reader refuses. The service therefore refuses
everything but an authenticated Web owner (`applySettleUnknownUsage`), and `orca task settle-usage` (token tier,
`humanOnly.ts`) can never succeed.

## 2. Change

1. **Schema 20 → 21**: `ALTER TABLE commands ADD COLUMN person_principal TEXT;` (nullable; in `initialSchema` and at
   the end of every migration path; `store.ts` accepts "20"). Nothing existing is rewritten; old rows read NULL. The
   `VACUUM INTO` backup precedes the step as before.
2. **Writer** (`persistCommandOutcome`, `commandLedger.ts`): `person_principal` is the `user:<id>` of the person token's
   account for a socket command that has person authority (`settlingPersonFor` on a non-Web client), NULL otherwise
   (every Web row, a socket call without a person token, a run Orca dispatched). Attribution only; it authorizes nothing.
3. **Service** (`applySettleUnknownUsage`): the settling person is `settlingPersonFor(commandId)` -- a Web `user:`
   account as before, or the owner whose person token the socket request carries. Anyone else is refused with the same
   `control-verb-human-only` error, before any write.
4. **Reader** (`hasValidUsageSettlement`): the row backs the marker when `client === "web"` and `principal` equals the
   marker's principal (unchanged), **or** the row is a socket row whose `person_principal` equals it.

## 3. Not changed

- The socket tier: `settle-unknown-usage` stays `token` (`humanOnly.ts`); a run Orca dispatched is refused at the
  route (permissions) and again by `settlingPersonFor` (no person authority).
- The saved-result receipt artifact (`savedRecoveryAccounting`) keeps recording the row's `principal`/`client`; for a
  socket settlement that is `agent:<client>` beside a marker naming the user. Registered, not changed (the artifact's
  bytes are hashed downstream).
- The Web path, the marker schema, and the single call's settlement (already person-token capable, its marker never
  checked against the ledger row).

## 4. Criteria

- Socket settlement with a person token succeeds; the marker's principal is the token's account; the ledger row has
  `client = cli`, `principal = agent:cli`, `person_principal = user:<id>`; `hasValidUsageSettlement` is true.
- Without person authority (a dispatched run's context) it is refused and nothing changes.
- A Web settlement still validates and its row's `person_principal` is NULL.
- Migration: a v20 store opens at 21 with the column, its existing rows NULL.
- Mutations (clone): the reader's socket branch removed → the socket criterion red; the writer writing NULL → red;
  the service back to Web-only → red.

The criterion "a task run's settle-unknown-usage stays the Web owner's" (`tests/control/testerStuckStates.test.ts`) is
rewritten to the new behaviour under the human's 「这次批准改写所有必要的判据」 (session 2026-10-29).

## 5. Correction to §3 (session b999cc81, 2026-10-29)

§3 registered the saved-result receipt as cosmetic. It is not: ccloop validates the receipt strictly
(`ccloop src/control/savedResultRecovery.ts`, `client: z.literal("web")`, `.strict()`, `marker.principal ===
receipt.principal`), so a run settled over the socket could never pass saved-result recovery (reproduced red at the
ccloop boundary before the fix). Human: 「同意，按你的建议走」. Now:
- Orca: `settlementReceipt` (`src/control/savedResultRecovery.ts`) adds `personPrincipal` when the row records one; a Web
  receipt's bytes are unchanged (criterion `tests/control/socketSettlementReceipt.test.ts`).
- ccloop (`fix(control): a socket settlement's receipt backs the marker by its personPrincipal …`): a Web row backs the
  marker by its `principal`, any other row by `personPrincipal`.
- Not covered by a criterion: `savedRecoveryAccounting` calling `settlementReceipt` (its preconditions need a real stop
  proof; Orca's paired end-to-end is env-gated and its fixture still expects schema 14).
