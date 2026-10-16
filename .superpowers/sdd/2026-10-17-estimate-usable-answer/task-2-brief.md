### Task 2: Record, contract and view fields

**Files:**
- Modify: `src/control/queries.ts` (`estimateRecordSchema`, `EstimateRecord`), `src/control/webProtocol.ts` (`estimateExecutionContractSchema`, `estimateViewSchema`), `src/panel/controlViews.ts` (`estimateViews`), `web/src/controlTypes.ts`, `src/control/planImport.ts` (estimate insert), `src/control/webService.ts` (`createEstimate` insert)
- Test: `tests/control/estimateRecordFields.test.ts`

**Interfaces:**
- Produces (all optional on the record, absent ⇔ not applicable; canonical bytes of old records unchanged):
  - record: `proposalVersion?: number`, `repairs?: string[]`, `origin?: { kind: "auto-retry"; of: string; problems: string[] }`, `retriedAs?: string`, `retrySkipped?: string`.
  - contract: `retryProblems?: string[]` (1..20 entries).
  - view: the same five fields passed through; web types mirror them.
  - `writeImportedPlan` writes `proposalVersion: 1`; `createEstimate` writes `proposalVersion: proposal.proposalVersion`.

- [ ] **Step 1: Failing tests**: an old-shape record body (no new fields) decodes and its view has none of them; a record with all five decodes and the view carries them; a fresh import's estimate has `proposalVersion: 1`; a re-estimate after one proposal edit has `proposalVersion: 2`; a contract with `retryProblems: []` is refused (min 1).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the schema fields and the two writers. Rewrite any existing criterion that pins the exact record/view key set (search `tests/` for `estimatorSlot` beside `toEqual` on estimate bodies) with a Ruling comment.
- [ ] **Step 4: Run** the new file, `tests/control/estimate*.test.ts`, `tests/panel/*estimate*`, typecheck, and `npm run build --workspace web` — all exit 0.
- [ ] **Step 5: Mutation**: stop writing `proposalVersion` in `createEstimate` → its test red.
- [ ] **Step 6: Commit** `feat(control): estimate records carry proposalVersion, repairs and retry links`.

