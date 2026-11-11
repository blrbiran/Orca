# Tester follow-up E — progress ledger

Controller: the Orca session started 2026-11-11 after commit
`docs(handoff): tester follow-up D round -- browser login, estimate as expectation, accept-attempt, the issue batch, what waits for the human`
(scratchpad id at start `4361b629`). Design: `docs/superpowers/specs/2026-11-11-tester-followup-e-design.md`.
This ledger is append-only (Rule 13): corrections go in new sections.

## Start state (2026-11-11, `/usr/bin/git ls-remote` vs local main)

Orca, ccloop, ccmem and syncskill: local main equals `origin/main` (the human pushed round D before this session).
Orca pins ccloop `095dbdf` (the #225 commit).

## Human rulings (verbatim)

Opening message:
- On round D's two design answers: 「同意」. On accept-attempt's §8 deviations: 「同意」.
- #125 (a): 「你看下 Orca 和 ccloop 整体如何调整最优，先不要顾虑之前裁定的部分，之前裁定时不一定有考虑好。」
- Items needing a ruling: 「具体列出你的建议和原因」. Browser review: 「告诉我具体要看哪些」. Cleanup: 「帮我清理」.
- Tester issues: analyse against current code, user's point of view, earlier rulings may be revisited; stop after the
  analysis to choose this session's scope.

Second message (after the controller's recommendations):
- 「#200 lilac 主题。 => 加」
- 「待裁事项 => 其他都按你的建议走」 — #125: split call-failed reasonCode, `lastInvalidReason` unchanged;
  #101/#104/#116: agents may settle with charge-remaining-grant / release-known-zero; #168: docs-only suite validator;
  D21: `orca project add`, human only, Web POST owner-only; attempts: explicit retry in an unlimited group gets fresh
  default attempts; #84: overlay and collapsible motion.
- 「真浏览器要看什么 => 暂时不看，我之后发现问题会再找你」
- 「#243 => 这一轮先不做，下一轮我们讨论一下」 — the composer and the Live note box are deferred; the controller
  reads the transcript font unification as part of #244 (same root cause: the transcript sat inside a table cell).
- 「要你点头才做的 => 其他都同意」 — #241 group acceptance check and #251 `--finish` approved.
- 「我建议本 session 做的 => 同意」 — scope: P0 #249 + activity-kind gap; P1 #242, #245; P2 transcript batch;
  P3 #250/#251/#246, #256/#258/#257; the rulings above; #241. The plan named the `i18nPseudo` count rewrite (#245) and
  the `singleCallErrorCode` rewrites (#125) as needing authorization; read as authorized by this 「同意」.
- 「清理脚本已执行」 — the round-D temp directories (handoff §八 12) are gone.

## Triage (read-only, three sub-agents, against main at the start commit)

- #242 reproduces (explicit `--group` skips the membership check; server has no group+run endpoint).
- #246 by design (agent-selection spec: no layer names an agent ⇒ `agent-unselected`); the tester's hint claim is
  wrong (the hint says `--agent` / `defaultAgent`, unchanged since 905dac97).
- #250 partly: `--slot worker` already sets every slot (tester-round2 spec: "the group worker slot is the batch set"),
  but the refusal never says so; `plan save --requirement` does not seed the estimator agent.
- #251 reproduces; spec'd rule (answer queues the next round while the frontier is open).
- #245 confirmed: pass, not-needed and stopped are silent. Side finding: Web `activityKinds` lacks
  `saved-result-top-up` (any topped-up run's activity is unreadable on the Web) — verified by the controller.
- #241 tail: group done runs no checks; only each task's own required checks ever run.
- #249 confirmed in ccloop: a mid-stream `error` row poisons `CodexUsageFold`; `decodePhase` rethrows without
  `observedTokens`. Orca side (`floorTokens:null` booked 0 and shown "unknown, at least 0") is spec'd.
- #243–#258 Web: all reproduce; #252 also makes Live follow plan instead of the running execute; #257's default view
  is spec'd.
- #247/#248/#259/#260: defects in the tester's target repository's generated code, not Orca.

## Workstreams

| id | scope | repo | branch / worktree | state |
|---|---|---|---|---|
| W1 | §1 #249 | ccloop | (filled by the implementer) | dispatched |
| W2 | §2 activity kinds, §3 #242, §4 #245, §5 #241 | Orca | | dispatched |
| W3 | §6 transcript | Orca | | dispatched |
| W4 | §7 #125 #250 #251 #246 | Orca | | dispatched |
| W5 | §8 settlement, attempts | Orca | | dispatched |
| W6 | §9 D21, #168 | Orca | | dispatched |
| W7 | §10 #256 #258 #257 #84 #200 | Orca | | dispatched |

Logs: `/private/tmp/orca-e1111/<workstream>/` (fixed path; scratchpads are replaced between turns).
