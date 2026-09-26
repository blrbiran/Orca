# 终审 I-1 修复报告

> 归属：终审 I-1 修复席（Orca 控制器会话 `ab5a693c` 派出），2026-09-26。
> 起点：Orca `main` `a0f58e2`（终审 `final-review.md` 的 HEAD）。
> 提交（均本地 `main`，逐文件 `git add`，未 push）：
> - `23a0199` test(panel): pin the agents table's assembly-time check to shape only (final review I-1)
> - `eab6f94` fix(panel): check the agents table path by shape only at assembly (final review I-1)
> - `0a1e138` docs(spec): append the final review's D10 correction as section 13.4
> 收尾 `main` `HEAD` = `0a1e138`；`git status --porcelain` 只剩 `.superpowers/sdd/2026-09-26-agent-selection/progress.md`（会话开始前就已改动，本席未碰）。
> 输出目录（下称 `$S`）：`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/ab5a693c-690d-47ff-9b2d-04c2449d055e/scratchpad/fix-final/`。变异副本：`$S/mut/orca-i1mut`（`git clone --local` 于 `eab6f94`）。node_modules 软链主树。HOME／XDG 四根改道到 `$S/home`。未调真 claude／codex；真 ccloop 只用于既有判据 `ccloopPortMissingTable.test.ts`（T16 build，`ORCA_CCLOOP_BIN=$S/../impl/ccloop-build/dist/cli.js`，脚本自带 fake codex）。未跑全量。

## 问题

`src/panel/controlConfig.ts` 的 `createTrustedControlConfig` 在装配时对 `agentsTablePath` 做
`checkedPath(input.agentsTablePath, "file")`，文件不在就抛 `control-trusted-config-invalid:path-missing`。
`assembleControlRuntime`（`src/panel/controlAssembly.ts`）是它唯一的调用方，跑在 `server.ts` 监听之前、没有
try 包裹 —— 表被删或被挪走重建之后重启面板，**整个面板进程装配失败**，评审／决策面板与执行端口一起没了，
在飞 run 的 inspect／collect／handoff 全部做不了。

这是波 2 I-1 修复的一个空洞：波 2 只改了 `src/control/ccloopPort.ts` 的端口构造（改成形状检查），没注意到
`controlConfig.ts` 有一道独立的、更早存在的存在性检查（原是 `adapterConfigPath` 沿用改名而来，本轮未重新
审视）。终审的探针 `finalProbe.test.ts`（`scratchpad/final/orca/tests/panel/finalProbe.test.ts`，未提交、只读）
实测复现：PROBE-A（表在）装配成功，PROBE-B（表删）rc=1，抛 `control-trusted-config-invalid:path-missing`。

## 修法

在 `src/control/ccloopPort.ts` 导出已有的 `agentsTablePath(path)` 形状检查函数（原为模块内部函数，行为不变，
只加 `export`），并在 `src/panel/controlConfig.ts` 里用它替换 `checkedPath(input.agentsTablePath, "file")`
这一行 —— 两处现在共用同一份形状判定（绝对路径；若有东西在，必须是 canonical 的普通文件、不是软链；路径上
什么都没有则放行），不再各自维护一份。`checkedPath` 返回的 `PathWitness` 在这一行原本就被丢弃（未存入闭包供
后续 `revalidatePath` 使用），确认过 `agentsTablePath` 只做校验、不需要 witness 后，改动仅两处：
- `src/control/ccloopPort.ts`：`function agentsTablePath` → `export function agentsTablePath`，注释里加一句
  说明它现在被 `controlConfig.ts` 复用。
- `src/panel/controlConfig.ts`：新增 import，`checkedPath(input.agentsTablePath, "file")` →
  `agentsTablePath(input.agentsTablePath)`。

表是否存在、内容是否合法，一律交给 ccloop 在 capabilities／accept 判（`agents-table-invalid`），装配层不再
自己判定存在性。

## 判据（TDD）

新增到既有文件，均在同一 `describe` 家族里补一段，未新建文件：

- **NEW-CRITERIA**: `tests/panel/controlConfig.test.ts` 3 —
  describe「the agents table path is checked by shape only, not by existence」：
  (1) 配了一个 configured 端口、`agentsTablePath` 指向不存在的文件 ⇒ 装配成功；
  (2) 相对路径 ⇒ 仍抛 `control-agents-table-invalid`；
  (3) 软链表（真实文件 + 指向它的软链）⇒ 仍抛 `control-agents-table-invalid`。
- **NEW-CRITERIA**: `tests/panel/controlAssemblyDriver.test.ts` 1 —
  「assembles and starts the driver when the agents table file has been deleted before assembly」：
  用既有 `fake-ccloop-control.mjs` 走 `resolveControlOptions` → 删表 → `assembleControlRuntime` 仍返回非
  null 的 runtime、`driver` 非 null。这是 finalProbe PROBE-B 的正式化版本，跑在真实装配路径（不是单独单测
  `createTrustedControlConfig`）上。

检查过既有判据：`tests/panel/controlConfig.test.ts`、`tests/panel/controlConfigPort.test.ts`、
`tests/panel/controlAssemblyDriver.test.ts`、`tests/control/ccloopPort*.test.ts`、
`tests/panel/controlStartup.test.ts`、`tests/panel/controlShutdown.test.ts`、
`tests/control/fixtures/ccloopWorld.ts` 里没有一条断言过「表被删后装配/端口构造应当失败」——波 2 I-1 时
`ccloopPort.test.ts`／`ccloopPortMissingTable.test.ts` 已经把端口层的旧行为改掉了，装配层这道检查此前完全
没有判据覆盖（终审 I-1 的原话：「判据空在哪」）。**没有需要 REWRITTEN 的既有判据**——没有一条编码了「装配时
应当因缺表而拒绝」的旧行为需要整条重写。

RED（`eab6f94` 之前，`23a0199` 落地后，主树未改代码）：
```
HOME=$S/home XDG_CONFIG_HOME=$S/home/.config XDG_DATA_HOME=$S/home/.local/share \
XDG_STATE_HOME=$S/home/.local/state XDG_CACHE_HOME=$S/home/.cache \
./node_modules/.bin/vitest run tests/panel/controlConfig.test.ts tests/panel/controlConfigPort.test.ts \
  tests/control/ccloopPort.test.ts tests/control/ccloopPortMissingTable.test.ts \
  tests/panel/controlAssemblyDriver.test.ts > $S/red.txt
```
`$S/red.txt` 读回：rc=1，`Test Files 2 failed | 2 passed | 1 skipped (5)`，`Tests 4 failed | 33 passed | 1 skipped (38)`。
四条失败精确对应新增的 4 条判据：
- `controlConfig.test.ts > ... > assembles when the agents table has nothing at it` → 抛
  `control-trusted-config-invalid:path-missing`
- `controlConfig.test.ts > ... > still refuses a relative agents table path` → 抛的是
  `control-trusted-config-invalid:path-not-absolute-canonical`，断言要的是 `control-agents-table-invalid`
- `controlConfig.test.ts > ... > still refuses a symlinked agents table` → 抛的是 `control-path-symlink`
- `controlAssemblyDriver.test.ts > ... > assembles and starts the driver when the agents table file has
  been deleted before assembly` → 抛 `control-trusted-config-invalid:path-missing`

GREEN（`eab6f94` 落地后，同一命令）：`$S/green.txt` 读回，rc=0，`Test Files 4 passed | 1 skipped (5)`，
`Tests 37 passed | 1 skipped (38)`（`ccloopPortMissingTable.test.ts` 无 `ORCA_CCLOOP_BIN` 时按设计跳过）。

补跑真 ccloop（`source .../impl/t16-env.sh`）：`$S/green-realpeer.txt` 读回，rc=0，
`Test Files 5 passed (5)`，`Tests 38 passed (38)`（`ccloopPortMissingTable.test.ts` 的真 peer 判据实际执行，
2150 ms）。

收尾（`0a1e138` 之后）再跑一遍，加上另外两个装配邻居 `controlStartup.test.ts`／`controlShutdown.test.ts`：
`$S/final-green.txt` 读回，rc=0，`Test Files 7 passed (7)`，`Tests 51 passed (51)`。

`npm run typecheck`：初次（`eab6f94` 之后）`$S/tsc.txt` rc=0；收尾（`0a1e138` 之后）`$S/tsc-final.txt` rc=0。

## 变异

- **MUTATION**: I1F-M1 —— 在 `git clone --local`（`$S/mut/orca-i1mut`，克隆自 `eab6f94`）里把
  `src/panel/controlConfig.ts` 的
  `if (input.agentsTablePath !== null) agentsTablePath(input.agentsTablePath);`
  改回
  `if (input.agentsTablePath !== null) checkedPath(input.agentsTablePath, "file");`
  （恢复被删除的存在性检查）-> 红：
  - `trusted panel control config > the agents table path is checked by shape only, not by existence >
    assembles when the agents table has nothing at it`
  - `... > still refuses a relative agents table path`（抛的码变回
    `control-trusted-config-invalid`，断言的 `control-agents-table-invalid` 不再出现在 message 里）
  - `... > still refuses a symlinked agents table`（抛的码变回 `control-path-symlink`）
  - `the execution driver in the panel's assembly (spec §2.1) > assembles and starts the driver when
    the agents table file has been deleted before assembly`

  命令：
  ```
  cd $S/mut/orca-i1mut
  HOME=$S/home XDG_CONFIG_HOME=$S/home/.config XDG_DATA_HOME=$S/home/.local/share \
  XDG_STATE_HOME=$S/home/.local/state XDG_CACHE_HOME=$S/home/.cache \
  ./node_modules/.bin/vitest run tests/panel/controlConfig.test.ts tests/panel/controlAssemblyDriver.test.ts \
    > $S/mut-red.txt
  ```
  `$S/mut-red.txt` 读回：rc=1，`Test Files 2 failed (2)`，`Tests 4 failed | 9 passed (13)`，四条失败逐字匹配
  上面列的四条判据名。

  变异只在克隆里做，主树全程未碰：主树 `git status --porcelain` 在变异前后都只有
  `.superpowers/sdd/2026-09-26-agent-selection/progress.md`（`$S/status-before-mutclone.txt` 与
  `$S/main-status-after.txt`、`$S/main-status-final.txt` 三次读回一致）；克隆的改动只在
  `$S/mut/orca-i1mut` 内，`$S/mut-diff.txt`（818 字节，`git -C $S/mut/orca-i1mut diff`）只含这一处单行替换。
  克隆用完未删，留作证据。

## 文档

按 Rule 13（本仓库多 agent 共享、发布过的 spec 一字不改，更正另起一节）在
`docs/superpowers/specs/2026-09-26-agent-selection-design.md` 末尾追加 §13.4，记录 §13.1 D10「保住
ccloop『删表不挡回收』」这句在生产装配路径上不成立，以及本次修复把这个保证真正落到了唯一的生产调用路径
（`controlAssembly.ts` → `createTrustedControlConfig`）上。§13.1–§13.3 原文一字未动。

## 关切

1. 修复只动了两个文件（`ccloopPort.ts` 导出、`controlConfig.ts` 复用），没有引入新的错误码或改变既有调用方
   看到的任何行为——`checkedPath` 在这一行的返回值本来就被丢弃，所以不存在下游需要 witness 的破坏性变更。
2. `tests/panel/controlAssemblyDriver.test.ts` 的新判据复用了文件里已有的 `fake-ccloop-control.mjs`
   fixture 和裸手写装配步骤（而不是抽出 `assembled()` 辅助函数），因为 `assembled()` 的签名
   （`assembled(configured: boolean)`）没有「装配后再删表」这个钩子；为保持改动最小，没有重构该辅助函数去
   适配这一个新用例。
3. 终审报告 I-1 建议的三步（改代码、补判据、写 §13.4）本次全部做了；I-1 之外终审报告提到的其他事项
   （I-2 CLI 升级哈希问题、m-1 至 m-8）不在本次派发范围，未处理。
4. 本席 token 数工具未给出，不报。
