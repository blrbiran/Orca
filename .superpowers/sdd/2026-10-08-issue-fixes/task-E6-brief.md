### Task E6: The agent skill teaches archive (spec §6.3)

**Files:**
- Modify: `skills/orca-control/SKILL.md` — route table (after line 104, the `integration/resolve` row) and the Notes
  paragraph (line 113)
- Modify: `tests/entry/skill.test.ts` — imports unchanged; `schemaByVerb` (lines 18-28), the three count literals
  (lines 46, 51, 61), the phrase list (lines 73-89)

- [ ] **Step 1: Write the failing test** — in `tests/entry/skill.test.ts`: add
  `"archive-group": emptyPayloadSchema, "unarchive-group": emptyPayloadSchema,` to `schemaByVerb` after
  `"resolve-integration-conflict": emptyPayloadSchema,`; change the three route counts from the value Part D left (30) to
  `32` and extend the comment above the first with `Issue-fixes spec §6.3 added groups/<groupId>/archive and
  groups/<groupId>/unarchive.`; add to the phrase list:

```ts
      // Issue-fixes spec §6.3: what archiving does to every other command, and the guards an agent meets.
      "refuses every command but `unarchive-group` with `group-archived`", "archive-run-active", "archive-call-in-flight",
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/entry/skill.test.ts > <S>/e6.txt 2>&1; echo rc=$?` → `rc=1` (32 routes in `controlApi.ts`, 30 rows; missing phrases).

- [ ] **Step 3: Implement** — `skills/orca-control/SKILL.md`, after the `| \`POST groups/<groupId>/integration/resolve\` | resolve-integration-conflict | \`{}\` |` row:

```markdown
| `POST groups/<groupId>/archive` | archive-group | `{}` |
| `POST groups/<groupId>/unarchive` | unarchive-group | `{}` |
```

  and append to the Notes paragraph (line 113, after its last sentence):

```markdown
An archived group keeps every record and refuses every command but `unarchive-group` with `group-archived` (409); reads are unchanged and it is never claimed or integrated. `archive-group` is refused while the group still has work in motion: `archive-run-active`, `archive-stop-pending` (a handoff or shutdown stop not yet `handoff-complete`), `archive-integration-resolving`, `archive-call-in-flight` (an estimate or requirement call).
```

- [ ] **Step 4: Run, expect PASS** — Step 2 command → `rc=0`.
- [ ] **Step 5: Mutation** (clone): delete the archive row → "lists exactly the panel's mutation routes" red; delete the
  Notes sentence → "teaches the rules" red.
- [ ] **Step 6: Commit** — `git -C <wt> add skills/orca-control/SKILL.md tests/entry/skill.test.ts`, message
  `docs(skill): teach the agent archive-group and unarchive-group` (+ Co-Authored-By).

