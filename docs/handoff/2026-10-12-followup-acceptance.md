# 2026-10-12 后续验收与待交接边界

本记录接续 `handoff.md` §4.0 与 `2026-10-12-live-service-cutover.md`。每次接手先现查三个仓库的本地分支、工作树与 `git ls-remote origin refs/heads/main`；这里不把会随文档提交移动的 HEAD 写成常量。下列 `/private/tmp` 路径是本机原始证据，清理临时目录后不能代替重新运行。

## 已验证

- ccmem 迁移备份修复已快进本地 main，主题为 `fix(db): publish validated WAL-safe migration backups` 与 `fix(test): remove temporary data root after every suite`；原 topic 分支已删。迁移前用 SQLite `VACUUM INTO` 生成隐藏临时副本，做完整性与 schema 检查，fsync 后以不覆盖已存在备份的硬链接发布；按内容散列复用并只轮换有效备份。专用判据先对旧实现见红，最终全量 `npm test` 760/760，日志 `/private/tmp/ccmem-full-reviewed-final-20261012.log`。真实备份的临时副本校验 `sourceCount=12879`、`backupCount=12879`、`integrity_check=ok`；副本已删。生产 ccmem daemon 仍是 2026-09-08 启动的原进程，真实数据没有交给测试运行。
- 真实 Claude CLI 的隔离任务在计划阶段收到周额度限制（返回的重置提示是 Asia/Shanghai 09:00），0 tokens、$0；证据 `/private/tmp/orca-live-acceptance-claude-20261012/summary.json`。fake Claude 面板任务通过。原固定 ccloop 包的真实 Codex execute 触发 strict structured output 的 `taskResult` 非 required 错误；原始证据 `/private/tmp/orca-live-driver-codex-20261012/summary.json`。修复留在 ccloop 的 `codex/codex-strict-output-wire`，主题 `fix(codex): send strict execute result schema`：provider wire 用 complete／partial × 有／无报告四个严格候选，业务解码的 optional 报告语义未变。新增判据对旧实现见红，真实 Codex API 探针接受新 schema；受控两 worker 的 ccloop 全量 1602/1602，原始日志 `/private/tmp/ccloop-strict-wire-full-escalated-20261012.log`，独立代码审查无待修项。默认并发、普通沙箱下的多处进程／时序红保留在 `/private/tmp/ccloop-strict-wire-full-20261012.log`，不是这次通过结果。
- 使用**本地修复版 ccloop 构建**而非 Orca 当前固定包，在隔离根跑真实 Codex Luna：plan、execute、verify 三阶段齐全，任务成功落地、工作区已清理；provider 与 Orca 账本同为 102919 tokens，所有检查为 true。证据 `/private/tmp/orca-live-driver-codex-strict2-20261012/summary.json`。这只证明该隔离运行；生产 launchd 仍用修复前的默认 pin，待已发布 ccloop 提交重钉后才会使用新 wire schema。
- Ubuntu 24.04 arm64 的临时 VM `orca-linux-smoke-20261012`（当前停止）用 Node 24.21.0、离线 npm 缓存完成安装；Orca typecheck、后端／Web 构建通过；`systemd.test.ts` 和 `repoLock.test.ts` 共 16/16。唯一的测试 unit `orca-panel-smoke-20261012` 在 VM 内真实安装，HTTP 200、重启换 PID、停止再启动均通过，卸载后 unit `LoadState=not-found`、`panel status` 回 `service-not-installed`；生成的 `service.json`／`run.sh` 按产品设计保留。Orca `repoLock` 跨进程占用拒绝、释放后再取得；ccloop 真正的 Linux `/usr/bin/flock` helper 也在两进程竞争中串行并释放。macOS 正式 `dev.orca.panel` 的 status 在本轮复核仍为 launchd running、127.0.0.1:7777 应答。
- GitHub keyring 登录有 `repo` scope；运行 `gh` 时须清掉继承的 `GH_TOKEN`／`GITHUB_TOKEN`，否则失效的环境 token 会遮住 keyring。私有验收库 `blrbiran/orca-integration-smoke-20261012` 已建；`/private/tmp/orca-gh-smoke-20261012` 里从该库 main 创建的 `orca/g-smoke-20261012` 只有本地提交。Orca 项目远端没有因此被修改。

## 尚未完成与下一动作

1. ccloop `CLAUDE.md` Rule 13 对**每一次合并与 push** 要分别授权。修复 topic 已提交、尚未合本地 main 或推远端。获两项逐次授权后先 `--ff-only` 合 ccloop、推其 main，再在 Orca 当前 `codex/codex-wire-repin`（从 main 创建）运行 `node scripts/pin-ccloop.mjs <已发布的完整提交号>`、复验默认 pin 与服务，并按 Orca Rule 15 为合 main／push 分别取授权。此前 Orca main 另有两笔仅 handoff 文档的本地提交，其 push 也已单独提请授权，不能把未确认的推送写成已完成。
2. GitHub 私有验收库分支的 push 已按 Orca Rule 15 单独提请授权；未获回复前没有 push、没有 PR。获准后用 Orca `pushPorcelain` 推这条**测试库分支**，再用 `syncGroupPr` 创建 draft PR 并验证重试幂等；创建 PR 后按 Codex 工具要求附着 PR。若要删测试库分支、旧 worktree 或远端库，各自重新核授权。
3. 正式面板的 owner 登录页可见，仍待 owner 在浏览器登录；没读或传密码。登录后需核 Results、Memory 与真实账户边界，不能把未登录 HTTP 200／401 当作已验登录体验。
4. ccmem main 有上述两笔产品／测试提交，未 push；最终滚动 handoff 的提交也尚未形成。两处 detached 旧工作树的 HEAD 均已被各自 main 包含：Orca `feedback-followup-20261011/Orca` 干净，ccloop `/private/tmp/orca-results-ccloop-20261010` 仅有指向主 checkout 的 `node_modules` 软链。它们未附着本任务，删除已按两仓规则逐个提请授权。
5. 路线图核对：Orca memory adapter 仍只读、`recordCorrection:false`，本机 `~/.orca/corrections.jsonl` 尚不存在；自动写回需要 ccmem 外部引用、以 `projectKey+correctionId` 幂等的输入契约和失败重试语义，不能直接用当前逐行吞错的 import。LiteLLM 与 A2A 在 Orca／ccloop 运行源码中均无接入；A2A 对外入口按已有人裁排远期。LiteLLM 接入前先定模型别名／实际成本来源、未知成本阻断口径和 per-run 预算边界，现有软 token 预算不能被描述成严格金钱上限。
