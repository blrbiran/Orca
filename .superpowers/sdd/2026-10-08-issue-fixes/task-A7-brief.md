### Task A7: Document what Web import requires

**Files:**
- Modify `README.md`: §5 lines 168-169 (the sentence before the example) and the example task (lines 183-185).
- Modify `docs/cli.md`: insert a section after "### The up-front rejections" ends (before `### Exit codes`, line 111).

**Interfaces:** none (documentation). Success criterion: the README example is a plan Web import accepts — A1's
`tests/scheduler/planSourceItems.test.ts` "still imports a plan with no problem" covers the same shape; Step 4 below
runs the README's own JSON through `schedulerControlPlanSourceOf`.

- [ ] **Step 1: Write the failing check** — a throwaway script in the executor's scratchpad (not committed), `$S/readme-plan.mjs`:

```js
// Extracts README §5's JSON example and runs it through the Web import's checks with its own targetRepo.
import { readFileSync } from "node:fs";
const readme = readFileSync("/Users/biran/code/skills/loop/Orca-issues/README.md", "utf8");
const section = readme.slice(readme.indexOf("### 5. Plans for Task control"), readme.indexOf("### 6. Optional integrations"));
const json = section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7));
const plan = JSON.parse(json.replaceAll("<path-to-repo>", "/abs/repo").replaceAll("<path-to-orca>", "/abs/orca").replaceAll("<a directory outside the repo>", "/abs/runs"));
const { schedulerControlPlanSourceOf } = await import("/Users/biran/code/skills/loop/Orca-issues/src/scheduler/planFile.ts");
try { schedulerControlPlanSourceOf(plan, "/abs/repo"); console.log("accepted"); } catch (error) { console.log(String(error)); process.exit(1); }
```

- [ ] **Step 2: Run it, expect FAIL** — `cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/tsx $S/readme-plan.mjs > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1, output `ControlError: control-plan-rejected:missing-target-version:a`.

- [ ] **Step 3: Implement.**

  (a) `README.md` lines 168-169:

```md
The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape), plus a top-level `goal`
and `successConditions`. A task may give a `loop` block instead of a `contract` file:
```

  become:

```md
The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape). **Import plan** accepts it
only when all of these hold; otherwise it refuses with every problem it can see, one per line, in the import form:

- `targetRepo` is the repository the plan is registered for;
- the plan has a `goal`;
- the plan has at least one `successConditions` entry, and no two are identical;
- every task has a `targetVersion` that is a positive integer (write `1` unless you mean otherwise);
- no task lists a dependency twice or depends on a task that is not in the plan;
- every task's `contract` file is valid JSON in ccloop's contract format, or its `loop` block is valid.

A task may give a `loop` block instead of a `contract` file:
```

  and in the example, lines 183-185:

```json
    {
      "taskId": "a",
      "dependsOn": [],
```

  become:

```json
    {
      "taskId": "a",
      "dependsOn": [],
      "targetVersion": 1,
```

  (b) `docs/cli.md`, insert before `### Exit codes` (line 111):

```md
### What Web import also requires

The panel's **Import plan** (Task control) reads the same file and adds its own checks. It accepts a plan only when:

- `targetRepo` is the repository the plan is registered for (`--plan <planId>=<repoId>=<path>`);
- the plan has a `goal`;
- the plan has at least one `successConditions` entry, and no two are identical;
- every task has a `targetVersion` that is a positive integer (write `1` unless you mean otherwise);
- no task lists a dependency twice or depends on a task that is not in the plan;
- every task's `contract` file is valid JSON in ccloop's contract format (or its `loop` block is valid).

A plan that fails is refused with `control-plan-rejected`, listing every problem it can see at once, one per line:
`target-repo-mismatch`, `missing-goal`, `missing-success-conditions`, `duplicate-success-condition`, then per task
`duplicate-dependency:<task>`, `dangling-dependency:<task>`, `missing-target-version:<task>` and the task's contract
problem (`contract-json:<task>`, `contract-shape:<task>`, `contract-canonical:<task>`, `loop-plan-invalid:<task>:<reason>`).
A file that does not match the schema at all is refused with its `malformed:<path>: <message>` lines alone. The panel
explains each line in English or Chinese.
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 command ⇒ rc=0, output `accepted`. Read `git -C /Users/biran/code/skills/loop/Orca-issues diff -- README.md docs/cli.md > $S/diff.txt` whole.

- [ ] **Step 5: Mutation** — in `$M`, delete the README's `"targetVersion": 1,` line and run the script against `$M/README.md` (edit the script's path) ⇒ rc=1 with `missing-target-version:a`.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add README.md docs/cli.md` and:

```
docs: list what Web import requires, and give the README example its targetVersion

README §5's example plan had no targetVersion, so Web import refused it. README and
docs/cli.md now list every Web-import requirement in one place and the refusal's items.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```
