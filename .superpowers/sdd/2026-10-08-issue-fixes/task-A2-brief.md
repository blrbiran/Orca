### Task A2: The requirement split validator hands back one reason per import item

**Files:**
- Modify `src/control/requirementSplit.ts`: doc comment lines 81-85, the catch at lines 111-114.
- Modify (rewrite, approved) `tests/control/requirementSplit.test.ts`: comment lines 77-78, test at lines 86-91.
- Test (create) `tests/control/requirementSplitItems.test.ts`.

**Interfaces:**
- Consumes: A1's `\n`-separated detail.
- Produces: `export function importReasons(error: ControlError): string[]` — `(error.detail ?? error.code).split("\n").map(item => "import:" + item)`; `validateSplitDraft`'s import refusal reasons are `importReasons(error)`.

- [ ] **Step 1: Write the failing tests.**

  (a) Rewrite in `tests/control/requirementSplit.test.ts`. Current lines 77-78:

```ts
  // The Web import stops at its first refusal; a repeated dependency and repeated criterion texts are named beside every
  // other reason (here a missing target), not only when they are the draft's one fault.
```

  replaced by:

```ts
  // The Web import is only asked once every other check passed, so the split validator names a repeated dependency and
  // repeated criterion texts itself, beside every other reason (here a missing target), not only as the draft's one fault.
```

  Current lines 86-91:

```ts
  // What only the Web import itself decides (here: a plan with no success condition) still reaches the person by name.
  it("hands back what the Web import refuses beyond the checks above, by its detail", async () => {
    const traced = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, traces: ["R1.ADR1"] })) };
    const out = await validate(traced, [], []);
    expect(out).toMatchObject({ ok: false, reasons: ["import:control-metadata"], layers: null, implicitEdges: null });
  });
```

  replaced by (spec §2.2(c) renames `control-metadata`; rewrite approved per §2.3 last bullet):

```ts
  // What only the Web import itself decides (here: a plan with no success condition) still reaches the person by name.
  // Rewritten for spec 2026-10-08 §2.2(c): the import names the missing piece (missing-success-conditions) instead of
  // the old catch-all control-metadata.
  it("hands back what the Web import refuses beyond the checks above, by its detail", async () => {
    const traced = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, traces: ["R1.ADR1"] })) };
    const out = await validate(traced, [], []);
    expect(out).toMatchObject({ ok: false, reasons: ["import:missing-success-conditions"], layers: null, implicitEdges: null });
  });
```

  (b) Create `tests/control/requirementSplitItems.test.ts` (its own file: `vi.mock` is file-wide). No plan the split
  expands can carry two import problems through `validateSplitDraft` (every other import check is made earlier by the
  validator itself), so the import is replaced by one that refuses with two items, and the real validator is run:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expandSplitDraft, importReasons, validateSplitDraft } from "../../src/control/requirementSplit.js";
import { ControlError } from "../../src/control/errors.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-10-08 §2.2(c): the Web import's refusal can carry several items; the split validator hands each back as
// its own `import:` reason, so the model's feedback stays one problem per line.
vi.mock("../../src/scheduler/planFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scheduler/planFile.js")>();
  const { ControlError: Refusal } = await import("../../src/control/errors.js");
  return { ...actual, schedulerControlPlanSourceOf: () => { throw new Refusal("control-plan-rejected", "missing-goal\nmissing-success-conditions"); } };
});

let root = "", repo = "", commit = "";
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "orca-split-items-")));
  repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); await writeFile(join(repo, "README.md"), "r"); await writeFile(join(repo, "src", "a.ts"), "a"); g("add", "-A"); g("commit", "-qm", "base");
  commit = g("rev-parse", "HEAD");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("the split validator and a Web import refusal with several items (spec 2026-10-08 §2.2(c))", () => {
  it("hands back one import reason per item", async () => {
    const criteria = [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }];
    const plan = expandSplitDraft(VALID_SPLIT, { targetRepo: repo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", groupId: "r", statement: "Export notes.", acceptanceCriteria: criteria });
    const out = await validateSplitDraft({ output: VALID_SPLIT, plan, repo, commit, criterionIds: ["AC1", "AC2"], adrIds: ["R1.ADR1"] });
    expect(out).toMatchObject({ ok: false, reasons: ["import:missing-goal", "import:missing-success-conditions"], layers: null, implicitEdges: null });
  });

  it("hands back a refusal with no detail by its code", () => {
    expect(importReasons(new ControlError("group-not-found"))).toEqual(["import:group-not-found"]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/requirementSplitItems.test.ts tests/control/requirementSplit.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: `requirementSplitItems.test.ts` fails to import `importReasons` (not exported); in `requirementSplit.test.ts` the rewritten test now passes (A1 landed) and every other test passes.

- [ ] **Step 3: Implement** — in `src/control/requirementSplit.ts` replace lines 81-85:

```ts
/**
 * N1 spec §8.3-§8.4 (Rule 5: code decides): every reason, in check order -- loadPlan's, the Web import's own dependency
 * and success-condition checks (which the import stops at the first of), each task's expansion, each target path
 * against the overview's commit, each trace -- and only for a draft with none, the import itself and the layers.
 */
```

with:

```ts
/**
 * Spec 2026-10-08 §2.2(c): the Web import's refusal as split reasons, one per item of its detail, so the model's
 * feedback stays one problem per line. A refusal with no detail is handed back by its code.
 */
export function importReasons(error: ControlError): string[] {
  return (error.detail ?? error.code).split("\n").map((item) => `import:${item}`);
}

/**
 * N1 spec §8.3-§8.4 (Rule 5: code decides): every reason, in check order -- loadPlan's, the Web import's own dependency
 * and success-condition checks, each task's expansion, each target path against the overview's commit, each trace --
 * and only for a draft with none, the import itself (one reason per item it names) and the layers.
 */
```

and line 113:

```ts
    return { ok: false, reasons: [`import:${error.detail ?? error.code}`], layers: null, implicitEdges: null };
```

with:

```ts
    return { ok: false, reasons: importReasons(error), layers: null, implicitEdges: null };
```

- [ ] **Step 4: Run, expect PASS** — same command as Step 2 ⇒ rc=0; then `./node_modules/.bin/vitest run tests/control/requirement*.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; `npm run typecheck` ⇒ rc=0.

- [ ] **Step 5: Mutation** — in `$M`, revert line 113 to `reasons: [\`import:${error.detail ?? error.code}\`]` ⇒ `tests/control/requirementSplitItems.test.ts` "hands back one import reason per item" red (one reason `import:missing-goal\nmissing-success-conditions`).

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add src/control/requirementSplit.ts tests/control/requirementSplit.test.ts tests/control/requirementSplitItems.test.ts` and:

```
fix(requirements): hand back one split reason per Web import item

The split validator wrapped the import's whole detail as one import: reason; with the
import now naming every problem, each item becomes its own reason so the model reads
one problem per line. The control-metadata criterion is rewritten to the new name.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

