# P2：子系统 C —— 调度层（queue over ccloop）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 造出 `orca plan` 与 `orca run` —— 一个一次性进程，吃一份任务图，把每个任务交给 ccloop 跑一遍，把结果整合进一条工作分支 W，处理途中的冲突，把替人做的每个选择写进目标仓库的台账，然后退出。

**Architecture:** 三层，**下层不知道上层存在**：①**纯函数层**（plan 文件 → 写集 → 字典树相交 → DAG 分层），零 I/O、零副作用，`orca plan` 就是它加一个打印器；②**执行层**（仓库锁 → run-id 分配 → 每任务一个 `git clone --local` → spawn ccloop → 读 `loop-state.json` → 事后核对 → 落地进 W）；③**冲突主干**（把冲突物化成一笔提交 → 合成和解契约 → 复用 ccloop 管线 → `commit-tree` 重构正确的 merge commit）。`plan` 与 `run` **共用同一个前半段函数**，结构上不可能漂移。

**Tech Stack:** TypeScript / Node ≥ 20 / vitest / zod（既有）/ `node:child_process` 的 `execFile` 与 `spawn`。**不引入新依赖。**

**Spec:** `docs/superpowers/specs/2026-09-03-scheduler-design.md`（§0–§11，含文末 ERRATUM）
**上游 spec（A′）:** `docs/superpowers/specs/2026-08-29-decision-ledger-design.md`

---

## 🔴 硬前置：P0 与 P1 必须先落地

| 前置 | 本计划靠它拿到什么 | 不落地会怎样 |
|---|---|---|
| **P0**（`plans/2026-09-03-p0-ccloop-publish-attempt-commit.md`） | `refs/ccloop/<run-id>/attempts/<n>` —— attempt 的**可达 commit sha** | *** **v1 跑不起来。** *** `scripted` adapter 不产 `diffPatch`（spec §4.4 现测）⇒ **没有任何产物可收**；且 §7 方向二退化成「patch 空不空」，分不清「采集失败」与「agent 真没干活」 |
| **P1**（`plans/2026-09-03-p1-ledger-extensions-for-c.md`） | `reconcile` kind、写入方两条检查、`bound` 的 `taskId`/`runId` | `bound` 那条**永远补不上** —— 台账只追加，C 一旦写下第一条 `bound`，格式就定死了 |

⚠️ **Task 1 的第一步就是机械核对这两个前置真的在了**，不是读文档确认。

---

## Global Constraints

| # | 约束 | 出处 |
|---|---|---|
| G1 | **`npm run verify` 必须始终 exit 0**，且**本计划的判据必须接进它**。一个没人跑的判据和一个不存在的判据，在输出里长得一模一样（本仓库实测：`core.hooksPath` 那道门曾以未武装状态出厂） | spec §10.1 |
| G2 | **判据是一条能跑出 0／非 0 的命令，不是散文** | `CLAUDE.md` Rule 4 |
| G3 | **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被【看见】红。** **每条变异必须点名【喂它的那个场景】** | `CLAUDE.md` Rule 9 ＋ spec §10.3 |
| G4 | **排在被测调用【之前】、读回测试自己刚写进去的值的断言，永远不可能红。** 验收任何判据前先扫这个形状 | Rule 9 推论 2 |
| G5 | **「红在哪条断言」不是可靠的判别方式** —— 前面的断言会先短路。**要量什么就直接量什么** | Rule 9 |
| G6 | **绝不过滤验证性跑**（`grep`/`tail`/`head`/`sed` 都算，管道还会吞退出码）⇒ 重定向到文件再整份读回 | Rule 14 |
| G7 | **变异只在 `git clone --local` 副本里做**，主工作树零触碰；还原证明用 `shasum -a 256` 前后比对 | Rule 15 |
| G8 | **本机 `rm`／`cp` 都有 `-i` alias** ⇒ 一律 `/bin/rm -rf` 和 `cat pristine > target` | handoff |
| G9 | **验证性 git 命令走裸 `/usr/bin/git`，不走 rtk**（rtk 会漏掉 HEAD 那一笔） | handoff |
| G10 | **push／合并 main／删分支或 worktree 每次单独找人。** 本计划全程不 push | Rule 15 |
| G11 | **调度、依赖判定、写集比对、台账校验必须是代码，不是模型。** 模型只在 §5 做冲突分类与和解 | `CLAUDE.md` Rule 5 ＋ spec §1.2 第 5 条 |
| G12 | 代码、注释、CLI help、commit message **一律英文**；本计划正文中文 | 语言约定 |
| G13 | **v1 全程跑在一次性沙盒仓 ＋ `scripted` adapter**，不花 claude 的钱 | spec §1.2 第 6 条 |
| G14 | **spec 与本计划都是已发布文本后只能追加具名 ERRATUM，不许就地改** | Rule 13 |

### 三条总原则（spec §0，**后面每一条任务都在用它**）

1. *** **凡是 C 够不着的动作，只能【检测 ＋ 降级】，不能声称禁止。** *** 声称禁止就是把一条不成立的前提写进设计。
2. *** **判据算错是常态，不是异常。** *** 写集相交判据是一个**降低进入冲突主干频率的优化**；**判据算错时系统必须仍然正确。**
3. *** **一条判据在被【看到】打红之前，它不是判据。** ***

---

## File Structure

**分三层，下层不知道上层存在。** 每个文件一个责任，且都小到能一次读完。

| 文件 | 责任 | 层 |
|---|---|---|
| `src/scheduler/planFile.ts` | plan 文件的 zod schema ＋ §2.3 的六条当场拒 | ① 纯函数 |
| `src/scheduler/writeSet.ts` | 写集归一化（§3.3 三档）＋ 保留原始声明字符串 | ① |
| `src/scheduler/pathTrie.ts` | 目录字典树 ＋ §3.2 三种冲突的判定与命名 | ① |
| `src/scheduler/graph.ts` | 显式 ∪ 隐式边、环检测、Kahn 分层 | ① |
| `src/scheduler/planReport.ts` | §9.1 的六项打印 ＋ §9.5 两条输出纪律 | ① |
| `src/scheduler/repoLock.ts` | §1.2 第 3 条：同一目标仓同时只允许一个 orca | ② 执行 |
| `src/scheduler/preflight.ts` | §4.2 的运行时前置（W 已存在／基点不是真提交／工作树不干净） | ② |
| `src/scheduler/runId.ts` | §2.2 `mkdir` 原子性 ＋ `EEXIST` 递增 | ② |
| `src/scheduler/ccloopRunner.ts` | clone 副本、改写契约 `repoPath`、spawn、读 `loop-state.json` | ② |
| `src/scheduler/harvest.ts` | 从 `refs/ccloop/**` 收结果 commit ＋ §7 双向核对 | ② |
| `src/scheduler/land.ts` | `git fetch` ＋ `merge --no-ff` 落进 W | ② |
| `src/scheduler/reconcile.ts` | §5 冲突主干：物化、合成和解契约、`commit-tree` 重构 | ③ 冲突 |
| `src/scheduler/ledgerWiring.ts` | §8 两类决策各写哪、`bound` 先写树再 `commit-tree` | ③ |
| `src/scheduler/exitCode.ts` | §6.3 的 3 > 2 > 1 > 0 | ③ |
| `src/scheduler/run.ts` | 编排：把上面串起来。**`plan` 就是它的前半段** | ③ |
| `src/cli.ts` | 加两个子命令 `plan` / `run`（**既有的 `validate` / `check-append-only` 一字不动**） | — |
| `tests/scheduler/**` | 每个模块一份单元判据 ＋ `tests/scheduler/scenarios/` 放 S1–S22 | — |
| `tests/scheduler/sandbox.ts` | 一次性沙盒仓的构造器（建仓、造契约、造 plan、造 scripted 脚本） | — |
| `scripts/verify-scheduler.mjs` | `npm run verify:scheduler` 的入口 | — |

⚠️ **明确不碰**：`src/ledger/**`（P1 已改完，P2 只**调用**它）、`scripts/githooks/**`、
`.decisions/**` 里已经写下的任何一行、ccloop 的 `src/**`（P0 已改完，P2 只**spawn** 它）。

---

## 🔴 一条关于本计划体例的声明（**不是占位符，是划界**）

本计划对每个任务给出：**判据的完整代码**（它是行为的唯一定义）、**导出接口的完整签名**、
以及**实现里承重或易踩反的那几段的完整代码**（字典树判定、`commit-tree` 重构、锁、run-id 递增、
和解契约合成、退出码归约）。

**常规胶水代码（参数拼装、路径 join、日志格式）给签名与它必须满足的断言，不逐行给。**
理由：一份逐行规定 2000 行实现的计划，执行者只能照抄，**评审也就无从评起**；
而判据是完整的 ⇒ **实现怎么写不重要，能不能过判据才重要。** 这是 Rule 4 的直接推论。

⚠️ **但有一条例外**：凡是 spec 点名「最脆」「最容易被顺手优化掉」「最容易踩反」的地方，
**代码必须完整给出** —— §5.2 第 4 步、§8.3 的时序、§3.2 的判定、§3.4 第 3 条。**那几处不许发挥。**

---

## 本计划自己做的 6 条决策

| # | 决策 | 为什么 | 撤销 |
|---|---|---|---|
| **D1** | **任务顺序按「判据能不能自己跑起来」排，不按 spec 的章节顺序** ——先建沙盒 harness 与门（Task 1），再纯函数层，再执行层，最后冲突主干 | spec §10.1 的教训是「门曾以未武装状态出厂」。**先把门装上再往里放东西**，否则每个任务都在赌最后接得上 | 顺序可重排 |
| **D2** | **`verify:scheduler` 在 Task 1 就接进 `npm run verify`，那时它只跑一条冒烟场景** | 一个"最后再接"的门，实测经验是它不会被接上。**先接空的，再往里加** | 从 verify 串里去掉那一步 |
| **D3** | **仓库锁用 `mkdir` 的原子性，不用 `fcntl`／`flock`** | 与 §2.2 的 run-id 分配**同一个原语**，少一套机制；且 spec §1.2 第 3 条明写 hermes 的教训是「无 `fcntl` 的平台退化成 no-op」——**`mkdir` 没有这种退化档** | 换实现，判据不变 |
| **D4** | **`orca plan` 与 `orca run` 是 `src/cli.ts` 的两个子命令，不是两个二进制** | §9.4 要求「同一份代码」。同一个 CLI 少一层可能漂移的接缝 | — |
| **D5** | **S10（`--serial` 与并行一致性）单独一个任务，排在最后** | 它要**跑两遍整个 plan** ⇒ 依赖前面全部就位；且 spec §10.4 缺口 12 明写「它是 v1 的判据，不是生产开关」 | — |
| **D6** | **`M-C`（跳过整个 §7 核对）不写成 `describe.skip`，写成一个真的会被跑的变异步骤** | `M-C` 抓的不是某条分支，是**整节的存在性**。写成 skip 就等于自己承认没跑过它 | — |

---

## Task 1: 沙盒 harness ＋ 把门装上（**先装门，再放东西**）

**Files:**
- Create: `tests/scheduler/sandbox.ts`
- Create: `scripts/verify-scheduler.mjs`
- Create: `tests/scheduler/sandbox.test.ts`
- Modify: `package.json`（加 `verify:scheduler`，并把它接进 `verify`）

**Interfaces:**
- Produces:
  - `export interface Sandbox { root: string; targetRepo: string; runsDir: string; ccloopBin: string; cleanup(): Promise<void> }`
  - `export async function makeSandbox(): Promise<Sandbox>` —— 建一个 `git init` 的一次性仓，做一笔 `init` 提交，**显式传 `-c user.name` / `-c user.email`**（沙盒仓没有 git 身份）
  - `export async function writeContract(s: Sandbox, taskId: string, spec: ContractSpec): Promise<string>` —— 写一份 ccloop 契约到 **`runsDir` 之下**（§2.3：契约必须落在 `targetRepo` 之外），返回绝对路径
  - `export async function writePlan(s: Sandbox, plan: unknown): Promise<string>`
  - `export async function refSha(repo: string, ref: string): Promise<string | null>`
  - `export async function allRefShas(repo: string): Promise<Record<string, string>>` —— `git for-each-ref --format='%(refname) %(objectname)'`
  - `export async function porcelain(repo: string): Promise<string>` —— `git status --porcelain`

- [ ] **Step 1: 机械核对两个硬前置真的在了（不是读文档）**

```bash
cd /Users/biran/code/skills/loop/Orca
{ echo "--- P1: bound 是否已要求 taskId/runId"
  npx tsx -e 'import{validateLine}from"./src/ledger/validateLine.js";console.log(JSON.stringify(validateLine(JSON.stringify({ev:"bound",id:"x/1"}))));'
  echo "--- P1: reconcile kind 是否已存在"
  npx tsx -e 'import{DECISION_KINDS}from"./src/ledger/types.js";console.log([...DECISION_KINDS].join(","));'
  echo "--- P0: ccloop 是否已导出 publishAttemptCommit"
  /usr/bin/grep -n "export async function publishAttemptCommit" /Users/biran/code/skills/loop/ccloop/src/workspace/worktreeManager.ts
} > /tmp/p2-prereq.txt 2>&1; echo "RC=$?"; cat /tmp/p2-prereq.txt
```

**期望**：第一条打印 `downgraded` 且 reasons 提到 `taskId`；第二条含 `reconcile`；第三条有一条命中。
🔴 **任何一条不符 ⇒ 停下来，先去做 P0／P1，不要往下走。**

- [ ] **Step 2: 写沙盒的自证判据（harness 自己也要有判据）**

```ts
// tests/scheduler/sandbox.test.ts
import { describe, expect, it } from "vitest";
import { allRefShas, makeSandbox, porcelain, writeContract, writePlan } from "./sandbox.js";

describe("the scheduler sandbox", () => {
  it("builds a repository with a real commit, a clean worktree, and no git identity leaking in from the machine", async () => {
    // Every scenario in this plan asserts something about a repository's refs
    // or its porcelain output. If the sandbox itself were dirty, or depended
    // on the developer's global git config, those assertions would measure the
    // machine rather than the code — the shape this repo has been bitten by.
    const s = await makeSandbox();
    try {
      expect(await porcelain(s.targetRepo)).toBe("");
      const refs = await allRefShas(s.targetRepo);
      expect(Object.keys(refs).length).toBeGreaterThan(0);
    } finally {
      await s.cleanup();
    }
  });

  it("puts contracts outside the target repository", async () => {
    // Load-bearing: spec 2.3 rejects a plan whose contract lives inside the
    // target repo, because an upstream task could then rewrite the write set
    // the graph was built from. A harness that violated it would make that
    // rejection untestable.
    const s = await makeSandbox();
    try {
      const p = await writeContract(s, "T1", { goal: "x", targetPaths: ["a.txt"], requiredChecks: ["true"] });
      expect(p.startsWith(s.targetRepo)).toBe(false);
      expect(p.startsWith(s.runsDir)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("writes a plan file that round-trips as JSON", async () => {
    const s = await makeSandbox();
    try {
      const p = await writePlan(s, { targetRepo: s.targetRepo, tasks: [] });
      expect(JSON.parse(await readFile(p, "utf8")).targetRepo).toBe(s.targetRepo);
    } finally {
      await s.cleanup();
    }
  });
});
```

- [ ] **Step 3: 实现 `sandbox.ts`**

关键点（其余是常规胶水）：

```ts
// Identity is passed per-invocation rather than configured, so a machine with
// no global user.email — a CI container, a fresh checkout — runs these tests
// identically to a developer's laptop.
const ID = ["-c", "user.name=orca-test", "-c", "user.email=orca-test@invalid"];

export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "orca-sched-"));
  const targetRepo = join(root, "repo");
  const runsDir = join(root, "runs");
  await mkdir(targetRepo, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await git(targetRepo, ["init"]);
  await writeFile(join(targetRepo, "README.md"), "seed\n");
  await git(targetRepo, [...ID, "add", "-A"]);
  await git(targetRepo, [...ID, "commit", "-m", "init"]);
  return { root, targetRepo, runsDir, ccloopBin: resolveCcloopBin(), cleanup: () => rm(root, { recursive: true, force: true }) };
}
```

⚠️ **`resolveCcloopBin()` 必须现测**：ccloop 的 `package.json` 是 `private: true`、`bin` 指向 `dist/cli.js`
（spec §1.4 现测）⇒ **要先在 ccloop 里跑一次 `npm run build`**。
**把「dist 不存在」写成一条显式报错，不要让它变成一个奇怪的 spawn 失败。**

- [ ] **Step 4: 装门 —— `verify:scheduler` 接进 `verify`（此刻它只跑 harness 自证）**

`scripts/verify-scheduler.mjs`：

```js
// Deliberately a thin wrapper rather than a second test runner: the scheduler
// scenarios are vitest tests like everything else. What this script exists for
// is to be a name in package.json that `verify` can depend on, so the gate is
// armed from the first task instead of at the end — this repo has shipped a
// gate in an unarmed state before, and nothing noticed.
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run", "tests/scheduler"], { stdio: "inherit" });
process.exit(r.status ?? 1);
```

`package.json`：加 `"verify:scheduler": "node scripts/verify-scheduler.mjs"`，
并把 `verify` 串里加上 `&& npm run verify:scheduler`。
⚠️ **先 `grep -c` 确认 `verify` 那一行命中数为 1**（整行锚点）。

- [ ] **Step 5: 跑，确认门是【武装】的 —— 这一步是本任务的全部意义**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p2-t1-verify.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p2-t1-verify.txt
```

🔴 **然后立刻证明它真的接上了**（副本里做，G7）：**把 `sandbox.test.ts` 里第一条判据改成必然失败**
（例如断言 `porcelain` 是 `"x"`），跑 `npm run verify`，**必须非 0**。

⚠️ *** **这一步不许跳过。** *** 「`verify` 里多了一行」和「`verify` 真的会因为它红」是两件事，
**而本仓库正是在这个区别上栽过**（`core.hooksPath` 那道门）。

- [ ] **Step 6: Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add tests/scheduler/ scripts/verify-scheduler.mjs package.json
/usr/bin/git commit -m "test(scheduler): build the sandbox harness and arm its gate first

The gate is wired into verify while it still runs one smoke assertion, and
proved to go red by breaking that assertion, because a gate added at the end
is a gate nobody ever proves is connected. This repository has shipped one in
an unarmed state before and nothing noticed."
```

---

## Task 2: plan 文件 ＋ §2.3 的六条当场拒

**Files:**
- Create: `src/scheduler/planFile.ts`
- Test: `tests/scheduler/planFile.test.ts`

**Interfaces:**
- Produces:
  - `export interface PlanTask { taskId: string; contract: string; dependsOn: string[] }`
  - `export interface PlanFile { targetRepo: string; ccloopBin: string; runsDir: string; workBranch: string; policy: "local-merge"; ledgerMode: "in-repo" | "out-of-repo"; tasks: PlanTask[] }`
  - `export type PlanRejection = { code: string; message: string }`
  - `export function loadPlan(raw: unknown, defaultBranch: string): { plan: PlanFile } | { rejections: PlanRejection[] }`
    —— **返回全部拒绝理由，不是第一条**（§3.2 的同款纪律）

- [ ] **Step 1: 判据 —— 六条各一条，外加"全部报出"那一条**

```ts
const OK = {
  targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs",
  workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "in-repo",
  tasks: [{ taskId: "T1", contract: "/abs/t1.json", dependsOn: [] }],
};

describe("loadPlan — the six up-front rejections (spec 2.3)", () => {
  it("rejects any relative path", () => {
    // A relative path resolves against whatever CWD the orchestrator happens
    // to be in: ambiguous, and a confused-deputy escape surface.
    const r = loadPlan({ ...OK, targetRepo: "./repo" }, "main");
    expect(codes(r)).toContain("relative-path");
  });

  it("rejects a duplicate taskId", () => {
    const r = loadPlan({ ...OK, tasks: [t("T1"), t("T1")] }, "main");
    expect(codes(r)).toContain("duplicate-task-id");
  });

  it("rejects a cycle", () => {
    const r = loadPlan({ ...OK, tasks: [t("T1", ["T2"]), t("T2", ["T1"])] }, "main");
    expect(codes(r)).toContain("cycle");
  });

  it("rejects a contract file that lives inside the target repo", () => {
    // This is the premise that lets the write set be computed once, at graph
    // construction time: a contract outside the repo cannot be rewritten by an
    // upstream task. Spec 2.4.1 leans its whole "no re-derivation at claim
    // time" argument on it, which is why it is a rejection and not a comment.
    const r = loadPlan({ ...OK, tasks: [{ ...t("T1"), contract: "/abs/repo/t1.json" }] }, "main");
    expect(codes(r)).toContain("contract-inside-target-repo");
  });

  it("rejects workBranch equal to the default branch", () => {
    // Merging into the default branch is tier 0 — mechanically forbidden, not
    // a matter of policy. Every tier argument in A' section 5.2 rests on this
    // being a check rather than a convention.
    const r = loadPlan({ ...OK, workBranch: "main" }, "main");
    expect(codes(r)).toContain("work-branch-is-default");
  });

  it("rejects a policy other than local-merge, instead of quietly downgrading", () => {
    // rebase and pull-request are configuration this version recognises and
    // does not implement. Accepting them and silently doing a local merge is
    // the failure mode borrowed backwards from hermes: a degradation nobody
    // sees.
    for (const policy of ["rebase", "pull-request", "squash-merge"]) {
      expect(codes(loadPlan({ ...OK, policy }, "main"))).toContain("unsupported-policy");
    }
  });

  it("reports every rejection at once, not just the first", () => {
    // A caller who fixes one problem and re-runs, six times, is a caller the
    // tool is wasting. Same discipline as the trie's conflict listing.
    const r = loadPlan({ ...OK, targetRepo: "./repo", workBranch: "main", policy: "rebase" }, "main");
    expect(codes(r).sort()).toEqual(["relative-path", "unsupported-policy", "work-branch-is-default"]);
  });

  it("accepts a well-formed plan", () => {
    const r = loadPlan(OK, "main");
    expect("plan" in r).toBe(true);
  });
});
```

⚠️ `codes(r)` 与 `t(id, deps)` 是本文件的小 helper，**在判据文件顶部现写**。

- [ ] **Step 2: 跑，确认全红**（模块不存在）

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/scheduler/planFile.test.ts > /tmp/p2-t2-red.txt 2>&1; echo "RC=$?"; cat /tmp/p2-t2-red.txt
```

- [ ] **Step 3: 实现**

zod schema ＋ 六条检查。**环检测复用 Task 4 的 Kahn 会剩节点这个性质**，
但**此刻先写一个独立的 DFS**，Task 4 再合并 —— **不要为了复用把 Task 4 提前**。

⚠️ **`isAbsolute` 要用 `node:path` 的，不要自己写 `startsWith("/")`**（Windows 不在 `os` 白名单里，
但 `package.json:6-9` 只列了 darwin／linux ⇒ 用标准库仍然是对的，且免得日后放宽平台时踩）。

- [ ] **Step 4: 跑，确认全绿 ＋ verify exit 0**

- [ ] **Step 5: 点名变异（六条，一条对一条）**

| 变异 | 删掉什么 | 喂它的判据 |
|---|---|---|
| `M-P2-REL` | 相对路径检查 | `rejects any relative path` |
| `M-P2-DUP` | 重复 taskId 检查 | `rejects a duplicate taskId` |
| `M-P2-CYC` | 环检测 | `rejects a cycle` |
| `M-P2-IN` | 契约在目标仓内的检查 | `rejects a contract file that lives inside the target repo` |
| `M-P2-WB` 🔴 | `workBranch == default` 检查 | `rejects workBranch equal to the default branch` |
| `M-P2-POL` | policy 白名单 | `rejects a policy other than local-merge` |
| `M-P2-ALL` | 把"收集全部"改成"遇到第一条就返回" | `reports every rejection at once` |

- [ ] **Step 6: Commit** —— `feat(scheduler): load a plan file and reject the six shapes that cannot be scheduled`

---

## Task 3: 写集归一化 ＋ 目录字典树相交判定

🔴 **这是 spec 点名「变异要点在判定上，不是点在两个名字上」的那一处，代码完整给出。**

**Files:**
- Create: `src/scheduler/writeSet.ts`、`src/scheduler/pathTrie.ts`
- Test: `tests/scheduler/writeSet.test.ts`、`tests/scheduler/pathTrie.test.ts`

**Interfaces:**
- Produces:
  - `export interface ClaimedPath { normalized: string; declared: string }` —— **保留原始声明字符串**（§3.3 末尾）
  - `export function normalizeClaim(declared: string): ClaimedPath`
  - `export function writeSetOf(contract: unknown): ClaimedPath[]` —— `context.targetPaths ∪ safetyPolicy.allowlistPaths`
  - `export type ConflictKind = "equal" | "new-contains-old" | "new-inside-old"`
  - `export interface PathConflict { kind: ConflictKind; a: ClaimedPath; b: ClaimedPath }`
  - `export function intersect(a: ClaimedPath[], b: ClaimedPath[]): PathConflict[]` —— **列出全部冲突，不是第一条**

- [ ] **Step 1: 判据**

```ts
describe("normalizeClaim (spec 3.3)", () => {
  it("normalizes a prefix glob to its directory prefix", () => {
    expect(normalizeClaim("src/**").normalized).toBe("src/");
  });

  it("normalizes a bare ** to the repository root", () => {
    // Load-bearing for the degradation warning in orca plan: a task claiming
    // ** intersects everyone, so the whole graph goes serial. That is correct
    // behaviour, and it must be visible rather than read as "parallelism is
    // broken".
    expect(normalizeClaim("**").normalized).toBe("");
  });

  it("keeps everything else whole and treats it as a prefix", () => {
    expect(normalizeClaim("src/a.ts").normalized).toBe("src/a.ts");
  });

  it("keeps the declared string for diagnostics", () => {
    // Without this, src/a.ts is reported as having claimed "src/a.ts/**", a
    // directory that does not exist, and the diagnosis reads as a tool bug.
    expect(normalizeClaim("src/**").declared).toBe("src/**");
  });
});

describe("intersect (spec 3.2)", () => {
  it("reports equal claims", () => {
    expect(intersect([c("src/a.ts")], [c("src/a.ts")])[0].kind).toBe("equal");
  });

  it("reports a directory that contains someone else's leaf", () => {
    // Naive set intersection answers "disjoint" here — and spec 3.1 marks that
    // direction as the unsafe one. This is the single judgement M-TRIE deletes.
    expect(intersect([c("src/a.ts")], [c("src/**")])[0].kind).toBe("new-contains-old");
  });

  it("reports a leaf that falls inside someone else's directory", () => {
    expect(intersect([c("src/**")], [c("src/a.ts")])[0].kind).toBe("new-inside-old");
  });

  it("does not confuse a sibling whose name is a string prefix", () => {
    // src/ab.ts starts with "src/a" as a string, but is not inside it as a
    // path. A startsWith implementation passes every test above and fails this
    // one — which is the whole reason this test exists.
    expect(intersect([c("src/a")], [c("src/ab.ts")])).toEqual([]);
  });

  it("says a bare ** intersects everything", () => {
    expect(intersect([c("**")], [c("anything/at/all.txt")]).length).toBe(1);
  });

  it("lists every conflicting path, not just the first", () => {
    const conflicts = intersect([c("src/a.ts"), c("src/b.ts")], [c("src/**")]);
    expect(conflicts.length).toBe(2);
  });

  it("answers disjoint for genuinely disjoint sets", () => {
    expect(intersect([c("src/a.ts")], [c("docs/b.md")])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑，确认全红**

- [ ] **Step 3: 实现 —— `pathTrie.ts` 完整给出**

```ts
/**
 * Path containment, not string prefix. The two differ on exactly one case —
 * "src/a" against "src/ab.ts" — and that case is the reason this is a trie
 * over path segments rather than a startsWith call: a string-prefix
 * implementation answers "intersecting" there, over-serialising, and answers
 * correctly everywhere else, so nothing else in this file would catch it.
 *
 * The empty prefix (from a bare **) is the repository root and contains
 * everything, which falls out of the segment comparison for free.
 */
function segments(normalized: string): string[] {
  return normalized.split("/").filter((s) => s.length > 0);
}

function contains(outer: string, inner: string): boolean {
  const o = segments(outer);
  const i = segments(inner);
  if (o.length > i.length) return false;
  return o.every((seg, idx) => seg === i[idx]);
}

/**
 * Cases 2 and 3 of spec 3.2 are one computation (a prefix relation) and two
 * diagnoses (what the reader has to do about it differs). They share the
 * judgement deliberately: giving each its own predicate is how "delete one
 * branch and everything stays green" happens.
 */
export function classify(a: ClaimedPath, b: ClaimedPath): ConflictKind | null {
  if (a.normalized === b.normalized) return "equal";
  if (contains(b.normalized, a.normalized)) return "new-contains-old";
  if (contains(a.normalized, b.normalized)) return "new-inside-old";
  return null;
}

export function intersect(a: ClaimedPath[], b: ClaimedPath[]): PathConflict[] {
  const out: PathConflict[] = [];
  for (const x of a) {
    for (const y of b) {
      const kind = classify(x, y);
      // Every conflicting pair, never just the first: a caller who fixes one
      // and re-runs to find the next is a caller the tool is wasting.
      if (kind !== null) out.push({ kind, a: x, b: y });
    }
  }
  return out;
}
```

- [ ] **Step 4: 跑，确认全绿 ＋ verify exit 0**

- [ ] **Step 5: 点名变异**

| 变异 | 删掉什么 | 喂它的场景／判据 | 期望 |
|---|---|---|---|
| **`M-TRIE`** 🔴 | 把 `contains` 换成 `inner.startsWith(outer)` | `does not confuse a sibling whose name is a string prefix` | 红 |
| `M-TRIE-b` 🔴 | 把 `classify` 里 `contains` 的两支**都**删掉（只留 `equal`） | `reports a directory that contains someone else's leaf` ＋ `reports a leaf that falls inside someone else's directory` | 两条都红 |
| `M-TRIE-c` | 只删 `"new-contains-old"` 这个**诊断名**那一支 | `reports a directory that contains someone else's leaf` | ⚠️ **只有一条红，另一条照绿** —— 这正是 spec §3.2 预告的形状：②③**共用一条判定、只是两个名字**。**如实登记为「诊断名的变异，不是判定的变异」**，判定本身由 `M-TRIE` ／ `M-TRIE-b` 钉 |
| `M-TRIE-d` | 把 `intersect` 的内层循环改成命中即 `return` | `lists every conflicting path, not just the first` | 红 |
| `M-NORM` | 把 `normalizeClaim("**")` 改成返回 `"**"` | `says a bare ** intersects everything` | 红 |
| `M-DECL` | 不保留 `declared` | `keeps the declared string for diagnostics` | 红 |

⚠️ **`M-TRIE` 喂它的场景是 S2**（spec §10.3）—— 单元判据先红，**S2 端到端在 Task 5 建立之后再复跑一次**。

- [ ] **Step 6: Commit** —— `feat(scheduler): decide path intersection by containment, not by string prefix`

---

## Task 4: 图的构造、隐式边与分层

**Files:**
- Create: `src/scheduler/graph.ts`
- Test: `tests/scheduler/graph.test.ts`

**Interfaces:**
- Produces:
  - `export interface ImplicitEdge { from: string; to: string; conflicts: PathConflict[] }`
  - `export interface TaskGraph { layers: string[][]; explicit: Array<[string,string]>; implicit: ImplicitEdge[]; writeSets: Map<string, ClaimedPath[]> }`
  - `export function buildGraph(plan: PlanFile, contracts: Map<string, unknown>): TaskGraph`
  - `export function implicitEdgeDecisions(g: TaskGraph, runId: string): DecisionEvent[]` —— **每条隐式边一条 `scheduling` 决策**

- [ ] **Step 1: 判据**

```ts
describe("buildGraph (spec 2.4)", () => {
  it("puts two tasks with disjoint write sets in the same layer", () => {
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["a.txt"], T2: ["b.txt"] }));
    expect(g.layers).toEqual([["T1", "T2"]]);
  });

  it("serialises two tasks whose write sets intersect", () => {
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["src/**"], T2: ["src/a.ts"] }));
    expect(g.layers.length).toBe(2);
    expect(g.implicit.length).toBe(1);
  });

  it("honours an explicit dependsOn even when write sets are disjoint", () => {
    const g = buildGraph(plan([["T1", []], ["T2", ["T1"]]]), contracts({ T1: ["a.txt"], T2: ["b.txt"] }));
    expect(g.layers).toEqual([["T1"], ["T2"]]);
  });

  it("records every implicit edge as a scheduling decision with alternatives", () => {
    // An implicit edge has no natural direction — four build systems hit this
    // and all four hand it to a human. The scheduler is not allowed to pick
    // silently: the choice goes in the ledger with the other direction as its
    // alternative, so it can be overturned.
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["src/**"], T2: ["src/a.ts"] }));
    const decisions = implicitEdgeDecisions(g, "orca-T1-abcd1234");
    expect(decisions.length).toBe(1);
    expect(decisions[0].kind).toBe("scheduling");
    expect(decisions[0].alternatives.length).toBeGreaterThanOrEqual(1);
    // The decision must survive the real validator, not a hand-made shape.
    expect(validateLine(JSON.stringify(decisions[0])).verdict).toBe("ok");
  });

  it("a task claiming ** collapses the whole graph to one task per layer", () => {
    const g = buildGraph(plan(["T1", "T2", "T3"]), contracts({ T1: ["**"], T2: ["a.txt"], T3: ["b.txt"] }));
    expect(Math.max(...g.layers.map((l) => l.length))).toBe(1);
  });
});
```

🔴 **最后一条 `validateLine(...).verdict === "ok"` 是承重的**：本仓库栽过
「34 条判据全绿，而 schema 拒绝了台账里 7 条真决策」——**根因是所有判据用的都是手搓 fixture**。
**每一处生成台账记录的地方，都要有一条判据把它喂进真校验器。**

- [ ] **Step 2–4:** 红 → 实现（Kahn 分层；隐式边方向按 `taskId` 字典序定，**并把这个选择本身写进决策的 `because`**）→ 绿

- [ ] **Step 5: 点名变异**

| 变异 | 删掉什么 | 喂它的判据 | 期望 |
|---|---|---|---|
| `M-IMPL` 🔴 | 隐式边（只用显式 `dependsOn`） | `serialises two tasks whose write sets intersect` | 红 |
| `M-DEC` 🔴 | `implicitEdgeDecisions` 里的 `alternatives` | `records every implicit edge as a scheduling decision with alternatives` | 红（`alternatives` 空 ⇒ **真校验器判 rejected**） |
| `M-LAYER` | 把分层改成"全部一层" | `honours an explicit dependsOn` | 红 |

- [ ] **Step 6: Commit** —— `feat(scheduler): build the task graph from explicit and implicit edges`

---

## Task 5: `orca plan` —— 打印器、零副作用、S17

**Files:**
- Create: `src/scheduler/planReport.ts`
- Modify: `src/cli.ts`（加 `plan` 子命令）
- Test: `tests/scheduler/planReport.test.ts`、`tests/scheduler/scenarios/S17.test.ts`

**Interfaces:**
- Produces: `export function renderPlanReport(g: TaskGraph, plan: PlanFile, preflight: PreflightReport, opts: { verbose: boolean }): string`

- [ ] **Step 1: 判据 —— §9.1 六项 ＋ §9.5 两条纪律 ＋ S17**

```ts
describe("renderPlanReport (spec 9.1, 9.5)", () => {
  it("prints each task's normalized write set alongside its declared strings", () => { /* ... */ });
  it("prints every intersecting pair with the conflict kind named", () => { /* ... */ });
  it("prints the layers and the parallelism of each", () => { /* ... */ });
  it("prints the landing policy, the work branch name, and all nine up-front checks", () => { /* ... */ });

  it("prints the degradation warning next to the parallelism, not as a footnote", () => {
    // A warning in the wrong place is a warning nobody reads. The place a
    // person decides from is the parallelism line, so the sentence has to be
    // there.
    const out = renderPlanReport(gWithStarStar(), p, pf, { verbose: false });
    const lines = out.split("\n");
    const par = lines.findIndex((l) => l.includes("parallelism"));
    const warn = lines.findIndex((l) => l.includes("no parallelism"));
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(Math.abs(warn - par)).toBeLessThanOrEqual(2);
  });

  it("warns about an intersecting pair whose requiredChecks union is empty", () => {
    // Such a pair escalates on its first conflict instead of being reconciled,
    // and finding that out after an hour of running is the expensive way.
    expect(renderPlanReport(gEmptyChecks(), p, pf, { verbose: false })).toContain("would escalate");
  });

  it("states that a disjoint write set does not guarantee no conflict, next to the parallelism", () => {
    const out = renderPlanReport(g, p, pf, { verbose: false });
    expect(out).toContain("Disjoint does not guarantee no conflict");
  });

  it("never truncates a list with a 'more' marker", () => {
    // rtk's filtering layer taught this repo that a truncated list is the
    // worst of the three options: it looks complete. Summary plus a count is
    // honest; a full list under --verbose is complete; "[+N more]" is neither.
    const out = renderPlanReport(gManyConflicts(), p, pf, { verbose: true });
    expect(out).not.toMatch(/\+\d+ more/);
  });
});
```

```ts
// tests/scheduler/scenarios/S17.test.ts
it("S17: orca plan touches not one byte of the target repository", async () => {
  const s = await makeSandbox();
  try {
    const planPath = await seedTwoTaskPlan(s);
    const refsBefore = await allRefShas(s.targetRepo);
    const porcelainBefore = await porcelain(s.targetRepo);

    const rc = await runCli(["plan", planPath]);
    expect(rc).toBe(0);

    // Measured directly, not via `git diff | wc -c`: that comparison is blind
    // to content changes in untracked files — overwrite one and it reports
    // zero bytes both before and after.
    expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
    expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
  } finally { await s.cleanup(); }
});
```

- [ ] **Step 2–4:** 红 → 实现 → 绿。⚠️ **`plan` 必须复用 Task 2–4 的那三个函数，不许另写一份**（§9.4）。

- [ ] **Step 5: 点名变异**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| `M-PLAN-SE` 🔴 | 在 `plan` 路径里插一句 `git branch <W>` | **S17** | 红 |
| `M-PLAN-WARN` | 退化警告 | `prints the degradation warning next to the parallelism` | 红 |
| `M-PLAN-TRUNC` | 把列表改成截断成 `[+N more]` | `never truncates a list` | 红 |

- [ ] **Step 6: Commit** —— `feat(scheduler): add orca plan, the run's front half stopped before it executes`

---

## Task 6: 仓库锁（S21）＋ 运行时前置（S18／S19／S22）

**Files:** Create `src/scheduler/repoLock.ts`、`src/scheduler/preflight.ts`；Test 各一份 ＋ `scenarios/S21.test.ts`、`S22.test.ts`

**Interfaces:**
- `export async function acquireRepoLock(targetRepo: string): Promise<{ release(): Promise<void> }>` —— **抢不到就抛，不返回 null**
- `export interface PreflightReport { rejections: PlanRejection[] }`
- `export async function preflight(plan: PlanFile, defaultBranch: string): Promise<PreflightReport>`

- [ ] **Step 1: 判据**

```ts
it("S21: a second orca on the same target repo fails loudly and never enters W", async () => {
  const s = await makeSandbox();
  const first = await acquireRepoLock(s.targetRepo);
  try {
    // Failing loudly is the whole point. hermes degrades its lock to a no-op
    // on platforms without fcntl; rule 12 does not allow that, and mkdir has
    // no such degradation mode.
    await expect(acquireRepoLock(s.targetRepo)).rejects.toThrow(/already/i);

    // And it must not have got as far as touching the branch.
    expect(await refSha(s.targetRepo, "refs/heads/orca/w/x")).toBeNull();
  } finally { await first.release(); }
});

it("S22: a dirty target worktree is rejected up front", async () => {
  const s = await makeSandbox();
  try {
    await writeFile(join(s.targetRepo, "untracked.txt"), "x\n");
    const report = await preflight(await seedPlan(s), "main");
    expect(report.rejections.map((r) => r.code)).toContain("dirty-worktree");
  } finally { await s.cleanup(); }
});

it("S22b: dirtiness is measured with porcelain, which sees untracked files", () => {
  // git diff is blind to an untracked file's contents — overwrite one and it
  // reports zero bytes before and after. Since the scheduler checks out the
  // user's worktree on the main path, a check that cannot see untracked work
  // is a check that will lose someone's work.
  // (Asserted by S22 above using an untracked file specifically.)
});

it("S18: an existing workBranch is rejected rather than reused", async () => { /* ... */ });
it("S19: a base that is not a real commit is rejected", async () => { /* ... */ });
```

- [ ] **Step 2–4:** 红 → 实现（锁用 `mkdir(<targetRepo>/.git/orca-lock)` 非 recursive，`EEXIST` ⇒ 抛；
  锁目录里写 pid ＋ 时间，**仅供人读，不参与判定**）→ 绿

⚠️ **锁放 `.git/` 之内**：它不属于工作树内容 ⇒ 不会污染 `git status --porcelain`，
**而 S22 正是拿 porcelain 判干净的** —— 放在工作树里会让这两条互相打架。

- [ ] **Step 5: 点名变异**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| **`M-LOCK`** 🔴 | §1.2 第 3 条的仓库锁 | **S21** | 第二个 orca 进了同一个 W ⇒ 红 |
| **`M-DIRTY`** 🔴 | §4.2.1 的工作树干净检查 | **S22** | 在脏工作树上 checkout W ⇒ 红 |
| `M-LOCK-b` | 把抢不到锁改成「返回 null 然后继续跑」 | **S21** | 红（这正是 hermes 的退化档，Rule 12 不允许） |
| `M-WB-EXIST` | W 已存在的检查 | **S18** | 红 |
| `M-BASE` | 基点是真提交的检查 | **S19** | 红 |

- [ ] **Step 6: Commit** —— `feat(scheduler): one orca per target repo, and refuse to run on a dirty worktree`

---

## Task 7: run-id 分配（S15）

**Files:** Create `src/scheduler/runId.ts`；Test ＋ `scenarios/S15.test.ts`

**Interfaces:** `export async function allocateRunId(runsDir: string, taskId: string, contractBytes: Buffer, baseCommit: string): Promise<string>`

- [ ] **Step 1: 判据**

```ts
it("derives the same id from the same contract and base", async () => { /* ... */ });

it("S15: running the same plan twice allocates a fresh id instead of colliding", async () => {
  // A' section 3.1's guarantee — every agent writes only its own file, so
  // conflicts are structurally impossible — rests entirely on ids not
  // colliding. mkdir's atomicity is the arbiter; no database is introduced.
  const a = await allocateRunId(dir, "T1", bytes, base);
  const b = await allocateRunId(dir, "T1", bytes, base);
  expect(b).not.toBe(a);
  expect(b).toMatch(/-2$/);
});

it("steps past a directory left behind by a crashed earlier run", async () => {
  // EEXIST covers two cases at once: the id was taken this round, and an
  // earlier round died leaving a directory with data in it.
  await mkdir(join(dir, expectedId), { recursive: true });
  await writeFile(join(dir, expectedId, "loop-state.json"), "{}");
  expect(await allocateRunId(dir, "T1", bytes, base)).not.toBe(expectedId);
});
```

- [ ] **Step 2–4:** 红 → 实现（`mkdir` 非 recursive；`EEXIST` ⇒ `-2`、`-3` …）→ 绿

⚠️ **不要加 `.claims/` 旁路目录** —— spec §2.2.1 现测过：ccloop 的 `ensureFreshRunDir` 自己就是
`mkdir(recursive)`，**一个已存在的空目录不会被它拒**，所以 C 先占位不打架。

- [ ] **Step 5: 变异 `M-ID`** 🔴 —— 删掉 `EEXIST` 递增，喂 **S15**，期望红。

- [ ] **Step 6: Commit** —— `feat(scheduler): allocate run ids with mkdir's atomicity, no database`

---

## Task 8: 跑一个任务（clone ＋ spawn ＋ 读状态）

**Files:** Create `src/scheduler/ccloopRunner.ts`；Test ＋ `scenarios/S8.test.ts`、`S9.test.ts`

**Interfaces:**
- `export type CcloopOutcome = "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed"`
- `export interface TaskRun { runId: string; workdir: string; outcome: CcloopOutcome; attemptSha: string | null }`
- `export async function runTask(plan: PlanFile, task: PlanTask, base: string, runId: string): Promise<TaskRun>`

- [ ] **Step 1: 判据**

```ts
it("reads the terminal status from loop-state.json, not from the exit code", async () => {
  // ccloop's run/resume both return `status === "succeeded" ? 0 : 2`, which
  // flattens four distinct non-success terminal states into one number. Those
  // four route four different ways in section 6.1, so the exit code cannot be
  // the source of truth.
  const r = await runTask(planThatEndsBlocked(), t, base, id);
  expect(r.outcome).toBe("blocked_waiting_human");
});

it("rewrites the contract's repoPath to the per-task clone", async () => {
  // ccloop has no field for "start from this commit": worktree add --detach
  // takes no commit-ish, and the contract schema is .strict() with no base
  // ref. Controlling repoPath is therefore the only way to control the base,
  // and it is the entire reason for a clone per task.
  const r = await runTask(plan, t, base, id);
  expect(await headOf(join(r.workdir, "repo"))).toBe(base);
});

it("S8: a failed task marks its descendants upstream_not_run and lets other branches continue", async () => { /* ... */ });
it("S9: a blocked task escalates without counting as a failure, and siblings keep running", async () => { /* ... */ });
```

- [ ] **Step 2–4:** 红 → 实现 → 绿

⚠️ **`git clone --local` 走硬链接，对象库不复制，但工作树是真文件** ⇒ **默认删掉成功任务的副本**，
失败的留 ＋ 打印路径；`--keep-workdirs` 全留（§4.5）。
⚠️ **删一律 `/bin/rm -rf`**（G8）。

- [ ] **Step 5: 变异**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| `M-STATUS` 🔴 | 读 `loop-state.json`，改成只看退出码 | 读状态那条 ＋ **S9** | 红（四个终态全被压成一个） |
| `M-REPOPATH` 🔴 | 改写 `repoPath` | 改写那条 | 红 |
| `M-ROUTE` | §6.1 的四态路由（改成"非 succeeded 一律后代全 blocked"） | **S8 ＋ S9** | 红 |

- [ ] **Step 6: Commit** —— `feat(scheduler): run one task in its own clone and read its real terminal status`

---

## Task 9: 收产物 ＋ §7 双向事后核对（S5／S6／S7）

🔴 **spec §7 是 C 唯一的漂移检测手段，且只能在【付完钱之后】才发现。**

**Files:** Create `src/scheduler/harvest.ts`；Test ＋ `scenarios/S5.test.ts`、`S6.test.ts`、`S7.test.ts`

**Interfaces:**
- `export interface Reconciliation { actualPaths: string[]; outOfBounds: string[]; declaredNotProduced: string[]; empty: boolean }`
- `export async function harvest(run: TaskRun, base: string, declared: ClaimedPath[]): Promise<Reconciliation>`
- `export type Disposition = { land: true; exitContribution: 0 | 2 } | { land: false; exitContribution: 2 | 3 }`
- `export function disposition(r: Reconciliation, siblingWriteSets: Map<string, ClaimedPath[]>): Disposition`

- [ ] **Step 1: 判据**

```ts
it("measures the actual change set itself instead of consuming ccloop's changedFiles", async () => {
  // ccloop's collection is honest — it shells out to git status rather than
  // asking the model — but its entry point is called best effort, and a
  // best-effort measurement cannot carry a correctness argument. A diff
  // between two commits is deterministic: it fails loudly or it is right.
  const r = await harvest(run, base, declared);
  expect(r.actualPaths).toEqual(["src/a.ts"]);
});

it("S5: a task ccloop calls succeeded but whose tree equals the base does not land", async () => {
  // Direction two of the reconciliation, and the more common failure in this
  // repository's history: green that is empty. It is a failure (exit 2), not
  // a quiet success.
  const d = disposition(await harvest(emptyRun, base, declared), siblings);
  expect(d.land).toBe(false);
  expect(d.exitContribution).toBe(2);
});

it("S6: out-of-bounds writes that touch nobody else land anyway, with a boundary decision", async () => {
  // Declaring too narrowly is common and usually harmless; throwing the work
  // away would be enormous waste. The judgement goes in the ledger as tier 1.
  const d = disposition(outOfBoundsButDisjoint, siblings);
  expect(d.land).toBe(true);
  expect(d.exitContribution).toBe(2);
});

it("S7: out-of-bounds writes that intersect a sibling in the same layer refuse to land and escalate", async () => {
  // Only same-layer tasks start from the same W HEAD unable to see each other,
  // so only there can an out-of-bounds write silently break someone. A later
  // layer starts from a W that already contains this task's result: its
  // overlap becomes an ordinary merge conflict, which section 5 handles.
  const d = disposition(outOfBoundsIntersecting, siblings);
  expect(d.land).toBe(false);
  expect(d.exitContribution).toBe(3);
});

it("declared-but-not-produced is a warning and a ledger entry, never a failure", () => {
  // snakemake fails here, and it is right to: its outputs are rule-declared
  // and precise. targetPaths is a human-written intent range, usually written
  // wide. Applying a precise contract's strictness to a coarse one trains
  // people to write targetPaths as narrow as possible — which is the unsafe
  // direction in section 3.1.
  const d = disposition(partiallyProduced, siblings);
  expect(d.land).toBe(true);
  expect(d.exitContribution).toBe(0);
});
```

- [ ] **Step 2–4:** 红 → 实现（`git diff --name-only <base> <attemptSha>` 在副本里跑）→ 绿

- [ ] **Step 5: 点名变异 —— 四条，其中 `M-C` 是整节的存在性检查**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| **`M-A1`** 🔴 | §7.3 方向一的**相交**检查 | **S7** | 红 |
| **`M-A2`** 🔴 | §7.3 方向一的分档（改成一律照落地） | **S7** | 红 |
| **`M-B1`** 🔴 | §7.3 方向二的「净改动全空」检查 | **S5** | 红 |
| **`M-C`** 🔴🔴 | **把整个 §7 核对跳过** | **S5 ＋ S6 ＋ S7 全跑** | *** **若判据仍全绿 ⇒ 说明没有一条判据在量核对本身，本任务不算完成。** *** |

🔴 **`M-C` 必须真的跑，不许写成 `describe.skip`**（决策 D6）。它抓的不是某条分支，是**整节的存在性** ——
这是「同一个不变量查两遍」，snakemake 在 `dag.py` 查一次、`check_jobs` 里穷举再查一次，
**并在注释里写明第一道有覆盖洞**。

- [ ] **Step 6: Commit** —— `feat(scheduler): reconcile declared against actual in both directions`

---

## Task 10: 落地进 W（S14 default ref 不动）

**Files:** Create `src/scheduler/land.ts`；Test ＋ `scenarios/S14.test.ts`、`S1.test.ts`、`S2.test.ts`

**Interfaces:** `export async function landIntoW(plan: PlanFile, run: TaskRun): Promise<{ merged: true } | { merged: false; conflict: ConflictState }>`

- [ ] **Step 1: 判据**

```ts
it("S14: a whole run leaves the default branch ref byte-identical", async () => {
  // Asserted as behaviour, not as a source scan. "the word push must not
  // appear in src" is brittle — comments, strings and variable names all trip
  // it — and, worse, passing it does not mean the running code leaves the
  // branch alone.
  const s = await makeSandbox();
  try {
    const before = await refSha(s.targetRepo, "refs/heads/main");
    await runCli(["run", await seedTwoTaskPlan(s)]);
    expect(await refSha(s.targetRepo, "refs/heads/main")).toBe(before);
  } finally { await s.cleanup(); }
});

it("S1: two tasks with disjoint write sets both land and the run exits 0", async () => { /* ... */ });

it("S2: two tasks with intersecting write sets run serially and the ordering lands in the ledger", async () => {
  const s = await makeSandbox();
  try {
    const rc = await runCli(["run", await seedIntersectingPlan(s)]);
    expect(rc).toBe(0);
    // Read it back through the real validator, from the real file on W —
    // hand-made fixtures are what let .strict() reject seven real decisions
    // while thirty-four criteria stayed green.
    const lines = await readLedgerOnBranch(s.targetRepo, "orca/w/x");
    expect(lines.every((l) => validateLine(l).verdict === "ok")).toBe(true);
    expect(lines.some((l) => JSON.parse(l).kind === "scheduling")).toBe(true);
  } finally { await s.cleanup(); }
});
```

- [ ] **Step 2–4:** 红 → 实现（`git fetch <副本> <sha>:refs/orca/<run-id>` → `git merge --no-ff`）→ 绿

⚠️ **主仓必须先 `checkout` 到 W** —— 这是 §4.2.1 那条「C 会碰人的现场」的兑现，
**Task 6 的 S22 干净检查是它唯一的护栏**。

- [ ] **Step 5: 变异 `M-MAIN`** 🔴 —— 删掉 default ref 断言（并故意 checkout default），喂 **S14**，期望红。

- [ ] **Step 6: Commit** —— `feat(scheduler): land each task into the work branch, one at a time`

---

## Task 11: 冲突主干（一）—— 物化、和解契约、两道拒绝（S4／S20）

**Files:** Create `src/scheduler/reconcile.ts`（前半）；Test ＋ `scenarios/S4.test.ts`、`S20.test.ts`

**Interfaces:**
- `export interface ConflictState { copyPath: string; conflictCommit: string; wTip: string; incomingRef: string; blocks: ConflictBlock[] }`
- `export function synthesizeReconcileContract(a: PlanTask, b: PlanTask, contracts: Map<string, unknown>, runsDir: string): { path: string } | { escalate: string }`
- `export function requiredChecksUnion(a: unknown, b: unknown): string[]`

- [ ] **Step 1: 判据**

```ts
it("materialises the conflict as a commit, because a fresh worktree cannot show it", async () => {
  // ccloop opens a clean detached worktree, and conflict state lives in the
  // index, not in any commit — so an agent spawned the ordinary way sees
  // nothing to reconcile. Committing the conflicted tree turns the markers
  // into ordinary text the agent can read.
  const c = await materialiseConflict(copy, wTip, incomingRef);
  expect(await showFile(copy, c.conflictCommit, "src/a.ts")).toContain("<<<<<<<");
});

it("S20: a reconciliation contract that names only one side's taskId is refused, and the run escalates", () => {
  // "Not the conflicting party" cannot be enforced by process boundaries — it
  // is the same model, possibly the same context. What can be enforced is the
  // context it is given: a contract carrying only one side's goal is, by
  // construction, the conflicting party's view. That difference is mechanical,
  // so it is a check.
  const r = synthesizeReconcileContract(a, b, contractsMissingOneSide, runsDir);
  expect("escalate" in r).toBe(true);
});

it("writes the synthesized contract into runsDir, outside the target repo", () => {
  // Which is why it needs no exception to section 2.3's up-front rejection.
  const r = synthesizeReconcileContract(a, b, contracts, runsDir);
  expect("path" in r && r.path.startsWith(runsDir)).toBe(true);
});

it("S4: an empty requiredChecks union refuses automatic reconciliation and escalates", () => {
  // Both sides declaring no checks makes the union empty, so any reconciliation
  // "passes" — green that is empty, and automatically generated at that.
  expect(requiredChecksUnion(noChecks, noChecks)).toEqual([]);
  expect(planReconciliation(noChecks, noChecks).escalate).toBe(true);
});
```

- [ ] **Step 2–4:** 红 → 实现 → 绿

- [ ] **Step 5: 变异**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| **`M-RECON`** 🔴 | §5.2 的「和解契约必须引用两个 taskId」检查 | **S20** | 当事任务被派去解自己的冲突 ⇒ 红 |
| **`M-EMPTYCHK`** 🔴 | §5.3 的并集为空检查 | **S4** | 和解"成功"通过 ⇒ 红 |

- [ ] **Step 6: Commit** —— `feat(scheduler): materialise a conflict as a commit and synthesize the reconciliation contract`

---

## Task 12: 冲突主干（二）—— `commit-tree` 重构 ＋ `bound` 时序

🔴 **spec 点名「§5.2 第 4 步是本节最脆的实现点」与「§8.3 极易踩反」。两处代码完整给出，不许发挥。**

**Files:** `src/scheduler/reconcile.ts`（后半）、`src/scheduler/ledgerWiring.ts`；Test ＋ `scenarios/S3.test.ts`

**Interfaces:**
- `export async function rebuildMergeCommit(copy: string, wTip: string, incomingRef: string, reconciledTree: string, message: string): Promise<string>`
- `export async function writeBoundThenCommit(copy: string, decisionIds: string[], taskId: string, runId: string, build: () => Promise<string>): Promise<string>`

- [ ] **Step 1: 判据 —— 直接量结果，不量过程**

```ts
it("rebuilds a merge commit whose two parents are exactly the W tip and the incoming ref", async () => {
  // Hand-constructing git history is the most fragile step in this design, so
  // the criterion measures the object that comes out rather than the sequence
  // of commands that made it.
  const sha = await rebuildMergeCommit(copy, wTip, incomingRef, tree, "merge");
  const parents = (await git(copy, ["rev-list", "--parents", "-n", "1", sha])).split(" ").slice(1);
  expect(parents).toEqual([wTip, await git(copy, ["rev-parse", incomingRef])]);
  expect(await git(copy, ["rev-parse", `${sha}^{tree}`])).toBe(tree);
});

it("the conflicted commit never reaches W", async () => {
  const refs = await allRefShas(targetRepo);
  expect(Object.values(refs)).not.toContain(conflictCommit);
});

it("S3: tasks that declared disjoint write sets but actually collided are reconciled and land, exit 0", async () => {
  // This is the load-bearing scenario of the whole design: the write-set
  // criterion is an optimisation, and the system has to be correct when it is
  // wrong. Section 3.4's third rule — no code path may assume "the criterion
  // said they would not collide" — is what M-OPT deletes.
  const s = await makeSandbox();
  try {
    const rc = await runCli(["run", await seedLyingPlan(s)]);
    expect(rc).toBe(0);
    const lines = await readLedgerOnBranch(s.targetRepo, "orca/w/x");
    expect(lines.some((l) => JSON.parse(l).kind === "reconcile")).toBe(true);
    expect(lines.every((l) => validateLine(l).verdict === "ok")).toBe(true);
  } finally { await s.cleanup(); }
});

it("the bound line is blamed to the merge commit itself, not to the commit after it", async () => {
  // The natural way to write this is "merge, then record" — and it is wrong in
  // a way that stays green: the bound line lands on the *next* commit, so
  // `git blame` answers with the wrong commit and nothing notices. The tree of
  // a commit-tree commit is fixed at construction, so the ledger line has to
  // be in the tree before the commit is built.
  const merge = await runS3AndGetMergeCommit();
  const blamed = await blameCommitOfLine(targetRepo, ".decisions/<orca-run>.jsonl", boundLineNumber);
  expect(blamed).toBe(merge);
});
```

- [ ] **Step 2: 跑，确认红**

- [ ] **Step 3: 实现 —— 两段完整代码**

```ts
/**
 * The conflicted commit exists only so an agent can see the markers as text.
 * What lands on W has to be an ordinary merge commit with correct parents, so
 * it is rebuilt from the reconciled tree rather than reused. Attribution on W
 * stays clean, and the conflicted commit stays behind in the copy.
 */
export async function rebuildMergeCommit(
  copy: string, wTip: string, incomingRef: string, reconciledTree: string, message: string,
): Promise<string> {
  const incoming = (await git(copy, ["rev-parse", incomingRef])).trim();
  const sha = await git(copy, [
    "-c", "user.name=orca", "-c", "user.email=orca@invalid",
    "commit-tree", reconciledTree, "-p", wTip, "-p", incoming, "-m", message,
  ]);
  return sha.trim();
}

/**
 * A' section 3.3 puts the bound line in the commit that implements the
 * decision, and `git blame` on that line is how "which commit implemented it"
 * is answered. A commit-tree commit's tree is fixed the instant it is built,
 * so writing the ledger line afterwards puts it on the following commit — the
 * blame answer is then wrong, and every test still passes. Hence: write the
 * line into the tree, then build.
 */
export async function writeBoundThenCommit(
  copy: string, decisionIds: string[], taskId: string, runId: string, build: () => Promise<string>,
): Promise<string> {
  for (const id of decisionIds) {
    await appendEvent(join(copy, ".decisions"), runId, { ev: "bound", id, taskId, runId });
  }
  await git(copy, ["add", "-A", ".decisions"]);
  // build() reads the index/tree that now contains the bound lines.
  return await build();
}
```

- [ ] **Step 4: 跑，确认绿 ＋ verify exit 0**

- [ ] **Step 5: 点名变异**

| 变异 | 删掉什么 | 喂它的场景 | 期望 |
|---|---|---|---|
| **`M-TREE`** 🔴 | §5.2 第 4 步的 parent／tree 断言（并故意构造 parent 错的 merge commit） | **S3** | 红 |
| **`M-BOUND`** 🔴 | §8.3 的时序（把两步调换：先 build 再写 `bound`） | **S3** | `bound` 行的 blame ≠ 那笔 merge commit ⇒ 红 |
| **`M-OPT`** 🔴 | 加一条「不相交就跳过合并冲突检查」 | **S3** | 红 |

🔴 **`M-OPT` 是 spec 明写「最容易被实现者顺手优化掉的一条」。** 做这条变异时**先确认那条捷径真的被插进了执行路径**
（临时 `throw` 一下看是不是走到），否则你测的是一段死码。

- [ ] **Step 6: Commit** —— `feat(scheduler): rebuild a correct merge commit, with the bound line already in its tree`

---

## Task 13: 台账接线（§8）＋ 退出码归约（§6.3）

**Files:** `src/scheduler/ledgerWiring.ts`（其余）、`src/scheduler/exitCode.ts`；Test 各一份

**Interfaces:**
- `export type ExitContribution = 0 | 1 | 2 | 3`
- `export function reduceExitCode(contributions: ExitContribution[]): ExitContribution`

- [ ] **Step 1: 判据**

```ts
describe("reduceExitCode (spec 6.3)", () => {
  it("is 3 whenever anything escalated, even alongside a failure", () => {
    // Written down because otherwise "a failure and an escalation in the same
    // run" is undefined. 2 means "this path is dead, read the log"; 3 means
    // "a person has to come back and do something". Demoting 3 to 2 makes that
    // errand vanish into a pile of failures; the reverse just reminds twice.
    expect(reduceExitCode([2, 3, 0])).toBe(3);
    expect(reduceExitCode([3, 2])).toBe(3);
  });

  it("is 2 when something failed and nothing escalated", () => {
    expect(reduceExitCode([0, 2, 0])).toBe(2);
  });

  it("has no mode in which a task failed and the run still exits 0", () => {
    // nextflow's IGNORE strategy exits 0 by default and needs an opt-in flag
    // to do otherwise. There is no --ignore-failures here, not one.
    expect(reduceExitCode([0, 2])).not.toBe(0);
  });

  it("is 0 only when everything succeeded and landed", () => {
    expect(reduceExitCode([0, 0])).toBe(0);
  });
});

describe("ledger wiring (spec 8.0)", () => {
  it("writes a task's own decisions into that task's copy and C's decisions onto W", async () => { /* ... */ });

  it("gives the two kinds different filenames, so A' section 3.1 still holds", async () => {
    // Per-agent files are what makes conflicts structurally impossible; N
    // copies of the target repo do not break that as long as the names differ.
    expect(taskLedgerName).not.toBe(orchestratorLedgerName);
  });

  it("records ccloop's HEAD and version in each decision's evidence", async () => {
    // A' section 9.1 asks for an npm dependency with a locked version, which
    // ccloop cannot satisfy today (private: true, bin pointing at an unbuilt
    // dist). Recording which ccloop this round actually ran on pins the fact
    // reproduction needs, which is what locking a version was for.
    const d = decisionsWrittenBy(runResult);
    expect(d[0].evidence?.join(" ")).toMatch(/[0-9a-f]{40}/);
  });
});
```

- [ ] **Step 2–4:** 红 → 实现 → 绿
- [ ] **Step 5: 变异 `M-EXIT`** 🔴 —— 把 `3 > 2` 的优先级反过来，喂「is 3 whenever anything escalated」，期望红。
- [ ] **Step 6: Commit** —— `feat(scheduler): wire the ledger and pin the exit-code precedence at 3 > 2 > 1 > 0`

---

## Task 14: 剩余场景（S10／S11／S12／S13／S16／S18／S19）＋ `--serial`

**Files:** `tests/scheduler/scenarios/` 补齐；`src/scheduler/run.ts` 加 `--serial`

- [ ] **Step 1: 判据**

```ts
it("S10: the same plan run serially and in parallel both pass the union of both requiredChecks", async () => {
  // Not byte-identical: the two orderings legitimately produce different
  // content, because an implicit edge has no natural direction. What has to
  // hold is that both results pass both sides' checks — that is what "the
  // parallelism is an optimisation" means operationally.
  const s = await makeSandbox();
  try {
    const p = await seedIntersectingPlan(s);
    expect(await runCli(["run", p, "--serial"])).toBe(0);
    expect(await runChecksOnBranch(s.targetRepo, "orca/w/x", unionChecks)).toBe(0);
    const s2 = await makeSandbox();
    expect(await runCli(["run", await seedIntersectingPlan(s2)])).toBe(0);
    expect(await runChecksOnBranch(s2.targetRepo, "orca/w/x", unionChecks)).toBe(0);
  } finally { await s.cleanup(); }
});

it("S16: a change larger than ten megabytes is not a silent success", async () => {
  // The patch path's maxBuffer is 10MB and its error handling returns an empty
  // string for any git failure other than exit code 1 — so an oversized change
  // used to arrive as "no changes at all". Reading the commit instead removes
  // that channel, and this scenario is what proves it removed.
  const d = await harvest(runWithHugeChange, base, declared);
  expect(d.empty).toBe(false);
  expect(d.actualPaths.length).toBeGreaterThan(0);
});

it("S11/S12/S13: each up-front rejection exits 1 with the target repo untouched", async () => { /* per code */ });
```

- [ ] **Step 2–4:** 红 → 实现 → 绿
- [ ] **Step 5:** 变异 `M-SERIAL`（让 `--serial` 实际仍并行）喂 **S10**，期望红。
- [ ] **Step 6: Commit** —— `feat(scheduler): add --serial and close the remaining scenarios`

---

## Task 15: 收尾 —— 变异总表复跑、verify 分档、台账、README

- [ ] **Step 1: 🔴 把 §10.3 的 14 条变异【全部重跑一遍】**

**代码改了以后，之前跑过的变异要重跑**（ccloop 铁律 6）。逐条留档到 `/tmp/p2-mut-<name>.txt` 并整份读回。

```
M-LOCK  M-ID  M-TRIE  M-OPT  M-RECON  M-EMPTYCHK  M-TREE
M-A1  M-A2  M-B1  M-C  M-BOUND  M-MAIN  M-DIRTY
```

**逐条填一张表：变异 → 喂它的场景 → 看到红的那条判据名 → 输出文件路径。**
🔴 **任何一条填不出「看到红的那条判据名」，就是缺证据，本任务不算完成。**

- [ ] **Step 2: 量 `verify` 的耗时，按 §10.1 分档**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/time -p npm run verify > /tmp/p2-verify-time.txt 2>&1; echo "RC=$?"; cat /tmp/p2-verify-time.txt
```

⚠️ **若慢到影响 pre-commit，正确处理是分档（`verify` vs `verify:fast`）并写明哪一档在门上，
【不是】把它从 `verify` 里拿掉**（spec §10.1 原文）。**只报 `time` 打印出来的数**（Rule 14）。

- [ ] **Step 3: 本轮决策落台账 ＋ 三条具名偏离**

用 `appendEvent` 落 `.decisions/orca-dev-<本会话 id>.jsonl`。**除本计划的 6 条决策外，另有三条 spec 已声明的具名偏离必须进台账**：

| 偏离 | 对谁 | kind |
|---|---|---|
| spawn 子进程而非 npm 依赖（§1.4） | A′ §9.1 | `dependency` |
| 两层身份对 A′ §3.0「run-id 全局唯一且稳定」的澄清（§2.1） | A′ §3.0 | `interface` |
| §1.2 第 4 条「只看退出码」的更正（§6.0 现测） | 本 spec 早期草稿 | `criteria` |

- [ ] **Step 4: README 一节** —— `orca plan` / `orca run` 的用法、plan 文件的形状、九条当场拒、
  退出码 0/1/2/3 的含义、**以及 §10.4 那 12 条已知缺口**（**照抄，不删减**）。

- [ ] **Step 5: 最终验证 ＋ Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p2-final.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p2-final.txt
/usr/bin/git status --short
```

**不 push。**

---

## Self-Review

### 1. Spec 覆盖

| spec 节 | 落在哪 |
|---|---|
| §1.2 第 3 条 单进程锁 | Task 6（S21 / `M-LOCK`） |
| §1.4 spawn 子进程 ＋ 记 ccloop HEAD 进 evidence | Task 8 ＋ Task 13（evidence 判据）＋ Task 15 Step 3（具名偏离进台账） |
| §2.1 两层身份 | Task 7 ＋ Task 15 Step 3 |
| §2.2 run-id 分配 ＋ §2.2.1 不加 `.claims/` | Task 7（S15 / `M-ID`） |
| §2.3 六条当场拒 | Task 2（S13／S11／S12） |
| §2.4 图 ＋ 隐式边进台账 | Task 4 |
| §2.4.1 契约在目标仓外 | Task 2 ＋ Task 1 harness 判据 |
| §3.1 写集定义 | Task 3 |
| §3.2 字典树三种冲突 | Task 3（`M-TRIE`） |
| §3.3 归一化三档 ＋ 保留原始声明 | Task 3（`M-NORM` / `M-DECL`） |
| §3.4 第 3 条「不许以判据为前提做简化」 | Task 12（S3 / `M-OPT`） |
| §3.5 `--serial` | Task 14（S10 / `M-SERIAL`） |
| §4.2 五条当场拒（两条 plan 层 ＋ 三条运行时） | Task 2 ＋ Task 6（S18／S19／S22） |
| §4.2.1 工作树干净 | Task 6（`M-DIRTY`）＋ Task 10（checkout W 的护栏） |
| §4.3 六步 | Task 8 ＋ Task 9 ＋ Task 10 |
| §4.4 收产物（消费 P0 的 ref） | Task 9 ＋ Task 1 Step 1 的前置核对 |
| §4.5 default ref 不动、副本留删、`/bin/rm -rf` | Task 10（S14 / `M-MAIN`）＋ Task 8 |
| §5.0–§5.4 冲突主干 | Task 11 ＋ Task 12 |
| §5.5 每块判断进台账（`reconcile` kind） | Task 12（S3 判据里断言有 `reconcile`） |
| §6.0–§6.2 读 `loop-state.json` ＋ 四态路由 ＋ 两个自有终态 | Task 8（`M-STATUS` / `M-ROUTE`）＋ Task 9（`succeeded_but_empty`） |
| §6.3 退出码 3>2>1>0 | Task 13（`M-EXIT`） |
| §6.4 `blocked_waiting_human` 不可 resume | Task 8（S9 走 C 自己的升人，不调 ccloop resume） |
| §6.5 `succeeded_but_empty` 一律失败 | Task 9（S5） |
| §7.0–§7.4 双向核对 | Task 9（`M-A1`／`M-A2`／`M-B1`／`M-C`） |
| §8.0–§8.2 两类台账 ＋ 走 `appendEvent` | Task 13 |
| §8.3 `bound` 先写树再 `commit-tree` | Task 12（`M-BOUND`） |
| §8.4 squash 三条准备 | ①③是消费侧，**不在 P2**（归 E）；**②由 P1 落地** |
| §8.5 `ledgerMode` | Task 2 的 schema。⚠️ **`out-of-repo` 的实现登记为缺口，见下** |
| §8.6 记账提交污染 W | v1 接受，无需任务 |
| §9.1–§9.5 `orca plan` | Task 5（S17） |
| §10.1 判据接进 `verify` | Task 1（**先装门**）＋ Task 15 Step 2（分档） |
| §10.2 22 个场景 | S1／S2 Task 10；S3 Task 12；S4／S20 Task 11；S5／S6／S7 Task 9；S8／S9 Task 8；S10／S11／S12／S13／S16 Task 14；S14 Task 10；S15 Task 7；S17 Task 5；S18／S19／S21／S22 Task 6 |
| §10.3 14 条点名变异 | 逐条分布如上，**Task 15 Step 1 全部重跑并填表** |
| §10.4 12 条已知缺口 | Task 15 Step 4 照抄进 README |

**缺口三处，如实登记**：

1. **`ledgerMode: out-of-repo` 只到 schema，未实现** —— spec §8.5 自己写它继承 A′ §3.7 自陈的弱点
   （无不可变锚点）。**Task 2 接受这个值，Task 13 遇到它当场拒 exit 1** ——
   *** **认得但未实现 ⇒ 当场拒，不静默降级**，与 `policy: rebase` 同款处理。 ***
2. **§8.4 的 ①（squash 启发式检测）与 ③（索引器降级标 `ambiguous`）不在 P2** —— 它们是消费侧，归子系统 E。
3. **`M-TRIE-c`（只删一个诊断名）是一条不可观测的变异** —— 见 Task 3 Step 5 的登记。
   spec §3.2 自己就预告了这一点（「变异要点在判定上，不是点在两个名字上」）。

### 2. 占位符扫描

已扫。以下**故意**留空，且都写明了填法与理由：

1. **常规胶水代码的实现体** —— 由「关于本计划体例的声明」那一节统一说明：判据完整、承重代码完整、
   胶水给签名。**这是划界，不是 TBD**；spec 点名"最脆／最易踩反"的四处代码都完整给出了。
2. 判据里的 `/* ... */` —— 出现在**场景骨架**里，紧邻的判据名与注释已经写明它要断言什么；
   **执行者按同一文件里已给出的完整同类判据照写**。
3. Task 15 Step 3 的 run-id `<本会话 id>` —— 必须是执行时的真 id。
4. Task 1 Step 3 的 `resolveCcloopBin()` —— **明确要求现测**（ccloop 是 `private: true` ＋ `bin` 指向未构建的 `dist/`）。
5. Task 3 的 `c(...)`、Task 4 的 `plan(...)` / `contracts(...)` 等判据 helper ——
   **在各自判据文件顶部现写**，形状由紧邻的调用点唯一确定。

### 3. 类型一致

- `ClaimedPath { normalized, declared }` 在 Task 3 定义，Task 4／5／9 全部按这两个名字用。✅
- `PathConflict { kind, a, b }` 与 `ConflictKind` 三个字面量在 Task 3 定义，Task 4／5 引用一致。✅
- `PlanFile` / `PlanTask` 在 Task 2 定义，Task 4／5／6／8 的签名全部吃它。✅
- `CcloopOutcome` 五个字面量 = spec §6.0 的五个终态，**与 ccloop `RunStatus` 的终态子集逐字一致**。✅
- `TaskRun { runId, workdir, outcome, attemptSha }` 在 Task 8 定义，Task 9／Task 10 消费。✅
- `ExitContribution` 是 `0|1|2|3`；`Disposition.exitContribution` 用的是它的子集，**类型上兼容**。✅
- `appendEvent(decisionsDir, runId, event)` 在 Task 12／13 的调用与 P1 落地后的签名一致。✅
- `bound` 事件带 `taskId` ＋ `runId` —— Task 12 的 `writeBoundThenCommit` 里两个字段都在，**与 P1 的必需字段对齐**。✅
- **`refs/ccloop/<run-id>/attempts/<n>`** 的形状与 P0 的 `attemptRefName` 逐字一致。✅
- **`refs/orca/<run-id>`**（C 自己的）与上面**是两个不同的命名空间**，不会互撞。✅

---

## 归属

本计划由 run `orca-dev-10762e47` 于 2026-09-03 写下，基点是主题行
`docs(handoff): continue this round's section with the review and the proposal` 那一笔。
spec 的全部引用基于 Orca `43bcb96`；ccloop 侧的实测观测点是它自己的
`0f7fc28e8bdc573ba22840d3c7e00e25d8927b17`（spec 与提案里标注的那个），
已核 `0f7fc28..7caa4cb` 之间 `src/**` 与 `scripts/**` 零改动 ⇒ 那些实测仍然有效。
⚠️ **所有行号引用前必须现测。**
