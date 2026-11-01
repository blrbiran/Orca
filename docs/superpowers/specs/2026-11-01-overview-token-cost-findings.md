# Where a clarify or split call's input tokens go

Who: Claude Code session `663fb68e`, 2026-11-01, at Orca commit `21c08f7f` (historical anchor). Human ruling for the paid calls: 「这一轮允许必要的付费真跑」. Nothing in the product changed for this. §4 is a recommendation waiting for the human.

## 1. The question

Tester run `run-3e770d4e`: one omp single call, `input` 250,493, `cacheRead` 0, no tool results (excerpt `orca_archived_files/run-3e770d4e-usage-excerpt.json`). One turn with no tools means the 250,493 is the first request's size. Our earlier paid measurement, 12.6–13.0 k per call, did not reproduce the tester's figure.

## 2. Measured

**Every clarify and split prompt embeds the repository overview** (`buildClarifyPrompt`, `buildSplitPrompt`), capped by `OVERVIEW_LIMITS` in `src/control/requirementOverview.ts`: list 120 KiB, documents 48 KiB, structure 120 KiB. So it scales with the repository, up to about 288 KiB. The 12.6–13.0 k came from a small repository.

Overview bytes, from `buildRepositoryOverview` on each repository:

| Repository | Overview bytes | Files in tree | List cut | Structure cut |
|---|---:|---:|---|---|
| Orca | 276,532 | 5,272 | yes | yes |
| ccloop | 128,437 | 930 | no | no |
| ccmem | 49,984 | 334 | no | no |

Tokens for the Orca overview, `claude -p --model haiku` with no settings, tools or session file, prompt tokens as the tool reported them (input + cache creation + cache read; scripts in the session scratchpad, which ends with the session):

| Sent | Bytes | Prompt tokens |
|---|---:|---:|
| one line only (baseline) | n/a | 2,843 |
| whole overview | 276,532 | 134,691 |
| `files` | 126,410 | 65,064 |
| `structure` | 122,781 | 61,653 |
| `docs` | 27,219 | 13,936 |

About 2.1 bytes per token: paths and symbol names are dense. The five calls cost $0.16007721 as the tool reported. Two Codex attempts were refused before the model answered ("You've hit your usage limit", until 2026-11-04 16:12) and reported no usage.

Real calls, from a backup copy of the control store (`~/.orca/backups/pre-schema21-20261029-135742/control.sqlite`; the overview in `~/.orca/control/panel.overview` of that repository is 158,747 bytes):

| Purpose | Prompt bytes | Reported tokens, input and output |
|---|---:|---:|
| clarify | 162,059 | 85,533 |
| clarify | 167,842 | 87,879 |
| clarify | 173,850 | 89,915 |
| clarify | 180,168 | 92,083 |
| split | 176,452 | 112,718 |
| estimate | 98,113 | 60,041 |

## 3. Conclusion, and its limit

The overview is the main cost of a clarify or split call on a large repository: on those clarify calls it is 88–98% of the prompt bytes, and each call sends it again.

It does not by itself prove 250,493. An overview at the cap is about 288 KiB, which at the Claude ratio is about 140 k tokens, so the tester's call needs another 110 k: a tokenizer that counts more per byte (the model was `Qwen3.8-Max-DogFooding` behind an `openai-completions` endpoint, whose ratio we have not measured), a larger prompt, or both. The run is also from 2026-10-19, before split prompt v3. The query in `docs/handoff/handoff.md` §8 settles it from the tester's store.

`cacheRead` 0 adds to the tester's cost: every call pays the whole overview at the full rate on that endpoint.

## 4. Recommendation (not done; the human decides)

Each option changes what the model sees, so it needs one before-and-after paid comparison of draft quality.

- (a) **Clarify stops sending `structure`.** It asks questions about intent, and a person can answer what symbols would tell it. Saves about 46% of the overview on Orca's figures. Split keeps it, since it names target paths.
- (b) **Lower the caps for all calls**, for example list 120 to 48 KiB. `files.directories` already summarises a cut list, and target paths are validated against git (`overviewPathExists`), not against the list, so a shorter list cannot let a bad path through. The risk is a split that cannot see the file it should name.
- (c) **Leave it**, and show each call's prompt size in the panel so the cost is visible.

➡️ (a), then (b) if the comparison holds up. Reusing a session across calls stays closed (#109, ccloop #50).

Multi-directory projects divide only `maxPaths` among members; each member's byte caps are unchanged (spec 2026-10-24, §6.3), so such a project can exceed one repository's total. Not measured.
