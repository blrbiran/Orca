# agent 选择一轮：控制器替人做的决定 —— 审阅清单

- 抽取人：控制器会话 `43e3e1d8`（Claude Opus 5.5），2026-09-27
- 观测锚点：Orca 主题行 `docs(handoff): I-2 landed as (a), the fixture audit and its follow-up are done; …` 那一笔
- 来源：`.superpowers/sdd/2026-09-26-agent-selection/progress.md`（所有含 `Ruling` 的行，python 逐行抽）＋ spec `docs/superpowers/specs/2026-09-26-agent-selection-design.md` §12、§13.1–13.8
- 计数更正：handoff 写「约 55 条」「B1 16／B2 8／B3 12／B4 4」—— 四组之和是 40，不是 55；该分组只存在于上一会话的对话里，没落盘。
  台账实测：`Ruling:` 出现 23 次、含 `Ruling` 的行 30 余行，很多行一行打包多条（如「W6-1…20 全部采纳」）。
  本清单按「一个可独立推翻的决定 ＝ 一项」重拆，共 **R1–R30**；已由人亲口裁过的（I-2、MC1、§13.8 三件）不列。

建议栏：**维持**＝我建议照现状；**改**＝我建议推翻或补做；**知悉**＝没有可选项，只需人知道。

---

## A 组：有实质后果，请逐条表态（按重要性排）

| # | 决定 | 出处 | 错了的代价 | 建议 |
|---|---|---|---|---|
| R1 | **安装记录里 `version` 以外的字段**（`command`、`configDir`、`timeoutMs`、`killGraceMs`）仍全部进 `configHash`；改了之后已开跑的组永久无出路 | spec §13.6「仍然成立的限制」、§13.5 | 🔴 **与人在 I-2 的意图（允许 agent 升级）相冲**：本机 claude 装在 `~/.nvm/versions/node/v22.13.1/…`，路径里带 node 版本号；换 node 版本或从 nvm 迁到 homebrew（本机两处都装了）都会改 `command` ⇒ 在飞组卡死。与 version 那次同形 | **改（要人定方向）**：(a′) `command` 也移出 hash，身份只由 kind＋选择＋漂移检查管；或 (b′) 维持，但付费轮前登记「不要在有组在飞时动安装路径」。我倾向 (a′)，理由同人裁 (a) |
| R2 | **D7 无迁移**：T11 之前确认的组、v1 profile 文件、带 `configHash` 的 plan 文件、缺 `estimatorSlot` 的估算记录一律拒／`recovery-blocked` | 台账 [103][106]、spec §13.1 D7 | 项目未上线 ⇒ 今天零代价；**上线后这个先例若被照抄，就是数据被拒** | **维持**，但加一句限定：「只在未上线前成立，上线后的 schema 变更必须带迁移或显式人裁」 |
| R3 | **D11**：探不到版本（`probeVersion`＝null）⇒ 非具名失败。accept 路径＝unknown 可重试；**派活闸门路径＝组级 `claim-capability-unavailable` 阻塞，直到人 recovery-retry** | 台账 [97]、§13.1 D11、§13.5 更正 | fail closed，不会跑错；但「recovery-retry 能清掉阻塞并重探」**从没实测过**，而 I-2 的升级出路正依赖这一步 | **维持**；**付费轮前补一次 fake 下的实测**（升级 → 改表 → recovery-retry → 续跑），否则升级出路是纸面的 |
| R4 | **claude 默认 model 用 `claude-opus-5-5`**（人给的例子 `opus-5.5` 不是 CLI 认的写法） | 台账 [18] | 付费轮默认会用它；拼写错 ⇒ 第一次调用失败，不花钱 | **维持**（与本会话自身的模型 ID 表一致） |
| R5 | **codex 默认 model 用 `gpt-6-sol`**（codex 二进制里只见 `gpt-6-astra`／`gpt-6-pro`，但人本机 `~/.codex/config.toml` 写的是 `gpt-6-sol`，codex 原样传服务端） | 台账 [19] | 若服务端不认 ⇒ 首调失败；codex 额度已用完，短期不会跑到 | **维持**，等 codex 能跑时第一次调用就验证 |
| R6 | **D4 ＋ m-5**：上下文阈值仍按 profile 声明的窗口判，不按冻结选择的 `contextWindow`；claude model 以 `[1m]` 结尾可绕过上下文档位 | §13.1 D4、§13.5 m-5 | 选了 1M 的组可能被按小窗口挡住，或反过来绕过挡位；**`[1m]` 是否真给 1M 只有付费轮能看见** | **维持到付费轮**；付费轮要不要带 `[1m]` 请人定（我建议首轮**不带**，先跑通 200K 形态，n＝1） |
| R7 | **D2**：面板对组层／任务层是**整层替换**，不与 plan 值逐字段合并（spec 正文写的是逐字段） | 台账 [41] M4、§13.1 D2 | 人在面板只改 model，plan 里同层写的 effort 等字段会一起被丢掉，且界面上不一定看得出 | **要人定**：这是产品语义。我倾向维持（语义简单、可预测），但面板要显示「整层覆盖」 |
| R8 | **D1**：导入时 estimator 只解析操作者两层；plan 文件不加 `estimatorAgent`；组级 estimator 只来自面板 | 台账 [42]（标注「偏离 spec，报人」）、§13.1 D1 | 估算 run 今天无执行方（⑤）⇒ 零代价；⑤ 落地时要回来补 plan 层 | **维持**，⑤ 开工时重开 |
| R9 | **两套退出码约定**：`ccloop control` 具名拒绝退 2；`ccloop run --agents` 拒绝退 1（2＝跑完未成功）。Orca 解冲突路径自己解释 | 台账 [73]、§13.2 | 跨仓词表不一致的第六次；以后每个新调用方都要记住两套 | **维持（不在本轮改）**，登记为 ccloop 侧的统一候选 |
| R10 | **Orca 从 codex `run --agents` 的 stderr 里取「首个非 budget 提示行」当原因** | 台账 [96]、§13.2 | 解析给人看的文本：ccloop 改一句提示文案，Orca 的原因就错位（只影响诊断文字，不影响阻塞判定） | **维持**，登记脆弱点 |

## B 组：属实现细节，建议整组维持（可以一句话批量表态）

| # | 决定 | 出处 |
|---|---|---|
| R11 | D3：闸门探测组内对冻结选择去重，任一降级 ⇒ 整组阻塞 | §13.1 D3 |
| R12 | D5：预览／确认两种模式；预览把瞬时失败记为逐槽 `unavailable`、不可确认 | 台账 [121] |
| R13 | D6：`selectionsHash` 不含来源层；偏好变了、选择不变时旧预览仍能确认（登记其时间窗） | §13.1 D6、§13.5 |
| R14 | D8 `orca agents show` 不读控制 store；D9 面板仍要两个 env 都给 | 台账 [44]、§13.1 |
| R15 | D10＋§13.4：端口与装配层都只核表路径形状，存在性交 ccloop（终审 I-1 已修并有判据） | 台账 [95][453] |
| R16 | 新码／新阻塞码：`reconcile-refused:<code>`、`reconcile-agent-unfrozen`、`agent-selection-file-invalid`、`agent-config-invalid`、`agents-command-invalid` | 台账 [88][122]、§13.2 |
| R17 | 面板 `unavailable` 槽去掉自动轮询，改手动 Re-read ＋ 请求序号守卫；`agent-selection-rejected` 后预览作废 | 台账 [130][136] |
| R18 | `probeVersion` 取 stdout 第一个 `x.y.z(-tag)?`，无则 null（本会话实测真 claude 答 `2.1.283 (Claude Code)`，能取到） | 台账 [35] W6-14 |
| R19 | W1／W2／W3／W4／W5／W6 计划写作阶段的接口裁定（schema 挪 `protocol.ts` 防循环 import、`AgentError` 码在前、`draftInstallationExtras`、「他人可写」＝`mode & 0o002`、detect 两个系统目录不改道等） | 台账 [34][35][37][39][41][44] |
| R20 | W6-8：`set-agent-preferences` payload 只有 `{preferences}`，`expectedRevision` 以信封为准 | 台账 [35] |

## C 组：过程裁定（已发生，无可逆操作，知悉即可）

| # | 决定 | 出处 |
|---|---|---|
| R21 | 人授权前曾「旧形态并列保留」，授权后撤回，回到 spec §4.5「直接换掉」 | 台账 [12] |
| R22 | spec 复审全部接受、不派二次复审；计划复审全部接受、以 §0.2 P1–P23 落实，不重出计划 | 台账 [26][27][50][57] |
| R23 | 波 1 两条 Important 并入 T5；波 3 修复并入 T14；波 5 任务复审与波复审合并为一席 | 台账 [71][124][155] |
| R24 | 变异台账以各报告 `MUTATION:` 行为准，T17 汇总；两仓变异电池并行跑 | 台账 [65][443] |
| R25 | 波 1 I-1（runner 把 `CCLOOP_CLAUDE_*` 泄漏给 claude 子进程）「必须在付费轮前落地」—— **本会话现核已落地**：`ccloop/scripts/claude-phase-runner.mjs:406` 剥掉两个变量再 spawn | 台账 [71] |

## D 组：登记不修 / 交人处理的挂账

| # | 决定 | 出处 | 建议 |
|---|---|---|---|
| R26 | 45 条 REWRITTEN 中 28 条助手／夹具级＋3 条复合条目无机械「仍在且通过」检查；§13.8 追验覆盖了其中 9 条＋SIGKILL 两行 | 台账 [425]、§13.8 | **知悉**；剩余条目是否再派审计归人（我倾向不派：审计 44 变异只查出 1 条放宽，且已人裁接受） |
| R27 | 旧 `ControlService` claim／continue 路径（K1／K3／K4、m-1 条件泄漏 L2／L4）生产不可达、无判据 | 台账 [158]、§13.3、§13.8 | **维持**；将来接回生产前补判据 |
| R28 | `versionOf`（Orca T7）用 `execFileSync` 无超时；派活不与确认快照比对；handoff 宽限在冻结值无效时退回 0；零写入守卫只看 mtime、不查真 HOME | §13.3、§13.5 | **维持**；`versionOf` 无超时在真 CLI 下的风险本会话实测为低（`--version` 26 ms），但一旦 CLI 首启卡在交互／网络就会挂住面板 —— 付费轮观察 |
| R29 | ccloop 已知红名单**不加**那条负载超时（`records claudeChildExited as NOT_OBSERVABLE…`） | 台账 [470] | **要人定**：加 ⇒ `check-known-reds` 回 RC 0；不加 ⇒ 每次负载下都要人工复判 |
| R30 | `materialize.test.ts` 的 `is the canonical hash of the materialized config` 标题与 describe 注释已不精确，未改名（改名＝改写既有判据，要人指名）；孤儿进程（3 个 `ccloop-agents-version-*`、2 个 `worker.js`，本会话 `pgrep` 现测仍在）不杀 | 台账 [441][472] | **要人定**：是否指名改名；孤儿我建议由人 `kill 22012 48757 52908 63821 96061`（本会话现测 pid） |

---

## 本会话的 3a 实测（附，供付费轮用）

- 命令：`scratchpad/probe3a/probe.py <claude> <out>`；`env -i`，仅 PATH、HOME、四个 XDG 根、TMPDIR，全部指向新建的 0700 空目录。
- 判定器自检：写 `$HOME` 的假二进制 ⇒ 报 added；静默的 ⇒ 空；写「真 HOME」（改道到临时目录）的 ⇒ 报 real hit。三向都对。
- 真 claude（`~/.nvm/versions/node/v22.13.1/bin/claude` → `…/claude-code/bin/claude.exe`）：stdout `2.1.283 (Claude Code)`，RC 0，26 ms；sandbox added／removed／changed 全空；真 HOME 下 `.claude`、`.claude.json`、`.config`、`.cache`、`.local` 在窗口内零改动。前后 `package.json` 版本 2.1.283、mtime 不变。
- ⇒ **§13.5 m-8 的前置条件已量：`--version` 不写配置目录。** 仍未量的是 `-p`（§11 已登记「会往配置目录写会话」）。
- 注意：本机有第二个 claude（`/opt/homebrew/bin/claude` → `…/claude-code/cli.js`），未运行、未读版本。
