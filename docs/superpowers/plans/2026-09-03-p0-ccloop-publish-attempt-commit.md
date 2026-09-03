# P0：让 ccloop 的 attempt 交出一笔可达的 commit —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ccloop 的每一次 attempt 在 worktree 被销毁之前留下一笔**可达的 commit**，使下游（Orca 的子系统 C）能拿到确定性的产物，而不是一个会静默转空的 patch。

**Architecture:** 在 `src/workspace/worktreeManager.ts` **新增**一个 `publishAttemptCommit(worktreePath)`：在 attempt worktree 里 `git add -A` → `git commit --allow-empty` → `git update-ref refs/ccloop/<run-id>/attempts/<n>`。attempt worktree 与 `repoPath` **共用同一个对象库**，所以 commit 对象本来就在那儿了，缺的只是可达性 —— 写 ref 就是整个改动的全部机关。再把它接进 `runLoop.ts` 里**已经存在的两个 cleanup 收敛点**，使 12 个调用点全部覆盖。`diff.patch` 一个字节不动。

**Tech Stack:** TypeScript / Node ≥ 20 / vitest / `node:child_process` 的 `execFile`（本仓库既有惯例，见 `src/workspace/worktreeManager.ts:1-6`）。

**Spec:** `/Users/biran/code/skills/loop/Orca/docs/superpowers/specs/2026-09-03-scheduler-design.md` §4.4、§7.5、§10.5
**提案（一页背景）:** `/Users/biran/code/skills/loop/Orca/docs/superpowers/proposals/2026-09-03-ccloop-p0-publish-attempt-commit.md`

⚠️ **本计划写在 Orca 仓库，但它要执行的改动全部落在 ccloop 仓库**
（`/Users/biran/code/skills/loop/ccloop`）。**执行时守 ccloop 自己的 `CLAUDE.md` 与铁律，不守 Orca 的。**

---

## Global Constraints

以下每一条都是 ccloop 自己的规则或本计划开工时的现测值，**每个任务的要求都隐含包含本节**。

| # | 约束 | 出处 |
|---|---|---|
| G1 | **测试基线 `35 files / 614 tests`，零 skipped。** 本计划只允许这个数**增加**，不允许任何一条既有判据被改写或删除 | ccloop handoff「最近一次会话（2026-08-28）实测基线」 |
| G2 | **跑测试前必须 `export ECC_GATEGUARD=off DISABLE_OMC=1`** | ccloop handoff「先跑这些」 |
| G3 | **绝不过滤验证性跑。** `grep`/`tail`/`head`/`sed` 都算过滤，管道还会吞退出码 ⇒ 一律**重定向到文件再整份读回**，并核 vitest 第一行 `RUN` 指向的路径 | ccloop 铁律 7 |
| G4 | **不许实施者自改既有判据。** 需要新覆盖时先问「能不能只加不改」 | ccloop 铁律 2 |
| G5 | **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰；还原证明用 `shasum -a 256` 前后比对，**不要用 `git diff` 管道到 `wc -c` 的那套**（Orca 实测：`git diff` 对未跟踪文件的内容改动完全看不见） | ccloop 铁律 6 ＋ Orca 2026-09-01/02 现测 |
| G6 | **`clone --local` 只克隆【已提交】状态。** 要测未提交的改动，必须先 `cat 工作树文件 > 副本对应文件` 再变异，并用 `diff` 证明逐字节相同 | ccloop 铁律 6 |
| G7 | **本机 `rm` 和 `cp` 都有 `-i` alias** ⇒ 一律用 `/bin/rm -rf` 和 `cat pristine > target` | ccloop「踩过的坑」1 |
| G8 | **一条变异在被【看到】打红之前，它不是证明。** 每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被看见红 | ccloop「踩过的坑」5 |
| G9 | **push／合并／删分支或 worktree 每次都要人单独授权。控制器不许 push。** 本计划全程不 push | ccloop 铁律 1 |
| G10 | **已知 flake 4 条**（都是 `Test timed out in 5000ms`）：`run-scenario CLI > records env names only and tracks descendants rooted at the spawned pid`、`runLoop > persists phase usage evidence from the subprocess adapter without recomputing controller totals`、`runLoop > accounts an execute timeout that rejects after the abort as exhaustion`、`run-scenario CLI > fails on an existing run directory without creating evidence or harvesting stale run data`。**看到红先核是不是这四条 ＋ 是不是超时 ＋ 总耗时是否异常**（红的那轮 ~25–29s，绿的 17–22s） | ccloop handoff 基线节 |
| G11 | **不碰 E1 的 I-2 ＋ 人裁 85 那一轮的任何东西**；不动 `fileStore.ts` 的红线函数 `tryRecoverStaleOwnerTransferLock` | ccloop handoff「下一件事」 |
| G12 | 代码、注释、commit message **一律英文**；本计划正文中文 | Orca 2026-09-01／09-02 语言约定 |

---

## 开工前必须先现测的三件事（**不许照抄本计划的行号**）

本计划所有 ccloop 实测的**观测时点是 2026-09-03，ccloop `main` tip `7caa4cb`**
（主题行 `docs(handoff): stop pinning a hard HEAD in the Orca section`）。
已核：`git diff --stat 0f7fc28 7caa4cb -- src scripts tests` **输出为空** ⇒ `src/**` 与 `scripts/**` 自 `0f7fc28` 起零触碰。

- [ ] **Step A：核对远端与工作树**

```bash
cd /Users/biran/code/skills/loop/ccloop
{ /usr/bin/git ls-remote origin refs/heads/main
  /usr/bin/git log --oneline -3
  /usr/bin/git status --short
  /usr/bin/git worktree list
} > /tmp/p0-open.txt 2>&1; echo "RC=$?"; cat /tmp/p0-open.txt
```

⚠️ **验证性 git 命令走裸 `/usr/bin/git`，不走 rtk** —— Orca 实测 `rtk proxy git log --oneline -N` **会漏掉 HEAD 那一笔**。

- [ ] **Step B：核对本计划引用的三个锚点还在不在**

```bash
cd /Users/biran/code/skills/loop/ccloop
{ echo "--- worktreeManager 全文（应为 31 行）"; cat -n src/workspace/worktreeManager.ts
  echo "--- cleanup 的调用点普查"
  /usr/bin/grep -rn "cleanupAttemptWorkspace" src/ | /usr/bin/grep -v "\.test\."
} > /tmp/p0-anchors.txt 2>&1; cat /tmp/p0-anchors.txt
```

**期望看到**（2026-09-03 现测）：

| 事实 | 值 |
|---|---|
| `cleanupAttemptWorkspace` 的定义 | `src/workspace/worktreeManager.ts:29`，函数体**只有一行** `git worktree remove --force` |
| `createAttemptWorkspace` 造出的路径 | `join(runDir, "worktrees", "attempt-" + attempt)`（`:18`） |
| 调用点总数 | **12 个**：`runLoop.ts` 11 个 ＋ `resumeLoop.ts:139` 1 个 |
| 其中走 `cleanupAttemptWorkspaceWithStatus`（`runLoop.ts:331`）的 | **11 个**（`cleanupAttemptWorkspaceBestEffort` 只是它的一层薄包装，`runLoop.ts:350`） |
| **不走**它的 | *** **1 个：`runLoop.ts:1494` 的裸调用** ***（verification rejected 之后的重试路径） |

🔴 **这张表是本计划成立的全部理由。** 若现测与它不符，**停下来报给人，不要照本计划往下做** ——
调用点变了意味着"两个收敛点覆盖 12 个"这个前提不再成立，而**半改比不改坏**（ccloop 历轮教训：第一轮改 12 漏 6）。

- [ ] **Step C：跑一次基线并留档**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run > /tmp/p0-baseline.txt 2>&1; echo "TEST_RC=$?"
npm run typecheck > /tmp/p0-typecheck.txt 2>&1; echo "TYPECHECK_RC=$?"
npm run build > /tmp/p0-build.txt 2>&1; echo "BUILD_RC=$?"
cat /tmp/p0-baseline.txt
```

期望 `35 files / 614 tests` 零 skipped、三个 RC 全 0。**记下实际数字，后续每次比对都用它，不用本文写的 614。**

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/workspace/worktreeManager.ts` | attempt worktree 的生命周期。**本计划把「发布 attempt commit」也放这里** —— 它和 `createAttemptWorkspace`／`cleanupAttemptWorkspace` 是同一件事的三个阶段，一起改一起读 | **Modify**（纯追加：新增 2 个导出 ＋ 1 个常量 ＋ 1 个私有函数；既有两个函数一字不动） |
| `src/controller/runLoop.ts` | 循环控制器。**只改两处**：`cleanupAttemptWorkspaceWithStatus`（:331）里加一次发布；`:1494` 的裸调用换成新包装 | **Modify**（`:331-348` 与 `:1494` 两处） |
| `tests/workspace/worktreeManager.test.ts` | 发布机制本身的单元判据 | **Modify**（只加，不改既有那条 `creates and removes a detached worktree`） |
| `tests/controller/runLoop.integration.test.ts` | 「重试路径也发布」的行为判据 | **Modify**（只加） |
| `README.md` | ref 命名空间、堆积代价、消费方式 | **Modify**（追加一节） |

⚠️ **明确不碰**：`src/persistence/fileStore.ts`（红线函数在里面，G11）、`src/runtime/**`（两个 adapter）、
`src/policy/pathPolicy.ts`、`src/contract/schema.ts`、状态机、退出码、租约／心跳／owner-transfer／`unlock`、
`scripts/claude-phase-runner.mjs`（`diff.patch` 的采集路径原样保留）。

---

## 本计划自己做的 4 条决策（**都落进 Orca 的台账，不在 ccloop 里做记录**）

| # | 决策 | 为什么 | 撤销 |
|---|---|---|---|
| **D1** | **发布逻辑放进 `worktreeManager.ts`，不放进 `fileStore.ts`** | 提案第 3 节第 4 步写的是「把 sha 报进 `attempts/<n>/` 的产物」，而 `attempts/<n>/` 是 `fileStore.ts` 的地盘（`:1726`），红线函数也在那个文件里（G11）。**改用 ref 本身当产物** ⇒ Orca 用 `git for-each-ref refs/ccloop/<run-id>/` 就能取，`base` 就是 `<sha>^`，**一个新文件都不用写，fileStore 零触碰** | `git checkout <基点> -- src/workspace/worktreeManager.ts` |
| **D2** | **接进 `cleanupAttemptWorkspaceWithStatus` ＋ 换掉 `:1494` 的裸调用**，不去 12 个调用点各改一次 | 12 个里 11 个是错误路径的 best-effort 清理。逐点改＝12 处机会漏掉一处，而 ccloop 自己的教训是「**半改比不改坏**」 | 同上 ＋ `git checkout <基点> -- src/controller/runLoop.ts` |
| **D3** | **空 attempt 也 commit（`--allow-empty`）** | 提案 §6.3 明说「两种做法都可以，但要选一个并写明」。选 `--allow-empty` 的理由：**让「跑成功了但什么也没干」可见**。有 sha ＋ 空 diff ≠ 没有 sha，后者才是采集失败 —— 这个区分正是 Orca §7 核对要的东西 | 去掉 `--allow-empty` 一个 flag |
| **D4** | **提交身份用 `-c user.name=ccloop -c user.email=ccloop@invalid` 显式传，不依赖环境里的 git config** | 目标仓库可能没配 `user.email`（一次性沙盒仓、CI 容器都常见），那样 `git commit` 会失败 ⇒ **发布在最该工作的场景下静默不工作** | 去掉那四个参数 |

⚠️ **D1 是对提案的一处实质偏离**（提案写「新字段，或一个新的小文件」，本计划选"都不要"）。
*** **人 2026-09-03 已裁决按 D1 执行**，见本文末尾裁决 1。 ***

---

## Task 1: `publishAttemptCommit` —— 提交 attempt worktree 并写 ref

**Files:**
- Modify: `src/workspace/worktreeManager.ts`（在 `:27` 之后、`:29` 的 `cleanupAttemptWorkspace` 之前插入）
- Test: `tests/workspace/worktreeManager.test.ts`（只加 `it(...)`，既有那条一字不动）

**Interfaces:**
- Consumes: 既有的 `createAttemptWorkspace(repoPath, runDir, attempt) => { worktreePath }`、`cleanupAttemptWorkspace(repoPath, worktreePath) => Promise<void>`
- Produces:
  - `export interface AttemptCommit { sha: string; base: string; ref: string }`
  - `export function attemptRefName(worktreePath: string): string`
  - `export async function publishAttemptCommit(worktreePath: string): Promise<AttemptCommit>` —— **失败时抛，不吞**

- [ ] **Step 1: 写下会红的判据（五条，一次写完）**

追加到 `tests/workspace/worktreeManager.test.ts`。先在文件顶部把 import 补齐：

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  attemptRefName,
  cleanupAttemptWorkspace,
  createAttemptWorkspace,
  publishAttemptCommit,
} from "../../src/workspace/worktreeManager.js";
```

然后追加：

```ts
/**
 * Seeds a real git repo plus one attempt worktree. `configureIdentity` is a
 * parameter, not a constant, because one of the criteria below is precisely
 * that publishing works in a repo where no identity is configured — the
 * shape a throwaway sandbox repo or a CI container actually has.
 */
async function seedRepoAndWorktree(configureIdentity: boolean): Promise<{ repoDir: string; worktreePath: string }> {
  const repoDir = await mkdtemp(join(tmpdir(), "ccloop-p0-repo-"));
  const runDir = await mkdtemp(join(tmpdir(), "ccloop-p0-run-"));

  await execFileAsync("git", ["init"], { cwd: repoDir });
  if (configureIdentity) {
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
  }
  await writeFile(join(repoDir, "README.md"), "hello\n");
  await execFileAsync("git", ["-c", "user.name=seed", "-c", "user.email=seed@invalid", "add", "README.md"], { cwd: repoDir });
  await execFileAsync("git", ["-c", "user.name=seed", "-c", "user.email=seed@invalid", "commit", "-m", "init"], { cwd: repoDir });

  const { worktreePath } = await createAttemptWorkspace(repoDir, runDir, 1);
  return { repoDir, worktreePath };
}

describe("publishAttemptCommit", () => {
  it("keeps the attempt commit reachable through a ref after the worktree is removed", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    await writeFile(join(worktreePath, "README.md"), "changed by the agent\n");

    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    // The ref is the only load-bearing assertion here. `git cat-file -e <sha>`
    // would stay green with no ref at all — the object lingers in the shared
    // object store until a gc that this test never runs. Asserting on the ref
    // is what makes deleting the update-ref call go red (mutation M0-1).
    const { stdout } = await execFileAsync("git", ["rev-parse", published.ref], { cwd: repoDir });
    expect(stdout.trim()).toBe(published.sha);
    expect(published.ref).toMatch(/^refs\/ccloop\/.+\/attempts\/1$/);
  });

  it("captures a modification to a tracked file in the published commit", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    await writeFile(join(worktreePath, "README.md"), "changed by the agent\n");

    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", published.base, published.sha],
      { cwd: repoDir },
    );
    expect(stdout.trim().split("\n")).toEqual(["README.md"]);
  });

  it("captures a file the agent created but never added", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    await writeFile(join(worktreePath, "brand-new.txt"), "untracked\n");

    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    const { stdout } = await execFileAsync(
      "git",
      ["show", `${published.sha}:brand-new.txt`],
      { cwd: repoDir },
    );
    expect(stdout).toBe("untracked\n");
  });

  it("captures a binary file byte for byte", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    // Bytes chosen to include a NUL and a high byte so git classifies the blob
    // as binary. This is the case `diff.patch` provably cannot carry: its two
    // `git diff` invocations have no --binary, so a binary change lands as
    // "Binary files a/x and b/x differ", which `git apply` cannot apply.
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00, 0x42]);
    await writeFile(join(worktreePath, "blob.bin"), bytes);

    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    const extracted = join(await mkdtemp(join(tmpdir(), "ccloop-p0-out-")), "blob.bin");
    await execFileAsync("sh", ["-c", `git show ${published.sha}:blob.bin > ${extracted}`], { cwd: repoDir });
    expect(await readFile(extracted)).toEqual(bytes);
  });

  it("publishes in a repository that has no git identity configured", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(false);
    await writeFile(join(worktreePath, "README.md"), "changed by the agent\n");

    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    const { stdout } = await execFileAsync("git", ["rev-parse", published.ref], { cwd: repoDir });
    expect(stdout.trim()).toBe(published.sha);
  });

  it("publishes a sha even when the agent changed nothing", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    // Deliberately no writes. An attempt that reports success while producing
    // an empty tree is a named failure downstream; it can only be named if it
    // is distinguishable from "publishing failed", and a present sha with an
    // empty diff is exactly that distinction.
    const published = await publishAttemptCommit(worktreePath);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    const { stdout: refOut } = await execFileAsync("git", ["rev-parse", published.ref], { cwd: repoDir });
    expect(refOut.trim()).toBe(published.sha);

    const { stdout: diffOut } = await execFileAsync(
      "git",
      ["diff", "--name-only", published.base, published.sha],
      { cwd: repoDir },
    );
    expect(diffOut.trim()).toBe("");
  });
});

describe("attemptRefName", () => {
  it("refuses a path that is not an attempt worktree", () => {
    expect(() => attemptRefName("/tmp/some-run/worktrees/scratch")).toThrow(/not an attempt worktree path/);
  });
});
```

- [ ] **Step 2: 跑，确认它红，且红在「导入不存在」上**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/workspace/worktreeManager.test.ts > /tmp/p0-t1-red.txt 2>&1; echo "RC=$?"
cat /tmp/p0-t1-red.txt
```

期望：**非 0**，报 `publishAttemptCommit` / `attemptRefName` 不是导出成员。
⚠️ **既有那条 `creates and removes a detached worktree` 也会一起红**（整个文件导入失败）—— 这是正常的，Step 4 会看到它回绿。

- [ ] **Step 3: 写最小实现**

在 `src/workspace/worktreeManager.ts` 顶部把 `basename` / `dirname` 补进既有的 path import：

```ts
import { basename, dirname, join } from "node:path";
```

在 `createAttemptWorkspace` 之后、`cleanupAttemptWorkspace` 之前插入：

```ts
/**
 * Author and committer are passed per-invocation instead of read from the
 * environment: the repositories this runs against are frequently throwaway
 * clones or CI checkouts with no user.email set, where `git commit` fails
 * outright. Depending on ambient config would make publishing break in
 * exactly the setups it exists to serve.
 */
const ATTEMPT_IDENTITY = ["-c", "user.name=ccloop", "-c", "user.email=ccloop@invalid"];

export interface AttemptCommit {
  /** The commit the attempt produced. */
  sha: string;
  /** The commit the worktree was created at, i.e. sha's parent. */
  base: string;
  /** The ref that makes sha reachable after the worktree is gone. */
  ref: string;
}

/**
 * Derived from the worktree path alone, because that is the only handle every
 * cleanup call site already holds. createAttemptWorkspace builds the path as
 * <runDir>/worktrees/attempt-<n>, so the run id is the run directory's
 * basename and <n> is the leaf's suffix.
 */
export function attemptRefName(worktreePath: string): string {
  const leaf = basename(worktreePath);
  const match = /^attempt-(.+)$/.exec(leaf);
  if (match === null) {
    throw new Error(`not an attempt worktree path: ${worktreePath}`);
  }
  const runId = basename(dirname(dirname(worktreePath)));
  return `refs/ccloop/${runId}/attempts/${match[1]}`;
}

/**
 * Commits whatever the attempt left in its worktree and pins it with a ref.
 *
 * The worktree shares an object database with repoPath, so the commit object
 * is already in the right store the moment it is written; the ref is what
 * stops it from being unreachable once `git worktree remove` runs. That single
 * `update-ref` is the whole mechanism — everything else here is bookkeeping.
 *
 * Throws on any failure. Callers decide whether a failed publish is fatal;
 * this function does not swallow, because a silently unpublished attempt is
 * indistinguishable downstream from an attempt that changed nothing.
 */
export async function publishAttemptCommit(worktreePath: string): Promise<AttemptCommit> {
  const ref = attemptRefName(worktreePath);

  const { stdout: baseOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
  const base = baseOut.trim();

  await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
  await execFileAsync(
    "git",
    [...ATTEMPT_IDENTITY, "commit", "--allow-empty", "-m", `ccloop attempt: ${ref}`],
    { cwd: worktreePath },
  );

  const { stdout: shaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
  const sha = shaOut.trim();

  await execFileAsync("git", ["update-ref", ref, sha], { cwd: worktreePath });

  return { sha, base, ref };
}
```

- [ ] **Step 4: 跑，确认全绿**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/workspace/worktreeManager.test.ts > /tmp/p0-t1-green.txt 2>&1; echo "RC=$?"
npm run typecheck > /tmp/p0-t1-tc.txt 2>&1; echo "TYPECHECK_RC=$?"
cat /tmp/p0-t1-green.txt
```

期望 RC=0，该文件 **1（既有）＋ 7（新增）= 8 条**全绿。

- [ ] **Step 5: 点名变异 —— 四条，每条都必须【被看到】打红**

⚠️ **一律在 `git clone --local` 副本里做，主工作树零触碰**（G5）。
⚠️ **副本只含已提交状态**（G6）⇒ 先把本任务尚未提交的两个文件覆盖过去，并用 `diff` 证明逐字节相同。

```bash
cd /Users/biran/code/skills/loop/ccloop
/bin/rm -rf /tmp/p0-mut && /usr/bin/git clone --local . /tmp/p0-mut > /tmp/p0-clone.txt 2>&1; echo "RC=$?"
cat src/workspace/worktreeManager.ts   > /tmp/p0-mut/src/workspace/worktreeManager.ts
cat tests/workspace/worktreeManager.test.ts > /tmp/p0-mut/tests/workspace/worktreeManager.test.ts
diff src/workspace/worktreeManager.ts /tmp/p0-mut/src/workspace/worktreeManager.ts && echo "SRC_IDENTICAL"
diff tests/workspace/worktreeManager.test.ts /tmp/p0-mut/tests/workspace/worktreeManager.test.ts && echo "TEST_IDENTICAL"
( cd /tmp/p0-mut && npm ci ) > /tmp/p0-mut-install.txt 2>&1; echo "INSTALL_RC=$?"
```

| 变异 | 怎么改（在 `/tmp/p0-mut/src/workspace/worktreeManager.ts`） | 必须红的那条判据 |
|---|---|---|
| **M0-1** | *** **删掉 `await execFileAsync("git", ["update-ref", ref, sha], …)` 整行** *** | `keeps the attempt commit reachable through a ref after the worktree is removed` ＋ `publishes in a repository that has no git identity configured` |
| **M0-2** | 删掉 `await execFileAsync("git", ["add", "-A"], …)` 整行 | `captures a file the agent created but never added` ＋ `captures a binary file byte for byte`（`captures a modification to a tracked file` 会**不红** —— `git commit` 不带 `-a`，已跟踪文件的改动同样进不去，但断言是 `["README.md"]` 对空数组… **实际会红**，跑出来为准，不要靠推理） |
| **M0-3** | 去掉 `"--allow-empty"` 这一个参数 | `publishes a sha even when the agent changed nothing` |
| **M0-4** | 把 `...ATTEMPT_IDENTITY,` 从 commit 的参数数组里删掉 | `publishes in a repository that has no git identity configured` |

每条按这个循环做（**逐条做，做完还原再做下一条**）：

```bash
cd /tmp/p0-mut
export ECC_GATEGUARD=off DISABLE_OMC=1
# 1) 改一处
# 2) 跑，整份读回
npm test -- --run tests/workspace/worktreeManager.test.ts > /tmp/p0-M0-N.txt 2>&1; echo "RC=$?"
cat /tmp/p0-M0-N.txt
# 3) 还原
/usr/bin/git checkout -- src/workspace/worktreeManager.ts 2>/dev/null || cat /Users/biran/code/skills/loop/ccloop/src/workspace/worktreeManager.ts > src/workspace/worktreeManager.ts
```

⚠️ *** **`git checkout -- <本任务刚创建、尚未提交的文件>` 会报 `pathspec did not match` 且什么都不还原。** ***
本任务改的是**已提交的**文件，`checkout` 可用；但**它是从索引恢复，不是从 HEAD** —— 若副本里 `git add` 过就会恢复出坏的那份。
⇒ **稳妥做法一律是 `cat 主树文件 > 副本文件`**，再 `diff` 证明。

- [ ] **Step 6: 证明主工作树零触碰，并删掉副本**

```bash
cd /Users/biran/code/skills/loop/ccloop
shasum -a 256 src/workspace/worktreeManager.ts tests/workspace/worktreeManager.test.ts > /tmp/p0-after.txt
diff /tmp/p0-mut/src/workspace/worktreeManager.ts src/workspace/worktreeManager.ts && echo "COPY_MATCHES_TREE"
cat /tmp/p0-after.txt
/bin/rm -rf /tmp/p0-mut
```

⚠️ **删副本前先做「副本判据文件 vs 工作树判据文件」的字节比对**（ccloop 铁律 6）。

- [ ] **Step 7: 跑全量，确认没碰坏别的**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run > /tmp/p0-t1-full.txt 2>&1; echo "TEST_RC=$?"
npm run typecheck > /tmp/p0-t1-tc2.txt 2>&1; echo "TYPECHECK_RC=$?"
npm run build > /tmp/p0-t1-build.txt 2>&1; echo "BUILD_RC=$?"
cat /tmp/p0-t1-full.txt
```

期望 `35 files`、测试数 = Step C 的基线 **+7**、零 skipped、三个 RC 全 0。
⚠️ **看到红先核 G10 那四条 flake。**

- [ ] **Step 8: Commit**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git add src/workspace/worktreeManager.ts tests/workspace/worktreeManager.test.ts
/usr/bin/git commit -m "feat(worktree): publish each attempt as a commit reachable through a ref

The attempt worktree shares an object database with the source repository,
so the commit object is already in the right store the moment it is written.
Without a ref it is unreachable as soon as the worktree is removed, which is
why update-ref is the whole mechanism rather than an extra bookkeeping step.

diff.patch is untouched: it stays the human-readable evidence. This adds a
machine-readable one alongside it."
```

**不 push**（G9）。

---

## Task 2: 接进 11 个调用点共用的收敛点

**Files:**
- Modify: `src/controller/runLoop.ts:331-348`（`cleanupAttemptWorkspaceWithStatus`）
- Test: `tests/workspace/worktreeManager.test.ts`（发布失败不阻断移除的那条，放这里因为它测的是 worktreeManager 的契约）

**Interfaces:**
- Consumes: Task 1 的 `publishAttemptCommit(worktreePath) => Promise<AttemptCommit>`；既有的 `appendEvent(runDir, {type, at, detail})`（`runLoop.ts:327` 已在用）
- Produces: 新事件类型 `attempt_commit_published` 与 `attempt_commit_publish_failed`，写进 `runDir` 的 `events.jsonl`

- [ ] **Step 1: 写下会红的判据**

追加到 `tests/workspace/worktreeManager.test.ts`：

```ts
describe("publishAttemptCommit failure surface", () => {
  it("throws instead of returning a sentinel when the worktree is gone", async () => {
    const { repoDir, worktreePath } = await seedRepoAndWorktree(true);
    await cleanupAttemptWorkspace(repoDir, worktreePath);

    // Removing the worktree first is the cheapest real failure: the cwd no
    // longer exists, so `git rev-parse HEAD` cannot run. The point of the
    // assertion is the shape of the failure, not this particular cause —
    // a publish that fails must be loud, because a silently unpublished
    // attempt reads downstream exactly like an attempt that did nothing.
    await expect(publishAttemptCommit(worktreePath)).rejects.toThrow();
  });
});
```

⚠️ **拿 rejection 一律用 `rejects`，不要用 `.catch(e => e)`** —— ccloop 实测：promise 成功时 `.catch(e => e)` 给出 `undefined`，让三条断言全在断言 `undefined`（「踩过的坑」5）。

追加到 `tests/controller/runLoop.integration.test.ts`（**判据名与既有风格一致，不改任何既有判据**）：

```ts
it("removes the attempt worktree even when publishing the attempt commit fails", async () => {
  // Wiring publish ahead of removal must not turn a publish failure into a
  // leaked worktree: eleven of the twelve cleanup call sites are error paths
  // that already ran best-effort, and a throw there would strand a worktree
  // that nothing else will ever clean up.
  const { runDir, repoPath, worktreePath } = await seedRunWithLiveAttemptWorktree();

  // Make publishing fail without making removal fail: an unwritable refs
  // directory blocks update-ref while `git worktree remove` still works.
  await chmod(join(repoPath, ".git", "refs"), 0o500);
  try {
    await cleanupAttemptWorkspaceBestEffort(repoPath, worktreePath, runDir, "test");
  } finally {
    await chmod(join(repoPath, ".git", "refs"), 0o700);
  }

  const { stdout } = await execFileAsync("git", ["worktree", "list"], { cwd: repoPath });
  expect(stdout).not.toContain(worktreePath);

  const events = (await readFile(join(runDir, "events.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((l) => JSON.parse(l).type as string);
  expect(events).toContain("attempt_commit_publish_failed");
});
```

⚠️ **`seedRunWithLiveAttemptWorktree` 若该文件里没有同类 helper，就照该文件既有的 seeding 方式现写一个** ——
**开工第一步是把 `tests/controller/runLoop.integration.test.ts` 整份读回，照它的惯例来**，不要照抄本计划的 helper 名。

- [ ] **Step 2: 跑，确认它红**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/workspace/worktreeManager.test.ts tests/controller/runLoop.integration.test.ts > /tmp/p0-t2-red.txt 2>&1; echo "RC=$?"
cat /tmp/p0-t2-red.txt
```

期望：integration 那条红在 `expected [...] to contain 'attempt_commit_publish_failed'`。
**要量什么就直接量什么** —— 若它红在别的断言上（比如 worktree 还在列表里），**说明前面的断言先短路了，先把它拆开单测**（ccloop「踩过的坑」／方法论 1）。

- [ ] **Step 3: 写最小实现**

`src/controller/runLoop.ts` 的 import 加上 `publishAttemptCommit`（`:46` 那一行）：

```ts
import { cleanupAttemptWorkspace, createAttemptWorkspace, publishAttemptCommit } from "../workspace/worktreeManager.js";
```

把 `cleanupAttemptWorkspaceWithStatus`（`:331`）改成：

```ts
async function cleanupAttemptWorkspaceWithStatus(
  repoPath: string,
  worktreePath: string,
  runDir: string,
  detail: string,
): Promise<ExecutionRecovery["cleanupStatus"]> {
  // Publishing has to happen before removal — after `git worktree remove` the
  // commit has no ref and no worktree, and there is nothing left to publish.
  // It is deliberately not fatal: eleven of the twelve call sites reach here
  // on an error path where the worktree must come off regardless, so a failed
  // publish is recorded as an event and the removal proceeds. The event is
  // what keeps this from being a swallow: absence of a ref plus absence of an
  // event would be indistinguishable from an attempt that was never run.
  try {
    const published = await publishAttemptCommit(worktreePath);
    await appendEvent(runDir, {
      type: "attempt_commit_published",
      at: new Date().toISOString(),
      detail: `${published.ref} ${published.sha}`,
    });
  } catch (error) {
    await appendEvent(runDir, {
      type: "attempt_commit_publish_failed",
      at: new Date().toISOString(),
      detail: `${detail}: ${String(error)}`,
    });
  }

  try {
    await cleanupAttemptWorkspace(repoPath, worktreePath);
    return "removed";
  } catch (error) {
    await appendEvent(runDir, {
      type: "workspace_cleanup_failed",
      at: new Date().toISOString(),
      detail: `${detail}: ${String(error)}`,
    });
    return "retained";
  }
}
```

⚠️ **既有的那个 `try/catch` 与两个返回值 `"removed"`／`"retained"` 一字不动** —— 它们是 11 个调用点读的契约。

- [ ] **Step 4: 跑，确认绿**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/workspace/worktreeManager.test.ts tests/controller/runLoop.integration.test.ts > /tmp/p0-t2-green.txt 2>&1; echo "RC=$?"
cat /tmp/p0-t2-green.txt
```

- [ ] **Step 5: 点名变异（两条）**

副本流程同 Task 1 Step 5（G5／G6／G7 全部适用）。

| 变异 | 怎么改 | 必须红的那条 |
|---|---|---|
| **M0-5** | 把发布那段的 `try { … } catch { … }` 去掉，只留 `const published = await publishAttemptCommit(worktreePath);` | `removes the attempt worktree even when publishing the attempt commit fails` |
| **M0-6** | 把发布整段**删掉** | 同上（`attempt_commit_publish_failed` 不再出现） |

🔴 **M0-6 是「删掉它自己」的那条**（G8）。**必须亲眼看到它红**，不许写"我知道它会红"。

- [ ] **Step 6: 全量 ＋ 主树零触碰证明 ＋ Commit**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run > /tmp/p0-t2-full.txt 2>&1; echo "TEST_RC=$?"
npm run typecheck > /tmp/p0-t2-tc.txt 2>&1; echo "TYPECHECK_RC=$?"
npm run build > /tmp/p0-t2-build.txt 2>&1; echo "BUILD_RC=$?"
cat /tmp/p0-t2-full.txt
/usr/bin/git add src/controller/runLoop.ts tests/workspace/worktreeManager.test.ts tests/controller/runLoop.integration.test.ts
/usr/bin/git commit -m "feat(runLoop): publish the attempt commit before the worktree is removed

Wired into cleanupAttemptWorkspaceWithStatus, the one function eleven of the
twelve cleanup call sites already funnel through. A failed publish records an
event and lets the removal proceed: most of those call sites are error paths
where stranding a worktree would be the worse failure."
```

期望测试数 = 基线 **+9**。

---

## Task 3: 覆盖第 12 个调用点（重试路径）

**Files:**
- Modify: `src/controller/runLoop.ts:1494`
- Test: `tests/controller/runLoop.integration.test.ts`（只加）

**Interfaces:**
- Consumes: Task 2 的 `cleanupAttemptWorkspaceWithStatus`
- Produces: `cleanupAttemptWorkspaceOrThrow(repoPath, worktreePath, runDir, detail): Promise<void>` —— 发布照做，**移除失败仍然抛**（保住 `:1494` 现有的语义：清理失败 ⇒ run 判 `failed`）

- [ ] **Step 1: 写下会红的判据**

```ts
it("publishes a ref for an attempt that was rejected at verification", async () => {
  // This is the twelfth cleanup call site — the retry path at runLoop.ts:1494,
  // the only one that does not go through cleanupAttemptWorkspaceWithStatus.
  // It is also the most interesting attempt for a downstream consumer: a
  // rejected attempt still changed files, and those changes are exactly what
  // someone needs to see to understand why it was rejected.
  const { runDir, repoPath, runId } = await runLoopThatRejectsItsFirstAttempt();

  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--format=%(refname)", `refs/ccloop/${runId}/attempts/`],
    { cwd: repoPath },
  );
  expect(stdout.trim().split("\n")).toContain(`refs/ccloop/${runId}/attempts/1`);
});
```

⚠️ **`runLoopThatRejectsItsFirstAttempt` 要按该文件既有的 scripted-adapter 驱动方式现写** ——
**开工第一步整份读回 `tests/controller/runLoop.integration.test.ts`**，找到它现成的「让 verify 判 rejected」的构造方式，照抄那一套。

- [ ] **Step 2: 跑，确认红**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/controller/runLoop.integration.test.ts > /tmp/p0-t3-red.txt 2>&1; echo "RC=$?"
cat /tmp/p0-t3-red.txt
```

- [ ] **Step 3: 写最小实现**

在 `runLoop.ts` 的 `cleanupAttemptWorkspaceBestEffort`（`:350`）旁边新增：

```ts
/**
 * The retry path needs a removal failure to stay fatal — it turns the run into
 * `failed` — so it cannot use the best-effort wrapper. It still needs the
 * publish, though, and routing it through here rather than calling
 * cleanupAttemptWorkspace directly is what keeps "publish precedes every
 * removal" true of all twelve call sites instead of eleven of them.
 */
async function cleanupAttemptWorkspaceOrThrow(
  repoPath: string,
  worktreePath: string,
  runDir: string,
  detail: string,
): Promise<void> {
  try {
    const published = await publishAttemptCommit(worktreePath);
    await appendEvent(runDir, {
      type: "attempt_commit_published",
      at: new Date().toISOString(),
      detail: `${published.ref} ${published.sha}`,
    });
  } catch (error) {
    await appendEvent(runDir, {
      type: "attempt_commit_publish_failed",
      at: new Date().toISOString(),
      detail: `${detail}: ${String(error)}`,
    });
  }

  await cleanupAttemptWorkspace(repoPath, worktreePath);
}
```

把 `:1494` 那一行：

```ts
          await cleanupAttemptWorkspace(contract.context.repoPath, worktreePath);
```

改成：

```ts
          await cleanupAttemptWorkspaceOrThrow(
            contract.context.repoPath,
            worktreePath,
            runDir,
            "cleanup after verification rejected",
          );
```

⚠️ **包住它的那个 `try/catch`（`:1493-1505`）一字不动** —— 它把清理失败转成 `failed` 的语义必须保持原样。
⚠️ **按【整行锚点 ＋ 命中数 ==1 否则退出】改**，不要用子串替换（ccloop「踩过的坑」2）。先跑一次确认唯一：

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/grep -c '^          await cleanupAttemptWorkspace(contract.context.repoPath, worktreePath);$' src/controller/runLoop.ts
```

**必须打印 `1`。不是 1 就停下来报人。**

- [ ] **Step 4: 跑，确认绿**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run tests/controller/runLoop.integration.test.ts > /tmp/p0-t3-green.txt 2>&1; echo "RC=$?"
cat /tmp/p0-t3-green.txt
```

- [ ] **Step 5: 点名变异（一条）**

| 变异 | 怎么改 | 必须红的那条 |
|---|---|---|
| **M0-7** | 把 `:1494` 改回裸的 `await cleanupAttemptWorkspace(contract.context.repoPath, worktreePath);` | `publishes a ref for an attempt that was rejected at verification` |

🔴 这条证明的是「**第 12 个调用点真的被这条判据喂到了**」。
上一轮 spec 评审抓到过三条**没有任何场景喂它们**的变异（`M-LOCK`／`M-BOUND`／`M-TREE`）——
**这一条不许重蹈：跑之前先确认这条判据确实走的是 `:1494` 那条路**（在实现里临时 `throw` 一下，看它是不是红在这条判据上，看完还原）。

- [ ] **Step 6: 全量 ＋ Commit**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run > /tmp/p0-t3-full.txt 2>&1; echo "TEST_RC=$?"
npm run typecheck > /tmp/p0-t3-tc.txt 2>&1; echo "TYPECHECK_RC=$?"
npm run build > /tmp/p0-t3-build.txt 2>&1; echo "BUILD_RC=$?"
cat /tmp/p0-t3-full.txt
/usr/bin/git add src/controller/runLoop.ts tests/controller/runLoop.integration.test.ts
/usr/bin/git commit -m "feat(runLoop): publish on the retry path too, the twelfth cleanup call site

The verification-rejected path is the one cleanup call site that does not go
through cleanupAttemptWorkspaceWithStatus, because a removal failure there has
to stay fatal. It is also the attempt a reader most wants to inspect."
```

期望测试数 = 基线 **+10**。

---

## Task 4: 回归证明 ＋ README

**Files:**
- Modify: `README.md`
- Test: `tests/workspace/worktreeManager.test.ts`（`diff.patch` 未受影响的回归判据）

**Interfaces:**
- Consumes: Task 1–3 的全部产物
- Produces: 无新接口。本任务的产物是**证据**。

- [ ] **Step 1: 证明 `diff.patch` 一个字节没变**

```bash
cd /Users/biran/code/skills/loop/ccloop
{ echo "--- claude-phase-runner.mjs 是否被动过（应为空）"
  /usr/bin/git diff --stat <本计划开工时的基点> HEAD -- scripts/
  echo "--- fileStore.ts 是否被动过（应为空）"
  /usr/bin/git diff --stat <本计划开工时的基点> HEAD -- src/persistence/
  echo "--- 本计划总共改了哪些文件"
  /usr/bin/git diff --stat <本计划开工时的基点> HEAD
} > /tmp/p0-t4-scope.txt 2>&1; cat /tmp/p0-t4-scope.txt
```

**期望**：前两项**空输出**；第三项**只有 5 个文件**（`worktreeManager.ts`、`runLoop.ts`、两个测试文件、`README.md`）。
**多出任何一个文件都要停下来解释。**

- [ ] **Step 2: 跑最终全量，三个 RC 都留档**

```bash
cd /Users/biran/code/skills/loop/ccloop
export ECC_GATEGUARD=off DISABLE_OMC=1
npm test -- --run > /tmp/p0-final-test.txt 2>&1; echo "TEST_RC=$?"
npm run typecheck > /tmp/p0-final-tc.txt 2>&1; echo "TYPECHECK_RC=$?"
npm run build > /tmp/p0-final-build.txt 2>&1; echo "BUILD_RC=$?"
cat /tmp/p0-final-test.txt
```

期望 `35 files`、测试数 = 基线 **+10**、**零 skipped**、三个 RC 全 0。
⚠️ **报数只报这份文件里打印出来的数**（G3 ＋ ccloop 铁律 8）。

- [ ] **Step 3: 写 README 一节**

追加到 `README.md`：

````markdown
## Attempt commits

Every attempt publishes its worktree as a commit before the worktree is
removed, and pins it with a ref:

```
refs/ccloop/<run-id>/attempts/<n>
```

`<run-id>` is the basename of the run directory; `<n>` matches the
`attempts/<n>/` artifact directory. The base the attempt started from is the
commit's first parent, so a consumer can ask what an attempt changed with:

```bash
git for-each-ref --format='%(refname) %(objectname)' 'refs/ccloop/<run-id>/attempts/'
git diff --name-only <sha>^ <sha>
```

An attempt that changed nothing still gets a commit (`--allow-empty`), so a
present ref with an empty diff means "the agent did nothing" while a missing
ref means "publishing failed" — the run's `events.jsonl` carries
`attempt_commit_published` or `attempt_commit_publish_failed` for each.

`attempts/<n>/diff.patch` is unchanged and remains the human-readable
evidence. It is not the machine-readable one: its two `git diff` invocations
carry no `--binary`, and their error handling returns an empty string for any
git failure other than exit code 1.

### Known costs

- **Refs accumulate.** One ref per attempt, never cleaned up by ccloop —
  deleting refs is irreversible and therefore needs a human (ironclad rule 1).
  `git for-each-ref refs/ccloop/` gets long on a repository with many runs.
- **The object database grows.** Attempt changes used to vanish with the
  worktree; now a ref holds them against gc.
- **Ignored files are not captured.** `git add -A` honours `.gitignore`,
  so an agent's changes to ignored paths are absent from the commit.
- **Temporary files are captured.** Anything the agent leaves in the worktree
  goes into the commit. `diff.patch` already collects those too, so this is
  not new, but it is worth knowing.
````

⚠️ **README 是活文档，但它写的每个结构性断言都必须来自实测** —— 上面每一条都由 Task 1–3 的判据钉住。

- [ ] **Step 4: Commit**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git add README.md
/usr/bin/git commit -m "docs(readme): document the attempt commit refs and what they cost"
```

**不 push。** 要 push **单独找人**（G9）。

---

## Self-Review

### 1. Spec 覆盖

| spec／提案要求 | 落在哪 |
|---|---|
| §4.4 第 1 步 `git add -A` | Task 1 Step 3 |
| §4.4 第 2 步 `git commit`，message 带 run-id 与 attempt 序号 | Task 1 Step 3（message 是 `ccloop attempt: refs/ccloop/<run-id>/attempts/<n>`，两者都在里面） |
| §4.4 第 3 步 **在 remove 之前**写 ref | Task 1 Step 3 ＋ Task 2／Task 3 的接线；判据 `keeps the attempt commit reachable…`；变异 M0-1 |
| §4.4 第 4 步 把 sha 报进产物 | **有意偏离（决策 D1）**：改用 ref 本身当产物 ＋ `events.jsonl` 里的两条事件。*** **人 2026-09-03 已裁决按此执行**（本文末尾裁决 1）。 *** |
| §4.4「`diff.patch` 原样保留」 | Task 4 Step 1（`scripts/` 与 `src/persistence/` 的 diff 必须为空） |
| §4.4「一处改动同时管 scripted 与 claude 两条路」 | 由 D1／D2 天然满足：发布在 worktree 里做，不经过 adapter 返回值。**Task 1 的判据全部不涉及 adapter，即为证据** |
| 提案 §5「可达性」判据 | Task 1 Step 1 第 1 条 |
| 提案 §5「内容正确」判据 | Task 1 Step 1 第 2 条 |
| 提案 §5「未跟踪文件进去了」 | Task 1 Step 1 第 3 条 |
| 提案 §5「二进制进去了」 | Task 1 Step 1 第 4 条 |
| 提案 §5「既有行为不变」 | Task 4 Step 1 ＋ Step 2 |
| 提案 §5 点名的那条变异（删 `update-ref`） | **M0-1** |
| 提案 §6.3「空 attempt 要选一种做法并写明」 | 决策 D3 ＋ Task 1 Step 1 第 6 条 ＋ 变异 M0-3 ＋ README |
| 提案 §6.1／§6.2／§6.4 的三条已知代价 | README「Known costs」四条（多写了一条 gitignore） |
| 提案 §4「明确不改什么」 | 本计划 File Structure 的「明确不碰」 ＋ Task 4 Step 1 的机械核对 |

**缺口一处，如实登记**：提案 §5 那条「`git diff --name-only <基点> <sha>` 与同一轮 `git status --porcelain` 采到的改动集一致」
—— 本计划**没有**为它单独立判据。理由：`git status --porcelain` 那一路只在 `claude` adapter 的 `readDiffPatch` 里跑，
为它建判据要拉进 `scripts/claude-phase-runner.mjs`，**与「那个文件零触碰」冲突**。
Task 1 的第 2／3／4 条从**内容**这一侧覆盖了同一个关切。**这是有意的取舍，不是遗漏。**

### 2. 占位符扫描

已扫。三处**故意**留空，且都写明了填法，不是占位符：

1. Task 4 Step 1 的 `<本计划开工时的基点>` —— 它必须是执行时现测的值，写死就会过期。
2. Task 2 Step 1 的 `seedRunWithLiveAttemptWorktree`、Task 3 Step 1 的 `runLoopThatRejectsItsFirstAttempt` ——
   **明确要求先整份读回 `tests/controller/runLoop.integration.test.ts` 照它的惯例现写**。
   写死一个 helper 名反而会让执行者以为它已经存在。
3. 变异循环里的 `/tmp/p0-M0-N.txt` 的 `N` —— 逐条替换。

### 3. 类型一致

- `AttemptCommit` 的三个字段 `sha` / `base` / `ref` 在 Task 1 定义，Task 2、Task 3、README 全部按这三个名字用。✅
- `publishAttemptCommit` 的签名 **只吃 `worktreePath` 一个参数**（不吃 `repoPath`）—— Task 2、Task 3 的调用都是一个参数。✅
  （`repoPath` 不需要：`cwd: worktreePath` 下的 git 命令写的是共用对象库与共用 ref 存储。）
- `cleanupAttemptWorkspaceWithStatus` 与 `cleanupAttemptWorkspaceOrThrow` **参数顺序一致**
  `(repoPath, worktreePath, runDir, detail)`。✅
- 两个新事件类型的名字在 Task 2、Task 3、判据、README 里**逐字一致**：
  `attempt_commit_published` / `attempt_commit_publish_failed`。✅

---

## ✅ 两处人类裁决（**2026-09-03，人当面拍板；执行时逐条援引，不要重开**）

| # | 问的什么 | 裁决 |
|---|---|---|
| **裁决 1** | 决策 D1 的偏离 —— 不写 `attempts/<n>/` 产物文件，改用 ref ＋ `events.jsonl` 两条事件。它和提案第 3 节第 4 步不同 | *** **按建议：用 ref。** *** 理由是不碰 `fileStore.ts`（红线函数在那个文件里） |
| **裁决 2** | 要不要**现在**动 ccloop | 🔴 *** **现在就动。** *** 人原话：「现在就动 ccloop，先做 Orca 这部分工作，**E1 的 I-2 ＋ 人裁 85 顺延**，**人裁 121 仍有效**。」 |

🔴 **裁决 2 改变的是 ccloop 自己的「下一件事」，这件事必须写回 ccloop 的 handoff。**
读懂它的三层意思，**一层都不要多读**：

1. **P0 现在排在 E1 的 I-2 ＋ 人裁 85 【前面】** —— 那一轮**顺延，不是取消**。
2. *** **人裁 121 仍然有效** *** —— 它当初授权的是「开工设计 E1 的 I-2 与人裁 85」，
   **顺延不撤销它**；那一轮回来时**不需要重新拿授权**。
3. ⚠️ *** **E1 仍在授权面外。** *** ccloop handoff 明写：「E1 出完设计、动生产代码之前必须**另拿一次具名授权**」——
   **本次裁决没有碰这一条**，它是关于 E1 的，不是关于 P0 的。

⚠️ *** **push 仍需一次单独授权，本次裁决不含 push**（G9）。 ***
⚠️ **执行 P0 时守 ccloop 自己的 `CLAUDE.md` 与铁律** —— 授权扩大的是「能不能碰」，不是「碰的时候守谁的规矩」。

## 归属

本计划由 Orca 这条线的 run `orca-dev-10762e47` 于 2026-09-03 写下，
基点是 Orca 主题行 `docs(handoff): continue this round's section with the review and the proposal` 那一笔。
ccloop 侧的观测时点是它的 `main` tip `7caa4cb`。
⚠️ **所有行号引用前必须现测**（开工前 Step B）。

---

## ERRATUM 1（P0 执行时现测，2026-09-03／04，ccloop 基点 `7b44220`）

本节由执行 P0 的那一轮（run `orca-dev-213d1395`）追加。**上文一字未动**，此处为具名更正。

### 1. 🔴 成功事件被撤掉了 —— 只保留 `attempt_commit_publish_failed`

Task 2／Task 3 的实现段都写了「成功记 `attempt_commit_published`，失败记
`attempt_commit_publish_failed`」。*** **成功那条已按人 2026-09-04 的裁决撤掉。** ***

**为什么**：`events.jsonl` 里多一条事件，**打红了 17 条既有判据** —— 它们用 `toEqual` 钉死了
完整的事件类型序列（`succeeds when verification approves`、`stops immediately when a stopOn signal matches`、
`records retained cleanupStatus in execution recovery when cleanup fails` 等，名单在本轮的实测留档里）。
而 ccloop 铁律 2 明写**不许实施者自改既有判据，改既有判据必须由人指名到具体测试**。

**两条路都实测过，数字如下**：

| 方案 | 实测 |
|---|---|
| 保留两个事件 | 整支 **17 条既有判据红** |
| 只记失败事件 | 整支 **35 files / 623 tests 全绿**（当时 Task 2 收尾，基线 614＋9） |

**人裁（2026-09-04）：只记失败事件。** 依据是本文末尾裁决 1 已经定的「**ref 本身就是产物**」——
成功事件与 ref 重复（`git for-each-ref refs/ccloop/<run-id>/attempts/` 就能回答），
而失败时**没有 ref 可看**，那条事件不重复。

⚠️ **提案第 3 节与 README 那一节里「两条新事件」的说法同此更正。**

### 2. 🔴 变异 M0-4 第一次跑是【绿】的 —— 判据是空的

M0-4（把 `ATTEMPT_IDENTITY` 从 commit 参数里删掉）**没有打红任何一条判据**，八条全绿。

根因：**「仓库里没配 git 身份」不足以让 `git commit` 失败** —— git 会从 OS 用户名与主机名
自己猜一个身份，带警告提交成功。探针实测（四个场景，都在一次性仓库里跑）：

| 场景 | 结果 |
|---|---|
| 全局／系统配置清空、仓库无身份、不带 `-c` | **成功**，自动猜出 `<user>@<host>.local` |
| ＋ `user.useConfigOnly=true` | **失败 exit 128**，`fatal: no email was given and auto-detection is disabled` |
| 再加 `-c` 显式身份 | **成功** ← 这才是 D4 要守的那条 |
| `useConfigOnly=true` 但全局配置还在 | 成功（全局兜住了） |

⇒ 判据的 seeding 里补了 `git config user.useConfigOnly true`，**M0-4 才被看见红**。
⇒ *** **决策 D4 的【措施】仍然正确，但它写的【理由】不准**：真正会失败的不是「没配 user.email」，
是「猜不出来或禁用了猜」（CI 容器里主机名非 FQDN 就是这种）。 ***

### 3. 一处计数口径差异（**不是漂移**）

「开工前必须先现测的三件事」Step B 那张表写「**12 个调用点，11 个走收敛点**」。
机械普查（`/usr/bin/grep -rn "cleanupAttemptWorkspace" src/`，观测时 ccloop `7b44220`）是：
**9 个 `BestEffort` ＋ 1 个直接 `WithStatus` ＋ 1 个裸调（重试路径）= 11 个叶子调用点**，
差的那一个是把 `cleanupAttemptWorkspaceBestEffort` 内部那一行也算进去了。

⚠️ **这不是源码变了**：`git diff --stat 0f7fc28 7b44220 -- src scripts tests` **空输出**。
计划真正承重的那条 —— **全仓只有两处裸调 `cleanupAttemptWorkspace(`，一处在收敛点内部、
一处在重试路径** —— 逐字成立，本轮就是照它做的。

### 4. README 用了中文，不是计划给的英文

计划 Task 4 Step 3 给的 README 段落是英文。ccloop 的 `README.md` **通篇是中文散文**，
按 Rule 11（conformance > taste inside the codebase）改用中文写，命令与标识符逐字保留。
计划的 G12 列的是「代码、注释、commit message 一律英文」，**没有列 README**。

### 5. 本轮的实测数（**只抄工具打印出来的数**）

| 量 | 值 |
|---|---|
| 开工基线 | `35 files / 614 tests`，零 skipped，TEST/TYPECHECK/BUILD 三个 RC 全 0，17.00s |
| 收尾 | `35 files / 624 tests`（**基线 +10，与计划预期一致**），零 skipped，三个 RC 全 0，23.92s |
| 改动范围 | 5 个文件；`git diff --stat 7b44220 HEAD -- scripts/` 与 `-- src/persistence/` **均为空输出** |
| 变异 | M0-1 ～ M0-7 **七条全部被看见红**（M0-4 是补硬判据之后才红的，见上文第 2 条） |
| push | **一次都没有** |
