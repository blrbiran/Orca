# 2026-10-09 合并后的清理

归属：Codex controller，2026-10-09（Asia/Shanghai）；授权来源：人本日明确要求删除 Orca-issues、Orca-issues2、ccloop-planner、Orca-usage-pin、Orca-integration 的无用 worktree/branch。

观测基线：Orca `c29676d6d0050d46b9cf61f45ffaee583f9dec76`、ccloop `938b7bac5940efa9772376c8ab9e6b32635e8778`、ccmem `d052c48ffa386fb16bb43e50738807c2934b41d5`。三个主检出与 `/usr/bin/git -C <repo> ls-remote origin refs/heads/main` 的结果一致。Orca `/usr/bin/git merge-base --is-ancestor fix/issues-20261009 <observed-remote-sha>` 退出 0；五个 worktree 的分支逐一对各仓 main 做同样检查，全部退出 0，`git log main..<branch>` 均为空。

主检出的 `package-lock.json` 与 `node_modules/.package-lock.json` 中 node_modules/ccloop.resolved 都指向固定 pin `ab824d16004de2d3c1613a76ec0431520aa16cc9`，已满足依赖更新要求；本次没有重复安装。

删除前逐一运行 `/usr/bin/git -C <worktree> status --porcelain=v1 --untracked-files=all`。三个 Orca worktree 干净。Orca-issues 剩 43 份未跟踪 review diff 与两条 node_modules 软链；ccloop-planner 只有 node_modules 软链。没有未提交产品代码。

43 份 diff 已归档 `worktree-archives/2026-10-09-Orca-issues-review-diffs.tar.gz`，逐文件内容与原文件 SHA256 相同，manifest 在同名 `.json`。压缩包 SHA256 `cd546432c738eab4abd4732062c49b9e71a6b3f7d23c65cd00f24aa2afd468e0`。依赖软链的目标记录在 manifest，移除软链未删除主检出的依赖。

已执行并成功（均使用 `rtk proxy /usr/bin/git -C <repo>`，权限升级经自动审核）：

- worktree remove：Orca-issues2、Orca-usage-pin、Orca-integration。
- worktree remove --force：Orca-issues（审查材料先归档）、ccloop-planner（仅依赖软链）。
- branch -d：fix/issues-20261008、fix/issues-20261009、deps/usage-by-model-pin、feat/integration-schemes、fix/codex-planner-output。
- 两仓 worktree prune --expire now：清掉两个 Orca scratchpad 登记和 ccloop-codex-0919 的失效登记，目录此前不存在。

清理后 Orca 仍有主检出和两个未点名 Codex managed worktree；ccloop 只剩主检出。未删除其它分支或远端分支；没有推送、合并、重启服务或运行付费模型。
