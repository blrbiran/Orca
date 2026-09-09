# 外派评审报告 —— `docs/superpowers/plans/2026-09-09-metrics-core-and-query.md`（E2 实施计划）

**评审席位**：1 席（general-purpose subagent）
**评审范围**：`e3d957b..7c4004e`（两笔：A′ 的 ERRATUM 3／4／5 ＋ E2 实施计划与三条台账决策）
**派出方**：run `orca-dev-3738db1c`，2026-09-09
**评审员自陈用量**：token 与耗时**它自己拿不到**（原文如此，未自估）；工具调用它自计 32 次
**派出方工具报数**：*** **185,683 token ／ 33 次工具调用 ／ 763,287 ms** *** —— 与它的自陈不同的那一格以工具报数为准
**判定**：*** `Ready to implement? No` *** —— 7 Critical ／ 9 Important ／ 6 Minor

⚠️ **本文是评审员的原文归档，逐字保留。** 控制器的复核结论记在文末「控制器复核」一节，**不在此就地改动原文**。
⚠️ `.superpowers/sdd/.gitignore` 内容是 `*` ⇒ **本文件是 `git add -f` 进来的**。

---

## 评审员拿到的 brief 要点（控制器写的，供复现）

- 明确这是**尚未实施的计划文档**，不是代码；对象是计划 ＋ 它实现的 E2 spec ＋ A′ 新追的 ERRATUM 3／4／5
- **五问**：(1) 计划里有没有可现测为假的断言；(2) 三处替 spec 做的裁断逐条攻（依据成不成立／又买来什么／有没有第三选项）；
  (3) **攻八任务分解本身**，不要只挑细节；(4) 逐条过 spec §8 那 21 条变异在计划写出的判据代码下会不会照绿；
  (5) 判据有没有碰真实用户数据或**制造**真实攻击面
- 给了本仓库对「绿」的**六种坏法**、「排在被测调用之前、读回自己刚写的值的断言永远不可能红」、
  「恒定值字段／恒为 0 的分子 ⇒ 变异结构上不可能红」三条记法
- 给了现测基线并点明 **73/398 是全仓、51/167 是 scheduler，别混**（上一席在这栽过）
- 给了 rtk 的五种骗法与 `rm`／`cp` 的 `-i` alias
- 硬边界：只读；不许再派子 agent；变异只能在 `mktemp -d` 下的 `clone --local` 副本里做；
  *** **绝对不许跑任何会写 `~/.orca` 的命令** ***；成本只报工具数

---

## 原文

**所有行号现测于 `7c4004e`**（主题行 `docs(plan): turn E2 into eight tasks, and record the three calls the spec left open`）。

### Strengths（真成立的）

1. **`toContain("not a URL")` 这条断言真去量过**（计划 664 行）。`cat src/corrections/projectKey.ts` 现测消息逐字为 `` `${repo}'s remote is ${JSON.stringify(remote)}, which is not a URL orca can key a correction by …` `` —— 引用前现测的少数几处之一。
2. **变异 20 的正向对照结构上能红**（计划 1093-1104）。`cat src/corrections/storeLock.ts` 现测 `STORE_LOCK_TIMEOUT_MS = 1_000`，`withStoreLock` → `acquireStoreLock` 在 1s 后抛 `CorrectRejection(…, 4)`。嵌套取锁会在 ~1s 抛出，远早于判据的 5000ms 超时 ⇒ 判据是抛错红，不是超时红。这条恰好躲开了任务书点名的第 6 种坏法。
3. **变异 19 钉的是年龄的字面毫秒数**（计划 1509-1516），不是「跑出来了」。这是 `storeLock` 那次实测教训的正确迁移。
4. **`deriveFixRunId(row, correctionId)` 与 `orca-fix-<hash8>.jsonl` 现测成立**。`cat src/corrections/fields.ts` 给出 `deriveFixRunId(row: CorrectionRow, correctionId: string)`；`cat src/scheduler/runId.ts` 给出 `orca-${taskId}-${hash8}`。§3.4.2 的定点查前提是真的。
5. **`Record<DecisionKind, …>` 确实买到编译错误**。`cat tsconfig.json` 现测 `"include": ["src/**/*.ts", "tests/**/*.ts", …]` ⇒ `tsc --noEmit` 看得见，变异 15 的「红是 tsc」成立。
6. **变异 21 判据的写法本身是对的**（计划 313-330）：用哨兵 `Error` 再断言 message 不含哨兵，避开了 `rejects.toThrow()` 会把自己抛的错也算通过的坑。坏的是变异脚本，不是判据（见 C4）。

### Critical（实施前必修）

**C1. `/bin/rm -rf "$(dirname "$D")"` 在 `$D` 未赋值时展开成 `/bin/rm -rf .`**
位置：计划 1272 行（Task 4 Step 7）。Task 4 Step 6（1259-1268 行）**整段只有注释，没有任何 `D=` 赋值**。同形还有 589 行（Task 2 Step 7）、958 行（Task 3 Step 7）—— 它们的 `D=` 在**上一个 Bash 调用**里（192／546／928 行），而 shell 状态不跨调用持久。
证据（只 echo，未删任何东西）：`D=""; dirname "$D"` ⇒ `.`；在仓库根即 `/bin/rm -rf .`。**这是 CLAUDE.md「绝对禁止」清单上的那一条**，且会命中主工作树。
修法：`T="${T:?clone root unset}"; /bin/rm -rf "$T"`，且每个任务的变异步骤自带完整 setup／teardown，不跨 Bash 调用引用变量。

**C2. `rejected` 那条分支不可达；§7 golden 夹具的「含一条 rejected」与 `exit 0` 互斥**
位置：计划 1176-1181 行、1711 行、1685 行。
证据（`npx tsx` 探针）：`rejected-candidate: validateLine.verdict=rejected decisionEventSchema.safeParse.success=false`。读 `src/ledger/validateLine.ts`：`ev === "decision"` 时 rejected 的唯一来源就是 `decisionEventSchema.safeParse` 失败。而计划的 `readLedgerLeniently`（452-460 行）**已经用同一个 schema parse 过**才把 row 交出来。⇒ `verdict === "rejected"` 在 `collect` 里永远不成立 ⇒ **spec §8 第 3 条变异结构上不可能红**；且一条真 rejected 的行会先被判 `malformed` ⇒ exit 6，而 1685 行断言 0。**golden 判据在自己的夹具上就跑不出 0。**
修法：要么 `readLedgerLeniently` 对 `ev==="decision"` 只做 `ev` 识别、把 schema 判决交给 `validateLine`；要么承认「rejected 决策 ≡ 坏行」，删掉死分支并把 §7 夹具改成「一条 downgraded ＋ 一条坏行」，同时向 spec §3.4／§8 第 3 条追 ERRATUM。

**C3. spec §8 第 8、9 条变异一个落点都没有，而计划自称 21 条全有**
位置：计划 1785 行 Self-Review 表、1377-1382 行。
证据：变异 9 的 kind 桶只在 `compute.ts`（Task 6）里存在，而 Task 6 的 `OBS` 现测 `unresolvedDecisions: []`（1485 行）；Task 5 的判据只能看 `Observations`，看不到桶。变异 8 期望的是「仓库里有 archive/ 时仍能出报告」，而 Task 5 那条有 archive 的夹具其 decision **是能扫到的**（断言 `unresolvedDecisions).toEqual([])`）⇒ 改成硬拒不会有任何断言触发。Task 8 夹具也没有扫不到的 decisionId。
修法：Task 5 加一条「decisionId 指向不在任何被扫文件里的 id」的夹具，并把「不进任何 kind 桶」的断言落在输出层。

**C4. 变异 21 的脚本落不到判据观测的那条路径上 ⇒ 照绿**
位置：570-580 行脚本 ＋ 313-330 行判据。变异把 `parse` 换成 `safeParse`，但 **`JSON.parse` 仍在外面**，而夹具是 `{ not json`。
证据：`node -e 'JSON.parse("{ not json")'` ⇒ `SyntaxError`。⇒ 变异后 `readCorrections` 照样抛 ⇒ 判据照绿。sha 会不等（变异确实落上了），但落在判据看不见的那一半上。
修法：(a) 变异改成让 `readCorrections` 直接调 `readCorrectionsLeniently`；(b) 夹具换成 **JSON 合法但 schema 不合法**的一行。建议两条都做。

**C5. Task 3／4 的判据文件在 `tsc` 上直接不过（`npm run verify` 第一步就红）**
位置：判据 630／1035 行从 `collect.js` import `MetricsRejection`，而 `collect.ts` 只在 768 行 import 它、**从未 re-export**。另 1231 行返回 `lastLineLooksTorn`，而 978 行的 `Observations` 接口没有该字段 ⇒ strict 下多余属性错误。
证据：`tsconfig.json` 现测 `"strict": true` 且 include 覆盖 `tests/**/*.ts`；`verify` 第一段是 `npm run typecheck`。
⚠️ 计划 1798 行的 Self-Review 声称这组字段「逐个核过、拼写一致」—— **这条自审结论现测为假**。

**C6. 裁一（归档定点查）在计划自己的数据流下不可实施：算 `deriveFixRunId` 要的字段已被丢掉**
位置：`CorrectionObservation`（1005-1011 行）只有 `{id, projectKey, decisionId, kind, at}`；而 Task 5 实现要点第 1 条（1362-1365 行）要求用「store 里的原样字段」。
证据：`CORRECTION_FIELDS = ["projectKey","decisionId","kind","chose_instead","because","at","by"]`，`canonicalCorrectionJson` 按这七个字段哈希 ⇒ 缺 `because`／`by`／`chose_instead` 算不出同一个 `runId`。
修法：`CorrectionObservation` 保留整行 `Correction`。⚠️ Rule 17 邻接影响：`because` 是人的原话 ⇒ 同时要钉一条「`renderJson` 输出里不含 `because`／`by`」。

**C7. 输出形状 —— 这一刀存在的理由 —— 仍然没有定义；golden 依旧写不出来**
位置：1450-1463 行 `METRICS_FIELDS` 列 12 个顶层字段；1420-1443 行只写出 `CorrectionRateBucket` 一个类型，1445 行把其余交给执行者。而判据已在引用 `caveats`／`stale_only.known_bias`／`review_coverage.available`／`backlog.oldest_correction_id` —— **无一处定义**。
更硬的一条：`METRICS_FIELDS` 有 `"repos"`，而 `Observations`（978 行）根本没有 repos（`discoverRepos` 的结果在 1163 行解构后只有 `unkeyable` 被带进去）⇒ `computeMetrics(obs)` 无从产出它；靠 `decisions` 里的 `projectKey` 反推，则**一个「有仓库、零决策」的仓库会从 `repos` 里消失** —— 恰是 §2.1 建立扫描机制要抓的那类。
**这正是 spec §12.1 C2 判 No 的同一个缺陷，降一层重现。**
修法：Task 6 Step 1 把 `MetricsReport` 全部 12 个字段连同嵌套形状逐字写出来，并在 `Observations` 里加 `repos: DiscoveredRepo[]`。

### Important（实施前该修）

**I1. 变异 17 的「打乱两次」判据对唯一依赖 `readdir` 顺序的两个集合是空转**
1607-1618 行 reverse 了 `unkeyableRepos` 与 `malformed`，而 `OBS` 现测两者都是 `[]`（1485 行）—— **反转空数组是恒等操作**。而它们恰是唯一两个直接由目录遍历顺序喂出来的集合。
修法：`OBS` 塞进至少两条 `unkeyableRepos` 与两条来自不同文件的 `malformed`，乱序给；把 `repos` 也加进去乱序。

**I2. 递归扫 `archive/` 把 §3.4.2 明确拒绝的「全扫」偷偷买了回来，而判据结构上发现不了**
计划引的依据是 `tests/ledger/appendOnly.test.ts:30`。现测该行确实是 `.decisions/archive/2026/run-7c.jsonl` —— 但它是 `checkAppendOnly` 的一个**手写 diff 字符串常量**，不是任何归档器的产物。`grep -rn "archive" src/` 现测只有 `src/cli.ts:41` 一条注释 ⇒ 本仓库**没有归档实现**，`.decisions/` 下也没有 `archive/`。
真正管这件事的证据在上游 spec 里，比计划引的强：`2026-08-29-decision-ledger-design.md:317` 逐字写着「整体 `git mv` 进 `.decisions/archive/<YYYY>/`」⇒ **层数是确定的一层**。
⇒ 递归比需要的宽，且把 §3.4.2 的成本承诺换成了每仓库一次整棵归档树遍历。计划自己那条「放 200 个无关文件、断言没被**读**」的判据**结构上无法发现这个代价** —— 遍历会 `readdir` 它们但不 `readFile`，判据照绿。
修法：`readdir(archive)` 一层拿年份目录，对每个年份目录 `stat`。若坚持递归，必须同时改 §3.4.2 的成本描述并把判据改成能观测遍历规模的形状。

**I3. exit 6 挂在一个全局 `lastLineLooksTorn` 上，两个方向都会错**
1733 行的规则配 1231 行的 `lastLineLooksTorn: storeRead.lastLineLooksTorn` —— **只来自 corrections store 那一次读**。⇒ 台账的撕裂尾行标记被丢弃（应 0 实 6）；store 撕裂 ＋ 台账真中间坏行时整个 6 被抑制成 0。
修法：把 torn 记进 `MalformedLine` 自身，退出码判据改成「存在至少一条 `torn === false` 的坏行 ⇒ 6」，并各配一条判据。

**I4. 判据不复用本仓库既成的两个约定，其中一个是 Rule 17 的约定写法**
1682／1696 行用 `captureStdout(() => main([...]))` 读 `out.code`／`out.text`。现测 `tests/scheduler/sandbox.ts:300` 已有 `export async function captureStdout<T>(fn): Promise<{ result: T; stdout: string }>` —— 它是 **async**（计划没 await）且字段名是 `result`／`stdout`。另 `tests/corrections/harness.ts:25` 已有 `withCorrectionsDir`，注释头一行就是「🔴 CLAUDE.md Rule 17。**每一条**触碰 corrections store 的判据都跑在这里面」。**计划一次都没提它。**
连带 Rule 17 风险：Task 8 Step 4（1729-1735 行）没说 `runMetrics` 从哪拿 corrections 目录，也没有任何判据钉「CLI 认 `ORCA_CORRECTIONS_DIR`」。接错则 golden 判据会去读使用者真实的 `~/.orca`（本机现测不存在所以今天不暴露），在有 `~/.orca` 的机器上完整性闸门会拿真实 projectKey 硬拒 ⇒ **判据变成「在别人机器上必红」**。
修法：Task 8 判据一律包在 `withCorrectionsDir` 里；`runMetrics` 显式 `correctionsDir(process.env)`；加一条判据断言改道生效。

**I5. Task 5／6／7 的收尾把计划自己的 Global Constraints 丢了**
Global Constraints 第 9、10、13 条（33／35／42 行）要求每个任务收尾现测 `ls ~/.orca`、跑整份 verify、变异前后取 shasum。现测 Task 5 Step 7（1384-1389）、Task 6 Step 7（1582-1587）、Task 7 Step 6（1654-1659）**只有 `git add` ＋ `git commit`**；Task 5／6／7／8 的变异步骤（1371／1377／1571／1647／1745）**全都没有 clone 建立、没有 shasum 前后对比、没有清理**。而第 4 种坏法（变异根本没落上去）正是靠 shasum 挡的。
修法：把 Task 1 Step 5-7 那套 setup／shasum／teardown 提成可复制片段，八个任务逐一贴上。

**I6. Task 3 Step 6 用管道过滤 `rtk` 输出，违反计划自己的第 13 条与 Rule 14**
929 行 `for f in $(rtk proxy git status --porcelain | awk '{print $2}')`。计划第 42 行自己写着不许过滤；且 `awk '{print $2}'` 对重命名（`R old -> new`）和含空格路径会取错。
修法：`git status --porcelain -z > /tmp/p.bin` 后用 python 按 NUL 切分。

**I7. 裁二（固定月桶）的「可逆」依据站不住；有第三选项两边都没看见**
依据写的是「粒度可改且不影响接口形状」。但 E2 spec §6 开宗明义说输出「**是 E3／E4 拿走的那个接口**」，§9 又把 E3 紧接 E2 ⇒ 粒度一旦进了 golden 和面板，改它就是改一个已被消费的接口。**「不影响接口形状」为假：`bucket` 的取值域就是接口的一部分。**
第三选项：把粒度做成 `computeMetrics(obs, { bucket: "month" })` 的**纯函数参数**，默认 month，**不加 CLI flag**。YAGNI 代价为零，口径持有者不再焊死一个展示选择，且给变异 16 多一个落点。

**I8. Task 4 的 decision 夹具实测判 `downgraded`，不是 `ok`**
1046-1053 行的工厂 `undo.how = "git revert abc123"`。探针现测 `verdict=downgraded`。读 `src/ledger/undoExecutable.ts`：`abc123` 不是 arg 形状（无 `-`／`/`／`=`／`*`／`<>`／带点文件名），也无 camelCase／snake_case／路径 ⇒ 两个谓词都不命中。
⇒ 照抄这个工厂建 §7 夹具，**每一条 decision 都是 downgraded**，「含一条 downgraded、其余 ok」不成立，变异 4 的正向对照失去对照。
修法：改成 `git revert abc123 -- src/foo.ts`（含路径 ⇒ `hasNamedTarget` 命中），downgraded 那条单独用不可执行的 how 造。

**I9. 分解本身：Task 4／5 的缝切错了**
- Task 4 交付一个明知是错的 stub（1251-1253 行 `resolvedOverturned` 直接返回 `overturnedRows`），而这正是 §3.4.2 判定为「核心交付数字静默劣化」的那个形状；Task 4 的四条判据**结构上看不见它**（没有一条涉及 archive）⇒ Task 4 是「绿着交付一个已知缺陷」的任务。
- Task 5 的两条变异（8／9）落在别的任务的观测面上（见 C3）。
- Task 5 需要的数据被 Task 4 的类型丢掉了（见 C6）。
⇒ 评审员**没法单独否掉 Task 4**（否掉它等于否掉 Task 5 的输入契约），也**没法单独验收 Task 5**（它的变异要到 Task 6／8 才看得见红）。
修法（二选一）：(a) 合并 Task 4＋5；(b) **倒置**：先做「解析」这件纯事（`resolveAcrossArchive` 接注入的 `listArchive`／`readFile`，零 fs），它自带完整判据与变异 8／9／10；再做 Task 4 把 fs 接上。评审员倾向 (b)。

### Minor

- **M1**（233 行）：`rtk proxy git diff > /tmp/wt.txt` 期望「只含本任务新增的两个文件」为假 —— `git diff` 对**未跟踪的新文件恒为空**。改用 `git status --porcelain -z`。
- **M2**（1755 行）：把 `git ls-remote` 称作「本轮有没有改过已发布文本的唯一检测手段」措辞过度 —— 它只给远端 tip 的 sha；判就地改要 `git diff <远端sha>..<本地sha> -- <文件>`。
- **M3**（556-566 行）：变异 7 的锚点现测只命中 `catch` 里那一处 push，**schema 失败那一处 push 没有任何变异覆盖**。补一条同形变异。
- **M4**（1630-1633 行）：`not.toContain('_ms":')` 与保留 `oldest_age_ms` 直接互斥。计划已自认，登记。
- **M5**（187-215 行）：变异 15 要靠「加第八个 kind」组合才能红；单删 `Record<DecisionKind,…>` 约束自身不红。建议明写成两步变异，两次都看。
- **M6**（1476-1486 行）：`OBS` 用了 `d(...)`／`c(...)` 两个工厂，**全文未定义**。Self-Review 的 Placeholder 扫描（1793-1796 行）漏了这两个。

### Ready to implement? **No**

C2 与 C7 各自单独就足以否掉：**在 `MetricsReport` 的字段被逐字写出来之前，Task 8 的 golden 写不出来**（这正是 spec 外审判 No 的同一个缺陷降一层重现）；而 §7 的夹具与它自己的 `exit 0` 断言在现测下互斥。再加上 C1 是一条会在主工作树上执行 `/bin/rm -rf .` 的命令。

### 评审员自陈用量

- token 数：拿不到（本会话没有工具报出 token 计数）。
- 工具调用次数：32 次 Bash 调用（自己逐条计数，非估算）。
- 耗时：拿不到。
- 全程只读：未 `git add`／`commit`／`push`，未建分支或 worktree，未跑 vitest，未做变异，未写仓库内任何文件（只在 scratchpad 写了一个 `probe.ts` 探针）。`ls ~/.orca` 现测仍不存在（退出码 1）。

---

## 控制器复核（**2026-09-09，run `orca-dev-3738db1c`，观测于 `7c4004e`；不照单全收，也不照抄它的数字**）

**结论：承重主张逐条现测，全部成立；其中两条比它自己说的更硬。**

| | 复核结果 | 复核命令 |
|---|---|---|
| **C1** | ✅ **成立，且更严重**。`rm` 现测在 **235／589／958／1272 四处**，`D=$(mktemp` 只在 **192／546／928**，且每处 `rm` 与其 `D=` 分属**不同代码块** ⇒ shell 状态不跨调用 ⇒ *** **四处全部展开成 `/bin/rm -rf .`** ***，不是评审员说的「一处 ＋ 三处同形」 | `D=""; dirname "$D"` ⇒ `.`；python 逐行取 `/bin/rm` 与 `D=$(mktemp` 的行号 |
| **C2** | ✅ 成立 | `npx tsx` 探针 ＋ 读 `validateLine.ts` |
| **C3** | ✅ 成立 | 计划 1485 行现测 `unresolvedDecisions: []` |
| **C4** | ✅ 成立 | `node -e 'JSON.parse("{ not json")'` ⇒ `SyntaxError` |
| **C5** | ✅ 成立 | python 扫计划：`MetricsRejection` 只在 768 行 import、无 re-export；`lastLineLooksTorn` 在 1231 行返回、978 行接口无此字段 |
| **C6** | ✅ 成立 | `cat src/corrections/fields.ts`：七字段全参与 `canonicalCorrectionJson` |
| **C7** | ✅ 成立 | python 扫计划：`"repos"` 在 1453 行，`Observations`（978 行）无 repos，1159 行只解构出 `unkeyable` |
| **I2** | ✅ **成立，且它的证据比控制器原来的强**。A′ §3.7.1 第 2 条**逐字**写着 `.decisions/archive/<YYYY>/` ⇒ 层数由上游 spec 钉死为一层；`src/` 里 `archive` 现测**只有 1 次命中且是注释**（`src/cli.ts:41`）；`.decisions/` 现测**无任何子目录** | `sed -n '310,324p'` A′；python 遍历 `src/`；`ls -la .decisions` |
| **I4** | ✅ 成立 | `tests/scheduler/sandbox.ts:300` 现测 `export async function captureStdout<T>(fn): Promise<{ result: T; stdout: string }>`；`tests/corrections/harness.ts:25` 现测 `withCorrectionsDir`，注释头一行即 Rule 17 |
| **I8** | ✅ 成立，控制器**两个方向都自己验了** | 探针：`"git revert abc123"` ⇒ `executable: false / verdict: downgraded`；`"git revert abc123 -- src/foo.ts"` ⇒ `executable: true / verdict: ok` |

⚠️ **一处与评审员自陈不同**：它说 token 与耗时「拿不到」。**派出方的工具报数是 185,683 token ／ 33 次工具调用 ／ 763,287 ms** ——
*** **这一格以派出方工具报数为准；评审员看不见自己的用量是已知的，不是它的错。** ***
⇒ 与上一轮两席（139,447 ／ 155,541 token）一致，**一席仍稳定在 130k–220k token 区间**。

### 🔴 本次派席最该被继承的两条

1. *** **计划的 Self-Review 是会说谎的，而且是可现测的谎。** *** 计划 1798 行自称字段「逐个核过、拼写一致」，
   而 C5 现测出两处不一致。⇒ **自审里凡是写「核过」的句子，都是一条可被外审现测的断言，不是背景说明。**
   （这与上一轮「『照抄 X』是一条可现测的断言」是同一个形状，本轮换了个位置又犯一次。）
2. *** **本轮最危险的一条（C1）不在设计层，在【计划正文的 shell 片段】里。** ***
   自审的三项（spec 覆盖／占位扫描／类型一致）**结构上都不看 shell**，所以它一条都抓不到。
   ⇒ **新记法：计划里每一段可复制粘贴的 shell，都要按「变量未赋值时它展开成什么」过一遍**，
   尤其是 `rm`／`mv`／`>` 三种会毁数据的动作。⚠️ **shell 状态不跨 Bash 调用持久 —— 跨代码块引用变量等于引用空值。**
