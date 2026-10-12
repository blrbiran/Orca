# 2026-10-12 本机服务切换记录

本记录接续 `handoff.md` §4.0 和 `.superpowers/sdd/2026-10-11-feedback-followup/task-14-native-gates-report.md`。本轮从 Orca 本地 `main` 建 `codex/live-service-cutover` 分支；ccloop 远端 `main` 在 repin 前经 `git ls-remote` 确认已到提交主题 `docs(handoff): roll Orca followup state in place`。人分别授权后，Orca、ccloop、ccmem 的本轮分支均以 `--ff-only` 合入各自本地 main。本席未执行 push；合入后的收尾 `ls-remote` 观测到三仓远端 main 已由人推进到各自合入提交，最后一笔“合入后交接更正”当时仍仅在本地。Results 5 原工作树的 HEAD、porcelain SHA256 与 21 项文件／软链接指纹按上轮基准重算后全部相同。

## 实际数据与备份

开工时 `~/.orca/control/panel/control.sqlite` 为 schema 9，`~/.orca/control/orca-e0c92460/control.sqlite` 为 schema 7；两库 `PRAGMA integrity_check` 都为 `ok`，groups、runs、未送达 outbox 均为 0。两把 `service-lock` 的记录 PID 经 `ps -p` 确认为已死，7777 端口无人监听。账户库已有 owner 账户；旧入口为 `~/.orca/panel.sh`，`dev.orca.panel` LaunchAgent 尚未安装。ccmem daemon 为活进程，未停止或重启。

SQLite backup API 建立了两库、`accounts.sqlite` 和真实 `~/.claude/ccmem/global.db` 的一致性副本；同时保存 agents、profile、旧 launcher 与 JWT key。每个副本通过 `PRAGMA integrity_check`；文件大小和 SHA256 在私有清单 `/Users/biran/.orca/backups/service-cutover-1791780311676/manifest.json`。ccmem 备份定名为 `/Users/biran/.claude/ccmem/global.db.bak.1791780311676`，包含备份时已提交的 WAL 页。第一次校验临时 ccmem 副本时只读打开失败；将该副本转成独立 DELETE journal 文件、校验 `ok` 后才定名，遗留的临时 `-shm` 已清除。

先对两份备份的 `/private/tmp` 副本分别执行 9→13、7→13，均得到 schema 13、`integrity_check=ok`、新安装表与 outbox 存在、groups/runs 保持 0。随后使用生产 `openControlStore({recovery:true})` 在真实路径执行同一升级：两库均为 schema 13、`integrity_check=ok`、groups/runs/待处理安装 outbox 为 0；旧死 owner 锁由恢复机制改为 retired-lock，未杀活进程。

## launchd 与依赖

原生 `tests/service/realSmoke.test.ts` 首次两次都在卸载后的立即 `launchctl print` 断言失败。独立隔离探针证明：`uninstall` 返回 0 且 plist 已移除时首次 print 仍为 0，约 100 ms 后返回 113。测试改成等待实际卸载；同一真实 launchd 冒烟在 Node 22.13.1 和正式服务采用的 `/usr/local/bin/node` 24.13.0 下各 1/1 通过。该测试使用隔离 label `dev.orca.panel.smoke`，没有使用真实控制库。

真实 `~/.orca/agents.json` 的两个旧版本值与已装 CLI 不符。`ccloop agents detect` 的草稿和原表逐字段比较，除 Claude `2.1.288→2.1.296`、Codex `0.155.1→0.160.0` 外无差异；只将这两处原子更新，随后 `agents validate` 两项均通过。未调用付费 provider。

仓库脚本 `scripts/pin-ccloop.mjs` 将 Orca package/lock 默认 ccloop 固定到已发布的 ccloop `2026ef14627bedb7a874bde561026e1484af3350`；脚本检查依赖条目、仅 ccloop lock 条目变化、真实安装目录、默认解析 12/12、类型检查及干净副本 `npm ci`，均退出 0。正式 `npm run verify:ccloop-pin` 3/3，类型检查和构建退出 0。repin 暴露配对安装测试把 `node_modules/ccloop` 当旧 peer 的隐含假设：先实测 1 过／2 红，改为显式 `ORCA_TASK9_OLD_CCLOOP_BIN` 后，以旧 `ab824d1` 与新 CLI 配对实跑 3/3。

正式 `orca panel install` 的配置使用 `/usr/local/bin/node`、端口 7777、项目 `orca=/Users/biran/code/orca/orca-web`、控制库 `/Users/biran/.orca/control/panel`、账户根 `/Users/biran/.orca/control`、真实 ccmem 根 `/Users/biran/.claude/ccmem`。初次启动显式使用本地新 ccloop；repin 后重新安装并移除 `ORCA_CCLOOP_BIN` 覆盖，由 Orca 解析已固定的 npm 包。`dev.orca.panel` 的新进程在 `http://127.0.0.1:7777` 应答：服务 status 报 launchd running，首页 HTTP 200，未登录的 `/api/control/summary` 为 401，控制库仍为 schema 13 且完整性 `ok`。旧 `~/.orca/panel.sh` 已改名为 `panel.sh.retired-20261012`，备份也保留原件。`ccmem export --json --scope global` 在显式真实根下返回 version 0.7、3901 条；导出内容未保留。现有 ccmem daemon 未切换代码或重启。

## 门与边界

原生完整根级 Vitest 因普通沙箱缺少 `ps`／loopback 权限，首次 3772 条里 1927 失败，其中 1695 条为 `spawnSync ps EPERM`、52 条为 `listen EPERM`；原始日志保留在 `/private/tmp/orca-followup-runs/cutover-root-20261012/`。使用本机进程权限、私有 HOME/XDG/CCMEM_DATA_ROOT 和短 TMPDIR 的完整重跑退出 0：3772 条中 3739 通过、0 失败、33 条条件跳过，证据在 `/private/tmp/orca-followup-runs/cutover-root-native-20261012/` 与 `/private/tmp/orca-root-native-20261012.json`。相对 Task 14 的 30 条，多 3 条是未传 Task 9 配对 CLI 时的条件跳过；这 3 条另以新旧 CLI 通过。此轮完整根级门在 repin 前执行；repin 后的默认包 3/3 和配对 3/3 分别实跑，未重复整套 22 分钟门。

本轮没有付费 provider 调用、真实任务执行或 Linux 原生锁验证，也没有对生产 ccmem 库执行 schema 迁移。真实网页登录与记忆页没有使用人的密码做端到端会话验证；已验证服务应答、未登录拒绝和真实 ccmem CLI 导出。Orca 本地 main 现已包含新 pin；当前运行服务使用该 main checkout 已安装的固定包。

## 回退

如需撤销，先停止 `dev.orca.panel`，确认端口、socket 与两个控制库的 owner 均无活写入者，再根据 manifest 校验备份 SHA256。若切换后产生任何新任务／账户数据，先保全新增数据，不能直接用旧副本覆盖。无新写入时可将两份 `control.sqlite` 和 `accounts.sqlite` 备份复制到各原目录的临时名，校验后原子替换；JWT key、agents/profile 和旧 launcher 也在同一备份集。随后卸载新服务，并将 `panel.sh.retired-20261012` 还原为原名。ccmem daemon 始终活着；只有在确认它已停止且确有 ccmem 数据损坏时，才考虑其独立备份和 WAL 恢复，不能直接覆盖运行中的全局库。

## Results 5 后续核对与清理

本轮追加核对原 `progress-results-20261010/Orca` 工作树：其已提交分支 tip 经 `git merge-base --is-ancestor` 证实已在 main，21 项 WIP 里每个路径都已在 main；6 项字节相同，其余是 main 的后续版本。旧 WIP 的 Results 入口、组件、双语文案、预览下载和原测试均已由 main 包含；main 又补了跨刷新保存权威、登录撤销下载、旧响应拒绝和中文状态翻译等保护。将旧文件覆写 main 会倒退这些修正，没有独有代码需要再合。私有 HOME 下、Node 24 的 `npm run --ws check` 在当前 main 通过 111 文件／987 测试；原始记录在 `/private/tmp/orca-followup-runs/results5-web-current-20261012/`。

清理前按上一轮 `original-wip-before.json` 复核旧 HEAD、porcelain SHA256 和 21 项文件／软链接指纹不变，将全部 WIP 归档到 `/Users/biran/code/skills/loop/orca_archived_files/results5-wip-20261012.tar.gz`，清单为同目录 `.manifest.json`；归档 SHA256、21 个 tar 成员和每项内容再次校验一致。Codex 原生附加工具因“由另一个任务拥有”拒绝接管该工作树；在用户明确要求清理且可恢复归档完成后，使用 Git 移除该脏工作树并以 `branch -d` 删除已合入的分支。`git worktree list` 已无该路径。其他 detached 工作树未动。
