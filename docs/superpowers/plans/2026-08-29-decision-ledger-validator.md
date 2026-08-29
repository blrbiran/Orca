# A′ 决策台账校验器 ＋ 自食其果 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec §3.8 的决策台账校验器，并让 Orca 用它校验 Orca 自己的 `.decisions/` 台账 —— 台账的第一批记录就是本计划自己做的那些决策。

**Architecture:** 一个 TypeScript 库 ＋ 一个 CLI。校验分三层：`validateLine`（纯函数，吃一行 JSON，做 spec §3.8 的检查 1–4）、`validateFile`（纯函数，吃行数组，加检查 5 的跨行引用）、`checkAppendOnly`（纯函数，吃 `git diff` 文本，做检查 6）。写入方 `appendEvent` 在落盘前先过校验器（fail closed）。仓库自己的 `.decisions/orca-dev-09cc3ea1.jsonl` 由本计划开张，最后一个任务把「校验它全绿」接成 `npm run verify` 与 pre-commit。

**Tech Stack:** TypeScript 5.5 · ESM / NodeNext · zod ^3.23.8 · vitest ^2.0.5 · Node ≥ 20（与 ccloop 逐项对齐，见 D1）

**Spec:** `docs/superpowers/specs/2026-08-29-decision-ledger-design.md`

## Global Constraints

- **spec 是已发布文本**（远端 `main` = `b6d2253`，2026-08-29 现测 `git ls-remote origin`）。**不许就地改 spec**，需要更正只能在文末追加具名 ERRATUM。本计划对 spec 的所有补完都记进台账，不动 spec。
- **控制器不许 push。** 合并进 `main`、删分支或 worktree，**每一次都要人单独点头**（CLAUDE.md Rule 15）。本计划全程只在 `main` 的本地提交上工作，不建分支、不合并、不推。
- **`CLAUDE.md` ≤ 200 行**（spec §2.1，人拍板的硬预算）。Task 8 把它接成机器检查。
- **每新增一个分支，必须点名一条「删掉它自己就打红」的变异，并确认看见红**（CLAUDE.md Rule 9、spec §3.8 末尾）。本计划每个任务都写死了该变异是哪一条，**不许跳过**。
- **绝不过滤验证性跑**：`grep`/`tail`/`head`/`sed` 都算过滤，管道还会吞退出码（CLAUDE.md Rule 14）。一律重定向到文件再整份读回。
- **本机 `rm`/`cp` 有 `-i` alias** ⇒ 脚本里一律用 `/bin/rm`。
- **rtk 的过滤层会骗你**：本会话实测 `rtk proxy git log --oneline -8` 漏掉了 HEAD 那一笔（`856fe8d`），裸 `git log` 能看到。**验证性 git 命令走裸 `git`，不走 rtk。**
- **Token 预算**：per-task 330,000 / per-session 450,000，**单位是上下文窗口占用**，不是累计消耗（CLAUDE.md Rule 6）。逼近就交接，不许静默超支。
- **多 agent 共享仓库**：别的 agent 的分支、worktree、文件是禁区（CLAUDE.md Rule 3、Rule 13）。本计划只碰下面 File Structure 列出的路径。

---

## File Structure

| 路径 | 职责 |
|---|---|
| `package.json` | 包定义、脚本入口（`test` / `typecheck` / `ledger` / `verify`） |
| `tsconfig.json` | 逐项照抄 ccloop（NodeNext / strict / ES2022） |
| `vitest.config.ts` | 照抄 ccloop（node 环境，`tests/**/*.test.ts`） |
| `.gitignore` | **修改**：补 `node_modules/` 与 `dist/`（现状两者都没被忽略） |
| `src/ledger/types.ts` | `kind` / `scope` 白名单常量；`ValidationResult` 三态 |
| `src/ledger/schema.ts` | `decision` 与引用类事件的 zod schema（检查 1／2／4） |
| `src/ledger/undoExecutable.ts` | `undo.how` 的「可执行形式」谓词（检查 3） |
| `src/ledger/validateLine.ts` | 单行校验：按 `ev` 分派，串起检查 1–4 |
| `src/ledger/validateFile.ts` | 整份校验：加检查 5（引用的 id 必须在本文件中存在） |
| `src/ledger/appendOnly.ts` | 检查 6：吃 `git diff` 文本，含任何删除行即拒 |
| `src/ledger/writer.ts` | `appendEvent`：run-id 路径安全 ＋ 落盘前先过校验（fail closed） |
| `src/cli.ts` | `validate` / `check-append-only` 两个子命令；退出码 0／1／2 |
| `scripts/check-claude-md-lines.mjs` | `CLAUDE.md ≤ 200 行`的机器检查（零依赖，纯 node） |
| `scripts/githooks/pre-commit` | 把检查 6 ＋ 台账全绿 ＋ 行数预算接成提交闸门 |
| `tests/ledger/*.test.ts` | 与 `src/ledger/*` 一一对应 |
| `tests/cli/cli.test.ts` | CLI 退出码（含一条真起进程量退出码的判据） |
| `.decisions/orca-dev-09cc3ea1.jsonl` | **本仓库自己的台账**，Task 1 开张 |

---

## 本计划自己做的 7 条决策（台账的第一批记录）

这 7 条都是 spec 留白或 spec 内部打架的地方，本计划替它判掉。**它们不是注释，它们是 Task 1 要逐字写进 `.decisions/orca-dev-09cc3ea1.jsonl` 的内容**，并在实现它们的那一笔提交里补 `bound` 行。

| id | kind | 判了什么 | 在哪个 Task 落地（写 `bound`） |
|---|---|---|---|
| `/1` | `dependency` | 技术栈照抄 ccloop | Task 1 |
| `/2` | `interface` | 校验器拆三层，spec 的「纯函数吃一行」覆盖不了检查 5 与 6 | Task 5 |
| `/3` | `interface` | 返回值三态（`ok`／`downgraded`／`rejected`），解 §3.8 表头与表格第 3 行的冲突 | Task 2 |
| `/4` | `criteria` | `undo.how` 谓词 = 命令形 ∪ 具名形，并把 spec 的 6 个正反例钉成判据 | Task 3 |
| `/5` | `interface` | 引用类事件只要求 `ev` ＋ `id`（照 §3.3 的例子），`when` 由 `git blame` 提供 | Task 2 |
| `/6` | `boundary` | 退出码 0／1／2，`downgraded` 也阻断提交 | Task 6 |
| `/7` | `boundary` | run-id 由调用方传入；写入方只做路径安全 ＋ 落盘前校验 | Task 7 |

**run-id = `orca-dev-09cc3ea1`**（取本会话 id 前 8 位）。依据 spec §3.0：非 ccloop 发起的 agent 自行分配一个不碰撞的 id，分配规则归 C，本文只要求全局唯一且稳定。会话 id 满足两者。

---

## Task 1: 仓库骨架 ＋ 台账开张

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.decisions/orca-dev-09cc3ea1.jsonl`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore`（在文件末尾追加两行）

**Interfaces:**
- Consumes: 无
- Produces: `npm test` 能跑；`npm run typecheck` 能跑；仓库根下存在 `.decisions/orca-dev-09cc3ea1.jsonl`，含 7 条 `decision` ＋ 1 条 `bound`

- [ ] **Step 1: 写会红的冒烟判据**

`tests/smoke.test.ts`：

```typescript
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("actually runs the assertions in this file", () => {
    // 这条判据存在的唯一理由：证明 vitest 真的在跑这个文件，
    // 而不是 include 没匹配上、0 个测试、然后打绿。
    expect(1 + 1).toBe(3);
  });
});
```

- [ ] **Step 2: 建骨架三件套，跑测试，确认看见红**

`package.json`：

```json
{
  "name": "orca",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "os": [
    "darwin",
    "linux"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "ledger": "tsx src/cli.ts"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "tsx": "^4.19.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`.gitignore` 末尾追加（**整行追加，不改动既有 20 行任何一个字**）：

```
node_modules/
dist/
```

然后：

```bash
npm install
npm test > /tmp/orca-smoke-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-smoke-red.txt
```

Expected: **FAIL**，输出含 `expected 2 to be 3`，`exit=1`。
⚠️ **这一步是本任务真正的交付物**：它证明「绿」不是空的。**没看见这条红，后面所有绿都不作数。**

- [ ] **Step 3: 把冒烟判据改成会绿的，再跑**

把 `tests/smoke.test.ts` 里的 `.toBe(3)` 改成 `.toBe(2)`。

```bash
npm test > /tmp/orca-smoke-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-smoke-green.txt
```

Expected: PASS，`exit=0`，且输出里 **`Tests  1 passed (1)`** —— 数字必须是 1，不是 0。

- [ ] **Step 4: 台账开张**

创建 `.decisions/orca-dev-09cc3ea1.jsonl`，**逐字写入以下 8 行**（每行一条 JSON，行尾无逗号，文件末尾一个换行）：

```
{"ev":"decision","id":"orca-dev-09cc3ea1/1","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"Orca 的技术栈用什么","chose":"逐项照抄 ccloop：TypeScript 5.5 + ESM + NodeNext + strict + zod ^3.23.8 + vitest ^2.0.5","alternatives":[{"option":"另选一套，例如 node:test + JSON Schema（ccmem 用的就是 node:test）","why_not":"CLAUDE.md Rule 11 conformance > taste；且 spec §9.1 要求 Orca 以 npm 依赖引入 ccloop，两边 module 解析方式不一致会直接在 import 上踩坑"}],"because":"CLAUDE.md Rule 11；spec §9.1「用 npm 依赖引入 ccloop，理由是锁版本」","undo":{"how":"/bin/rm -rf package.json tsconfig.json vitest.config.ts node_modules && 重新初始化","cost":"丢掉骨架那一笔提交；此时尚无产品代码，损失为零","blast_radius":"仅本仓库"},"evidence":["ccloop/package.json: \"type\":\"module\", zod ^3.23.8, vitest ^2.0.5, typescript ^5.5.4","ccloop/tsconfig.json: module=NodeNext, strict=true, target=ES2022","ccmem/package.json: 用的是 node --test，与 ccloop 不同"],"scope":"repo","kind":"dependency"}
{"ev":"decision","id":"orca-dev-09cc3ea1/2","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"spec §3.8 说校验器是「纯函数：吃一行 JSON」，但检查 5 要整份文件、检查 6 要 git diff，怎么落地","chose":"拆三层：validateLine（纯，检查 1-4）／validateFile（纯，吃行数组，加检查 5）／checkAppendOnly（纯，吃 diff 文本，检查 6）","alternatives":[{"option":"硬做成单一纯函数，让它自己去读文件和调 git","why_not":"那它就不是纯函数了，且不可测——检查 6 会变成必须有真 git 仓库才能跑的判据"},{"option":"只实现检查 1-4，把 5 和 6 推给以后","why_not":"spec §3.8 明写 6 项都要，且检查 6 是把追加纪律从「自觉」变成「机制」的唯一手段"}],"because":"spec §3.8 表格 6 项检查的输入粒度本来就是三种（一行／整份／一个 diff），单层 API 装不下","undo":{"how":"把 src/ledger/validateFile.ts 与 src/ledger/appendOnly.ts 的逻辑并回 src/ledger/validateLine.ts 的单一入口","cost":"要重写三份测试文件的入口调用，约一个任务的量","blast_radius":"仅 src/ledger/** 与 tests/ledger/**"},"evidence":["spec §3.8 检查 5：bound / superseded / overturned 引用的 id 在本文件中存在","spec §3.8 检查 6：该行是追加——既有行一字未改；第 6 项要在 pre-commit 上跑"],"scope":"repo","kind":"interface"}
{"ev":"decision","id":"orca-dev-09cc3ea1/3","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"spec §3.8 开头说校验器「吐 ok 或拒绝理由」，表格第 3 行却说不过时是「降级 Tier 0」，返回值到底几态","chose":"三态：ok / downgraded(tier 0) / rejected；rejected 类失败优先于 downgraded","alternatives":[{"option":"二值，把降级也算作拒绝","why_not":"会把一条合法但需升人的决策当成非法记录挡掉，等于删掉 spec §1.1.1「拍不了 Tier 1 的后果是升到人，不是卡死」这句"},{"option":"二值，把降级当作通过","why_not":"那检查 3 就没有任何后果，闸门 A 退回 §1.1.1 批评的「只挡得住懒得写字的 agent」"}],"because":"CLAUDE.md Rule 7：两条打架时挑一条并说明。表格更具体，且 spec §1.1.1 两处独立地都写「降级 Tier 0」，§3.8 表头那句是概述","undo":{"how":"把 src/ledger/types.ts 的 ValidationResult 收回二值，并把 src/ledger/validateLine.ts 里检查 3 的分支改成 rejected","cost":"要改 validateLine、validateFile、cli 三处的分支与对应判据","blast_radius":"仅 src/ledger/** 与 src/cli.ts"},"evidence":["spec §3.8 表格第 3 行「不过时」列写的是：降级 Tier 0（§1.1.1）","spec §1.1.1：不含 ⇒ 降级 Tier 0","spec §3.5 表格：undo 为空时「降级 Tier 0，交给人」"],"scope":"repo","kind":"interface"}
{"ev":"decision","id":"orca-dev-09cc3ea1/4","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"spec §3.8 检查 3「undo.how 含可执行形式」只给了 6 个正反例，机械谓词怎么定","chose":"谓词 = 命令形 ∪ 具名形。命令形：存在相邻两 token，前者形如程序名（^[a-z][a-z0-9._-]*$）且后者形如参数（以 - 开头、或含 / = *、或形如 <...>、或形如 name.ext）。具名形：存在 camelCase／snake_case 标识符，或含 / 的路径样 token","alternatives":[{"option":"非空即过","why_not":"这正是 spec §1.1.1 点名批评的形状——「agent 只要写一句散文就过闸，这道闸门只挡得住懒得写字的 agent」"},{"option":"维护一份可执行程序名白名单（git / rm / npm / node ...）","why_not":"白名单对 spec 自己给的第三个合法例「把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run」判错——它的可核性来自指名了字段，不是来自程序名"}],"because":"spec §1.1.1 给了 3 正 3 反共 6 个例子，谓词必须对这 6 个全部判对，且两个子句各自要有只有它能接住的例子，否则其中一个是死码","undo":{"how":"把 src/ledger/undoExecutable.ts 的 undoHowIsExecutable 改回 (how) => how.trim().length > 0，并删掉 tests/ledger/undoExecutable.test.ts","cost":"闸门 A 退化为形式检查，需要在台账里另记一条决策说明为什么放弃","blast_radius":"仅 src/ledger/undoExecutable.ts"},"evidence":["spec §1.1.1 合法例：git branch -f int/a <ref>","spec §1.1.1 合法例：rm -rf .decisions/run-7c.jsonl && <重跑命令>","spec §1.1.1 合法例：把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run","spec §1.1.1 不合法例：把 T7 重新排进并行池 / 回滚一下就好 / 改改配置"],"scope":"repo","kind":"criteria"}
{"ev":"decision","id":"orca-dev-09cc3ea1/5","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"bound / superseded / overturned 这三类引用事件的必填字段是什么，spec 没给","chose":"只要求 ev 与 id 两个字段，其余字段放行（zod passthrough）；不要求 at，也不要求 run","alternatives":[{"option":"照 §6 的归属纪律，给引用事件也加上 at 与 run 必填","why_not":"spec §3.3 给出的 bound 例子只有 ev / id / note 三个键，加必填会让 spec 自己的例子校验不过；而 who 由文件名承载、when 由 git blame 反查该行得出，这正是 §3.3 不存 hash 的设计本身"}],"because":"spec §3.8 检查 1 列的 11 个必填字段（question / chose / alternatives / undo ...）显然是 decision 的形状，套到 bound 上没有意义；引用事件的语义全部在 id 上","undo":{"how":"在 src/ledger/schema.ts 的 referenceEventSchema 上把 at 与 run 加回 required，并改 tests/ledger/validateLine.test.ts 的对应判据","cost":"已写入的引用事件行会集体变非法，需要在台账里另起一条决策记录这次收紧","blast_radius":"仅 src/ledger/schema.ts"},"evidence":["spec §3.3 的 bound 例子逐字为：{\"ev\":\"bound\",\"id\":\"run-7c/3\",\"note\":\"...\"}","spec §3.3：bound 这一行本身落在实现那笔提交里 ⇒ 哪笔实现了它由 git blame 反查 bound 行得出"],"scope":"repo","kind":"interface"}
{"ev":"decision","id":"orca-dev-09cc3ea1/6","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"CLI 的退出码怎么定，降级要不要阻断提交","chose":"0 = 全过；1 = 存在 rejected；2 = 无 rejected 但存在 downgraded。pre-commit 对非 0 一律阻断","alternatives":[{"option":"降级返回 0，只打印警告","why_not":"降级的含义是这条决策 agent 自己拍不了、必须升人。返回 0 就是让它照常落地，等于把 Tier 0 的闸门做成了一行日志"},{"option":"降级也返回 1，与拒绝不分","why_not":"两者要人做的事不同——拒绝是记录写错了要改，降级是记录没错但要人来拍。合成一个码，面板与 hook 就分不出这两种积压"}],"because":"CLAUDE.md Rule 4 要求成功判据是一条能跑出 0／非 0 的命令；spec §1 的总原则是「能改成做不到的，就不要留成必须自觉」","undo":{"how":"把 src/cli.ts 里 downgraded 分支的返回值从 2 改回 0","cost":"降级从此不再阻断提交，闸门 A 只剩下打印","blast_radius":"仅 src/cli.ts 与 scripts/githooks/pre-commit"},"evidence":["spec §3.8：这把 §3.3 的追加纪律从「自觉」变成「机制」","CLAUDE.md Rule 4：成功判据必须是一条能跑出 0 / 非 0 的命令，不许是散文"],"scope":"repo","kind":"boundary"}
{"ev":"decision","id":"orca-dev-09cc3ea1/7","at":"2026-08-29T05:48:37.196Z","run":"orca-dev-09cc3ea1","question":"写入方怎么拿到 run-id，以及要不要在落盘前校验","chose":"run-id 由调用方必填传入，写入方不生成；写入方只做两件 fail-closed 的事：run-id 字符集校验（^[A-Za-z0-9][A-Za-z0-9._-]*$，挡住路径穿越）＋ 落盘前跑 validateLine，非 ok 一律抛错不写","alternatives":[{"option":"写入方自己生成 run-id（时间戳 / uuid）","why_not":"spec §3.0 明写分配规则由 C 定义。现在替 C 定一个，等 C 落地时会有两套不兼容的 id 规则，而台账文件名不可改（改名就是就地改）"},{"option":"先写后校验，让 pre-commit 兜底","why_not":"那写入方就能产出校验器拒绝的行；spec §3.3 是只追加语义，写坏的行改不掉，只能再追加一条更正"}],"because":"spec §3.0「非 ccloop 发起的 agent 需自行分配一个不与之碰撞的 id——该分配规则由 C 定义」；spec §1.1 闸门 A 是 fail closed","undo":{"how":"在 src/ledger/writer.ts 里加一个 generateRunId() 并把 runId 参数改成可选","cost":"要同时决定与 C 的 id 规则怎么并存，是一条新的 Tier 1 决策","blast_radius":"仅 src/ledger/writer.ts"},"evidence":["spec §3.0 run-id 定义：该分配规则由 C 定义，本文只要求它全局唯一且稳定","spec §3.1：每个 agent 只写自己那一个文件，文件名是自己的 run-id"],"scope":"repo","kind":"boundary"}
{"ev":"bound","id":"orca-dev-09cc3ea1/1","note":"骨架三件套落地：package.json / tsconfig.json / vitest.config.ts，逐项对齐 ccloop"}
```

⚠️ **这 8 行是手写的** —— 此刻写入方（Task 7）还不存在。Task 7 会拿写入方把这份文件**原样复现一遍**做等价判据，Task 8 会把「校验它全绿」接成门。

- [ ] **Step 5: 确认台账文件被 git 看见（它必须进版本库，不能被忽略）**

```bash
git check-ignore -v .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-ignore.txt 2>&1; echo "exit=$?"; cat /tmp/orca-ignore.txt
```

Expected: `exit=1`，文件内容为空 —— `git check-ignore` 找不到匹配规则时退出码就是 1。**若 exit=0，说明有规则把台账忽略了，必须停下来先修 `.gitignore`。**

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore tests/smoke.test.ts .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(skeleton): 建仓库骨架并给 Orca 自己的台账开张

技术栈逐项对齐 ccloop（决策 orca-dev-09cc3ea1/1）。
冒烟判据先被看见红（expected 2 to be 3）再改绿，证明 vitest 真在跑。"
```

---

## Task 2: 事件 schema ＋ 单行校验的检查 1／2／4

**Files:**
- Create: `src/ledger/types.ts`
- Create: `src/ledger/schema.ts`
- Create: `src/ledger/validateLine.ts`
- Create: `tests/ledger/validateLine.test.ts`
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（**只追加两行**）

**Interfaces:**
- Consumes: Task 1 的 `npm test`
- Produces:
  - `DECISION_KINDS: readonly ["dependency","interface","scheduling","abandon","criteria","boundary"]`
  - `DECISION_SCOPES: readonly ["file","task","repo","cross-repo"]`
  - `type ValidationResult = { verdict: "ok" } | { verdict: "downgraded"; tier: 0; reasons: string[] } | { verdict: "rejected"; reasons: string[] }`
  - `decisionEventSchema` / `referenceEventSchema`（zod）
  - `validateLine(raw: string): ValidationResult`

- [ ] **Step 1: 写失败的判据**

`tests/ledger/validateLine.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id: "run-7c/3",
    at: "2026-08-29T10:04:11.482Z",
    run: "run-7c",
    question: "任务 T4 与 T7 能否并行",
    chose: "串行，T7 等 T4",
    alternatives: [
      {
        option: "并行开两个 worktree",
        why_not: "两者 targetPaths 都含 src/persistence/fileStore.ts，合并必冲突",
      },
    ],
    because: "写集相交（§5.1 判据）",
    undo: {
      how: "git branch -f int/a <ref>",
      cost: "浪费 T4 已跑的 attempt",
      blast_radius: "仅本仓库调度",
    },
    scope: "repo",
    kind: "scheduling",
    ...overrides,
  };
}

const line = (obj: unknown) => JSON.stringify(obj);

describe("validateLine — 检查 1：必填字段齐全", () => {
  it("接受 spec §3.4 的完整 decision 例子", () => {
    expect(validateLine(line(validDecision()))).toEqual({ verdict: "ok" });
  });

  // 11 个必填字段逐个删掉，逐个必须被拒。
  // 这里不写 for 循环里的 expect.soft——要的是每个字段各自一条能单独打红的判据。
  for (const field of [
    "id", "at", "run", "question", "chose", "alternatives", "because", "undo", "scope", "kind",
  ]) {
    it(`缺 ${field} 时拒绝`, () => {
      const obj = validDecision() as Record<string, unknown>;
      delete obj[field];
      const result = validateLine(line(obj));
      expect(result.verdict).toBe("rejected");
    });
  }

  it("不是合法 JSON 时拒绝，且不抛异常", () => {
    expect(validateLine("{不是 json").verdict).toBe("rejected");
  });

  it("ev 不认识时拒绝", () => {
    expect(validateLine(line({ ev: "note", id: "run-7c/3" })).verdict).toBe("rejected");
  });
});

describe("validateLine — 检查 2：alternatives 非空且每条含 option 与 why_not", () => {
  it("alternatives 为空数组时拒绝（spec §3.5：这不是决策）", () => {
    const result = validateLine(line(validDecision({ alternatives: [] })));
    expect(result.verdict).toBe("rejected");
  });

  it("alternatives 某条缺 why_not 时拒绝", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行开两个 worktree" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });

  it("alternatives 某条的 why_not 是空串时拒绝", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行", why_not: "" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });
});

describe("validateLine — 检查 4：kind 与 scope 白名单", () => {
  for (const kind of ["dependency", "interface", "scheduling", "abandon", "criteria", "boundary"]) {
    it(`接受白名单内的 kind=${kind}`, () => {
      expect(validateLine(line(validDecision({ kind }))).verdict).toBe("ok");
    });
  }

  it("拒绝白名单外的 kind", () => {
    expect(validateLine(line(validDecision({ kind: "naming" }))).verdict).toBe("rejected");
  });

  for (const scope of ["file", "task", "repo", "cross-repo"]) {
    it(`接受白名单内的 scope=${scope}`, () => {
      expect(validateLine(line(validDecision({ scope }))).verdict).toBe("ok");
    });
  }

  it("拒绝白名单外的 scope", () => {
    expect(validateLine(line(validDecision({ scope: "global" }))).verdict).toBe("rejected");
  });

  it("拒绝 decision 上的未知字段（与 ccloop 的 .strict() 同形）", () => {
    expect(validateLine(line(validDecision({ confidence: 0.9 }))).verdict).toBe("rejected");
  });
});

describe("validateLine — 决策 /5：引用事件只要求 ev 与 id", () => {
  it("接受 spec §3.3 逐字给出的 bound 例子（含 note，且没有 at / run）", () => {
    const result = validateLine(line({ ev: "bound", id: "run-7c/3", note: "落地于本笔提交" }));
    expect(result).toEqual({ verdict: "ok" });
  });

  it("接受只有 ev 与 id 的 superseded", () => {
    expect(validateLine(line({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
  });

  it("接受只有 ev 与 id 的 overturned", () => {
    expect(validateLine(line({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("ok");
  });

  it("引用事件缺 id 时拒绝", () => {
    expect(validateLine(line({ ev: "bound" })).verdict).toBe("rejected");
  });
});
```

- [ ] **Step 2: 跑判据，确认全红**

```bash
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-red.txt
```

Expected: FAIL，`Failed to resolve import "../../src/ledger/validateLine.js"`，`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/ledger/types.ts`：

```typescript
export const DECISION_KINDS = [
  "dependency",
  "interface",
  "scheduling",
  "abandon",
  "criteria",
  "boundary",
] as const;

export const DECISION_SCOPES = ["file", "task", "repo", "cross-repo"] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];
export type DecisionScope = (typeof DECISION_SCOPES)[number];

/**
 * 三态，不是二值。依据决策 orca-dev-09cc3ea1/3：
 * spec §3.8 表头写「吐 ok 或拒绝理由」，但同节表格第 3 行的不过时结果是「降级 Tier 0」。
 * 降级 ≠ 拒绝：记录本身合法，只是这条决策 agent 拍不了，要交给人。
 */
export type ValidationResult =
  | { verdict: "ok" }
  | { verdict: "downgraded"; tier: 0; reasons: string[] }
  | { verdict: "rejected"; reasons: string[] };
```

`src/ledger/schema.ts`：

```typescript
import { z } from "zod";
import { DECISION_KINDS, DECISION_SCOPES } from "./types.js";

export const alternativeSchema = z
  .object({
    option: z.string().min(1),
    why_not: z.string().min(1),
  })
  .strict();

export const undoSchema = z
  .object({
    how: z.string().min(1),
    cost: z.string().min(1),
    blast_radius: z.string().min(1),
  })
  .strict();

export const decisionEventSchema = z
  .object({
    ev: z.literal("decision"),
    id: z.string().min(1),
    at: z.string().min(1),
    run: z.string().min(1),
    question: z.string().min(1),
    chose: z.string().min(1),
    alternatives: z.array(alternativeSchema).min(1),
    because: z.string().min(1),
    undo: undoSchema,
    scope: z.enum(DECISION_SCOPES),
    kind: z.enum(DECISION_KINDS),
  })
  .strict();

/**
 * 引用事件只钉 ev 与 id，其余放行 —— 决策 orca-dev-09cc3ea1/5。
 * passthrough 是必需的：spec §3.3 的 bound 例子带一个 note 字段。
 */
export const referenceEventSchema = z
  .object({
    ev: z.enum(["bound", "superseded", "overturned"]),
    id: z.string().min(1),
  })
  .passthrough();

export const REFERENCE_EVENT_TYPES = ["bound", "superseded", "overturned"] as const;

export type DecisionEvent = z.infer<typeof decisionEventSchema>;
export type ReferenceEvent = z.infer<typeof referenceEventSchema>;
```

`src/ledger/validateLine.ts`：

```typescript
import { decisionEventSchema, referenceEventSchema } from "./schema.js";
import type { ValidationResult } from "./types.js";

function rejected(reasons: string[]): ValidationResult {
  return { verdict: "rejected", reasons };
}

/**
 * spec §3.8 的检查 1 / 2 / 4，作用在单独一行 JSON 上。
 * 检查 3 在 Task 3 接进来；检查 5 属 validateFile；检查 6 属 checkAppendOnly。
 */
export function validateLine(raw: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return rejected([`not valid JSON: ${(error as Error).message}`]);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rejected(["line is not a JSON object"]);
  }

  const ev = (parsed as { ev?: unknown }).ev;

  if (ev === "decision") {
    const result = decisionEventSchema.safeParse(parsed);
    if (!result.success) {
      return rejected(result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`));
    }
    return { verdict: "ok" };
  }

  if (ev === "bound" || ev === "superseded" || ev === "overturned") {
    const result = referenceEventSchema.safeParse(parsed);
    if (!result.success) {
      return rejected(result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`));
    }
    return { verdict: "ok" };
  }

  return rejected([`unknown ev: ${JSON.stringify(ev)}`]);
}
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-green.txt
```

Expected: PASS，`exit=0`。

- [ ] **Step 5: 点名变异 —— 三条，逐条确认看见红**

⚠️ **`npm test` 打绿不等于这三条检查在干活。** 逐条做，每条做完立刻还原：

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M2-a（检查 2 死了）** | `schema.ts` 的 `z.array(alternativeSchema).min(1)` 去掉 `.min(1)` | `alternatives 为空数组时拒绝` |
| **M2-b（检查 4 死了）** | `schema.ts` 的 `kind: z.enum(DECISION_KINDS)` 改成 `kind: z.string()` | `拒绝白名单外的 kind` |
| **M2-c（决策 /5 死了）** | `schema.ts` 的 `referenceEventSchema` 末尾 `.passthrough()` 改成 `.strict()` | `接受 spec §3.3 逐字给出的 bound 例子` |

每条按这个跑法：

```bash
# 改完之后
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-mut.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-mut.txt
# 确认表格里点名的那条判据出现在失败清单里，然后还原
git checkout -- src/ledger/schema.ts
git diff --stat > /tmp/orca-t2-restore.txt 2>&1; cat /tmp/orca-t2-restore.txt   # 必须为空
```

⚠️ 还原证明看 `git diff` 的字节数，不看肉眼（CLAUDE.md Rule 15）。

- [ ] **Step 6: 台账追加 bound（追加两行，一个字都不改既有 8 行）**

```
{"ev":"bound","id":"orca-dev-09cc3ea1/3","note":"ValidationResult 三态落在 src/ledger/types.ts"}
{"ev":"bound","id":"orca-dev-09cc3ea1/5","note":"referenceEventSchema 只钉 ev 与 id，passthrough 放行 note"}
```

- [ ] **Step 7: Commit**

```bash
git add src/ledger/types.ts src/ledger/schema.ts src/ledger/validateLine.ts tests/ledger/validateLine.test.ts .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(ledger): 单行校验的检查 1/2/4

三条变异逐条确认过红：去掉 alternatives 的 .min(1)、kind 放成 z.string()、
referenceEventSchema 改 .strict()。"
```

---

## Task 3: `undo.how` 可执行形式谓词（检查 3）

**Files:**
- Create: `src/ledger/undoExecutable.ts`
- Create: `tests/ledger/undoExecutable.test.ts`
- Modify: `src/ledger/validateLine.ts`（在 decision 分支的 schema 通过之后接一段）
- Modify: `tests/ledger/validateLine.test.ts`（追加一个 describe）
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（只追加一行）

**Interfaces:**
- Consumes: `validateLine(raw: string): ValidationResult`（Task 2）
- Produces: `undoHowIsExecutable(how: string): boolean`

- [ ] **Step 1: 写失败的判据**

`tests/ledger/undoExecutable.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../src/ledger/undoExecutable.js";

// spec §1.1.1 的表格逐字搬过来。这 6 条是这条谓词的全部外部规格。
describe("undoHowIsExecutable — spec §1.1.1 的三个合法例", () => {
  it("git branch -f int/a <ref>", () => {
    expect(undoHowIsExecutable("git branch -f int/a <ref>")).toBe(true);
  });

  it("rm -rf .decisions/run-7c.jsonl && <重跑命令>", () => {
    expect(undoHowIsExecutable("rm -rf .decisions/run-7c.jsonl && <重跑命令>")).toBe(true);
  });

  it("把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run", () => {
    expect(undoHowIsExecutable("把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run")).toBe(true);
  });
});

describe("undoHowIsExecutable — spec §1.1.1 的三个不合法例", () => {
  it("把 T7 重新排进并行池", () => {
    expect(undoHowIsExecutable("把 T7 重新排进并行池")).toBe(false);
  });

  it("回滚一下就好", () => {
    expect(undoHowIsExecutable("回滚一下就好")).toBe(false);
  });

  it("改改配置", () => {
    expect(undoHowIsExecutable("改改配置")).toBe(false);
  });
});

describe("undoHowIsExecutable — 两个子句各自的独占例子", () => {
  // ⚠️ 这两条判据存在的理由，是让两个子句各自的变异有地方打红。
  // spec 给的 3 个合法例里，前两个同时被两个子句接住（int/a 和 .decisions/… 都含 /），
  // 只删命令形那一支的话它们照绿 —— 那就是「绿是空的」。
  it("只有命令形能接住：npm test -- --run（无 / 无 camelCase）", () => {
    expect(undoHowIsExecutable("npm test -- --run")).toBe(true);
  });

  it("只有具名形能接住：spec §1.1.1 的第三个合法例（无命令形相邻对）", () => {
    expect(undoHowIsExecutable("把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run")).toBe(true);
  });
});

describe("undoHowIsExecutable — 英文散文不该过闸", () => {
  it("just roll it back", () => {
    expect(undoHowIsExecutable("just roll it back")).toBe(false);
  });

  it("空串", () => {
    expect(undoHowIsExecutable("")).toBe(false);
  });
});
```

`tests/ledger/validateLine.test.ts` 末尾追加（`validDecision` 已在文件上方定义）：

```typescript
describe("validateLine — 检查 3：undo.how 不可执行时降级 Tier 0，不是拒绝", () => {
  it("undo.how 是散文时降级", () => {
    const result = validateLine(
      line(validDecision({
        undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result.verdict).toBe("downgraded");
    if (result.verdict === "downgraded") {
      expect(result.tier).toBe(0);
    }
  });

  it("降级不吃掉拒绝：同时 kind 非法时，结果是拒绝而不是降级", () => {
    const result = validateLine(
      line(validDecision({
        kind: "naming",
        undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result.verdict).toBe("rejected");
  });

  it("undo.how 可执行时仍然是 ok", () => {
    const result = validateLine(
      line(validDecision({
        undo: { how: "git branch -f int/a <ref>", cost: "小", blast_radius: "小" },
      })),
    );
    expect(result).toEqual({ verdict: "ok" });
  });
});
```

- [ ] **Step 2: 跑判据，确认红**

```bash
npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts > /tmp/orca-t3-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-red.txt
```

Expected: FAIL（`undoExecutable.js` 解析不到；`validateLine` 的三条降级判据拿到 `ok`），`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/ledger/undoExecutable.ts`：

```typescript
/**
 * spec §3.8 检查 3：undo.how 是否含「可执行形式」。
 * 谓词由决策 orca-dev-09cc3ea1/4 定义 —— spec 只给了 3 正 3 反共 6 个例子，没给规则。
 *
 * 已知弱点（不掩饰）：具名形只要求出现一个 camelCase／snake_case 标识符或路径样 token，
 * 因此「把 targetPaths 那事儿处理一下」这种含标识符的散文会过闸。
 * 这是有意的下限：spec §1.1.1 自己把「指名到文件与字段的具体过程」列为合法。
 */

const PROGRAM_WORD = /^[a-z][a-z0-9._-]*$/;
const ANGLE_PLACEHOLDER = /^<.+>$/;
const FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
const NAMED_TARGET = /[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*_[a-z][a-z0-9_]*|\S*\/\S+/;

function isArgShaped(token: string): boolean {
  return (
    token.startsWith("-") ||
    token.includes("/") ||
    token.includes("=") ||
    token.includes("*") ||
    ANGLE_PLACEHOLDER.test(token) ||
    FILE_NAME.test(token)
  );
}

/** 命令形：相邻两 token，前者形如程序名、后者形如参数。 */
function hasCommandShape(how: string): boolean {
  const tokens = how.split(/\s+/).filter((t) => t.length > 0);
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (PROGRAM_WORD.test(tokens[i]) && isArgShaped(tokens[i + 1])) {
      return true;
    }
  }
  return false;
}

/** 具名形：指名到了文件或字段。 */
function hasNamedTarget(how: string): boolean {
  return NAMED_TARGET.test(how);
}

export function undoHowIsExecutable(how: string): boolean {
  return hasCommandShape(how) || hasNamedTarget(how);
}
```

`src/ledger/validateLine.ts` 的 decision 分支改成（**整段替换 `if (ev === "decision") { ... }` 这一块**）：

```typescript
  if (ev === "decision") {
    const result = decisionEventSchema.safeParse(parsed);
    if (!result.success) {
      return rejected(result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`));
    }
    // 检查 3 排在 schema 之后：拒绝类失败优先于降级（决策 orca-dev-09cc3ea1/3）。
    if (!undoHowIsExecutable(result.data.undo.how)) {
      return {
        verdict: "downgraded",
        tier: 0,
        reasons: [`undo.how is not executable: ${JSON.stringify(result.data.undo.how)}`],
      };
    }
    return { verdict: "ok" };
  }
```

并在 `validateLine.ts` 顶部加一行 import：

```typescript
import { undoHowIsExecutable } from "./undoExecutable.js";
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npm test > /tmp/orca-t3-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-green.txt
```

Expected: PASS，`exit=0`。

- [ ] **Step 5: 点名变异 —— 三条，逐条确认看见红**

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M3-a（命令形这一支是死码）** | `undoHowIsExecutable` 改成 `return hasNamedTarget(how);` | `只有命令形能接住：npm test -- --run` |
| **M3-b（具名形这一支是死码）** | `undoHowIsExecutable` 改成 `return hasCommandShape(how);` | `只有具名形能接住：spec §1.1.1 的第三个合法例` |
| **M3-c（检查 3 整条没接进 validateLine）** | `validateLine.ts` 里删掉 `if (!undoHowIsExecutable(...))` 那一整块 | `undo.how 是散文时降级` |

跑法与还原证明同 Task 2 Step 5。

⚠️ **M3-a 与 M3-b 是本任务的核心。** 起草本计划时就是靠它们发现：spec 给的前两个合法例（`git branch -f int/a <ref>`、`rm -rf .decisions/...`）**同时**被两个子句接住，只用 spec 的 6 个例子做判据的话，删掉命令形那一支**照样全绿**。那两条独占判据是补这个洞的。

- [ ] **Step 6: 台账追加 bound（追加一行）**

```
{"ev":"bound","id":"orca-dev-09cc3ea1/4","note":"谓词落在 src/ledger/undoExecutable.ts；两个子句各配了一条独占判据，M3-a / M3-b 均确认看见红"}
```

- [ ] **Step 7: Commit**

```bash
git add src/ledger/undoExecutable.ts src/ledger/validateLine.ts tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(ledger): undo.how 可执行形式谓词，不过关就降级 Tier 0

spec §1.1.1 的 6 个正反例全部钉成判据。另加两条独占判据——
spec 的前两个合法例同时被两个子句接住，只靠它们的话删掉命令形那一支照样绿。"
```

---

## Task 4: 整份校验的检查 5（引用的 id 必须存在）

**Files:**
- Create: `src/ledger/validateFile.ts`
- Create: `tests/ledger/validateFile.test.ts`

**Interfaces:**
- Consumes: `validateLine(raw: string): ValidationResult`（Task 2／3）
- Produces:
  - `interface LineVerdict { lineNumber: number; result: ValidationResult }`
  - `interface FileVerdict { verdict: "ok" | "downgraded" | "rejected"; lines: LineVerdict[] }`
  - `validateFile(lines: string[]): FileVerdict`

- [ ] **Step 1: 写失败的判据**

`tests/ledger/validateFile.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { validateFile } from "../../src/ledger/validateFile.js";

function decisionLine(id: string, undoHow = "git branch -f int/a <ref>"): string {
  return JSON.stringify({
    ev: "decision",
    id,
    at: "2026-08-29T10:04:11.482Z",
    run: "run-7c",
    question: "任务 T4 与 T7 能否并行",
    chose: "串行",
    alternatives: [{ option: "并行", why_not: "写集相交" }],
    because: "写集相交（§5.1 判据）",
    undo: { how: undoHow, cost: "浪费一次 attempt", blast_radius: "仅本仓库调度" },
    scope: "repo",
    kind: "scheduling",
  });
}

describe("validateFile — 检查 5：引用的 id 必须在本文件中存在", () => {
  it("bound 引用了本文件里存在的 decision id 时通过", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("bound 引用了不存在的 id 时拒绝", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/9" }),
    ]);
    expect(result.verdict).toBe("rejected");
    expect(result.lines[1].result.verdict).toBe("rejected");
  });

  it("superseded 引用不存在的 id 时拒绝", () => {
    const result = validateFile([JSON.stringify({ ev: "superseded", id: "run-7c/9" })]);
    expect(result.verdict).toBe("rejected");
  });

  it("overturned 引用不存在的 id 时拒绝", () => {
    const result = validateFile([JSON.stringify({ ev: "overturned", id: "run-7c/9" })]);
    expect(result.verdict).toBe("rejected");
  });

  it("引用出现在被引用的 decision 之前也通过——spec 只要求「在本文件中存在」，不要求顺序", () => {
    const result = validateFile([
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
      decisionLine("run-7c/1"),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("bound 不能引用另一条 bound 的 id——只有 decision 才是被引用的对象", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
      JSON.stringify({ ev: "bound", id: "run-7c/2" }),
    ]);
    expect(result.verdict).toBe("rejected");
  });
});

describe("validateFile — 汇总与行号", () => {
  it("空行被跳过，不算一条记录", () => {
    const result = validateFile([decisionLine("run-7c/1"), "", "   "]);
    expect(result.verdict).toBe("ok");
    expect(result.lines).toHaveLength(1);
  });

  it("行号是 1-based，且指向出问题的那一行", () => {
    const result = validateFile([decisionLine("run-7c/1"), "{坏行"]);
    expect(result.lines[1].lineNumber).toBe(2);
    expect(result.lines[1].result.verdict).toBe("rejected");
  });

  it("有降级无拒绝时，整份的 verdict 是 downgraded", () => {
    const result = validateFile([decisionLine("run-7c/1", "回滚一下就好")]);
    expect(result.verdict).toBe("downgraded");
  });

  it("同时有降级和拒绝时，整份的 verdict 是 rejected", () => {
    const result = validateFile([decisionLine("run-7c/1", "回滚一下就好"), "{坏行"]);
    expect(result.verdict).toBe("rejected");
  });
});
```

- [ ] **Step 2: 跑判据，确认红**

```bash
npx vitest run tests/ledger/validateFile.test.ts > /tmp/orca-t4-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t4-red.txt
```

Expected: FAIL，`Failed to resolve import "../../src/ledger/validateFile.js"`，`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/ledger/validateFile.ts`：

```typescript
import { validateLine } from "./validateLine.js";
import type { ValidationResult } from "./types.js";

export interface LineVerdict {
  lineNumber: number;
  result: ValidationResult;
}

export interface FileVerdict {
  verdict: "ok" | "downgraded" | "rejected";
  lines: LineVerdict[];
}

const REFERENCE_EVENTS = new Set(["bound", "superseded", "overturned"]);

/**
 * spec §3.8 检查 5：bound / superseded / overturned 引用的 id 必须在本文件中存在。
 * 「存在」= 本文件里有一条 ev=decision 且 id 相同的记录。不要求出现在引用之前 ——
 * spec 的原话是「在本文件中存在」，加顺序约束是本计划无权做的收紧。
 */
export function validateFile(rawLines: string[]): FileVerdict {
  const entries: Array<{ lineNumber: number; raw: string }> = [];
  rawLines.forEach((raw, index) => {
    if (raw.trim().length > 0) {
      entries.push({ lineNumber: index + 1, raw });
    }
  });

  const decisionIds = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
      if (parsed.ev === "decision" && typeof parsed.id === "string") {
        decisionIds.add(parsed.id);
      }
    } catch {
      // 解析不了的行交给 validateLine 去拒，这里只是收集 id。
    }
  }

  const lines: LineVerdict[] = entries.map((entry) => {
    const result = validateLine(entry.raw);
    if (result.verdict === "rejected") {
      return { lineNumber: entry.lineNumber, result };
    }

    let parsed: { ev?: unknown; id?: unknown };
    try {
      parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
    } catch {
      return { lineNumber: entry.lineNumber, result };
    }

    if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(parsed.ev)) {
      if (typeof parsed.id !== "string" || !decisionIds.has(parsed.id)) {
        return {
          lineNumber: entry.lineNumber,
          result: {
            verdict: "rejected",
            reasons: [`${parsed.ev} references unknown decision id: ${JSON.stringify(parsed.id)}`],
          },
        };
      }
    }

    return { lineNumber: entry.lineNumber, result };
  });

  const hasRejected = lines.some((l) => l.result.verdict === "rejected");
  const hasDowngraded = lines.some((l) => l.result.verdict === "downgraded");

  return {
    verdict: hasRejected ? "rejected" : hasDowngraded ? "downgraded" : "ok",
    lines,
  };
}
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npm test > /tmp/orca-t4-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t4-green.txt
```

Expected: PASS，`exit=0`。

- [ ] **Step 5: 点名变异 —— 三条**

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M4-a（检查 5 是死码）** | 删掉 `if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(...))` 那一整块 | `bound 引用了不存在的 id 时拒绝` |
| **M4-b（只认 decision 才算存在，这条约束死了）** | 收集 id 那段的 `parsed.ev === "decision" &&` 去掉 | `bound 不能引用另一条 bound 的 id` |
| **M4-c（汇总优先级反了）** | `hasRejected ? "rejected" : hasDowngraded ? ...` 两个分支对调 | `同时有降级和拒绝时，整份的 verdict 是 rejected` |

跑法与还原证明同 Task 2 Step 5。

- [ ] **Step 6: Commit**

```bash
git add src/ledger/validateFile.ts tests/ledger/validateFile.test.ts
git commit -m "feat(ledger): 整份校验的检查 5

三条变异确认过红：删掉引用检查、id 收集不再限定 decision、汇总优先级对调。"
```

---

## Task 5: 追加语义检查（检查 6）

**Files:**
- Create: `src/ledger/appendOnly.ts`
- Create: `tests/ledger/appendOnly.test.ts`
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（只追加一行）

**Interfaces:**
- Consumes: 无（纯函数，只吃字符串）
- Produces: `checkAppendOnly(diffText: string): { ok: true } | { ok: false; reasons: string[] }`

- [ ] **Step 1: 写失败的判据**

`tests/ledger/appendOnly.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { checkAppendOnly } from "../../src/ledger/appendOnly.js";

const PURE_APPEND = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
index 1111111..2222222 100644
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3,0 +4 @@
+{"ev":"bound","id":"run-7c/3"}
`;

const HAS_REMOVAL = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
index 1111111..2222222 100644
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3 +3 @@
-{"ev":"decision","id":"run-7c/3","chose":"串行"}
+{"ev":"decision","id":"run-7c/3","chose":"并行"}
`;

const NEW_FILE = `diff --git a/.decisions/run-9a.jsonl b/.decisions/run-9a.jsonl
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/.decisions/run-9a.jsonl
@@ -0,0 +1 @@
+{"ev":"decision","id":"run-9a/1"}
`;

const PURE_RENAME = `diff --git a/.decisions/run-7c.jsonl b/.decisions/archive/2026/run-7c.jsonl
similarity index 100%
rename from .decisions/run-7c.jsonl
rename to .decisions/archive/2026/run-7c.jsonl
`;

describe("checkAppendOnly — spec §3.8 检查 6", () => {
  it("纯追加通过", () => {
    expect(checkAppendOnly(PURE_APPEND)).toEqual({ ok: true });
  });

  it("含删除行时拒绝", () => {
    const result = checkAppendOnly(HAS_REMOVAL);
    expect(result.ok).toBe(false);
  });

  it("新建文件通过（--- /dev/null 不是删除行）", () => {
    expect(checkAppendOnly(NEW_FILE)).toEqual({ ok: true });
  });

  it("空 diff 通过", () => {
    expect(checkAppendOnly("")).toEqual({ ok: true });
  });

  it("纯改名通过——spec §3.7.1 的归档就是 git mv，内容一字不动", () => {
    expect(checkAppendOnly(PURE_RENAME)).toEqual({ ok: true });
  });

  // ⚠️ 这条判据存在的理由：hunk 门控是不是死码。
  // 文件头的 `--- a/...` 也以 - 开头；不做门控的话它会被当成删除行，这条就红。
  it("文件头的 --- a/… 不算删除行", () => {
    const result = checkAppendOnly(PURE_APPEND);
    expect(result).toEqual({ ok: true });
  });

  // ⚠️ 这条判据存在的理由：门控不能靠「跳过以 --- 开头的行」来做。
  // 一条内容以 -- 开头的记录被删掉时，diff 里长得就是 `---...`。
  it("删掉一条内容以 -- 开头的行，仍然算删除", () => {
    const diff = `diff --git a/.decisions/run-7c.jsonl b/.decisions/run-7c.jsonl
--- a/.decisions/run-7c.jsonl
+++ b/.decisions/run-7c.jsonl
@@ -3 +2,0 @@
---{"ev":"decision"}
`;
    expect(checkAppendOnly(diff).ok).toBe(false);
  });

  it("拒绝时报出是哪一行", () => {
    const result = checkAppendOnly(HAS_REMOVAL);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reasons.join("\n")).toContain("串行");
  });
});
```

- [ ] **Step 2: 跑判据，确认红**

```bash
npx vitest run tests/ledger/appendOnly.test.ts > /tmp/orca-t5-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t5-red.txt
```

Expected: FAIL，`Failed to resolve import "../../src/ledger/appendOnly.js"`，`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/ledger/appendOnly.ts`：

```typescript
export type AppendOnlyResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * spec §3.8 检查 6：对 .decisions/** 的 diff 若含任何非新增行，拒绝提交。
 *
 * 只在 hunk 内部（@@ 之后）判断以 - 开头的行。理由是文件头的 `--- a/...` 也以 - 开头，
 * 而「跳过以 --- 开头的行」这种写法会漏掉「删除一条内容以 -- 开头的记录」。
 *
 * 纯改名（无 hunk）自然通过 —— spec §3.7.1 的归档就是 git mv，内容一字不动。
 */
export function checkAppendOnly(diffText: string): AppendOnlyResult {
  const reasons: string[] = [];
  let inHunk = false;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith("-")) {
      reasons.push(`non-append change to .decisions/**: ${line}`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npm test > /tmp/orca-t5-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t5-green.txt
```

Expected: PASS，`exit=0`。

- [ ] **Step 5: 点名变异 —— 三条**

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M5-a（检查 6 是死码）** | 删掉 `if (line.startsWith("-")) { reasons.push(...) }` | `含删除行时拒绝` |
| **M5-b（hunk 门控是死码）** | 删掉 `if (!inHunk) { continue; }` | `文件头的 --- a/… 不算删除行` |
| **M5-c（门控退化成跳过 ---）** | 把 hunk 门控整段换成 `if (line.startsWith("---")) continue;` | `删掉一条内容以 -- 开头的行，仍然算删除` |

跑法与还原证明同 Task 2 Step 5。

- [ ] **Step 6: 台账追加 bound（追加一行）**

```
{"ev":"bound","id":"orca-dev-09cc3ea1/2","note":"三层齐了：validateLine（检查1-4）／validateFile（检查5）／checkAppendOnly（检查6）"}
```

- [ ] **Step 7: Commit**

```bash
git add src/ledger/appendOnly.ts tests/ledger/appendOnly.test.ts .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(ledger): 追加语义检查，吃 git diff 文本的纯函数

M5-b / M5-c 两条变异钉住了 hunk 门控：跳过 --- 开头的写法会漏掉
「删除一条内容以 -- 开头的记录」，那条判据就是为它准备的。"
```

---

## Task 6: CLI ＋ 退出码 0／1／2

**Files:**
- Create: `src/cli.ts`
- Create: `tests/cli/cli.test.ts`
- Create: `tests/fixtures/ledger/ok.jsonl`
- Create: `tests/fixtures/ledger/downgraded.jsonl`
- Create: `tests/fixtures/ledger/rejected.jsonl`
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（只追加一行）

**Interfaces:**
- Consumes: `validateFile(lines: string[]): FileVerdict`（Task 4）、`checkAppendOnly(diffText: string): AppendOnlyResult`（Task 5）
- Produces: `main(argv: string[], stdinText?: string): Promise<number>`
  - `main(["validate", <路径…>])` —— 路径可以是文件，也可以是目录（目录只扫顶层 `*.jsonl`，因此天然跳过 `.decisions/archive/`）
  - `main(["check-append-only"], diffText)`

- [ ] **Step 1: 写失败的判据**

三份 fixture：

`tests/fixtures/ledger/ok.jsonl`（一行）：

```
{"ev":"decision","id":"fx/1","at":"2026-08-29T00:00:00.000Z","run":"fx","question":"用哪种锁","chose":"文件租约","alternatives":[{"option":"进程内互斥","why_not":"跨进程无效"}],"because":"跨进程","undo":{"how":"git revert <ref>","cost":"一次重跑","blast_radius":"仅本仓库"},"scope":"repo","kind":"interface"}
```

`tests/fixtures/ledger/downgraded.jsonl`（一行，`undo.how` 是散文）：

```
{"ev":"decision","id":"fx/2","at":"2026-08-29T00:00:00.000Z","run":"fx","question":"用哪种锁","chose":"文件租约","alternatives":[{"option":"进程内互斥","why_not":"跨进程无效"}],"because":"跨进程","undo":{"how":"回滚一下就好","cost":"一次重跑","blast_radius":"仅本仓库"},"scope":"repo","kind":"interface"}
```

`tests/fixtures/ledger/rejected.jsonl`（一行，`alternatives` 为空）：

```
{"ev":"decision","id":"fx/3","at":"2026-08-29T00:00:00.000Z","run":"fx","question":"用哪种锁","chose":"文件租约","alternatives":[],"because":"跨进程","undo":{"how":"git revert <ref>","cost":"一次重跑","blast_radius":"仅本仓库"},"scope":"repo","kind":"interface"}
```

`tests/cli/cli.test.ts`：

```typescript
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const fixtures = join(repoRoot, "tests", "fixtures", "ledger");

describe("main — validate 的退出码", () => {
  it("全过时返回 0", async () => {
    expect(await main(["validate", join(fixtures, "ok.jsonl")])).toBe(0);
  });

  it("有拒绝时返回 1", async () => {
    expect(await main(["validate", join(fixtures, "rejected.jsonl")])).toBe(1);
  });

  it("只有降级时返回 2", async () => {
    expect(await main(["validate", join(fixtures, "downgraded.jsonl")])).toBe(2);
  });

  it("降级与拒绝同时存在时返回 1", async () => {
    const code = await main([
      "validate",
      join(fixtures, "downgraded.jsonl"),
      join(fixtures, "rejected.jsonl"),
    ]);
    expect(code).toBe(1);
  });

  it("目录参数扫顶层的 *.jsonl", async () => {
    expect(await main(["validate", fixtures])).toBe(1);
  });

  it("路径不存在时返回 1", async () => {
    expect(await main(["validate", join(fixtures, "nope.jsonl")])).toBe(1);
  });

  it("没给子命令时返回 1", async () => {
    expect(await main([])).toBe(1);
  });
});

describe("main — check-append-only 的退出码", () => {
  it("纯追加返回 0", async () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1,0 +2 @@",
      '+{"ev":"bound","id":"x/1"}',
    ].join("\n");
    expect(await main(["check-append-only"], diff)).toBe(0);
  });

  it("含删除行返回 1", async () => {
    const diff = [
      "diff --git a/.decisions/x.jsonl b/.decisions/x.jsonl",
      "--- a/.decisions/x.jsonl",
      "+++ b/.decisions/x.jsonl",
      "@@ -1 +1 @@",
      '-{"ev":"decision","id":"x/1"}',
      '+{"ev":"decision","id":"x/2"}',
    ].join("\n");
    expect(await main(["check-append-only"], diff)).toBe(1);
  });
});

// ⚠️ 上面所有判据量的都是 main() 的返回值。返回值不等于进程退出码——
// 中间少写一句 process.exitCode 就断了，而上面每一条都照绿。
// 所以这里起一个真进程，直接量它的退出码。
describe("真进程的退出码", () => {
  it("rejected.jsonl 让进程以 1 退出", async () => {
    await expect(
      execFileAsync("npx", ["tsx", "src/cli.ts", "validate", join(fixtures, "rejected.jsonl")], {
        cwd: repoRoot,
      }),
    ).rejects.toMatchObject({ code: 1 });
  }, 60_000);

  it("ok.jsonl 让进程以 0 退出", async () => {
    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", "src/cli.ts", "validate", join(fixtures, "ok.jsonl")],
      { cwd: repoRoot },
    );
    expect(stdout).toContain("ok");
  }, 60_000);
});
```

- [ ] **Step 2: 跑判据，确认红**

```bash
npx vitest run tests/cli/cli.test.ts > /tmp/orca-t6-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-red.txt
```

Expected: FAIL，`Failed to resolve import "../../src/cli.js"`，`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/cli.ts`：

```typescript
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkAppendOnly } from "./ledger/appendOnly.js";
import { validateFile } from "./ledger/validateFile.js";

const USAGE = `usage:
  orca validate <path...>        校验台账文件或目录（目录只扫顶层 *.jsonl）
  orca check-append-only         从 stdin 读 git diff，含任何删除行即拒
`;

async function collectLedgerFiles(paths: string[]): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    let info;
    try {
      info = await stat(path);
    } catch {
      errors.push(`cannot stat: ${path}`);
      continue;
    }
    if (info.isDirectory()) {
      // 只扫顶层：spec §3.0 规定 .decisions/ 不建子目录，
      // 而 §3.7.1 的 archive/ 默认不该被扫到。
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(path, entry.name));
        }
      }
    } else {
      files.push(path);
    }
  }

  return { files, errors };
}

async function runValidate(paths: string[]): Promise<number> {
  if (paths.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const { files, errors } = await collectLedgerFiles(paths);
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }

  let sawRejected = errors.length > 0;
  let sawDowngraded = false;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const verdict = validateFile(text.split("\n"));

    for (const line of verdict.lines) {
      if (line.result.verdict === "rejected") {
        process.stderr.write(`${file}:${line.lineNumber}: rejected: ${line.result.reasons.join("; ")}\n`);
      } else if (line.result.verdict === "downgraded") {
        process.stderr.write(
          `${file}:${line.lineNumber}: downgraded to tier 0: ${line.result.reasons.join("; ")}\n`,
        );
      }
    }

    if (verdict.verdict === "rejected") sawRejected = true;
    if (verdict.verdict === "downgraded") sawDowngraded = true;
  }

  if (sawRejected) return 1;
  if (sawDowngraded) return 2;

  process.stdout.write(`ok: ${files.length} ledger file(s)\n`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[], stdinText?: string): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "validate") {
    return runValidate(rest);
  }

  if (command === "check-append-only") {
    const diffText = stdinText ?? (await readStdin());
    const result = checkAppendOnly(diffText);
    if (result.ok) {
      process.stdout.write("ok: append-only\n");
      return 0;
    }
    for (const reason of result.reasons) {
      process.stderr.write(`${reason}\n`);
    }
    return 1;
  }

  process.stderr.write(USAGE);
  return 1;
}

// 直接 `tsx src/cli.ts` 跑时才执行。被 import 时不执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npm test > /tmp/orca-t6-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t6-green.txt
```

Expected: PASS，`exit=0`。

- [ ] **Step 5: 点名变异 —— 三条**

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M6-a（降级不再阻断）** | `if (sawDowngraded) return 2;` 改成 `if (sawDowngraded) return 0;` | `只有降级时返回 2` |
| **M6-b（拒绝没盖过降级）** | 把 `if (sawRejected) return 1;` 与 `if (sawDowngraded) return 2;` 两行对调 | `降级与拒绝同时存在时返回 1` |
| **M6-c（返回值没接到进程退出码）** | 删掉文件末尾 `process.exitCode = code;` 这一行 | `rejected.jsonl 让进程以 1 退出` |

⚠️ **M6-c 是这个任务真正要证的那条。** 前面 7 条判据量的都是 `main()` 的返回值，删掉 `process.exitCode` 它们全部照绿 —— 而 pre-commit 与 CI 看的是进程退出码。

跑法与还原证明同 Task 2 Step 5。

- [ ] **Step 6: 台账追加 bound（追加一行）**

```
{"ev":"bound","id":"orca-dev-09cc3ea1/6","note":"退出码 0/1/2 落在 src/cli.ts；M6-c 证过返回值确实接到了进程退出码"}
```

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli/cli.test.ts tests/fixtures/ledger .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(cli): validate 与 check-append-only，退出码 0/1/2

另起真进程量了一次退出码——七条判据量的都是 main() 的返回值，
删掉 process.exitCode 它们照样全绿。"
```

---

## Task 7: 写入方（fail closed）

**Files:**
- Create: `src/ledger/writer.ts`
- Create: `tests/ledger/writer.test.ts`
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（只追加一行）

**Interfaces:**
- Consumes: `validateLine(raw: string): ValidationResult`（Task 2／3）
- Produces: `appendEvent(decisionsDir: string, runId: string, event: unknown): Promise<void>`

- [ ] **Step 1: 写失败的判据**

`tests/ledger/writer.test.ts`：

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent } from "../../src/ledger/writer.js";

function validDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id,
    at: "2026-08-29T00:00:00.000Z",
    run: "fx",
    question: "用哪种锁",
    chose: "文件租约",
    alternatives: [{ option: "进程内互斥", why_not: "跨进程无效" }],
    because: "跨进程",
    undo: { how: "git revert <ref>", cost: "一次重跑", blast_radius: "仅本仓库" },
    scope: "repo",
    kind: "interface",
    ...overrides,
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "orca-writer-"));
}

describe("appendEvent — 落盘形状", () => {
  it("写到 <dir>/<runId>.jsonl，一行一条，行尾一个换行", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "fx", validDecision("fx/1"));
    await appendEvent(dir, "fx", { ev: "bound", id: "fx/1" });

    const text = await readFile(join(dir, "fx.jsonl"), "utf8");
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    expect(JSON.parse(lines[0]).id).toBe("fx/1");
    expect(JSON.parse(lines[1]).ev).toBe("bound");
  });

  it("目录不存在时自动建出来", async () => {
    const dir = join(await tempDir(), "nested", ".decisions");
    await appendEvent(dir, "fx", validDecision("fx/1"));
    const text = await readFile(join(dir, "fx.jsonl"), "utf8");
    expect(text).toContain("fx/1");
  });
});

describe("appendEvent — fail closed", () => {
  it("校验器拒绝时抛错，且一个字都不写", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(dir, "fx", validDecision("fx/1", { alternatives: [] })),
    ).rejects.toThrow(/rejected/);
    await expect(readFile(join(dir, "fx.jsonl"), "utf8")).rejects.toThrow();
  });

  it("校验器降级时也抛错，且一个字都不写", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(
        dir,
        "fx",
        validDecision("fx/1", { undo: { how: "回滚一下就好", cost: "小", blast_radius: "小" } }),
      ),
    ).rejects.toThrow(/downgraded/);
    await expect(readFile(join(dir, "fx.jsonl"), "utf8")).rejects.toThrow();
  });
});

describe("appendEvent — run-id 路径安全", () => {
  for (const bad of ["../escape", "a/b", ".hidden", "", "with space"]) {
    it(`拒绝非法 run-id: ${JSON.stringify(bad)}`, async () => {
      const dir = await tempDir();
      await expect(appendEvent(dir, bad, validDecision("fx/1"))).rejects.toThrow(/run id/);
    });
  }

  it("接受合法 run-id: orca-dev-09cc3ea1", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "orca-dev-09cc3ea1", validDecision("orca-dev-09cc3ea1/1"));
    const text = await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8");
    expect(text).toContain("orca-dev-09cc3ea1/1");
  });
});

describe("写入方能复现本仓库自己那份手写台账", () => {
  // Task 1 那 8 行是手写的（当时写入方还不存在）。这条判据证明：
  // 同样的对象过一遍写入方，产出的字节与仓库里躺着的那份逐字相同。
  it("逐行喂给 appendEvent，产出与 .decisions/orca-dev-09cc3ea1.jsonl 逐字相同", async () => {
    const real = await readFile(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
      "utf8",
    );
    const dir = await tempDir();
    for (const line of real.split("\n")) {
      if (line.trim().length === 0) continue;
      await appendEvent(dir, "orca-dev-09cc3ea1", JSON.parse(line));
    }
    const written = await readFile(join(dir, "orca-dev-09cc3ea1.jsonl"), "utf8");
    expect(written).toBe(real);
  });
});
```

- [ ] **Step 2: 跑判据，确认红**

```bash
npx vitest run tests/ledger/writer.test.ts > /tmp/orca-t7-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-red.txt
```

Expected: FAIL，`Failed to resolve import "../../src/ledger/writer.js"`，`exit=1`。

- [ ] **Step 3: 写最小实现**

`src/ledger/writer.ts`：

```typescript
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateLine } from "./validateLine.js";

/**
 * run-id 由调用方传入，写入方不生成 —— 决策 orca-dev-09cc3ea1/7。
 * spec §3.0 把分配规则留给了子系统 C；这里只挡住会逃出 .decisions/ 的形状。
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function appendEvent(
  decisionsDir: string,
  runId: string,
  event: unknown,
): Promise<void> {
  if (!RUN_ID.test(runId)) {
    throw new Error(`invalid run id: ${JSON.stringify(runId)}`);
  }

  // 落盘前先过校验器。写坏的行改不掉——spec §3.3 是只追加语义。
  const line = JSON.stringify(event);
  const result = validateLine(line);
  if (result.verdict === "rejected") {
    throw new Error(`refusing to append: rejected: ${result.reasons.join("; ")}`);
  }
  if (result.verdict === "downgraded") {
    throw new Error(
      `refusing to append: downgraded to tier 0, this decision is not the agent's to make: ${result.reasons.join("; ")}`,
    );
  }

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(join(decisionsDir, `${runId}.jsonl`), `${line}\n`);
}
```

- [ ] **Step 4: 跑判据，确认全绿**

```bash
npm test > /tmp/orca-t7-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-green.txt
```

Expected: PASS，`exit=0`。

⚠️ 若「逐字相同」那条红了，**先看是不是手写台账里某个字段的键序与 `JSON.stringify` 不一致** —— 修的是 `.decisions/` 那份手写文件（此时它还没被任何提交之外的东西依赖，改它是修正手写笔误，不是就地改历史）。**改之前先确认：只有键序差异，没有值的差异。**

- [ ] **Step 5: 点名变异 —— 三条**

| 变异 | 改哪里 | 必须打红的判据 |
|---|---|---|
| **M7-a（run-id 校验是死码）** | 删掉 `if (!RUN_ID.test(runId)) throw ...` 那一块 | `拒绝非法 run-id: "../escape"` |
| **M7-b（降级被放行）** | 删掉 `if (result.verdict === "downgraded") throw ...` 那一块 | `校验器降级时也抛错，且一个字都不写` |
| **M7-c（先写后校验）** | 把 `await appendFile(...)` 移到 `validateLine` 之前 | `校验器拒绝时抛错，且一个字都不写` |

跑法与还原证明同 Task 2 Step 5。

- [ ] **Step 6: 台账追加 bound（追加一行）**

```
{"ev":"bound","id":"orca-dev-09cc3ea1/7","note":"写入方落在 src/ledger/writer.ts：run-id 必填且过字符集校验，落盘前跑 validateLine，非 ok 抛错不写"}
```

- [ ] **Step 7: Commit**

```bash
git add src/ledger/writer.ts tests/ledger/writer.test.ts .decisions/orca-dev-09cc3ea1.jsonl
git commit -m "feat(ledger): 写入方，落盘前先过校验器

M7-c 钉住了顺序：先写后校验的话，'拒绝时一个字都不写' 这条会红。
另有一条判据用写入方复现了 Task 1 手写的那份台账，逐字相同。"
```

---

## Task 8: 把校验接成门（`npm run verify` ＋ pre-commit）

**Files:**
- Create: `scripts/check-claude-md-lines.mjs`
- Create: `scripts/githooks/pre-commit`
- Modify: `package.json`（加 `verify` 脚本）
- Modify: `.decisions/orca-dev-09cc3ea1.jsonl`（不追加决策，本任务不含新决策）

**Interfaces:**
- Consumes: `npm run ledger -- validate <path>`、`npm run ledger -- check-append-only`（Task 6）
- Produces: `npm run verify` —— 一条能跑出 0／非 0 的命令，即 CLAUDE.md Rule 4 要求的成功判据

- [ ] **Step 1: 先证明这道门会红**

在仓库里放一条故意坏的台账（**临时文件，Step 4 删掉**）：

```bash
mkdir -p /tmp/orca-badledger
cat > .decisions/orca-tmp-bad.jsonl <<'EOF'
{"ev":"decision","id":"bad/1","at":"2026-08-29T00:00:00.000Z","run":"bad","question":"q","chose":"c","alternatives":[],"because":"b","undo":{"how":"git revert <ref>","cost":"x","blast_radius":"y"},"scope":"repo","kind":"interface"}
EOF
npm run ledger -- validate .decisions > /tmp/orca-t8-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t8-red.txt
```

Expected: `exit=1`，输出含 `.decisions/orca-tmp-bad.jsonl:1: rejected`。
⚠️ **看不见这条红，Task 8 就是装饰。**

- [ ] **Step 2: 写行数预算检查**

`scripts/check-claude-md-lines.mjs`：

```javascript
#!/usr/bin/env node
// spec §2.1：CLAUDE.md ≤ 200 行的硬预算「须由机器检查（CI 或 pre-commit），否则必然被突破」。
import { readFileSync } from "node:fs";

const LIMIT = 200;
const path = "CLAUDE.md";
const lines = readFileSync(path, "utf8").split("\n");
// 末尾换行会切出一个空串，不算一行。
const count = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

if (count > LIMIT) {
  process.stderr.write(`${path}: ${count} lines exceeds the hard budget of ${LIMIT} (spec §2.1)\n`);
  process.stderr.write("超了必须往 ccmem project scope 挪，不许「再加一条就好」。\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`ok: ${path} is ${count}/${LIMIT} lines\n`);
}
```

- [ ] **Step 3: 加 `verify` 脚本并跑一次（此刻仍应是红的）**

`package.json` 的 `scripts` 加两条：

```json
    "verify": "npm run typecheck && npm test && npm run ledger -- validate .decisions && node scripts/check-claude-md-lines.mjs",
    "hooks:install": "git config core.hooksPath scripts/githooks"
```

```bash
npm run verify > /tmp/orca-t8-verify-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t8-verify-red.txt
```

Expected: `exit=1`（坏台账还在）。

- [ ] **Step 4: 删掉坏台账，重跑 verify，确认全绿**

```bash
/bin/rm -f .decisions/orca-tmp-bad.jsonl
npm run verify > /tmp/orca-t8-verify-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t8-verify-green.txt
```

Expected: `exit=0`。输出里必须同时出现：
- `ok: 1 ledger file(s)`
- `ok: CLAUDE.md is 135/200 lines` —— ⚠️ **135 这个数字是本会话现测的**（`wc -l CLAUDE.md`，观测于 commit `856fe8d`）。**若实际不是 135，以现测为准，不要去改 CLAUDE.md 迁就它。**

- [ ] **Step 5: 写 pre-commit hook**

`scripts/githooks/pre-commit`：

```sh
#!/bin/sh
# spec §3.8 检查 6 要在 pre-commit 上跑：
# 「对 .decisions/** 的 diff 若含任何非新增行，拒绝提交。」
# 与 §1 的总原则一致：能改成「做不到」的，就不要留成「必须自觉」。
set -e

# CLAUDE.md 的行数预算（spec §2.1）——每次提交都查，很便宜。
node scripts/check-claude-md-lines.mjs

# 台账相关的检查只在这次提交真的动了 .decisions/ 时才跑。
if git diff --cached --name-only -- .decisions | read -r _; then
  tmp="$(mktemp)"
  # ⚠️ 不用管道：管道会吞掉 git 那一侧的退出码（CLAUDE.md Rule 14）。
  git diff --cached --unified=0 -- .decisions > "$tmp"
  npx tsx src/cli.ts check-append-only < "$tmp"
  rm -f "$tmp"

  npx tsx src/cli.ts validate .decisions
fi
```

装上并加可执行位：

```bash
chmod +x scripts/githooks/pre-commit
npm run hooks:install
git config --get core.hooksPath > /tmp/orca-t8-hookpath.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t8-hookpath.txt
```

Expected: `scripts/githooks`，`exit=0`。

⚠️ `core.hooksPath` 是**每个 clone 各自的本地配置**，不随 git 走。新 clone 必须自己跑一次 `npm run hooks:install`。这一点要写进 Task 8 的提交信息里。

- [ ] **Step 6: 证明 hook 真的会挡（在 `git clone --local` 副本里做，主工作树零触碰）**

⚠️ **变异／故障注入只在 `git clone --local` 副本里做**（CLAUDE.md Rule 15）。

```bash
git clone --local . /tmp/orca-hooktest > /tmp/orca-t8-clone.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t8-clone.txt
cd /tmp/orca-hooktest && npm install > /tmp/orca-t8-clone-install.txt 2>&1; echo "install-exit=$?"
cd /tmp/orca-hooktest && npm run hooks:install > /dev/null 2>&1
# 就地改掉台账第一行的一个字，这是检查 6 该挡的形状
cd /tmp/orca-hooktest && node -e "
const fs=require('fs');
const p='.decisions/orca-dev-09cc3ea1.jsonl';
const lines=fs.readFileSync(p,'utf8').split('\n');
lines[0]=lines[0].replace('\"chose\"','\"CHOSE\"');
fs.writeFileSync(p, lines.join('\n'));
"
cd /tmp/orca-hooktest && git add .decisions && git commit -m "should be blocked" > /tmp/orca-t8-blocked.txt 2>&1; echo "commit-exit=$?"; cat /tmp/orca-t8-blocked.txt
```

Expected: `commit-exit` **非 0**，输出含 `non-append change to .decisions/**`。

清掉副本（**这是我自己刚建的临时目录，不是别的 agent 的工作树**）：

```bash
/bin/rm -rf /tmp/orca-hooktest
```

⚠️ **主工作树的还原证明**：

```bash
cd /Users/biran/code/skills/loop/Orca
git diff > /tmp/orca-t8-diff.txt 2>&1; wc -c < /tmp/orca-t8-diff.txt
git diff --cached > /tmp/orca-t8-cached.txt 2>&1; wc -c < /tmp/orca-t8-cached.txt
```

Expected: 两个字节数都只反映本任务**有意**新增的文件，不含 `.decisions/` 的任何修改。

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/check-claude-md-lines.mjs scripts/githooks/pre-commit
git commit -m "chore(gate): npm run verify 与 pre-commit 把台账纪律接成机制

verify = typecheck + test + validate .decisions + CLAUDE.md 行数预算，
一条命令跑出 0/非 0（CLAUDE.md Rule 4）。

pre-commit 走 core.hooksPath=scripts/githooks，这是【每个 clone 的本地配置】，
新 clone 必须自己跑一次 npm run hooks:install。

在 git clone --local 副本里验过：就地改台账一个字，提交被挡，
报 non-append change to .decisions/**。主工作树全程零触碰。"
```

- [ ] **Step 8: 更新 handoff（**追加一节，不删任何既有条目**）**

在 `docs/handoff/handoff.md` 的「⛔ 下一件事」一节**之前**插入一节，内容包括：本计划已执行完、`npm run verify` 是现在的成功判据、台账文件路径与 run-id、新 clone 要跑 `hooks:install`、下一件事变成子系统 B 或 C 的 brainstorming。

⚠️ **别的 agent 落下的条目不要删**（CLAUDE.md Rule 13）。**历史记录不许就地改** —— 「⛔ 下一件事」那一节若已过期，**另起一节记更正，原文逐字保留**。

```bash
git add docs/handoff/handoff.md
git commit -m "docs(handoff): 记下校验器已落地，下一件事换成 B 或 C"
```

---

## 已知缺口（登记，不掩饰）

本计划**没有**做，且**知道自己没做**的：

1. **索引器**（spec §3.0、§3.7）—— 归 E，本计划只保证 `.decisions/**` 的输入形状是它能吃的。
2. **`corrections` 与人纠正闭环**（spec §4）—— 需要 DB 与面板，归 E；`overturned` 事件的完整字段形状因此暂缺（决策 `/5` 只钉了 `ev` ＋ `id`）。
3. **`git blame --follow` 反查**（spec §3.2、§3.3）—— 归索引器，本计划一行都不写。
4. **归档流程**（spec §3.7.1）—— 只在 CLI 上做到了「目录参数不扫子目录，所以 `archive/` 天然被跳过」，`git mv` 归档本身没有工具。
5. **run-id 分配规则**（spec §3.0）—— 明确留给 C，写入方只做字符集校验。两个 agent 各自挑到同一个 run-id 时，spec §3.1「结构上不可能冲突」的保证失效；**这是本计划已知的、未消除的缺口**。
6. **`undo.how` 谓词的假阳性** —— 含任意 camelCase 词的散文能过闸（决策 `/4` 里已写明）。
7. **非 git 目录下的台账**（spec §3.7）—— spec 自己就标了「这一档确实弱」，本计划不碰。

---

## Self-Review

**1. Spec 覆盖**（逐节过一遍 spec，指出哪个 Task 实现它，或为什么不实现）

| spec 节 | 覆盖情况 |
|---|---|
| §1 权限模型 / §1.1 闸门 A | Task 3（`undo.how` 不可执行 ⇒ 降级 Tier 0） |
| §1.1.1 `undo.how` 必须可执行 | Task 3，6 个正反例全部成判据 |
| §1.1 闸门 B / §1.2 自我反驳 | **不实现** —— 是 agent 的行为纪律，不是可执行件；已在 CLAUDE.md Rule 1 与 Rule 7 里 |
| §2 四层分家 / §2.1 容量纪律 | Task 8（`CLAUDE.md ≤ 200 行`的机器检查）。其余三层归 D 与 E |
| §2.2 可过期观测 | **不实现** —— 归 D（spec §8 表格自己这么写的） |
| §3.0 术语 / run-id | Task 7（run-id 由调用方传入，分配规则留给 C） |
| §3.1 每 run 一文件 | Task 7（`<runId>.jsonl`） |
| §3.2 不存 commit hash | Task 2（schema 里没有 hash 字段，`.strict()` 挡住外来字段） |
| §3.3 事件日志 ＋ 后绑定 | Task 2（四种 `ev`）、Task 4（`bound` 的引用完整性） |
| §3.4 `decision` 字段 | Task 2（11 个必填字段逐个有拒绝判据） |
| §3.5 两个 fail-closed 闸门字段 | Task 2（`alternatives`）、Task 3（`undo`） |
| §3.5.1 没有 `confidence` | Task 2（`.strict()` 判据：`拒绝 decision 上的未知字段`，用的正是 `confidence`） |
| §3.6 kind／scope 白名单 | Task 2（白名单内逐个接受 ＋ 白名单外拒绝） |
| §3.7 git 为真相源 | Task 1（`.decisions/` 进版本库，且判据证明它没被 gitignore） |
| §3.7.1 留存策略 | Task 6 部分覆盖（目录只扫顶层 ⇒ `archive/` 跳过）；`git mv` 归档工具**未做**，已登记 |
| §3.8 校验器 6 项检查 | 检查 1／2／4 → Task 2；检查 3 → Task 3；检查 5 → Task 4；检查 6 → Task 5 ＋ Task 8（接 pre-commit） |
| §3.8 变异证明要求 | 每个 Task 的 Step 5，共 18 条点名变异 |
| §4 人纠正闭环 | **不实现**，归 E，已登记 |
| §5 并行编排判据 | **不实现**，归 C；spec §5.3 自己说 A′ 只承诺「`scheduling` 是一等 kind」（Task 2 白名单里有）＋「登记判据」（spec 自己已登记） |
| §6 两条新纪律 | 归属 → Task 2（`run` 必填）；失效 → 归 D |
| §7 边界声明 | Global Constraints（不碰 ccloop） |
| §9 三仓库关系 | Task 1（D1 的技术栈对齐理由引的就是 §9.1） |

**发现的缺口 ⇒ 已补**：起草时 §3.5.1（为什么没有 `confidence`）本来没有对应判据 —— 已在 Task 2 补成 `.strict()` 的那条判据，且它用的输入就是 `confidence: 0.9`。

**2. 占位符扫描**

全文搜过 `TBD` / `TODO` / `implement later` / `add appropriate error handling` / `similar to Task` / `fill in` —— **零命中**。每个代码步骤都带完整代码块；台账的 8 行 JSON 是逐字内容不是示意；`at` 用的是本会话现测的真实时间戳 `2026-08-29T05:48:37.196Z`，不是占位符。

**3. 类型一致**

| 名字 | 定义于 | 被谁用 | 一致？ |
|---|---|---|---|
| `ValidationResult`（三态） | Task 2 `types.ts` | Task 3（返回 downgraded）、Task 4（`LineVerdict.result`）、Task 7（判 verdict） | ✅ |
| `validateLine(raw: string)` | Task 2 | Task 3（改它）、Task 4（调它）、Task 7（调它） | ✅ 全都传字符串，不是对象 |
| `validateFile(lines: string[]): FileVerdict` | Task 4 | Task 6（`text.split("\n")`） | ✅ |
| `checkAppendOnly(diffText: string)` | Task 5 | Task 6 | ✅ |
| `undoHowIsExecutable(how: string): boolean` | Task 3 | Task 3 内部 | ✅ |
| `appendEvent(dir, runId, event)` | Task 7 | Task 7 判据 | ✅ 与 ccloop 的 `appendEvent(runDir, event)` **同名不同签名** —— Orca 多一个 runId 参数，因为文件名由它决定；两者不在同一个包里，不冲突 |
| `main(argv, stdinText?)` | Task 6 | Task 6 判据、`scripts/githooks/pre-commit` | ✅ hook 走进程与 stdin，不走 `stdinText` |
| `DECISION_KINDS` / `DECISION_SCOPES` | Task 2 `types.ts` | Task 2 `schema.ts` | ✅ |

**改掉的一处不一致**：起草时 Task 6 的 `validate` 一度写成吃「文件路径数组」，而 Task 8 的 `verify` 传的是目录 `.decisions` —— 已在 Task 6 的 `collectLedgerFiles` 里把目录情形做实，并配了 `目录参数扫顶层的 *.jsonl` 那条判据。
