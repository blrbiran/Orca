# Plan Version Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person choose a plan library version by its visible number or an unambiguous SHA prefix without accidentally selecting the wrong document.

**Architecture:** Resolve a positive decimal version against `EntryView.versions[].version` before SHA prefix lookup; use an explicit SHA prefix spelling for numeric-only SHA prefixes so `1` unambiguously means version 1. Keep the existing default-to-head behavior and read-only routes.

**Tech Stack:** TypeScript CLI registry, Vitest.

**Spec:** Tester feedback `../orca_archived_files/issue-20261023.md` Issue 181; current correction recorded in Orca handoff §3 (miss hints already implemented).

## Global Constraints

- Do not change the plan library store, document hashes or exported bytes.
- Existing `--version` flag and SHA-prefix semantics for nonnumeric prefixes remain available.
- Verification runs use `node scripts/test-affected.mjs --base=<base>` and required typecheck, not the release-only `npm run verify`.

## Review Focus

- Numeric SHA prefix colliding with a displayed version must not silently select the SHA document: Task 1 test.
- Missing numeric version must list available numeric versions as well as hashes: Task 1 test.
- Ambiguous SHA prefix must still reject: Task 1 test.
- Default head and full SHA must still select the same bytes: Task 1 test.
- Export to an existing path must still refuse before overwriting: Task 1 test.

---

### Task 1: Resolve library versions as shown to people

**Files:**
- Modify: `src/commands/domains/plan.ts` (`VERSION`, `EntryView`, `versionOf`, examples)
- Test: `tests/commands/planVersionMiss.test.ts` and the existing plan show/export tests

**Interfaces:**
- Consumes: `EntryView.versions: Array<{version:number; sha256:string}>` from `src/control/planLibrary/views.ts`.
- Produces: `versionOf(c, entry): Promise<string>` returning the stored SHA after resolving either numeric ordinal or a SHA prefix. A numeric-only SHA prefix needs explicit `sha256:<prefix>`; hex prefixes containing letters remain accepted directly.

- [ ] **Step 1: Write failing tests** covering version `1` and `2` on two documents, a SHA starting with `1`, explicit numeric SHA prefix, ambiguous prefix, no match, default head, and show/export reading the selected canonical document. Keep existing file overwrite refusal coverage.
- [ ] **Step 2: Run only those tests and observe the numeric version test fail on its own behavior.** Use `./node_modules/.bin/vitest run tests/commands/planVersionMiss.test.ts --run` with output saved intact.
- [ ] **Step 3: Implement resolution using the view's version ordinals, preserving SHA-prefix resolution for nonnumeric input and explicit `sha256:`. Update flag help and examples.**
- [ ] **Step 4: Rerun the focused tests, root typecheck and affected tests.** Report pass, skip, and failure counts verbatim.
- [ ] **Step 5: Independently review the changed code and any necessary generated CLI docs drift.**
