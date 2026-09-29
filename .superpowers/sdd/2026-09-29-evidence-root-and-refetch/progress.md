# ccloop 证据根目录 ＋ Web 面板无限重读 一轮台账（会话 `2f65a729`，2026-09-29）

> 本文件只追加。更正另起一节，原文逐字保留（Rule 13）。
> 来源：`docs/handoff/handoff.md` §4.0「还挂着的」前两条；计划 C（`docs/superpowers/plans/2026-09-29-ccloop-git-dependency.md`）更正节第 7 条。

## §1 人的授权（原话）

- 对开工计划（只做 `findCcloopRoot`）：「可以，Web 面板的 bug 也排进这一轮，做完第一项接着做」。
- 未授权：push、付费调用、删数据、杀进程、改既有判据。本轮也没有做其中任何一件。

## §2 开工核对（会话 `2f65a729`，开工时 HEAD 主题行 `docs(handoff): roll the entry point onto what is left after labels, progress, …`）

- `/usr/bin/git ls-remote origin refs/heads/main` 与本地 `main` 在三个仓库都一致（Orca、ccloop、ccmem），三棵工作树都干净。
  ⇒ ccloop 的打包提交已在 GitHub 上，计划 C Task 5（人那一步）的前置条件已满足。

## §3 第一项：`findCcloopRoot` 静默错证据

提交主题行：`fix(scheduler): stop recording the installing repository's HEAD as ccloop's evidence`。

- 缺陷：`src/scheduler/ledgerWiring.ts` 的 `findCcloopRoot` 从 bin 往上找第一个同时有 `package.json` 与 `.git` 的目录。
  bin 在 `<repo>/node_modules/ccloop/dist/cli.js` 时，装好的包没有 `.git`，于是落到 `<repo>`，`ccloopEvidence` 记下 `<repo>` 的 HEAD。
- 修法：还要求 `package.json` 的 `name === "ccloop"`；找不到沿用既有具名抛错。
- 只加判据：`tests/scheduler/ledgerWiring.test.ts`「refuses a ccloop installed under another repository's node_modules …」。
  先红实测：`promise resolved "[ 'ccloop 0.1.0 @ ff40102f…' ]" instead of rejecting`（外层夹具仓库的 HEAD）。
- 已发布注释只追加具名 ERRATUM：`ledgerWiring.ts`（`findCcloopRoot` 与 `ccloopEvidence` 两处）、`run.ts`（`ccloopEvidence` 调用处）、`tests/scheduler/sandbox.ts`（`resolveCcloopBin` 注释）、`tests/scheduler/ledgerWiring.test.ts`（「records ccloop's HEAD …」注释）。
  `sandbox.ts` 的报错**字符串**是运行时文案、不是注释，就地改了（去掉「never an npm dependency」）；全树无判据断言它（`grep` 核过）。
- 变异（`git clone --local` 副本，`cat` 同步、`cmp` 证同；`RUN` 行指向副本；还原后 5/5 绿）：
  | 变异 | 结果 |
  |---|---|
  | M1 去掉 name 检查（改回 `package.json` 存在即可） | 新判据红 |
  | M2 比较成 `"not-ccloop"` | 两条正向判据红（「records ccloop's HEAD …」「ccloopEvidence resolves the same HEAD …」） |
  | M3 抛错改成 `return dir` | 新判据红 |
- Ruling: 装好的包拿不到 HEAD 时**抛错**，不去读 Orca lockfile 的 `resolved`（`git+https://…#sha`）来给出正确证据。
  为什么：计划 C 更正节第 7 条指定此修法；只有 `orca run` 的计划文件显式写 node_modules 路径才触发，`orca run` 不走默认解析；读 lockfile 是新功能（Rule 2）。
  错了的代价：有人真要 `orca run` 用 node_modules 里的 ccloop 时会被具名错误挡住，需要另开一项做 lockfile 读取。可逆。

## §4 第二项：Web 面板对打开的组无限重读

提交主题行：`fix(web): read a voided group once, and lift the refetch mark on the next whole summary`。

- 根因：`web/src/controlState.ts` 的 `refetchRequired` 由 purge（epoch 变／`resetRequired`）、缺口、revision-conflict 置真，**没有任何路径复位**（`base.refetchRequired || gap`）。
  `web/src/App.tsx` 开组 effect 在「已缓存但标记在」时也读，读回的 body 换掉 `control.canonical` ⇒ effect 再跑 ⇒ 再读。
  次生症状：「projection refetch required」横幅永远亮；轮询永远不带 `sinceChangeSeq`。
- 修法：
  1. effect 只在组**未缓存**时读。三种置真原因都已清掉它们作废的那条缓存（purge、缺口清全部，冲突删那一组），「未缓存」就是完整的触发条件。
  2. reducer：一份**完整**摘要、且它自己既不 purge 也不缺口时复位；部分摘要只列动过的组，保持原值。
- 自我反驳（为什么复位不会提前放行命令）：`refetchRequired` 的读者只有 `Shell` 告警、`ControlPanel` 横幅、轮询的 `since`（`grep` 核过 `web/src`），不挡任何命令。
- 只加判据：
  - `web/tests/controlState.test.ts`「lifts the refetch mark on the next complete summary, but not on a partial one」；
  - 新文件 `web/tests/controlRefetch.test.tsx` 两条：「reads the open group once after the cache was voided …」（500 ms 内、下一次 2 s 轮询之前，组 GET 恰 1 次）、「stops saying a refetch is required once a complete summary shows the projection whole」。
  - 先红实测：组 GET **399 次**（期望 1）；横幅 `<p role="alert">` 不消失；reducer 判据 `expected true to be false`。
- 变异（新 `clone --local` 副本，`RUN` 行指向副本 `…/mut2/o/web`；四个文件与主树 `cmp` 同；还原后 14/14 绿）：
  | 变异 | 结果 |
  |---|---|
  | W1 effect 改回旧条件与依赖 | 「reads the open group once …」红（`expected 363 to be 1`），其余绿 |
  | W2 reducer 改回 `base.refetchRequired \|\| gap` | reducer 判据红＋横幅判据红 |
  | W3 reducer 去掉部分摘要那一支（`purge \|\| gap`） | reducer 判据红（部分摘要那句，`expected false to be true`） |
- 主树 `web` 的 `npm run check`：tsc RC 0；33 文件／167 条全过（上一基线 32／164；＋1 文件＋3 条）。
- 已知残留（只登记）：缺口之后，一个在缺口之前发出、之后才到的组读取，`reduceGroup` 会收下（只和已缓存的 changeSeq 比）。修前它会被无限重读「顺带」覆盖掉，修后要等这个组下一次变化。没有测它，也没有修。

## §5 收尾门（会话 `2f65a729`，2026-09-29；脚本与原始输出在会话 scratchpad `gate.sh`、`gate/`）

- 环境：全新 `git clone --local`（Orca 内容＝主题行 `fix(web): read a voided group once, …`；ccloop 内容＝主题行 `docs(handoff): the Orca line's twenty-first version: …`，只 build 给 `ORCA_CCLOOP_BIN`，本轮 ccloop 零改动、没跑它的门）；HOME＋四个 XDG 根改道；TMPDIR 短真目录（`mktemp -d /private/tmp/cl-XXXX`）；夹具表 fake codex `integration`（0600 文件在 0700 目录）；json reporter。
- Orca：web build RC 0；typecheck RC 0；全量 **2153 条、2146 过、4 红、3 pending**（`ccloopDefaultE2E` 开关未开）；web check 33 文件／167 条 RC 0；`verify:panel` 15 PASS；真 `~/.orca` 前后 `stat` 相同（`1790516258 128`）。`verify:control` 没跑（它跑的就是 `tests/control`，全量已含）。
- 4 红：
  - `driverLanding` D「leaves the branch alone when it moved …」—— 5 s 超时（④ 轮已登记的负载型 flake）；
  - `driverProgress`「R2: books exactly the usage of a collect without progress, and nothing twice」—— 5 s 超时，🔴 **名单外，本轮新登记**；
  - `driverRecovery`「drives a retried run on …」—— 5 s 超时（已登记）；
  - `controlShutdown`「makes it exit cleanly …」—— `expected 143 to be +0`（已登记，同一特征）。
  - 全量期间 `uptime` 5 分钟负载到 10.62。四个文件在同一 clone 各单独重跑 3 次，**12/12 绿**（`gate/rerun/`，跑时 1 分钟负载约 5.3–5.5）。四个文件都不在本轮改动面里。
- 🔴 `check-tmp-leak` RC 1：`vitest exit 1, 2153 tests, 1 entries left`，剩 `orca-tmp-9aEkR9/orca-test-control-9kPzfs`（空目录）—— 与上一轮（会话 `2724716d`）同形，那一轮也是在有 flake 红的一轮里剩 1 个。登记，未修。
