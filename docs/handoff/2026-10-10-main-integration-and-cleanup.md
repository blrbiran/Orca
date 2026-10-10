# 三仓 main 整合与清理

归属：Codex controller，2026-10-10 Asia/Shanghai。人本轮明确要求“先将所有仓库的改动都合入main 分支，清理无用的worktree 和 branch”，覆盖旧交接中将本地整合/清理留给人的说明。未包含 push 或真实服务/库切换。

## 整合

Orca 从反馈分支切到 main，以 `/usr/bin/git merge --ff-only` 收录产品主题 `fix(panel): clarify capabilities and complete requirement archive controls` 及反馈交接主题。D9/M3、M5/M6、issue-fixes 之前已在 main，未重做实现或性能实验。

ccloop main 已包含当前固定 pin 的产品。旧 backup 分支相对共同祖先只有 6 行报告追加，src 零差异，main 已不跟踪 `.wolf/memory.md`。这 6 行逐字节追加到既有报告，并另起归属说明，主题 `docs: preserve historical backup report on main before cleanup`。不将 7 月自述当成 10 月的新验收。原两笔历史提交通过 tag `archive/evidence-first-v1-20261010` 保留。

ccmem config-value-parity 已由前轮本地合入，本轮仅核实并清理已合入分支，不重复合并或改配置。

## 清理前保全

Orca control-foundation worktree 唯一未提交 tracked 文件是历史 handoff 更正：完整快照压缩和二进制 patch 存于 `worktree-archives/2026-10-10-main-cleanup/`。它是历史材料，不覆盖当前主 handoff。另发现该 worktree 691 项忽略证据、usage-settlement worktree 24 项忽略证据：逐文件压缩保存，按各自 manifest 全成员读回并核 SHA256。归档主题 `docs: preserve old worktree evidence before authorized cleanup`。两个 untracked node_modules 都是指向主检出依赖的软链。构建 dist、Vite 测试缓存可重建。

## 本轮验证

验收源码观察锚点为历史提交 682db866d47f95ce9d0da2694d1cda9d7d1f6478；后续归档提交仅改文档。命令均在隔离 HOME/XDG/TMPDIR/CCMEM_DATA_ROOT 下执行，去掉 CCMEM_CONFIG_PATH。ORCA_CCLOOP_BIN 为 `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`，agent table 为该 clone 的 fake integration 夹具。无付费 provider。

已完成：Web TypeScript + 92 文件/751 条通过；root build/typecheck 与 web build RC0；panel 0–14 RC0；pin 3/3；ccloop build/typecheck RC0；ccmem 四个配置文件25/25，非全仓门。实际 merged main 后端全量371文件/3505通过/0失败/4跳过，RC0，工具报1179.86s。跳过项为3条默认pin（另跑3/3）与1条真实launchd（未跑）。

首轮沙箱全量因快速失败中止，诊断单文件19/19报 `spawnSync ps EPERM`，定位到控制 store 的进程身份查询。授权重跑未改源码，实际同文件19/19通过。原失败与中止日志保留，不能当业务 RED 或抹掉失败。

浏览器几何仍需人验；SQLite 实验警告、Vite JS592.97kB警告保留。schema10单向、真实库/daemon/人的面板仍未切换。

## 下一轮

按 brainstorming 先定延后反馈的第一批目标与设计范围。总览/行动区、设置聚合、成果报告、跨组演进分开设计；右键、向导与视觉样式按依赖再排。原反馈中“组内每任务需手动启动”的假设已被现行driver否定，项目选择是全局上下文而非静态偏好，导入plan是操作。已完成轮不重开。

## 清理收口

实际移除 Orca 三个 linked worktree：control-foundation-0919、usage-settlement-handoff-retry、codex-skill-support；逐树先确认HEAD属于main祖先，逐项复核归档字节，恢复已保全的旧handoff和移除已核目标的node_modules软链，然后非force worktree remove。删除11个本地旧分支：Orca6、ccloop4、ccmem1；已合入分支用branch -d，ccloop历史backup独有文本先原样保全main/提交由archive tag留住，再移除旧branch ref。没有丢弃独有源改动、历史证据或真实数据。

三仓各仅保留本地main和主检出；远端分支未删，未push。旧台账的保留/待人合并说明是历史观测，本轮人明确授权已覆盖。
