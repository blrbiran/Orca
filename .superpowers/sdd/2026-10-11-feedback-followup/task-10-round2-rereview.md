# Task 10 round-2 scoped re-review — cb8d4a6..084a956

**Verdict: ADDRESSED.** The one remaining Important finding from `task-10-scoped-rereview.md`—manual same-ID retry writing the retrying owner's or NULL audit attribution—is fixed in both successful-receipt and proven-stale terminal paths. I found no new Critical or Important issue in the complete 257-line, three-file round-2 diff. This is a scoped product review, not a final full-suite or release verdict.

## Original finding: ADDRESSED

`Reservation` now distinguishes fresh and existing pending operations and carries the existing row's persisted `client` and `principal` (`src/control/agentUpdates.ts:12-14,71-88`). On an existing pending operation, `finalizeAsOriginal` installs that stored command context around the synchronous terminal ledger write (`src/control/agentUpdates.ts:140-158`). It applies to a matching receipt and to a proven stale refusal. A fresh reservation retains the caller's normal context; unsupported old-peer handling remains limited to fresh dispatch (`src/control/agentUpdates.ts:150-155`). The command ID, raw request hash, immutable peer request, and receipt-identity checks around this change remain in place (`src/control/agentUpdates.ts:51-60,66-77,139-158`).

The paired criterion uses the real Task 9 CLI to mutate a private fixture table, injects a post-receipt/pre-SQLite crash, switches briefly to the pinned old peer, then manually retries the **same** command under a different owner's ambient context. It checks the original receipt identity, revision 1, unchanged table bytes, and the ledger's original `web`/`user:owner` attribution (`tests/control/agentUpdatePaired.test.ts:75-108`). Unit criteria also cover a direct supported retry with no ambient context and a stale refusal under a different owner's ambient context (`tests/control/agentUpdates.test.ts:85-118`). Those tests directly exercise the missing round-1 paths.

## New Critical/Important findings in the scoped diff

None. The context override is limited to existing pending terminal writes; it does not change peer dispatch, outbox fencing, revision, or Task 9 table semantics. The nested context calls synchronous ledger writers, so the original identity remains active for the relevant `commandClientFor`/`commandPrincipalFor` reads. No Web, schema, package-pin, or protocol file changed in this round.

## Evidence and out-of-scope items

The exact three-path commit is `084a956e0ca9792db2fd963047849fa0d097e726`; its diff passes `git diff ... --check`. Raw run metadata on final source tree SHA256 `06850c486e6b84bd8bd84d26d77d4fd69288e17f5a42171d147144d0aed5c34e` records affected tests 143/143 RC0, typecheck/build RC0, and real panel acceptance RC0 (PASS 0–14). The same-tree clone baseline `t10r2bf` is RC0, while the clone with attribution carry removed (`t10r2mf`) is RC1. I inspected these result records and the changed tests; I did not rerun the whole suite.

The round-1 four-worker `npm run verify:control` RC1 and separate two-worker unfiltered control RC0 apply only to the **prior** source tree `4b0106df…`. Neither establishes a final formal gate for this round-2 tree. Task 14 owns later integrated full control/root/Web/browser gates. This review did not use a live database or user table, repin the default ccloop dependency, switch a service, or touch remote state. `git status --short --branch` showed the pre-existing controller-owned modified `progress.md` and untracked `node_modules` symlink; this review changed neither source, index, nor HEAD.
