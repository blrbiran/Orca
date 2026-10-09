# 已登记负载超时：issue-fixes F2

归属：Codex controller，2026-10-09（Asia/Shanghai）；人本日明确同意登记 F2 的四条 timeout。材料基线：Orca `c29676d6d0050d46b9cf61f45ffaee583f9dec76`；引用历史观测，未在本次重跑。

历史证据：`.superpowers/sdd/2026-10-08-issue-fixes/progress.md` 的 Task F2。观测 commit `11027ab`；隔离 clone 中 `npm test` 4 条均为 `Test timed out in 5000ms`，负载约 10；每个文件在负载约 5–6 单跑 3/3 绿。该段记录全量结果、隔离环境、其它门与验收边界，原文保留。

| 文件 | 精确测试名 |
|---|---|
| tests/control/retryTask.test.ts | refuses a run blocked for any other reason: a succeeded run out of bounds, a transient failure, another step |
| tests/control/retryTask.test.ts | refuses a stopped group with stop-mode-conflict and a clarifying group with group-state-invalid |
| tests/control/retryTask.test.ts | refuses on either half of the stop guard alone: stopped without an intent, an intent without stopped |
| tests/control/requirementCommands.test.ts | re-queues a failed draft as the next draft with a fresh retry count (Task 8 carry) |

登记只适用于该 timeout 类别，不能豁免断言失败、不同错误或新运行中的稳定回归。再次遇见时记录完整输出、commit、`uptime`，负载下降后按文件单跑三次。不能因一次单跑绿或旧登记就报全量门全绿；仍如实报 failures/skips。

其它历轮 flake 继续见 `docs/handoff/handoff.md` §三。本次只落实人点名的 F2 四条，未把旧候选扩大为新的豁免名单，也未提高任何测试超时。
