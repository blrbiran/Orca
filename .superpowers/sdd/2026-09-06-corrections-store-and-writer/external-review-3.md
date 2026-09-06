# 第三席外派评审报告 —— `2026-09-06-corrections-store-and-writer-design.md` 的 §14（第二版）

**评审席位**：1 席（general-purpose subagent，Opus）
**评审范围**：`7c15bdc..9fa4ce5`（§14 的整节重写）＋ 最终 §14 全文
**派出方**：run `orca-dev-d5eb8fa6`，2026-09-06
**评审员自陈**：*** **它说自己的 harness 不给 token／工具计数，拒绝自估。** ***
**派出方这一侧的工具报数**：*** **218,207 token ／ 38 次工具调用 ／ 855,587 ms。** ***
**结论**：`Ready to implement? No`

⚠️ **本文是评审员的原文归档，逐字保留。** 控制器的复核与处置记在文末与 spec 的 §14.20 第三张表。

⚠️ `.superpowers/sdd/.gitignore` 内容是 `*` ⇒ **本文件是 `git add -f` 进来的**。

⚠️ **brief 是【收窄的】**：只问两件事 —— (1) 这一轮的每个修法**又买来了什么**，
(2) §14.18 判据表里**还有哪些不可能红**。不许重报前两席已处置的发现。

---

## 原文

### 1. What this round's fixes bought

**(a) Splitting the closing sequence into two mode lines (record-only takes no repo lock).**
Bought: registered item 14 / E20 — a human can still record a correction while a round holds the repo lock. Real, and it was the right call.

**New failure it creates:** the two modes now disagree about which targets they accept, and only closure mode runs `unlockableTargetRejection` (闭-2). Record-only's 記-2 is `git config` only. Measured just now in a throwaway repo: in a linked worktree, `.git` is a **file** and `git config --get remote.origin.url` returns `git@github.com:acme/thing.git` (exit 0). So `orca correct` in a linked worktree **records the row fine**, and the later `--close --repo <same worktree>` is rejected at 闭-2 with `target-not-a-git-repo`. The store now holds a row that the closure path can never consume from the checkout the human is standing in, and nothing says why. Before the split both modes went through one preflight, so an unclosable row could not be created. Second, smaller: on a non-repo target `git config --get remote.origin.url` exits 1 (measured), so record-only rejects with "this target has no remote" instead of the named `target-not-a-git-repo` — the "message too far from the cause" shape §12 finding 2 and 14.13/I-H exist to kill.

**(b) The explicit ordering — in particular I-F, moving "read the original decision" (闭-5) to *after* the store write (闭-4).**
Bought: `--close` works at all, since the `decisionId` only exists on the stored row.

**New failure it creates — this is the round's own C-D shape, repeated.** In the **non-`--close`** closure path the `decisionId` comes from `--decision` on the command line and could be checked before anything is written; I-F was applied unconditionally to both paths. Consequence: `orca correct --repo R --decision <typo> --kind wrong --because … --chose-instead … --undo-how …` writes the correction row at 闭-4 and *then* rejects at 闭-5. A permanent junk row sits in the user-global store, counted in A′ §4.4's denominator — the exact metric pollution §4.1 introduced the semantic dedupe to prevent — and the retry with the corrected id has a *different* `decisionId`, so the dedupe does not catch it either; the store ends up with two rows.

The spec has not noticed: the residue table at line 711 still reads `记-1／记-2／闭-1…闭-5 | 什么都没写 | 干净`, and §5's "原 decision 找不到 ⇒ 当场拒 … 不等 appendEvent 的检查 5 去兜底" still stands. The previous round's step 2 read the original decision *before* the store write and said "本步一个字节都不写"; the reorder invalidated that claim and the claim was carried forward verbatim. Same for the detached-HEAD / merge-rebase guards, which 闭-5 also hosts — see E15 below.

**(c) `git add -- <path>` then `git commit -m … -- <path>`.**
Bought: measured and confirmed here — HEAD's commit contains only `.decisions/run.jsonl`, author `orca`, and the human's pre-staged `mine.txt` stays in the index. The seat-2 修法 alone does fail on an untracked path; the spec's three-line measurement table is right.

**New failure it creates:** a partial commit has a **strictly larger refusal set** than an ordinary commit, and 闭-5's guard list (detached HEAD, merge, rebase) was not widened. Measured: conflicted cherry-pick, human resolves and `git add`s but has not run `--continue` — `MERGE_HEAD` absent, no rebase dir, HEAD not detached (guard passes), zero unmerged index entries — then

- new form: `fatal: cannot do a partial commit during a cherry-pick.` exit 128
- old form: exit 0 (and it swallowed `f.txt`, author `t` not `orca`)

So the fix converts silent corruption into a hard failure, which is the right direction, but the failure lands at **闭-7, after 闭-6 has permanently appended two lines to an append-only file**, surfaces as git's raw fatal rather than a named rejection, and residue-10's documented recovery ("修好钩子后重跑同一条 `--close`") is wrong advice — the rerun fails identically until the cherry-pick is finished or aborted. This is 14.23 lesson 3 ("copy the repo-state preconditions along with the git call") violated by the fix that produced the lesson. (Measured for contrast: `cherry-pick -n`, `revert -n`, `merge --squash` and a conflicted-then-resolved *revert* all allow the partial commit and correctly leave the human's work staged.)

**(d) Landing and committing each idempotent; exit 0 only when both are done.**
Bought: C-D closed — a hook rejection no longer reports success.

**New failure #1:** the exit-code table this same round wrote (14.14: 0 / 1="retry won't help" / 3=unexpected / 4=transient-lock) has **no slot for the one failure this same round built the recovery path for.** 闭-7's residue row says only "非 0 退出". `1` is definitionally wrong (retrying *is* the documented fix), `4` is wrong (no lock is held by anyone), `3` is "unexpected" while registered item 10 registers it as expected. E5b asserts only "非 0", so two implementations returning 1 and 3 both pass, and a wrapper script written against the table cannot tell "the irreversible half succeeded" from "your input was bad".

**New failure #2 — an interaction with C5.** 闭-6's idempotence test is "does *this working-tree file* contain an `overturned` with this `correctionId`". Combine with registered item 15 (the commit may land on W): the human closes the loop while on W, later checks out main, and reruns the same `--close`. On main the ledger file does not exist, so 闭-6 does **not** skip — it writes the two lines again. Because C5 now makes both `at` fields real write time, the two versions of the *same path* `.decisions/<run>.jsonl` are byte-different. Merging W into main is then a content conflict on an append-only ledger file, on the one file A′ §3.1's "conflicts are structurally impossible" guarantee is built on; and a concatenating resolution yields two decisions with id `<run>/1` in one file, which `validateFile` does not check (duplicate-id Check B lives only in `writer.ts`), so `orca validate` says ok. Under the pre-C5 backfilled `at` the two writes would have been byte-identical and this would have been benign.

**(e) E13: deep-equal both lines + no-extra-keys on the overturned line.**
Bought: closes C-C — `correctionId` finally has something watching it. Correct and necessary.
**New failure: none found** (the added assertion is redundant rather than harmful — see §2).

**(f) `--undo-cost` / `--undo-blast-radius` (14.22).**
Bought: prevents a permanently false inherited `undo.cost` on the first real `overturned`. The reasoning is right.

**New failure it creates: the parameters have zero criteria.** Measured — `undo-cost` / `blast` appear at lines 51, 225, 385, 496, 502, 594, 1128–1143 and **nowhere in §14.18's 31 rows** (the only two `undo` rows are E3 and E12, both about `undo.how`), and none of 14.2's six field mutations touches them. Concrete: implement the flags so they are parsed and never wired into the derived object — a one-line miss — and all 31 criteria stay green, including E13, whose fixture has no reason to pass them. The first `overturned` written *with* `--undo-cost` then silently records the inherited text, permanently. The fix bought a parameter and left the door it guards unwatched.

### 2. Criteria that still cannot go red

**E6 (line 986) — cannot go red under its named mutation; and no mutation makes it red.** This is the one flagged as "本刀最承重的一条".
The two fixture rows differ only in `by`, with `at` pinned byte-identical. But §4 derives the correction id as `sha256(projectKey|decisionId|at|because|by)`, and §7.1 passes **that id as `deriveRunId`'s third argument**. So the two correction ids differ *because of `by`*, and `deriveRunId` hashes `contractBytes ++ 0x00 ++ baseCommit` (`runId.ts:45-51`) — the two run ids differ whether or not `by` is in the canonical JSON. Excluding `by` from "规范 JSON 的字段序列那个具名常量" changes nothing observable: two files, assertion passes, **green**.
*Operation that would make it red:* none, as the design stands. Removing `by` from both derivations makes the two rows collide on correction id, so the §4 id-dedupe rejects the second row and the fixture cannot be built (`--again` lifts only the *semantic* dedupe, not the id one) — red by crash, which §14.18's own discipline refuses. 14.11 rewrote E6 precisely to give the `by` mutation a landing place; the landing place it picked is neutralised by the second `by`-carrying input named one line above it.

**E3 (line 981) — the requirement it removes does not exist.** §3 and 記-1 select the mode by parameter presence: "`--chose-instead` ＋ `--undo-how` 都在 ⇒ 闭环；否则只记". So omitting either flag is not a rejection, it is **record-only mode, exit 0**. There is no "必填" for the mutation to remove, and the unmutated implementation never prints the message E3 asserts. A human who typos `--undo-how` gets exit 0, a correction row, and no ledger write.
*Operation that would make it a real gate:* run the full closure argv with `--undo-how` misspelled and assert a **named non-zero rejection** — i.e. require an explicit closure signal rather than inferring the mode from which flags happen to be present.

**E3b (line 982) — as written, green under its own mutation.** The expectation column says the difference is "失败点跑到 schema 深处", i.e. *both* variants exit non-zero (without `chose_instead`, `chose` is `undefined`, `decisionEventSchema.chose: z.string().min(1)` rejects inside `appendEvents`). But unlike E2, E3 and E11, the "判据钉什么" column does **not** say it asserts the message. An exit-code-only assertion passes under the mutation. This is exactly the disease 14.13 (M2 / I-H) was written to cure, missed on a criterion added in the same round.
*Fix:* say "断言消息" explicitly, as E2/E3/E11 do.

**E5b (line 985) — its "补上提交" half has no assertion.** The row explicitly disclaims file observation ("它不断言文件内容 —— 文件两种情况下都不变"). That is true of the *ledger* file and false of the *git* state. Mutate 闭-7 so that on a `--close` rerun it never re-attempts the commit (the pre-C-D behaviour) while still returning non-zero because the path is dirty: the exit-code assertion is satisfied at every step, "both done" is never reached so the exit-0 half is never observed, and the recovery path is dead again.
*Operation that would make it a real gate:* assert, after the rerun, that `git rev-parse HEAD` changed and `git status --porcelain` no longer lists the ledger path — the observation the row currently rules out.

**E10c (line 994) — not constructible as specified.** The fixture is told to carry `--again` but not to pin the clock. `--again` only lifts the semantic dedupe; the id still contains `at` = now, so a second invocation produces a *different* id and no duplicate ever occurs — the criterion is red against the **unmutated** implementation. §4.1 says this in as many words ("它只在原样重放同一行时才响").
*Operation that would make it a real gate:* pin `at` byte-identical (inject the clock, or replay the identical row through the store writer directly) — the same fixture constraint 14.11 wrote out for E6 and did not carry across to E10c in the same table.

**E15 (line 1001) — goes red for the wrong reason, or contradicts 闭-5.** It asserts the state guards reject "且**一个字节都没写**", but the step table (line 660) puts those guards in 闭-5, *after* 闭-4 has appended the correction row. Against a faithful implementation the assertion fails; against an implementation that satisfies it, the guards are not where the spec puts them. E8b uses the identical phrase for a case where genuinely nothing is written anywhere, so the phrase cannot be read as "nothing in the target repo".
*Fix:* either hoist the state guards above 闭-4, or say the assertion is scoped to the target repo (and then note it no longer distinguishes much).

**E11 (line ~996) — now a tautology.** After I-G the mutation is a **pure string-literal swap**: replace the named rejection's message with check-5's wording. Any message assertion goes red against any message change; this proves the test reads stderr, not that the pre-check exists or runs at the right time. Deleting the guard — the thing the criterion is nominally about — still crashes (14.13 measured that), so it remains unmutatable.
*Operation that would make it a real gate:* keep the message assertion and add "the store file and `<repo>/.decisions/` are unchanged", with the mutation "move the pre-check after 闭-4/闭-6". That mutation does not crash and pins the ordering, which is the property that actually matters — and, per §1(b), the ordering is currently wrong.

**E13 (line 998) — the no-extra-keys assertion is a redundant guard.** A deep-equal against a fixture object already fails on a seventh key (that is what deep-equal means, and excluding `at` from the comparison does not change it). None of 14.2's six named mutations *adds* a key, so no named mutation can make the extra assertion red while the deep-equal stays green.
*Operation that would make it a real gate:* add a seventh mutation that writes an extra passthrough field onto the `overturned` line — e.g. copying `chose_instead` onto it, literally the change 14.4 declined to make. Then the extra assertion is the only thing that catches it.

**E18 (line 1004) — correct, but nothing walks through the door.** It pins that a **reversed** batch `[overturned, decision]` succeeds. 闭-6 is the only caller and it always passes `[新 decision, overturned]`. No operation in the product produces a reversed batch; this is the second rewrite of E18 for the same disease (I-C killed the first).
*Operation that would make it a real gate:* pin 14.1's actual central claim instead — "there is no longer an intermediate state where the decision is written and the overturned is not". Mutation: make `appendEvents` do one `appendFile` per event; fixture: a forward batch whose *second* event is rejected (e.g. an `overturned` whose `replacedBy` does not resolve); assert the ledger file does not exist. That is reachable — registered item 11 is exactly a 闭-6 failure — and nothing currently asserts it. E4′ brushes against it only under one reading of "让闭-6 的台账写失败".

**E18c (line 1006) — cannot go red.** "改成只校验最后一行" makes the prospective check *stricter*, not looser, for the only batch the product builds: the `overturned`'s `replacedBy` points at the in-batch decision, which would drop out of `fileDecisionIds` (`validateFile.ts:55-65`) and make check 5 reject a valid batch. So the mutation breaks the happy path — which E13 and E14 already assert. Under the other reading (validate the whole text, inspect only the last line's verdict), the per-event `validateLine` in the contract has already covered checks 1–4 for every element. Either way it is a redundant guard.
*Operation that would make it a real gate:* none for this batch shape; fold it into the E18 replacement above.

**E9b (line 991) and E18b (line 1005) — correct, but no caller can reach them.** 闭-6 passes a hard-coded two-element array and `appendEvent` becomes a single-element wrapper; nothing can produce a zero-length batch or two same-id decisions in one batch. They are defensible as API-contract tests on an exported function in A′'s core — but they should not be counted as covering C1/I8/I9, and the criteria table does not say which they are.

**E10d (line 995) — the injectable barrier cannot be a two-sided rendezvous.** Under the *unmutated* implementation the read is inside the lock, so two processes can never both be past the read at once — by construction, which is the whole point. A barrier that waits for both arrivals therefore hangs the correct implementation and the criterion times out rather than passing. A one-sided seam (P1 holds the lock and sleeps) works, but then the unmutated pass is delivered by the store-lock **timeout** (exit 4), not by the dedupe — i.e. it passes for a reason other than the one named. The spec says "一个可注入的同步点" without saying which; only the one-sided form is buildable.

**E1a (line ~979) — likely red by crash.** Given §2.3's documented algorithm (`new URL(u)` on the non-`git@` branch), deleting the `git@` branch routes `git@host:p.git` into `new URL()`, which throws — the mutation goes red on an exception, not on the assertion, which §14.18's own discipline refuses. *Fix:* mutate the branch to return a wrong-but-valid value (drop the `:`→`/` translation) so two strings are compared.

Rows I checked and did **not** flag: E1b, E2, E4′, E5a, E7, E8, E8b, E9, E10a, E10b, E12, E14, E14b, E16, E17, E19, E20. E5a's rewritten mutation is executable and does go red (second `--close` lands in a different file, `overturned` count becomes 2); E14b I reproduced end to end; E16, E19 and E20 each have a reachable door and a mutation with a landing place.

### Out of brief

- `unlockableTargetRejection`'s message (`preflight.ts:131-137`) says "…this **round** has nowhere to put the repo lock **it takes before reading anything**". 14.9 reuses it 原样, so `orca correct` will now print it — a command with no round.
- §14.4's `--close` exclusivity enumeration was not updated for the two new parameters; a literal implementer allows `--close --undo-cost`, a defensive one rejects it, and the spec settles neither.
- E17's `process.umask(0o022)` is process-global; the spec does not say to restore the previous value.
- I could not determine which exit code 闭-7's failure should return — see §1(d); the spec genuinely does not say.

### Assessment

**Ready to implement?** No

**Reasoning:** The pattern from the previous round repeats: the two most consequential new defects are made *by* this round's fixes — I-F's unconditional reorder put the store write ahead of the "original decision not found" rejection while the residue table still claims 闭-1…闭-5 write nothing, and the partial-commit form widened git's refusal set past 闭-5's unchanged guard list (both measured above). On the criteria side, the load-bearing row E6 cannot go red under its named mutation and I can name no mutation that makes it red, E3's requirement does not exist, E10c is not constructible, and the two parameters added in 14.22 have no criterion at all. Fixing these is bounded — reorder the non-`--close` decision lookup above 闭-4, widen the state guard, unify the `by` field list across both derivations (or replace E6 with something observable), pin E10c's clock, add message assertions to E3b, and give the undo overrides a criterion — but the first real `overturned` should not land before they are.

**Token/tool usage:** my harness does not expose token or cost counters to me, so I cannot report measured numbers, and I will not estimate them.

---

## 控制器复核（**2026-09-06，run `orca-dev-d5eb8fa6`；本节是控制器写的，不是评审员的话**）

按本仓库既定纪律，**评审员的承重主张必须自己复核**。逐条现测结果：

| 主张 | 复核方式 | 结论 |
|---|---|---|
| **E6 仍不可能红**（`by` 经由 correction id 也进派生） | 现测 `src/scheduler/runId.ts`：`hash.update(contractBytes); hash.update(Buffer.from([0])); hash.update(baseCommit, "utf8")` —— 而 §7.1 传的第三个入参正是 correction id，§4 又把 id 定义成含 `by` 的哈希 | *** **成立。14.11 专门为「让变异有落点」做的改写，落点被它上面一行的另一个入参抵消了。** *** |
| **残留表与步骤表自相矛盾** | 现测本节自己的两张表：闭-4 写 correction 行、闭-5 读原 decision，而残留表写着「记-1／记-2／**闭-1…闭-5** ｜ 什么都没写」 | **成立** |
| **两个新参数零判据覆盖** | 现测第二版 §14.18 表 **47 行**：`undo-cost` / `undo-blast` / `undo.cost` / `blast_radius` **各 0 次命中** | **成立** |
| **部分提交的拒绝面更大** | *** **实测**（一次性仓库）：造「cherry-pick 冲突已解决、未 `--continue`」的状态 ⇒ `CHERRY_PICK_HEAD` 存在、`MERGE_HEAD` 不存在、无 rebase 目录、HEAD 未 detached、unmerged 为 0（三条守卫全放行）⇒ `git commit -m … -- <path>` 得 `fatal: cannot do a partial commit during a cherry-pick.`，**EXIT=128** *** | **成立**，且它发生在闭-7 已经不可逆写完之后 |

**四条承重主张全部成立；21 条处置逐条记在 spec 的 §14.20 第三张表。**

⚠️ **本席之后不再派席**（人裁 2026-09-06）：真正还能检验这份设计的不是第四席，
而是 §10 那条验收 —— **在一次性仓库里让第一条真 `overturned` 落盘并被 `orca validate` 判 ok**。
