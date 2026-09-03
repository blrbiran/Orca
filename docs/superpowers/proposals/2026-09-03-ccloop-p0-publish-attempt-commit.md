# 给 ccloop 的一页：**让 attempt 交出一笔可达的 commit**

**提出方**：Orca 这条线，run `orca-dev-8d4c6ba3`，2026-09-03。
**性质**：*** **提案，不是任务。要不要做、什么时候做、怎么做，由 ccloop 自己决定。** ***
**授权状态**：人已授权 Orca 这条线**可以**改 ccloop；本文是「动手之前先报」的那一步。**尚未动任何一个字节。**
**不影响**：E1 的 I-2 ＋ 人裁 85 那一轮**一点没变**，仍是 ccloop 的下一件事。

---

## 1. 一句话

> **在 `git worktree remove --force` 之前，把 agent 的改动 commit 掉，并写一个 ref 让它可达，然后把 sha 报进产物里。**

`diff.patch` **原样保留**，行为**一处不改**。**纯追加。**

---

## 2. 为什么（三条，都带实测命令与观测时的 commit）

**观测时点 2026-09-03，ccloop HEAD `0f7fc28e8bdc573ba22840d3c7e00e25d8927b17`。**
口径一律**重定向到文件再整份读回**，未过滤。

### 理由一：`scripted` adapter 根本不产 `diffPatch`

```
/usr/bin/grep -n "diffPatch\|changedFiles\|artifacts" src/runtime/scriptedAdapter.ts   ⇒ 零命中
```

`diffPatch` 是 adapter execute 结果的**可选**字段（`src/runtime/types.ts:42`），
落盘处有守卫（`src/persistence/fileStore.ts:1738`：`if (artifacts.diffPatch !== undefined)`）。

⇒ **走 scripted 路径时 `attempts/<n>/diff.patch` 压根不会被写出来。**
⇒ 对 Orca：它的 v1 全程用 scripted（为了不花 claude 的钱），**因此没有任何产物可收，跑不起来**。

### 理由二：patch 这条路本身有三个静默转空的通道

口径 `sed -n '190,260p' scripts/claude-phase-runner.mjs`。`readDiffPatch`（`:232`）：

| # | 现状 | 后果 |
|---|---|---|
| 1 | 两处 `git diff` **都没有 `--binary`** | 二进制改动落成 `Binary files a/x and b/x differ`，**`git apply` 应用不了** |
| 2 | `maxBuffer: 10 * 1024 * 1024` | 超 10MB 抛错，而 `readGitDiff` 的 catch **只对 `code === 1` 返回 stdout，其余一律 `return ""`** ⇒ **补丁静默变空** |
| 3 | 同一个 catch 吞掉任何其它 git 失败 | 也是空 |

⚠️ **先说 ccloop 做对的地方**：**未跟踪文件是被收进来的**（逐个合成 `--no-index -- /dev/null <path>` 的 diff）。
这一点常被误报成缺陷，**它不是**。

⇒ 上面三条**不构成「ccloop 有 bug」的指控** —— 在「patch 只是给人看的证据」这个定位下它们完全够用。
**它们只说明一件事：patch 不适合当机器的交接物。**

### 理由三：它坏的是**核对**，不只是传输

Orca 要做一条双向的事后核对：**实际改动 ⊄ 声明**（越界）与 **声明 ⊄ 实际**（声明了却没产出）。
后者是「跑成功了但其实什么也没干」——本仓库历史上最贵的那类错。

**只有 patch 时，后者退化成「patch 空不空」**，而按理由二，空可能来自
①agent 真的没干活 ②采集失败 ③超了 10MB。**三者分不开 ⇒ 这条核对是假的。**

**有真 commit 时**，`git diff --name-only <基点> <结果>` 是确定性的：**失败就是失败，不会伪装成"没有改动"。**

---

## 3. 改什么（四步，纯追加）

```
attempt 跑完（agent 已改完 worktree）
  1. git add -A                                  ← 在 attempt worktree 里
  2. git commit                                   ← message 建议带 run-id 与 attempt 序号
  3. git update-ref refs/ccloop/<run-id>/attempts/<n> <sha>    ★ 必须在 remove 之前
  4. 把 <sha> 报进 attempts/<n>/ 的产物（新字段，或一个新的小文件）
然后照旧 git worktree remove --force
```

🔴 **第 3 步是整个改动的全部机关。**
attempt worktree 与 `context.repoPath` **共用同一个对象库** ⇒ *** **commit 对象本来就已经在那儿了，缺的只是可达性。** ***
**不写 ref，它就等着被 GC 掉。**

⇒ 这四步**与 adapter 无关**（commit 发生在 worktree 里，不经过 adapter 的返回值）
⇒ *** **一处改动同时管好 `scripted` 与 `claude` 两条路。** ***

---

## 4. 明确**不**改什么（这一节是给评审看的）

- **`diff.patch` 一个字节不动**，继续按现在的方式采、按现在的路径落盘；
- **`readDiffPatch` 的三个坑一个都不修** —— 它们在「给人看的证据」这个定位下不是坑，**修它们是另一件事**；
- **不动状态机**：`RunStatus` 九档、`legalTransitions`、`isTerminalRunStatus` 全不碰；
- **不动退出码**：`status === "succeeded" ? 0 : 2` 保持原样（Orca 已改成读 `loop-state.json`，不依赖退出码分辨终态）；
- **不动租约／心跳／owner-transfer／`unlock`**；
- **不动 `evaluatePathPolicy`**；
- **不动契约 schema**（本提案不需要新字段进契约）；
- **不碰 E1 的 I-2 与人裁 85 那一轮的任何东西。**

---

## 5. 怎么验（建议，按 ccloop 自己的纪律）

| 判据 | 断言 |
|---|---|
| **可达性** | `worktree remove` **之后**，`git cat-file -e <sha>` 仍成功，且 `git rev-parse refs/ccloop/<run-id>/attempts/<n>` == `<sha>` |
| **内容正确** | `git diff --name-only <基点> <sha>` 与同一轮 `git status --porcelain` 采到的改动集**一致** |
| **未跟踪文件进去了** | 让 attempt 新建一个文件 ⇒ 它出现在 `<sha>` 的树里（`git add -A` 覆盖未跟踪） |
| **二进制进去了** | 让 attempt 写一个二进制文件 ⇒ 它在树里且内容逐字节相同（**这条正是 patch 路做不到的**） |
| **既有行为不变** | `diff.patch` 的内容与改动前**逐字节相同**；`35 files / 614 tests` 仍全绿零 skipped |

🔴 **按贵仓库的纪律，每条新分支要点名一条删掉【它自己】的变异，并确认看见红。**
**最该点名的一条**：*** **删掉第 3 步的 `update-ref`** *** ——
如果判据仍然绿，说明它是在 `worktree remove` **之前**读的 sha，**而那什么也没证明**。
（这正是「一条判据在被看到打红之前不是判据」的形状。）

⚠️ **变异只在 `git clone --local` 副本里做**；还原证明建议用 `shasum -a 256` 前后比对，
**不要用 `git diff | wc -c`** —— Orca 实测：**`git diff` 对未跟踪文件的内容改动完全看不见**，
覆写一个未跟踪文件前后都是 0 字节。

---

## 6. 已知代价（不掩饰）

1. **`refs/ccloop/**` 会长期堆积。** 每个 attempt 一个 ref，跑得多了 `git for-each-ref` 会很长。
   ⇒ **本提案不含清理策略** —— 删 ref 是不可逆动作，按贵仓库铁律 1 属需人授权的形状，
   **该由 ccloop 自己决定要不要、以及怎么做。**
2. **对象库会变大**：以前 attempt 的改动跑完就随 worktree 消失，现在被 ref 钉住，不再被 GC。
3. **空 attempt 会产生空提交。** `git commit --allow-empty` 与「拒绝空提交」两种做法都可以，
   **但要选一个并写明** —— Orca 这边把「报成功却产出空树」当作一个具名失败来处理，
   所以**倾向于让它 commit 出来**（让空可见），但**这是 ccloop 的选择**。
4. **多一次 `git add -A`**：如果 worktree 里有 agent 留下的临时文件，它们会一起进 commit。
   `diff.patch` 今天也会收它们（未跟踪文件那一支），**所以这不是新问题，但值得知道。**

---

## 7. 边界

- **本文不构成对 ccloop 的任何授权，也不是任务。**
- Orca 的规则**不放松 ccloop 的任何铁律**（Orca 的 A′ spec §7）。若真要做，
  按 ccloop 自己的流程走（有实质设计成分 ⇒ 先 `brainstorming` 再 `writing-plans`）。
- *** **push 仍需人单独授权。控制器不许 push。** ***
- 完整背景在 Orca：`docs/superpowers/specs/2026-09-03-scheduler-design.md` §4.4、§7.5、§10.5。
- ⚠️ **本文所有实测值都带命令与观测时的 commit（`0f7fc28…`）。行号会移动 ——
  引用前请现测，不要照抄。**
