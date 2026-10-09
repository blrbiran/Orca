# Performance round drafting report

归属：Codex controller 的 draft_performance_round 席，2026-10-09（Asia/Shanghai）。所在 branch codex/d9-m3-implementation；写作前 HEAD 2c14e7378684c48ae33b5777ba9a3c430287a586（`rtk proxy /usr/bin/git rev-parse HEAD`）。生产源码仅固定读取 c29676d6d0050d46b9cf61f45ffaee583f9dec76（`rtk proxy /usr/bin/git show c29676d:<path>`），未把在飞 D9/M3 当成稳定基线。

产物：

- `docs/superpowers/specs/2026-10-09-control-poll-performance-design.md`
- `docs/superpowers/plans/2026-10-09-control-poll-performance.md`

只起草新文档。未写产品/tests/git/旧spec/旧ledger，未跑suite、服务、付费provider或benchmark。controller将派fresh设计/plan审后决定执行；不是性能已完成报告。

读取RTK.md、CLAUDE.md、brainstorming/writing-plans技能、新轮handoff、旧final-review M5/M6与旧progress Round close。三方案维持request-local snapshot推荐；D9/M3完整最新树为实施/性能before基线，必须另外记录commit。

自检重点：最新activity不仅取seq对应at，还保留完整kind/body的entryOf校验与原拒绝先后；rawsnapshot必须lazyparse，summary与groupview不能共用同一严格schema政策；rowid历史顺序与id显示顺序分开；已有groupbody仅同步复用。

与controller裁定一致，M6选入口filter：每同步段每归档组一次lookup/parse、targethandler/provider=0；剩余O归档组/待wake扫描明确保留。SQL-only完整strictmark谓词与JSON重复key等风险暂不承担。过滤坏group/mark不当archived，回旧strictauthority；await后清局部map，避免同pump取消归档仍被挡住；交易内guard必留。

规模DAG task0无dep/task1一个dep/其余两个dep；实际E必须由构造代码sum计算并写manifest，不使用人人2dep循环图，不报未观测边数/耗时/测试条数。100live×50tasks+100archived×3pendingwakes，所有计数和时长从真实summary/group/replenish/pump入口测。计数hook与timing分开，操作负载初态恢复，before是D9/M3完成而非固定读码c29676d。

未决执行风险：

- baselineafter D9/M3若改过runview/usage/refusal需fresh读码与controller裁定，不能机械覆盖。
- entryfilter通过严格语义换取有限收益，不能夸大为SQL零parse或所有N+1消除。
- benchmarkfixture必须形成同一store100组合法数据；不能用100个store或只测map/helper冒充summary规模。
- 混合handler await让同组可重新读取，数量上界是同步段而非整个pump，实测须分别报告。

文档自检按技能做speccoverage/typeconsistency/refusal/count/mutation检查；没有用户权限或自动审查阻塞。本席不提交文档，交controller统一归属/审核/提交。
