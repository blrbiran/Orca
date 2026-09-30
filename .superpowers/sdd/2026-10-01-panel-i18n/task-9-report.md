# Task 9 report — the agents area and the retry notice

Implementer: subagent of session e604b1ba (controller), 2026-10-01. BASE f1ec75b, local `main`.
Commit: `5cb8ce4 feat(web): translate the agents area and the retry notice` (parent f1ec75b). Message read back
with `/usr/bin/git log -1 --format=%B > $SCRATCH/t9-commit-msg.txt`: trailer is exactly the two required lines.

`$SCRATCH` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

## Status: DONE

## What was built

- `web/src/locales/en.ts`: `AgentSlotV1`, `ProvenanceSourceV1` imported; enum families `agentSlot`, `selectionSource`
  (Records over the unions); `agents` area with every key and English value from the brief, verbatim; both families in `enums`.
- `web/src/locales/zh.ts`: `agents` area and the two enum families, values verbatim from the brief.
- `web/src/AgentFields.tsx`: `contextLabel` translates at call time via `i18n.t` (signature unchanged); `SelectionFields`
  uses `t` for the mask label (`ignorePlan` + `field.*`), the three labels, `inheritPlan` / `inherit` (both options).
- `web/src/AgentSelectionEditor.tsx`: every site listed in the brief (`from` + `selectionSource` ×3, rejected /
  unavailable, `region` ×4, frozen title, th ×2 tables + own layer, not recorded ×2, `agentSlot` reconcile ×2,
  reread, title ×2, cannotRead, resolving, proposalTitle, staleResolution, unresolved, group legend / set / clear with
  `agentSlot`, estimator note, task legend / set / clear).
- `web/src/AgentSettings.tsx`: region, title, operator line, no-installations note, 5 th, default agent label,
  no-default option, per-agent legend, estimator / reconcile slot legends, save button.
- `web/src/App.tsx`: `RetryState` and `retryNotice` exported; notice keyed (body shape unchanged).
- `web/tests/i18nWidth.test.ts`: prefixes `agents.th.`, `agents.settings.th.`; buttons `agents.reread`,
  `agents.settings.save`; guard raised to `>= 97` (measured count before this task: 87, see t9-red.txt).
- `web/tests/agentsI18n.test.tsx`: new criterion (3 tests).

Installation `kind`/`version`, the selection's agent and model, and codes stay as sent (F6).

## Deviations from the brief (and why)

1. **Fixture `gpt-plan` → `gpt-5x`** and expected `忽略计划里的模型（gpt-5x）` — preflight P2 (carried in the dispatch).
2. **`import type { JSX } from "react"`** in the criterion — preflight P11.
3. **Criterion extended beyond the brief's text** (all of the brief's assertions kept, only `gpt-plan` renamed), to meet
   the contract's last bullet and preflight P4: every translated site is also asserted by its own element's exact text
   (legends and fieldset `aria-label`s as exact lists, `thead th` lists, row cells, `p[role=…]`, buttons list, label own
   text, first `<option>`, section `aria-label`s, h3s). Fixture additions to reach otherwise-unrendered sites:
   plan group worker layer also has `contextWindow: 1_000_000` (shows the `contextWindow` mask label), a task slot `b`
   with outcome `unavailable` / `ccloop-timeout` (shows `agents.unavailable`), a stale render with
   `preview.proposalVersion: 1` (shows `staleResolution`). A third test pins the three retry notices' English byte for byte.
   Fixture strings checked against the P2 collision words: none contains repo / ready / plan except the key name
   `planLayers` and provenance value `group-plan` (a wire enum, not rendered raw in zh).
4. **Placement of `agents` in the resources**: after `loopPlan` (which Task 8 put after `budget`), not directly after
   `budget` — key order is irrelevant to lookup and parity, and this keeps the areas in spec §2 order.
5. **MT9-3's criterion** is the exact `legend` list plus the exact fieldset `aria-label` list (P4); seen red at the
   legend list (`组 worker` vs `组 执行`) — the brief's `toContain("组 执行")` alone would stay green because
   `设置组 执行 的 agent` also contains it.

## Commands, output files, results (all read whole)

Env before each run: `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`.

| Step | Command | Output | Result |
|---|---|---|---|
| Red | `(cd web && ../node_modules/.bin/vitest run tests/agentsI18n.test.tsx tests/i18nWidth.test.ts)` | `$SCRATCH/t9-red.txt` | rc=1; agentsI18n 3/3 red (`retryNotice is not a function` ×2; settings text English), i18nWidth red `expected 87 to be >= 97` |
| Green | same two + `agentSelectionEditor`, `agentSettings`, `agentPreviewRefresh`, `confirmSelection` | `$SCRATCH/t9-green.txt` | rc=0; 6 files, 39 tests passed |
| Web check | `npm run check --workspace web` | `$SCRATCH/t9-web-check.txt` | rc=0; tsc clean; 51 files, 289 tests passed, none skipped |
| Clone | `git clone --local` → `$SCRATCH/mut-t9`, 8 files copied | `$SCRATCH/t9-clone.txt`, `$SCRATCH/t9-copy.txt` (0 bytes) | rc=0 |
| Clone baseline | the two criteria in the clone | `$SCRATCH/t9-clone-baseline.txt` | rc=0, 4/4 passed |
| Mutations | `python3 $SCRATCH/t9-mutate.py` | `$SCRATCH/t9-mutations.json`, per mutation `$SCRATCH/t9-<name>.txt` and `t9-<name>-restore.txt`; all concatenated in `$SCRATCH/t9-mutations-all.txt` (2500 lines, read whole in 4 parts) | 70/70 rc=1, each restore cmp rc=0 with a 0-byte file |

No existing criterion was rewritten; none turned red.

## Mutations (all in `$SCRATCH/mut-t9`, each seen red; test names abbreviated: S = "shows the settings page in Chinese", E = "shows the proposal's agent editor, the confirmed view, the read failure and the retry notice in Chinese")

Brief's named ones:
- MT9-1 `i18n.t("agents.contextDefault")` → `"agent default"`: S red (`agent 默认` missing).
- MT9-2 `enumText("selectionSource", provenance.agent)` → `provenance.agent`: E red (`codex 来自operator`).
- MT9-3 group legend `enumText("agentSlot", slot)` → `slot`: E red at the exact legend list (`组 worker`, `组 estimator`, `组 reconcile`).
- MT9-4 `retryPaused` literal English: E red at `retryNotice({state:"paused"})`.
- MT9-5 `t("agents.rejected")` → `"rejected"`: E red (`rejected · agent-installation-missing`).
- MT9-6 `zh.agents.settings.th.installation` → `安装表里的安装项名称`: i18nWidth red (`expected 20 to be <= 14`).

One per remaining site (raw English put back), each red in the named test with the English text visible in the diff:
AgentFields — F-contextTokens (S and E), F-ignorePlan (E), F-fieldName (E: `忽略计划里的model`), F-labelModel (S, E),
F-labelContext (S, E), F-inheritPlan (E), F-inheritAgent (S, E), F-inheritContext (S, E).
AgentSelectionEditor — E-fromAgent, E-fromModel, E-sourceModel, E-fromContext, E-sourceContext, E-unavailable,
E-regionConfirmed / Failure / Resolving / Editable (each occurrence separately), E-frozenTitle, E-thSlot/Model/Context
× Confirmed and Editable (each separately), E-thOwnLayer, E-notRecordedTask, E-notRecordedReconcile,
E-slotReconcileConfirmed, E-slotReconcileEditable, E-reread, E-titleFailure, E-titleResolving, E-cannotRead,
E-resolving, E-proposalTitle, E-stale, E-unresolved, E-groupSlot, E-setGroup, E-setGroupSlot (enumText only),
E-clearGroup, E-clearGroupSlot, E-estimatorNote, E-taskLayer, E-setTask, E-clearTask — all E red.
AgentSettings — S-region, S-title, S-operatorLine, S-noInstallations, S-thInstallation, S-thKind, S-thVersion,
S-thDefaultModel, S-thDefaultContext, S-defaultAgent, S-noDefault, S-perAgent, S-estimatorSlot, S-reconcileSlot,
S-save — all S red.
App — A-retryWaiting (E), MT9-4, A-retryStopped (E).

## Sites judged unobservable

Where the Chinese value equals the English one, putting the raw English back renders the same text, so no criterion can see it:
- `agents.label.agent` (`agent` in both),
- `agents.th.agent` in both tables (`agent` in both),
- `agents.field.agent` as the interpolated field name of the agent mask label (`agent` in both; the `model` and
  `contextWindow` field names are observed, F-fieldName).

## Concerns

- The criterion is larger than the brief's (deviation 3); every addition is an exact per-element assertion, kept to
  what the contract's last bullet and P4 ask.
- Mutation clone `$SCRATCH/mut-t9` is kept (deleting needs the human).
