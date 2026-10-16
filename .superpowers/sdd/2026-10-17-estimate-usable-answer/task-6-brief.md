### Task 6: Panel display

**Files:**
- Modify: the web component that renders estimates (`web/src/BudgetEditor.tsx` and/or `web/src/ControlGroupView.tsx`), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `web/tests/estimateRepairRetry.test.tsx`

**Interfaces:**
- Consumes: Task 2 view fields.

- [ ] **Step 1: Failing test**: a view with `repairs: ["duplicate-task-dropped:a"]` shows "repaired" and the code; `origin.of` shows "retry of v1"; `retriedAs` shows "retried as v2"; `retrySkipped: "proposal-changed"` shows "retry skipped: proposal-changed"; in zh the same four (`已修复`, `第 1 版的重试`, `已重试为第 2 版`, `未重试：proposal-changed`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the new file and `npm run --ws check` (and `npx vitest run tests/panel/scanPanelText.test.ts` from the root) — exit 0.
- [ ] **Step 5: Mutation**: remove the repaired label → red. **Step 6: Commit** `feat(web): show an estimate's repairs and its automatic retry`.

