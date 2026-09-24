# 缝 B（targetVersion）变异电池 —— 台账

- **who**：变异席（mutation seat），由 Orca 控制器会话 `905e41ce-94af-4c74-b8c8-8c091a60e72b` 派出；模型 Claude Opus 5.5。
  实现不是本席写的；下表只记本席**看到的**结果。
- **when**：2026-09-25
- **在哪一笔提交上**：`fix(control): make targetVersion one positive safe integer from plan file to start envelope`，
  sha `e3204380c9c603b78ee25e339dec816e2da2a255`（`git clone --local` 副本的 HEAD 与主树 HEAD 均为此值，`git rev-parse HEAD` 现测）。
- **计划**：`docs/superpowers/plans/2026-09-24-g1-seam-b-target-version.md` Task 3；spec `docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md`。
- **场地**：变异全部在 scratchpad 下的 `orca-mut` 副本（`git clone --local`，`node_modules` 与 `web/node_modules` 软链到主树）。主工作树除本文件外零触碰。

## 绿基线

命令（副本内，先 `source env.sh`）：
`./node_modules/.bin/vitest run tests/control/targetVersion.test.ts --reporter=json --outputFile=<scratch>/mut/base.json`
RC 0；`numTotalTests` 14，`numPassedTests` 14，`numFailedTests` 0，`numPendingTests` 0（python 读 json 计数）。

## 变异表

每条的做法：先存原文件副本，按**行号**取出那一行，断言它逐字等于旧行，再替换（子串替换时断言该行命中数 == 1）；
改后 sha256 与改前不同才跑；跑的是 `tests/control/targetVersion.test.ts` 全文件（json reporter）；然后 `cat` 回原件，sha256 回到改前值。
红集合由 python 从 json 里取 `status != passed` 的标题。每条跑的总数都是 14，pending 都是 0。

| V | file:line | before sha256 | after sha256 | restored sha256 | RC | 实测红集合 | 预言 | 一致？ |
|---|---|---|---|---|---|---|---|---|
| V1 | `src/scheduler/planFile.ts:107` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | `9e4030fe633ccdf1007d7a3a438c86626182d456174294f9e34365e16be39ec2` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | 1 | N0、N1、N3、N4、N5、N6、N8、N9、N0b、N7b（10 条） | N0、N1、N3、N4、N5、N6、N8、N9、N0b、N7b | 一致 |
| V2 | `src/scheduler/planFile.ts:107` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | `44fba0e743bfaa3bf99c3c1ba48cfc614f72285f582d81de17f6952e59840d45` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | 1 | 只有 N2[zero] | N2[zero] | 一致 |
| V2b | `src/scheduler/planFile.ts:107` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | `e8709d62985d43204139c31e85461a40faddda40a2e429086ec3445a1b777f7e` | `d150c6879446eefadea7b010f9256f89323dce9538cfa5a2cc8c85b3f2189498` | 1 | N2[a fraction] 和 N2[an unsafe integer] | N2[a fraction]、N2[an unsafe integer] | 一致 |
| V3 | `src/control/planImport.ts:214-215` | `0fdf3cf2179270a869ed42bbdd057cb8d495b2b6e592842e4d339b51f7bc49a9` | `82e1f3547f0f5b78aa678ca60672356d3a171807f1a01cf071e86b59f5a003ab` | `0fdf3cf2179270a869ed42bbdd057cb8d495b2b6e592842e4d339b51f7bc49a9` | 1 | 只有 N3 | N3 | 一致 |
| V4 | `src/control/webDispatch.ts:281` | `644d6c6f9dbfd9c09a1b734ff018d3a2795216c84d29dd89bb16b52cbf853e4b` | `92667dad276bd3bd0057fd8e61c787aa3a9fff63f5af28701fb82079454d09ba` | `644d6c6f9dbfd9c09a1b734ff018d3a2795216c84d29dd89bb16b52cbf853e4b` | 1 | N4 和 N0b | N4 与 N0b（N8／N9 仍绿） | 一致 |
| V5 | `src/panel/controlViews.ts:61` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | `902a5000ab1cc1ee78685ea704c1eca4c44dac938de4e858c54e048040f172cb` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | 1 | 只有 N5 | N5 | 一致 |
| V6 | `src/panel/controlViews.ts:388` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | `3c700f7d340135f21ccabff3765170877b8b4e84cf1c52f7f5d68932fa2970be` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | 1 | 只有 N6 | N6 | 一致 |
| V7 | `src/control/webProtocol.ts:383` | `42d1299b6bc6dcdd52ee788219580674cd2ce8aa9f9fc01ab6050ef90988c381` | `ae023de8b614f948d54d502c366ec6ab524eff7f2765515820d6498a7821b3ad` | `42d1299b6bc6dcdd52ee788219580674cd2ce8aa9f9fc01ab6050ef90988c381` | 1 | N3、N4、N5、N6、N8、N9、N0b、N7、N7b（9 条） | N7 ＋ N3–N6、N8、N9、N0b、N7b | 一致 |
| V7b | `src/control/webProtocol.ts:821` | `42d1299b6bc6dcdd52ee788219580674cd2ce8aa9f9fc01ab6050ef90988c381` | `8791ed6446c5e02674e4ca53dba53d7d08c44a76f1d2be5112de5747a6296976` | `42d1299b6bc6dcdd52ee788219580674cd2ce8aa9f9fc01ab6050ef90988c381` | 1 | N7b 和 N0b | N7b；N5／N6／N8／N9／N0b 待量 | 预言本身有条件（没下死结论），实测见发现 2 |
| V8 | `src/panel/controlViews.ts:112` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | `0539e8ddcb131dfb64509c1299857d075ff5074bfa0d57407bc0b245fc736a52` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | 1 | 只有 N8 | N8 | 一致 |
| V9 | `src/panel/controlViews.ts:488` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | `0f000aa9f62a8a05f05a7526b727f872059143bba20862671c82387c6b49d4e7` | `17bda308a2ef4af1fff83af3f8c8964442a97d004fdb07b201996a1e9cc46d7e` | 1 | 只有 N9 | N9 | 一致 |

各条具体改动（改后那一行，逐字）：
- V1：`    targetVersion: z.string().min(1).optional(),`
- V2：`    targetVersion: safeInteger.optional(),`
- V2b：`    targetVersion: z.number().positive().optional(),`
- V3：`:214` 的 `VALUES (?,?,?,?)")` 改成 `VALUES (?,?,1,?)")`；`:215` 整行改成 `          .run(payload.groupId, task.taskId, JSON.stringify(work));`
- V4：`    graphVersion: snapshot.graphVersion, targetVersion: 1,`
- V5（`:61`）／V8（`:112`）：`  targetVersion: z.union([z.string().min(1), safeInteger]),`（两行文字相同，按行号定位，每次只改一行）
- V6：`      || body.configHash !== task.configHash`
- V7（`:383`）／V7b（`:821`）：`targetVersion: positiveSafeInteger,` 改成 `targetVersion: nonemptyString,`
- V9：删掉子串以后，`:488` 剩下只有空格的一行（8 个空格），**这一行留着没删**。

## 各守卫的实测失败消息（证明是哪道守卫拦下的）

- **V4**：N4 失败在 `expected 1 to be 3`；N0b 失败在 `ControlError: recovery-blocked:run-work-identity:run-…`，由 `controlViews.ts:491` 的 `blocked` 抛出，也就是 `:487-491` 这道 run/work 身份守卫。
- **V5**：N5 失败在 `AssertionError: expected false to be true`（`targetVersion.test.ts:109`，也就是 `detail?.startsWith("work-item-invalid:a:")` 这条断言）。
  这条消息看不出实际的 `detail`，所以另做了一次**探针**（只在副本里做）：把 `:109` 临时改成 `expect(error.detail).toBe("__probe__")`，
  同时施加 V5，用 `-t N5` 跑。看到的是 **`expected 'work-item-authority:a' to be '__probe__'`**。也就是说，schema 放行了字符串之后，
  拦下它的是 `:388` 的权威比对守卫（`"3" !== 3`），报成 authority mismatch，没有报成 invalid。N5 的判据要分的正是这两种情况。
  探针跑完后，测试文件和 `controlViews.ts` 都已还原，sha256 回到改前值。
- **V6**：N6 失败在 `Error: expected a ControlError, the call returned`（`targetVersion.test.ts:116`），说明去掉这道守卫之后读取直接成功，没有别的守卫顶上。
- **V9**：N9 失败在 `Error: expected a ControlError, the call returned`（`targetVersion.test.ts:134`），同上，没有别的守卫顶上。
- **V7b**：N0b 和 N7b 的消息都是 `ControlError: recovery-blocked:group-view:workItems.0.targetVersion:Expected string, received number`，
  由 `controlViews.ts:571`（`readControlGroup` 出口处的 `groupViewSchema` 校验）抛出。**N5、N6、N8、N9 没有红。**

## 还原证明

在副本里执行（输出先重定向到文件，再用 python 读字节数）：
- `/usr/bin/git diff`：**0 字节**
- `/usr/bin/git diff --cached`：**0 字节**
- `git status --porcelain` 只列出 `?? node_modules`、`?? web/node_modules`（两个软链，随后已删）
- `cmp <副本>/tests/control/targetVersion.test.ts <主树>/tests/control/targetVersion.test.ts`：RC 0
- 随后 `/bin/rm -f` 删掉两个软链，`/bin/rm -rf` 删掉副本；主树的 `node_modules/.bin/vitest` 仍在。

## 发现

1. **11 条变异全部看见了红**，没有哪条是零红，也就是说每个分支都有能打红它的判据。
   其中 V2、V2b、V3、V5、V6、V8、V9 **各自只红自己那一条**（独占判据）。V4 红 N4 和 N0b。
   V1、V7 按预言红了大片，因为改的是经过导入的路径。
2. **V7b 的实测红集合是「N7b 和 N0b」，N5／N6／N8／N9 没有红。**
   计划原文是一句带条件的预言：「若视图出口按 `groupViewSchema` 校验，N5／N6／N8／N9／N0b 也会红」。
   实测里视图出口确实校验了（`controlViews.ts:571`，错误是 `group-view:…`），但只有 N0b 走到了出口。
   N5、N6、N8、N9 在到达出口**之前**就被各自的守卫以预期的 `detail` 拦下，所以仍然是绿的。
   记为**和预言中的「也会红」那一半不一致**。这不影响判据：N7b 仍然能打红 V7b，而 N0b 也能打红 V7b。
3. **V5 下，N5 是被 `:388` 的权威守卫接住的（`work-item-authority:a`）**，不是完全漏掉。N5 能红，靠的是它断言了
   `work-item-invalid:` 前缀，而不只是断言 `recovery-blocked`。如果以后有人把 N5 放宽成只断言 `code`，V5 就不会再让 N5 变红。
4. `-t N5` 这个过滤条件也匹配到了 N0b（N0b 的标题里含 "N5"），探针那次 N0b 也跑了，结果是 passed。这一点对结论没有影响，这里只记下来。
