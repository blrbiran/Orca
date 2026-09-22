# 控制面两道门的基线（第 1 步）

**归属**：会话 `da2f5e9a`（Claude Code 交互会话，不是 orca run），2026-09-22。
**观测锚点**：主题行 `docs(handoff): roll the entry point onto the six rulings and the order they land in` 那一笔，
工作树 `git status --porcelain` **整份读回 0 字节**（跑前跑后各一次）。
**本步没有改动任何 `src/`、`tests/`、`scripts/` 或 `package.json`。**

## 为什么要先做这一步

handoff 记的是「`verify:control` 与 `verify:web-control:consumer` 本轮未跑（缺 `/tmp` 的 ccloop artifact），
不许引用旧数」。⇒ **这两道门的状态是未知的**，而下一步（G1 那条线）要改的正是它们观测的协议。
**在状态未知的门上改协议，改完分不清红的是新回归还是本来就红。**

## 🔴 一处更正：artifact 并没有缺

现测两个 artifact **都在**：

| 路径 | 实测 |
|---|---|
| `/tmp/ccloop-codex-0919/dist/cli.js` | 存在，`-rwxr-xr-x`，166 B，**build 时间 Sep 19 21:48** |
| `/tmp/orca-ccloop-d3-task8/fake-codex-config.json` | 存在，`-rw-------`，273 B |

测量命令：`rtk proxy ls -la /tmp/ccloop-codex-0919/ /tmp/ccloop-codex-0919/dist/`（未过滤整份读回）。

⇒ **「缺 artifact」这个说法为假** —— 开发树活着，只是上一轮没去用它。
⚠️ **但 `dist` 是 9/19 的构建**：这个基线反映的是**那一刻的 ccloop**，不是 ccloop 的当前 `src/`。
**下一轮在 ccloop 侧动契约之后，这两道门必须重跑，且要先重建 `dist`。**

⚠️ *** **rtk 的过滤层在本步骗过一次**：`ls /tmp/ccloop-codex-0919` 的过滤输出里**没有 `dist/`**，
而 `rtk proxy ls -la` 的整份读回里它在。**目录列表也算验证性读，一律走 `rtk proxy` ＋ 整份读回。** ***

## 基线（**只抄工具报数**）

两道门都带 `PATH="/usr/local/bin:$PATH"`、
`ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js`、
`ORCA_CCLOOP_ADAPTER_CONFIG=/tmp/orca-ccloop-d3-task8/fake-codex-config.json`，
走 `rtk proxy`，**未过滤重定向到文件再整份读回**。

| 门 | 命令 | RC | 结果 | 日志 |
|---|---|---|---|---|
| 消费者门 | `npm run verify:web-control:consumer` | **1** | 1 文件失败（1）；**2 失败 / 2 通过（4）**，0 skipped；耗时 1.18s | `test-logs/g1-consumer.log` |
| 控制门 | `npm run verify:control` | **1** | **42 文件通过 / 1 失败（43）**；**430 通过 / 2 失败（432）**，0 skipped；耗时 78.55s | `test-logs/g2-control.log` |

*** **两道门的全部失败就是同一对判据，且原因相同** ***：
`tests/control/webCcloopSmoke.test.ts` 的两条，报 `start-envelope-conflict:run:targetVersion`，
抛点在 `src/control/startEnvelope.ts:65`。
⇒ **这不是回归，是已知的 `targetVersion` 分歧**（Orca handoff 与 `goal.md` §8 的 G1 都记着）。

## 这条基线怎么用

*** **下一轮改协议之后，判别式是「除这两条之外有没有新的红」。** ***
- 消费者门回绿 ＝ RC 0、4 通过、0 失败。
- 控制门回绿 ＝ RC 0、43 文件通过、432 通过、0 失败、**0 skipped**。
⚠️ **别只看 RC**：这两道门在修好 `targetVersion` 之前**必然 RC1**，
**RC1 本身不携带信息，要看的是失败判据的名字与条数。**

## Rule 17 核验

跑前跑后各测一次 `rtk proxy ls -la ~/.orca ~/.orca/control`：
`~/.orca/` 与 `~/.orca/control/` **都是 `drwx------`（0700）**，`control/` 下**始终为空**，
`control/` 的 mtime **跑前跑后都是 `Sep 22 23:02`**，而两道门跑在 **23:13–23:15**。
⇒ *** **两道门没有写进真实用户数据。** ***

## 没做

- **没有重建 ccloop 的 `dist`** —— 本步要的是「现状基线」，重建会把基线换成另一个东西。
- 没有跑 `npm test` 全量、`typecheck`、Web 门、`verify:panel`：**本步的目标只有这两道门**，
  其余各门的最近实测见 Orca handoff 上一节，**不在本步的观测范围内，不许拿本步的结论去覆盖它们**。
