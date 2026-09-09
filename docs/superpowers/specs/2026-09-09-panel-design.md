# 子系统 E 的第三刀：Web 面板（E3）

> **归属**：run `orca-dev-ad1e30c6`，2026-09-09 写下，观测锚点 **`5b18a07`**
> （主题行 `docs(spec): rewrite E2 after a review seat took the decomposition apart`）。
> **前置**：`docs/superpowers/specs/2026-09-08-metrics-core-and-query-design.md`（E2）。
> ⚠️ **E2 尚未实施** —— 人 2026-09-09 明确选了「先出 spec 再实施」这条路，风险已当面说明。
> **若 E2 的实施推翻了本文的前提，按规矩给本文追加具名 ERRATUM，不就地改。**
> ⚠️ **本文不写任何 HEAD、不写发布状态。**

---

## 0. 本文定什么、不定什么

**定**：`orca panel` 的仓库结构、伺服方式、安全边界、API 形状、reviews 表、判据与变异，
以及一条可执行的成功判据。

**不定**：
- **不建 DB** —— 那是 E4，且它**由一条实测阈值触发**（E2 §9.1），不由日程触发。
- *** **不做认证系统** *** —— 本刀只把「允许」与「是谁」的**形状**拆开（§3.1），未解决的逐条登记（§3.3）。
- **不改台账 schema**、**不改 `CORRECTION_FIELDS`**、**不改 `src/corrections/store.ts`**。
- *** **不做闭环** *** —— 见 §2.1，这是 A′ §4.1 定的，不是本刀的选择。

---

## 1. 现测事实（观测于 `5b18a07`）

### 1.1 本仓库今天没有任何 server / bundler / UI 工具链
`cat package.json`：运行时依赖**只有 `zod`**；`os: ["darwin","linux"]`；
`scripts` 全是纯 node ／ tsc ／ vitest。
`ls -a | grep -iE 'vite|webpack|rollup|next|index.html'` **只命中 `vitest.config.ts`**。
`grep -rn "createServer\|listen(" src/` **零命中**；`grep -rn "express" src/` 只命中英文单词 （`could express`、`expressedClosingIntent` 之类），**没有一处是 HTTP 框架**。
`grep -n 'command === ' src/cli.ts` 给出 **5** 个子命令 ⇒ `orca metrics`（E2）是第六个，`orca panel` 是**第七个**。

### 1.2 两个参考实现的**可迁移形状是结构，不是框架**
`sourceget find openclaw hermes-agent` 现测给出
`/Users/biran/code/skills/agent/openclaw`、`/Users/biran/code/skills/agent/hermes-agent`（人 2026-09-09 授权访问）。

| | 前端住哪 | 栈 |
|---|---|---|
| **hermes-agent** | `web/`，**自己的** `package.json` / `tsconfig` / `vitest.config` / `check` 脚本 | React 19 ＋ Vite 8 ＋ Tailwind 4 ＋ react-router 8 |
| **openclaw** | `ui/`，同样自己一套 | Lit ＋ Vite |

⇒ *** **两者共同的那条：前端是一个独立工作区，几十个传递依赖关在里面，不进根 `package.json`。** ***
**本刀抄这条结构。框架用 React（人 2026-09-09 裁）。**

**伺服方式**（现测 `hermes-agent/web/vite.config.ts` 与 `web/README.md`）：
dev 由 Vite dev server 起、`/api` proxy 到后端；生产由后端伺服构建产物，
并**往 `index.html` 注入一次性 session token**。**本刀抄这条。**

### 1.3 `by` 是承重的，不是装饰
`cat src/corrections/fields.ts`：`by` 在 `CORRECTION_FIELDS` 里，
⇒ 它**同时进 correction id 与 fix run id 的派生**，且该文件的注释专门论证过为什么必须只有一处定义。
A′ §4.3：一条 correction 的价值在于它是**人的**对照样本（子系统 B 要吃的东西）。
⇒ 支配 §3.1。

### 1.4 A′ §4.1 已经禁掉了面板闭环
现测原文：「面板若直接写进仓库，就要求一个 Web 应用对**所有**仓库持有提交权。**安全上不给。**」
表中 `corrections` 的作者是「人（面板）」，真相源是 DB；`.decisions/` 的作者是 agent，真相源是 git。

---

## 2. 结构与伺服

| | 裁法 | 依据 |
|---|---|---|
| **前端** | 独立 `web/` 工作区，自己的 `package.json` / `tsconfig` / `vitest.config` | §1.2 |
| **后端** | *** **`node:http`，不引 express** *** | 只出几个 JSON 端点 ＋ 伺服静态文件。Rule 2，且根依赖不变 |
| **子命令** | `orca panel`（第七个） | 与既有 CLI 形状一致 |
| **dev** | Vite dev server ＋ `/api` proxy | §1.2 |
| **生产** | `orca panel` 伺服 `web/dist` ＋ 注入一次性 token | §1.2 |
| **`verify`** | 根 `verify` 多**一条委派档**（`npm --prefix web run check`） | *** **不把前端依赖拉进根** *** —— 根的 verify 现测是纯 node ＋ tsc ＋ vitest |

⚠️ *** **必须承认的代价**：本刀是本仓库第一次有【构建产物】。 *** `package.json` 现测 `os: ["darwin","linux"]`、
根依赖只有 zod。加 `web/` 之后，「在一台只有 node 的机器上 `npm ci && npm run verify`」这件事**会变**。
**不掩饰，见 §7 边界声明。**

### 2.1 🔴 面板**只能记，不能闭环**

依据 A′ §4.1（§1.4 现测原文）。落到形状上：

| | |
|---|---|
| 面板可以做 | `orca correct` 的**只记模式** —— 写一行 correction 到全局 store |
| 面板**不可以**做 | 取任何目标仓库的 repo 锁、往 `.decisions/` 写 `overturned` / 新 `decision`、在任何仓库里 `git commit` |
| 闭环仍归谁 | **CLI（`orca correct --close`）与 fix agent** |

⚠️ *** **这一条要写死在 spec 里，否则实现会顺手把闭环也搬上去** *** —— 它在代码上只差一次函数调用，
而在安全模型上差一整个「Web 应用对所有仓库的提交权」。判据见 §5 变异 5。

---

## 3. 安全边界

**人 2026-09-09 裁**：默认只绑 `127.0.0.1` ＋ 一次性 token；**带参数允许绑外部地址；最终目标是外部可访问。**

| | |
|---|---|
| **默认** | 绑 `127.0.0.1`。token 启动时生成、注入 `index.html`，无登录流程 |
| **外部** | `--bind <addr>` 显式开启 |

### 3.1 🔴 「允许」与「是谁」必须是两件事

一个共享 token 认证得出「**这个请求被允许**」，认证不出「**这是谁**」。
而 `by` 是承重的（§1.3）⇒ *** **一个只有共享 token 的面板，记下的每条 correction 的 `by` 都是同一个值** ***
—— 单人回环下无害，**外部可访问下是假话**，而假话会污染 ccmem 的对照样本（A′ §4.3）。

**裁法**：

| | |
|---|---|
| token 管**授权**；viewer identity 管**是谁**，**两者分开实现、分开存储** | 将来接真认证时**只换后者，不动写入路径** |
| 今天 identity 由**启动参数**给定（回环单人场景） | 最小可用，不建认证系统 |
| 🔴 **绑非回环地址时，identity 必须显式给出，否则【启动就拒】** | 不许让一个多人可达的面板用一个写死的 `by` 往台账体系里灌行 |

### 3.2 绑定守卫的判据形状（**别写成一条永远绿的**）

⚠️ 守卫判据的已知坏法（本仓库实测，E2 §5.2 与 `storeLock` 那一轮都踩过）：
*** **只断言「它拒绝了」，在守卫被删掉时可能照绿。** ***
⇒ 本条必须断言 *** **服务器根本没有在监听**（连过去应当 `ECONNREFUSED`）***，不只是断言有个错误抛出来。

### 3.3 未解决的，逐条登记（Rule 12，不掩饰）

1. **无 TLS** —— 外部模式下 token 与全部台账内容明文过网。
2. **token 在 `index.html` 里** —— 任何能读到那份 HTML 的东西就拿到了它。
3. **无吊销、无过期** —— 换 token 只能重启。
4. **无多用户** —— identity 是启动参数，一个进程一个身份。
⇒ *** **外部模式今天只适合「你自己跨机器用」，不适合多人。这一句要出现在 `--bind` 的帮助文本里。** ***

---

## 4. API 与 reviews 表

### 4.1 🔴 服务端是指标口径的**唯一**持有者

*** **前端一个指标都不算。** *** 所有数字来自 E2 的 `compute.ts`，经端点原样吐出。
⇒ 前端若自己算，两处口径**必然漂移** —— 而这正是 E2 §5 把 `compute.ts` 定为纯函数的全部理由。
判据形状见 §5 变异 4。

### 4.2 🔴 `expanded` 由**服务端**判定，不由前端报告

审阅覆盖率的 `expanded` 要量的是「人看过这条决策」。
若它是前端的一次折叠点击，那么**一次误触、一次批量展开、一次自动滚动都算**
—— 而 A′ §4.4 说这个数是用来**校正纠正率的自欺**的，
*** **一个更容易被噪声灌大的覆盖率，恰好会把它本来要防的那种自欺喂回去。** ***

**裁法：端点切分。**

| 端点 | 返回什么 | 副作用 |
|---|---|---|
| **列表** | *** **只返回列表上显示得下的字段** ***（`id` / `kind` / `scope` / `at` / 一行摘要） | *** **不记任何 review** *** |
| **详情** | `question` / `alternatives` / `because` / `undo` | *** **服务端在伺服这个响应时记一条 `expanded`** *** |

⇒ 信号变成「**那条决策的推理字节真的到达过浏览器**」—— 前端伪造不了，也不是一次点击。
⚠️ *** **「把详情字段塞进列表端点做批量预取」是这条设计最自然的性能优化，也正是它的死法。** ***
判据必须钉住它（§5 变异 3）。

`handled` 由**真实写入**产生：记了一条 correction，或显式点「同意」（后者同样是一次服务端写入）。

### 4.3 reviews 表

住 `~/.orca/reviews.jsonl`。**沿用 corrections 的全部 Rule 17 纪律**：
目录 `0700` ／ 文件 `0600` **显式给定、不从 umask 继承**；**已存在文件的 mode 不改**；
路径经 `correctionsDir(env)` 解析，*** **判据一律走 `ORCA_CORRECTIONS_DIR` 改道** ***。
**自己一把锁**，不共用 corrections 那把 —— 理由见 E2 §12：共用会让一次 review 写入被
`corrections-store-busy` 拒掉，**那是一条说谎的消息**。

| 字段 | 说明 |
|---|---|
| `decisionId` | 看的是哪一条 |
| `projectKey` | 哪个项目（与 corrections 同一个键 —— A′ §4.3，跨项目聚合不需要新键） |
| `action` | `expanded` ｜ `handled` |
| `by` / `at` | viewer identity（§3.1）／挂钟 ISO 8601 |

#### 4.3.1 🔴 `expanded` 在请求路径上写盘 —— 去重是为了盘和锁，不是为了正确性

人翻 100 条决策就是 100 次取锁 ＋ 100 行；反复看同一条还会重复写。

**裁法**：进程内维护一个已写集合（启动时读一次），`(decisionId, by, action)` 命中就**跳过**。

⚠️ **覆盖率算的是 distinct `decisionId`**（E2 §3.5 把覆盖率留给了本刀）
⇒ *** **重复行本来就不影响指标 —— 去重买的是盘和锁，不是正确性。这一句要写进注释，
否则将来有人会以为删掉去重会改数字，然后为它写一条永远绿的判据。** ***

⚠️ **多进程下仍会重复写，有意接受**：为它加跨进程协调，代价远大于几行重复。**登记在 §7。**

---

## 5. 判据与变异（**只列会骗过天真写法的那几条 ＋ 每个新分支各一条删掉它自己的变异**）

| # | 分支 | 变异 | 加固形状 |
|---|---|---|---|
| 1 | 绑非回环而未给 identity ⇒ 启动拒（§3.1） | 删掉守卫 | ⚠️ *** **只断言「拒绝了」会照绿** ⇒ 必须断言服务器**没在监听**（`ECONNREFUSED`）*** |
| 2 | 默认绑 `127.0.0.1`（§3） | 改成 `0.0.0.0` | 断言 `server.address().address === "127.0.0.1"` 的**字面值**，不断言常量（上一刀实测：断言 == 被测代码的常量，改常量照绿） |
| 3 | 详情记 `expanded`、列表不记（§4.2） | 把详情字段塞进列表端点 | *** **列出 N 条决策后，reviews 里 `expanded` 必须是 0** *** |
| 4 | 前端**一个指标都不算**（§4.1） | 前端自己算某个率 | 🔴 *** **mock 的 API 响应里放一个【故意算错】的率，断言页面原样显示它** *** —— 前端若自己算就显示不出那个错数 |
| 5 | 面板**不能闭环**（§2.1） | 加一个闭环入口 | ⚠️「不做某事」，删不掉 ⇒ **正向观测**：记一条 correction 后，目标仓库 `git status --porcelain` **为 0 字节**且 `.decisions/` 无新文件 |
| 6 | reviews 自己一把锁（§4.3） | 共用 corrections 那把 | ⚠️「不做某事」⇒ **负向对照**：corrections 锁被持有时，详情请求**必须仍然成功** |
| 7 | 去重集合（§4.3.1） | 删掉 | 同一条决策看两次 ⇒ 钉 reviews **行数的字面值**（1，不是 2） |
| 8 | token 校验 | 跳过校验 | 无 token 的请求必须 401 |
| 9 | 目录／文件 mode（§4.3） | 改成 `0o755` / `0o644` | ⚠️ **断言字面值 `0o700` / `0o600`**，不断言常量；**且判据要 pin 住 umask 并还原**（照抄 `storeLock.test.ts` 现有形状） |

⚠️ **第 5、6 两条钉的是「什么都没发生」** ⇒ *** **各配一条正向观测，否则它们是空的。** ***

⚠️ **变异纪律**：只在 `git clone --local` 副本里做，主工作树零触碰；副本只克隆已提交状态
⇒ 变异未提交的改动必须先 `cat` 进副本并 `diff` 证明逐字节相同；副本**没有 `node_modules`**
⇒ `ln -s <主仓库>/node_modules <副本>/node_modules` 再走 `./node_modules/.bin/vitest`。
🔴 **`web/` 有自己的 `node_modules`，同样要 symlink** —— 否则前端那一档的「红」是启动错误，不是判据变红。

---

## 6. 成功判据（Rule 4：**一条能跑出 0／非 0 的命令**）

```
ORCA_CORRECTIONS_DIR 改道到一次性目录；造一个带 origin remote 的一次性目标仓库，
里面有已知条数的 decision（含至少一条高位）。

  orca panel --port 0            # 绑回环，打印实际端口与 token
  带 token 拉列表                 → 断言 reviews 里 expanded == 0
  拉一条决策的详情                 → 断言 expanded 恰好 1 行，decisionId 对得上
  再拉同一条详情                   → 断言 reviews 仍然只有 1 行（§4.3.1 去重）
  记一条 correction               → 断言 corrections 落一行、reviews 落一条 handled
                                  → 且目标仓库 git status --porcelain 为 0 字节、.decisions/ 无新文件（§2.1）
  无 token 再拉一次                → 断言 401
  另起一个 orca panel --bind 0.0.0.0 且不给 identity
                                  → 断言它【没在监听】（ECONNREFUSED），不只是断言报了错（§3.2）
关掉。收尾现测 ls ~/.orca 仍不存在。
```

⚠️ **全程 exit 0；任一条不成立即非 0。**
⚠️ *** **收尾的 `ls ~/.orca` 不是形式** *** —— 本刀是 E 这条线上**第一个在请求路径上写用户全局数据**的东西。

---

## 7. 已知边界与登记项（**本刀明确不做，不掩饰**）

1. **无 TLS ／ token 在 HTML 里 ／ 无吊销 ／ 无多用户**（§3.3）⇒ 外部模式今天只适合单人跨机器。
2. **多进程下 reviews 会有重复行**（§4.3.1）—— 有意接受，不影响任何指标。
3. *** **本仓库第一次有构建产物** ***（§2）—— 根 `verify` 多一条委派档，`npm ci` 的形状会变。
4. **不建 DB** —— E4 由 E2 §9.1 那条实测阈值触发。
5. **面板不闭环**（§2.1）—— 这是 A′ §4.1 定的，不是本刀的选择；**它同时意味着面板上看到的积压，人只能到 CLI 去消**。
6. **E2 尚未实施** —— 本文建在它的 `compute.ts` 与输出形状（E2 §6）上。若实施推翻，**给本文追加具名 ERRATUM，不就地改**。

---

## 8. 边界声明

本刀**不放松**它所读取的任何目标仓库的规则（CLAUDE.md Rule 16）。
本刀**不写任何目标仓库**、**不取任何仓库的 repo 锁**。
仓库外的写入只有 `~/.orca/reviews.jsonl` 与（经只记模式的）`~/.orca/corrections.jsonl`，
两者都经 `ORCA_CORRECTIONS_DIR` 可改道，**判据一律走改道后的临时目录**（Rule 17）。
