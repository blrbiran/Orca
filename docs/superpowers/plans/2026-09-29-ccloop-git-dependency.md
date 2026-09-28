# ccloop 作为 Orca 的锁定依赖（git URL 钉提交）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Orca 在 `ORCA_CCLOOP_BIN` 未设时，从「作为依赖装进 `node_modules` 的 ccloop 包」解析出 ccloop 二进制；ccloop 自己能被 npm 以 git 依赖的方式装好（`prepare` 现 build、`files` 带上运行时要读的脚本）。`package.json` 的依赖行和 `package-lock.json` 由**人**在推送 ccloop 之后亲手加（本计划只写命令）。

**Architecture:** ccloop 侧只改 `package.json`（`prepare` ＋ `files`），外加一条只加不改的打包判据。Orca 侧新增 `src/control/ccloopBin.ts`（`createRequire(...).resolve("ccloop/package.json")` → `bin.ccloop`），**只在进程边界**（`src/panel/server.ts` 的 `startPanelFromArgs`、`src/cli.ts` 的 `agents` 分支）把默认值填进 env；`resolveControlOptions`／`controlAssembly`／`agents/command.ts` 与它们的既有判据一字不动。离线验证：scratch clone 里 `npm pack` 出 tarball，解进 scratch Orca clone 的 `node_modules/ccloop`，跑一条新的 opt-in E2E（`ORCA_CCLOOP_BIN` 未设）。

**Tech Stack:** TypeScript（NodeNext ESM）、vitest、npm 10.9.2、Node v22.13.1（测量命令：`node --version; npm --version`，2026-09-29，Orca `e3f6c16`）。

**人裁（2026-09-29，原话见台账 `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md` §1「#1 用 git URL」）：** ccloop 成为 Orca 的锁定依赖，形式 `"ccloop": "github:blrbiran/ccloop#<commit>"`。约束：push 只能人做；本会话里被钉的提交还不在 GitHub 上 ⇒ **依赖行与 lockfile 的更新是人的一步（Task 5，只写不做）**，其余现在做完。

**台账：** 本轮进度源 `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md`（计划 C）。本计划不新建台账；执行记录由控制器追加到该文件 §2。

## 执行顺序与分工

1. **Task 1（ccloop）**：`package.json` 加 `prepare`＋`files`，加打包判据，README 一句话。先落 ccloop 的本地提交。
2. **Task 2（Orca）**：`src/control/ccloopBin.ts` ＋ 单元判据。
3. **Task 3（Orca）**：边界接线（`server.ts`、`cli.ts`）、用法文字、README、opt-in E2E 文件。
4. **Task 4（控制器或实施者，只在 scratch）**：离线打包 → 解包进 scratch Orca → 跑 E2E（默认解析）→ 全部变异（ccloop MP1–MP5、Orca M-B1–M-B7、接线 M-W1–M-W2、包内容 M-P5）。
5. **Task 5（人，只写不做）**：人 push ccloop 后，在 Orca 里 `npm install "github:blrbiran/ccloop#<sha>"`，核对、提交 `package.json`＋`package-lock.json`。
6. 交接要点（给控制器写 handoff 用）在文末。

## Global Constraints

- **两仓都在 `main` 上落本地提交**（与 `2026-09-27-single-call-estimate.md` 同）；**绝不 push**，不删分支／worktree。若执行时另有 agent 正在同一仓的 `main` 上干活 ⇒ 按记忆「多 agent 时用 worktree 新分支」改在 worktree 的新分支里做，由控制器在派发前定。
- 提交信息结尾两行（Task 5 是人的提交，除外）：
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`
- 提交前先把 diff 写进文件整份读回（全局 CLAUDE.md「Always show diff before committing」）。
- `S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad`。**所有变异、打包、解包、`npm install` 类动作只在 `$S` 下的 `git clone --local` 副本里做**；两个主工作树全程不 build、不 `npm install`、不 `npm pack`。
- **验证跑一律 `> "$S/<name>.txt" 2>&1; echo rc=$?`，再整份读回**；不许 `grep`／`tail`／`head`／`sed` 过滤，不许管道。核 vitest 第一行 `RUN` 指向的路径。
- **TMPDIR 是短的真实目录**（`mktemp -d /private/tmp/cl-XXXX`；tsx 的 IPC socket 在 `$TMPDIR` 下，macOS socket 路径上限 104 字节），**HOME ＋ 四个 XDG 根改道**。Task 2 Step 0 建一次，写进 `$S/c-env.sh`；之后每条测试／npm 命令先 `. "$S/c-env.sh"`。**`git commit` 不 source 它**（改道后的 HOME 没有 git 身份）。
- **ccloop 既有判据一条不改（只加）**；Orca 既有判据也一条不改（本计划不需要人裁 S6 类授权）。点名之外的既有判据红了 ⇒ 停下报控制器。`describe.skipIf(!process.env.ORCA_CCLOOP_BIN)` 系列文件不动。
- 散文（本计划、ccloop README、台账）用中文；代码、注释、Orca README 用英文。
- 文件复制用 `cat a > b`，不用 `cp`；删除用 `/bin/rm -rf <字面路径>`（不带变量）；git 一律 `/usr/bin/git`。
- 仓库外零写入（Rule 17）：E2E 的子进程 HOME／XDG／`ORCA_CONTROL_DIR`／`ORCA_CORRECTIONS_DIR`／`ORCA_AGENTS_TABLE` 全在测试自己的临时根里。
- 付费调用、推送、删人的数据、杀人的进程不在授权内（台账 §1）。E2E 只杀它自己 spawn 的 panel 子进程。

## Review Focus（最可能咬人的五条）

1. **默认值只在边界填**：`resolveControlOptions` 依旧只看 env；`tests/panel/controlOptions.test.ts:158-181` 钉的「两个变量都要」「空串 ⇒ unconfigured」不能因为 `node_modules` 里有没有 ccloop 而变色（Drafter F6）。
2. **空串 `ORCA_CCLOOP_BIN=""` 仍是「显式关」**：只有 `undefined` 才走默认（M-B2、E2E 第 3 条的正对照）。
3. **`files` 覆盖所有运行时读取**：`claudeRunnerPath()` 从包根找 `scripts/claude-phase-runner.mjs`，runner 再 import `./claude-stream.mjs`；`accept.ts` 默认 worker 是 `dist/src/control/worker.js`（F1、F2）。
4. **Task 4 用 `tar` 解包而不是 `npm install`**（离线做不到，F9）；git 安装全链路（临时 clone → 装 devDeps → `prepare` → 按 `files` 打包 → bin-links chmod）只能在 Task 5 由人的网络环境验证，同一条 E2E 再跑一遍。
5. **`verify:control` 不加默认**：它跑的 `tests/control` 真 ccloop E2E 从 `dirname(ORCA_CCLOOP_BIN)/../tests/fixtures` 取 fake codex／fake claude，包里没有 `tests/`（F5）。

## File Structure

| 仓 | 文件 | 动作 | 责任 |
|---|---|---|---|
| ccloop | `package.json` | 改 | `scripts.prepare`、`files` |
| ccloop | `tests/packaging/gitDependency.test.ts` | 新建 | `files`／`prepare` 覆盖运行时读取的判据 |
| ccloop | `README.md` | 改（第 53 行后加一段） | git 依赖安装方式与 `prepare` 的副作用 |
| Orca | `src/control/ccloopBin.ts` | 新建 | `CcloopNotInstalled`、`installedCcloopBin`、`withDefaultCcloopBin` |
| Orca | `tests/control/ccloopBin.test.ts` | 新建 | 覆盖／默认／缺包／缺 build／缺 bin 字段 六条 |
| Orca | `src/panel/server.ts` | 改（12 行 import 后、250-252 行） | panel 边界填默认 |
| Orca | `src/cli.ts` | 改（24 行 import 后、60 行用法、569-571 行） | `orca agents` 边界填默认，缺包具名失败 |
| Orca | `README.md` | 改（398 行后加一段） | 解析顺序与仍需 checkout 的判据 |
| Orca | `tests/control/ccloopDefaultE2E.test.ts` | 新建 | opt-in E2E：`ORCA_CCLOOP_BIN` 未设，对装好的包跑 |
| Orca | `package.json`、`package-lock.json` | **人**改（Task 5） | 依赖行与锁 |

**本计划不碰**：`src/control/ccloopPort.ts`、`src/panel/controlOptions.ts`、`src/panel/controlAssembly.ts`、`src/agents/command.ts`、`src/control/unconfiguredPort.ts`、`scripts/verify-control.mjs`、`tests/scheduler/sandbox.ts`。

## 与并行计划的文件重叠（控制器排序用）

并行计划 `2026-09-29-labels-and-progress.md`（A）与 `2026-09-29-backlog-hardening.md`（B）起草中，下列是本计划（C）会碰、且 A／B 可能也碰的：

| 文件 | C 的改动 | 风险 |
|---|---|---|
| ccloop `package.json` | `files`＋`prepare` | A／B 若加 ccloop 脚本或依赖 ⇒ 同一 hunk 附近冲突；**更要紧**：Task 5 钉的 SHA 必须是本轮所有 ccloop 改动落地、且人 push 之后的 ccloop tip，否则 Orca 钉到的 ccloop 缺 A／B 的 ccloop 半边。 |
| Orca `src/cli.ts` | 24 行 import、60 行用法、569-571 行 `agents` 分支 | A 若加命令／改 USAGE ⇒ 行号漂；按字符串重新定位。 |
| Orca `src/panel/server.ts` | 12 行 import、`startPanelFromArgs` | A 若改 panel 启动 ⇒ 重新定位。 |
| Orca ccloop 配置解析（`controlAssembly.ts:123,246` 读 `env.ORCA_CCLOOP_BIN!`、`controlOptions.ts:108`） | **C 不改**，靠 env 在边界被填好 | B 若把 `ORCA_CCLOOP_BIN` 的读取挪出 env（例如进 `PanelOptions`）⇒ C 的接线要跟着挪，否则默认值失效（Task 4 的 M-W2 会看见）。 |
| Orca `README.md` | 398 行后加一段 | 低。 |
| Orca `package.json`／`package-lock.json` | 人（Task 5） | A／B 若加依赖 ⇒ lock 冲突；**Task 5 放在全轮最后**。 |

## Drafter findings

> 起草者：Orca 控制器会话 `2724716d` 派出的只读起草子 agent（Claude Opus 5.5），2026-09-29。只读探查，只写了本文件。
> 观测锚点：Orca 主题行 `docs(sdd): open the ledger for the labels, progress and backlog round, with the human's authorizations`（`e3f6c16`）；ccloop 主题行 `docs(handoff): the Orca line's twentieth version: the rulings are accepted and the suite-wide temp-dir leak is fixed`（`b1c383e`）。行号一律「measured 2026-09-29, re-measure before use」（测量命令：`/usr/bin/grep -n` 与 `sed -n`）。

| # | 发现 | 证据 | 本草稿的选择 |
|---|---|---|---|
| F1 | ccloop 运行时从**包根**读 `scripts/`：`claudeRunnerPath()` 在 dist 布局下取 `dist/` 的上一级再拼 `scripts/claude-phase-runner.mjs`；runner 第 4 行 `import … from "./claude-stream.mjs"`。build 不拷 `scripts/`。 | ccloop `src/runtime/claude/claudeAgentAdapter.ts:21-26`、`:87`、`:112`；`scripts/claude-phase-runner.mjs:4`；`scripts/claude-stream.mjs` 只 import `node:fs` | `files` 显式列这两个脚本；判据按 import 闭包机械导出（Task 1）。 |
| F2 | `accept.ts` 的默认 worker 是 `new URL("./worker.js", import.meta.url)` ⇒ `dist/src/control/worker.js`。 | ccloop `src/control/accept.ts:125` | `files` 含 `dist/src/`。 |
| F3 | `tsconfig.json` 的 `include` 把 `tests/`、`validation/`、`vitest.config.ts` 也编进 `dist/`；`types` 含 `vitest/globals`。 | ccloop `tsconfig.json` | 只 ship `dist/cli.js`、`dist/cli.d.ts`、`dist/src/`。**副作用**：`prepare` 会编译测试，测试里一个类型错误就会让所有 git 安装失败。不改（Rule 2），报控制器。 |
| F4 | `typescript ^5.5.4`、`vitest ^2.0.5` 都在 devDependencies；npm 装 git 依赖时会在临时 clone 里装 devDeps 再跑 `prepare`。 | ccloop `package.json` | 够用；判据钉 `devDependencies.typescript` 存在。 |
| F5 | Orca 的真 ccloop E2E 从 `dirname(ORCA_CCLOOP_BIN)/../tests/fixtures/{fake-codex,fake-claude-cli}.mjs` 取夹具，包里不带 `tests/`。 | Orca `tests/control/fixtures/ccloopWorld.ts:95,107`、`tests/control/webCcloopSmoke.test.ts:58` | 这些 E2E 与 `verify:control`（`scripts/verify-control.mjs:6-10`）照旧要 `ORCA_CCLOOP_BIN` 指 checkout 的 build；**`verify-control.mjs` 不加默认**，否则它会拿包去跑这些 E2E 而红。 |
| F6 | `resolveControlOptions` 的「configured」只看 env；既有判据钉「只有 table、没有 bin ⇒ unconfigured」「bin 为空串 ⇒ unconfigured」。若在它内部做默认解析，人装上依赖之后这条判据就会随机器状态变红。 | Orca `src/panel/controlOptions.ts:108`；`tests/panel/controlOptions.test.ts:167-177` | 默认只在进程边界填（`server.ts:250-252`、`cli.ts:569-571`），`resolveControlOptions` 与其判据不动；单元判据用可注入的 `from` 路径，不依赖本仓 `node_modules`。 |
| F7 | panel 没有 ccloop 也必须能启动（裁决 R5，`src/control/unconfiguredPort.ts:5-23`）。 | 同左；`server.ts:184-185` 已有 stderr「mounted with no execution port」 | panel 缺包 ⇒ 不报新错，照旧 unconfigured（那行 stderr ＋ 拒绝即是响亮路径）；`orca agents` 缺包 ⇒ 具名 `ccloop-not-installed`，exit 1。 |
| F8 | `createCcloopExecutionPort` 要求 binary 绝对、`realpath` 等于自身、非符号链接、可执行。 | Orca `src/control/ccloopPort.ts:55-58`、`:79` | `createRequire().resolve` 返回的就是 realpath；可执行位由 npm bin-links 保证，Task 4 解包后显式 `test -x`。 |
| F9 | 离线装不了：scratch Orca clone 没有 `node_modules`，`npm install --no-save <tgz>` 需要把 Orca 全部依赖（及 ccloop 的 `zod`）装进来，改道后的 npm cache 是空的；而软链整个 `node_modules` 会让 npm 写进主树。 | Orca handoff `docs/handoff/handoff.md:443`（副本软链 `node_modules` 的做法） | Task 4 偏离派活提示：scratch Orca 的 `node_modules` 是**真目录**，里面每项软链到主树（跳过 `.vite`），`ccloop` 一项用 `tar -xzf` 从 tarball 解成真目录。git 安装全链路在 Task 5 验。 |
| F10 | `tests/scheduler/sandbox.ts:79` 注释「ccloop's package.json is `private: true`, so it is never an npm dependency」在 Task 5 之后不再为真；sandbox 仍按兄弟目录找 ccloop。 | 同左，及 `:101` 的错误文案 | 不改（只加原则；测试基础设施）；列入待清理，交控制器。 |
| F11 | Orca `README.md:397-398` 只说「scheduler 集成测试要 `ORCA_CCLOOP_BIN`」。 | 同左 | 398 行后加一段（Task 3）。 |
| F12 | npm 对 `github:` 简写的 lock `resolved` 多半记成 `git+ssh://git@github.com/blrbiran/ccloop.git#<sha>` ⇒ 以后 `npm ci` 需要 GitHub SSH 访问（仓库若私有，https 也要凭据）。 | npm 行为，未实测（离线） | Task 5 只核 `resolved` 以 `#<sha>` 结尾；协议形态记进交接。 |
| F13 | ccloop 没有 `exports` 字段，`ccloop/package.json` 可被 resolve；将来加 `exports` 必须带 `"./package.json"`。 | ccloop `package.json` | 记进 `ccloopBin.ts` 注释与交接。 |
| F14 | ccloop 的 `agents detect` 无条件搜 `/opt/homebrew/bin`、`/usr/local/bin`。 | ccloop `src/agents/types.ts:97-108` | E2E 里 `init` 只断言 codex（fake 在 PATH 首位 ⇒ 被选为 PATH 默认）；`show` 前把表重写成只含 codex，去掉本机真 claude 的影响。 |
| F15 | `prepare` 也会在 ccloop 自己的 checkout 里每次 `npm install` 时 build 一次。 | npm 生命周期 | ccloop README 写一句。 |
| F16 | 派活提示说「在 scratch Orca clone 里 `npm install --no-save <tgz>`」。 | F9 | 不这么做，理由见 F9；E2E 本身不变，Task 5 在真装好的树上再跑同一条。 |

## Interfaces

```ts
// Orca src/control/ccloopBin.ts
export class CcloopNotInstalled extends Error {} // message starts "ccloop-not-installed: "
export function installedCcloopBin(from?: string): string; // from: module file URL or absolute path; default import.meta.url
export function withDefaultCcloopBin(env: NodeJS.ProcessEnv, from?: string): { env: NodeJS.ProcessEnv; notInstalled: CcloopNotInstalled | null };
```

- `withDefaultCcloopBin`：`env.ORCA_CCLOOP_BIN !== undefined` ⇒ 原样返回同一个对象；否则返回**新对象**（不改入参）带上 `installedCcloopBin(from)`；缺包 ⇒ `{ env: 原对象, notInstalled }`；其他异常照抛。
- ccloop `package.json`：`scripts.prepare = "npm run build"`；`files = ["dist/cli.js", "dist/cli.d.ts", "dist/src/", "scripts/claude-phase-runner.mjs", "scripts/claude-stream.mjs"]`。
- opt-in 开关：`ORCA_CCLOOP_DEFAULT_E2E=1`；与 `ORCA_CCLOOP_BIN` 同时设 ⇒ 文件加载即抛错（一次正式跑不许被覆盖变量答掉）。

---

# Part A — ccloop

### Task 1: `prepare` ＋ `files`，让 git 依赖装得出能跑的 ccloop（ccloop）

**Files:**
- Create: `/Users/biran/code/skills/loop/ccloop/tests/packaging/gitDependency.test.ts`
- Modify: `/Users/biran/code/skills/loop/ccloop/package.json`（`"bin"` 块之后加 `"files"`；`"scripts"` 里 `"build"` 之后加 `"prepare"`）
- Modify: `/Users/biran/code/skills/loop/ccloop/README.md`（第 53 行「想全局有 `ccloop` 命令…」之后）

- [ ] **Step 0: 建运行环境文件**（只做一次；Task 2–4 共用）

```bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad
T=$(mktemp -d /private/tmp/cl-XXXX); H=$(mktemp -d /private/tmp/cl-XXXX)
mkdir "$H/xdg-config" "$H/xdg-cache" "$H/xdg-data" "$H/xdg-state"
printf 'export S=%s T=%s H=%s\nexport TMPDIR=%s HOME=%s XDG_CONFIG_HOME=%s/xdg-config XDG_CACHE_HOME=%s/xdg-cache XDG_DATA_HOME=%s/xdg-data XDG_STATE_HOME=%s/xdg-state\nexport ECC_GATEGUARD=off DISABLE_OMC=1 npm_config_cache=%s/npm-cache npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false\nunset ORCA_CCLOOP_BIN ORCA_AGENTS_TABLE ORCA_CCLOOP_DEFAULT_E2E NODE_PATH\n' "$S" "$T" "$H" "$T" "$H" "$H" "$H" "$H" "$H" "$H" > "$S/c-env.sh"
cat "$S/c-env.sh"
```

把 `$T`、`$H` 的字面值记进报告。

- [ ] **Step 1: 写判据** `tests/packaging/gitDependency.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeRunnerPath } from "../../src/runtime/claude/claudeAgentAdapter.js";

/**
 * Orca ruling (2026-09-29): Orca depends on ccloop by a git URL pinned to a commit. npm installs such a dependency by
 * cloning it, installing its devDependencies, running `prepare`, and packing only what `files` names. Whatever ccloop
 * reads from its own package root at run time therefore has to be in `files`, or the install succeeds and the first
 * claude phase dies on ENOENT far from here. `npm pack` against a scratch clone is the end-to-end proof (Orca plan
 * 2026-09-29-ccloop-git-dependency, Task 4); this file is the part code can answer on every run.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  files?: string[];
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** npm's `files` for plain entries: a path ships when an entry names it or a directory above it. */
function ships(path: string): boolean {
  return (manifest.files ?? []).some((entry) => {
    const name = entry.replace(/\/$/, "");
    return path === name || path.startsWith(`${name}/`);
  });
}

/** The `scripts/` files a script imports by a relative specifier. */
function localImports(path: string): string[] {
  return [...readFileSync(join(root, path), "utf8").matchAll(/from "\.\/([^"]+)"/g)].map((match) => `scripts/${match[1]}`);
}

describe("ccloop installed as a git dependency", () => {
  it("builds dist/ itself on install, with a compiler it declares", () => {
    // dist/ is gitignored, so a git install has no build unless `prepare` makes one.
    expect(manifest.scripts?.prepare).toBe("npm run build");
    expect(manifest.scripts?.build).toMatch(/^tsc -p tsconfig\.json /);
    expect(manifest.devDependencies?.typescript).toBeDefined();
  });

  it("ships its bin, the compiled runtime and the worker accept spawns", () => {
    expect(manifest.bin?.ccloop).toBe("dist/cli.js");
    // dist/src/control/worker.js: accept.ts's default worker, resolved relative to its own module.
    for (const path of ["dist/cli.js", "dist/src/cli.js", "dist/src/control/worker.js"]) expect(ships(path), path).toBe(true);
  });

  it("ships the claude phase runner and every script it imports", () => {
    // Derived, not listed: a new relative import in the runner changes the closure and turns this red until
    // `files` names it too.
    const runner = relative(root, claudeRunnerPath());
    const closure = [runner];
    for (let index = 0; index < closure.length; index += 1) {
      for (const next of localImports(closure[index]!)) if (!closure.includes(next)) closure.push(next);
    }
    expect(closure).toEqual(["scripts/claude-phase-runner.mjs", "scripts/claude-stream.mjs"]);
    for (const path of closure) expect(ships(path), path).toBe(true);
  });
});
```

- [ ] **Step 2: 跑，确认红**

Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/ccloop && ./node_modules/.bin/vitest run tests/packaging/gitDependency.test.ts > "$S/c-t1-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=1；`RUN` 行指向 `/Users/biran/code/skills/loop/ccloop`；3 条全红：第 1 条 `expected undefined to be 'npm run build'`，第 2、3 条 `ships(...)` 为 `false`（`files` 不存在）。

- [ ] **Step 3: 改 `package.json`**

在 `"bin": { "ccloop": "dist/cli.js" },` 之后插入：

```json
  "files": [
    "dist/cli.js",
    "dist/cli.d.ts",
    "dist/src/",
    "scripts/claude-phase-runner.mjs",
    "scripts/claude-stream.mjs"
  ],
```

在 `"scripts"` 里 `"build": …,` 那一行之后插入：

```json
    "prepare": "npm run build",
```

（`"build"` 行本身一字不动。）

- [ ] **Step 4: 跑，确认绿 ＋ typecheck**

Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/ccloop && ./node_modules/.bin/vitest run tests/packaging/gitDependency.test.ts tests/runtime/claude/claudeAgentAdapter.test.ts > "$S/c-t1-green.txt" 2>&1; echo rc=$?`，整份读回。Expected: rc=0，两个文件全绿，0 skipped。
Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$S/c-t1-tc.txt" 2>&1; echo rc=$?`。Expected: rc=0。
⚠️ 不在主树跑 `npm install`（有了 `prepare` 之后它会在主树 build）。

- [ ] **Step 5: README 一段**（`README.md` 第 53 行「想全局有 `ccloop` 命令，`npm link` 即可（`package.json` 已声明 `bin`）。」之后空一行插入）

```markdown
作为 Orca 的依赖时，Orca 用 git URL 钉到一个提交（`"ccloop": "github:blrbiran/ccloop#<commit>"`）。npm 会在临时 clone 里装 devDependencies、跑 `prepare`（即 `npm run build`），再只打包 `package.json` 的 `files` 列出的东西——所以除了 `dist/`，运行时从包根读的 `scripts/claude-phase-runner.mjs` 与它 import 的 `scripts/claude-stream.mjs` 也必须在 `files` 里（`tests/packaging/gitDependency.test.ts` 守着这一点）。副作用：在本仓库里 `npm install` 也会顺带 build 一次。
```

- [ ] **Step 6: diff 读回，提交（ccloop）**

```bash
cd /Users/biran/code/skills/loop/ccloop
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad
/usr/bin/git status --porcelain > "$S/c-t1-status.txt"; /usr/bin/git diff > "$S/c-t1.diff"
```

整份读回两份文件。Expected：只有 ` M package.json`、` M README.md`、`?? tests/packaging/`。

```bash
/usr/bin/git add package.json README.md tests/packaging/gitDependency.test.ts
/usr/bin/git commit -m "build: ship ccloop as a git dependency (prepare builds dist, files lists the runtime)" -m "Orca ruling 2026-09-29: Orca pins ccloop by git URL to a commit. npm installs that by cloning, installing devDependencies, running prepare and packing only 'files', so prepare now runs the build and files names dist/cli.js, dist/src/ and the two scripts the claude adapter reads from the package root at run time. tests/packaging/gitDependency.test.ts derives the runner's import closure and fails when files misses any of it." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN"
```

**Mutation**（Task 4 Step 8 里在 `$S/c-ccloop` 副本做；每条一处）:
- MP1 删 `scripts.prepare` ⇒ 红「builds dist/ itself on install…」。
- MP2 `files` 去掉 `scripts/claude-stream.mjs` ⇒ 红「ships the claude phase runner…」。
- MP3 `files` 去掉 `dist/src/` ⇒ 红「ships its bin, the compiled runtime…」。
- MP4 `files` 去掉 `dist/cli.js` ⇒ 红「ships its bin…」。
- MP5 删 `devDependencies.typescript` ⇒ 红「builds dist/ itself…」。

---

# Part B — Orca

### Task 2: `src/control/ccloopBin.ts`：从装好的包解析 ccloop（Orca）

**Files:**
- Create: `/Users/biran/code/skills/loop/Orca/src/control/ccloopBin.ts`
- Create: `/Users/biran/code/skills/loop/Orca/tests/control/ccloopBin.test.ts`

- [ ] **Step 1: 写判据** `tests/control/ccloopBin.test.ts`

```ts
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CcloopNotInstalled, installedCcloopBin, withDefaultCcloopBin } from "../../src/control/ccloopBin.js";

/**
 * ccloop dependency plan (2026-09-29) Task 2. Every criterion resolves from a consumer directory of its own, laid out
 * the way npm leaves one, so none of them depends on whether THIS checkout's node_modules holds ccloop -- before the
 * human's install it does not, after it does, and a criterion that changed colour between the two would be measuring
 * the machine. `from` is a module two levels below the consumer root, so resolution has to walk up as Node's does.
 * Precondition: NODE_PATH unset and no node_modules/ccloop above $TMPDIR (Node would find those too).
 */
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function consumer(pkg: { manifest?: unknown; build?: boolean } | null) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccb-")));
  roots.push(root);
  await mkdir(join(root, "src", "control"), { recursive: true });
  const from = join(root, "src", "control", "ccloopBin.js");
  const dir = join(root, "node_modules", "ccloop");
  if (pkg !== null) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg.manifest ?? { name: "ccloop", version: "0.1.0", bin: { ccloop: "dist/cli.js" } }));
    if (pkg.build !== false) await writeFile(join(dir, "dist", "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  }
  return { from, bin: join(dir, "dist", "cli.js") };
}

describe("the ccloop binary Orca uses when ORCA_CCLOOP_BIN is unset", () => {
  it("is the installed package's bin.ccloop, found by walking up from the calling module", async () => {
    const c = await consumer({});
    expect(installedCcloopBin(c.from)).toBe(c.bin);
    // The shipped default is import.meta.url, a file: URL, not a path.
    expect(installedCcloopBin(pathToFileURL(c.from).href)).toBe(c.bin);
  });

  it("is filled into a copy of the environment, never into the caller's", async () => {
    const c = await consumer({});
    const input: NodeJS.ProcessEnv = { ORCA_AGENTS_TABLE: "/etc/agents.json" };
    const result = withDefaultCcloopBin(input, c.from);
    expect(result).toEqual({ env: { ORCA_AGENTS_TABLE: "/etc/agents.json", ORCA_CCLOOP_BIN: c.bin }, notInstalled: null });
    // process.env is what the panel passes; a default written into it would leak into every child it spawns.
    expect(input).toEqual({ ORCA_AGENTS_TABLE: "/etc/agents.json" });
  });

  it("never overrides an explicit ORCA_CCLOOP_BIN, an empty one included", async () => {
    // The package IS installed here, so a resolver that ignored the variable would visibly replace it.
    const c = await consumer({});
    const explicit: NodeJS.ProcessEnv = { ORCA_CCLOOP_BIN: "/elsewhere/ccloop/dist/cli.js" };
    expect(withDefaultCcloopBin(explicit, c.from).env).toBe(explicit);
    // Empty is the operator saying "no execution port": controlOptions reads it as unconfigured
    // (tests/panel/controlOptions.test.ts, "calls the port configured only when both are set and non-empty").
    const empty: NodeJS.ProcessEnv = { ORCA_CCLOOP_BIN: "" };
    expect(withDefaultCcloopBin(empty, c.from).env.ORCA_CCLOOP_BIN).toBe("");
  });

  it("names a missing package instead of crashing, and leaves the environment as it was", async () => {
    const c = await consumer(null);
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(/^ccloop-not-installed: /);
    const input: NodeJS.ProcessEnv = { ORCA_AGENTS_TABLE: "/etc/agents.json" };
    const result = withDefaultCcloopBin(input, c.from);
    expect(result.notInstalled).toBeInstanceOf(CcloopNotInstalled);
    expect(result.env).toBe(input);
    expect("ORCA_CCLOOP_BIN" in result.env).toBe(false);
  });

  it("names a package installed without its build, by the path it expected", async () => {
    // What a git install looks like when `prepare` did not run: the manifest is there, dist/ is not.
    const c = await consumer({ build: false });
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(c.bin);
  });

  it("names a package whose manifest declares no ccloop bin", async () => {
    const c = await consumer({ manifest: { name: "ccloop", version: "0.1.0" } });
    expect(() => installedCcloopBin(c.from)).toThrow(CcloopNotInstalled);
    expect(() => installedCcloopBin(c.from)).toThrow(/names no bin\.ccloop/);
  });
});
```

- [ ] **Step 2: 跑，确认红**

Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/ccloopBin.test.ts > "$S/c-t2-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=1；`RUN` 行指向 Orca 主树；文件级失败 `Failed to load url ../../src/control/ccloopBin.js`（或 `Cannot find module`）。

- [ ] **Step 3: 实现** `src/control/ccloopBin.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * ccloop as a locked dependency (human ruling 2026-09-29, plan docs/superpowers/plans/2026-09-29-ccloop-git-dependency.md):
 * Orca's package.json pins ccloop to a commit by git URL, so a checkout that ran `npm install` holds the ccloop it was
 * tested against. ORCA_CCLOOP_BIN still decides whenever it is present -- empty included, because controlOptions reads
 * an empty value as "no execution port", and an explicit answer is never second-guessed by what happens to be installed.
 *
 * Resolution is Node's own (`createRequire(from).resolve("ccloop/package.json")`), so it walks node_modules upward
 * from `from` and returns a realpath, which ccloopPort's regularAbsolute requires. ccloop has no "exports" field today;
 * if it ever gains one, it must export "./package.json" or this stops resolving.
 */
export class CcloopNotInstalled extends Error {
  constructor(from: string, detail: string) {
    super(
      `ccloop-not-installed: ORCA_CCLOOP_BIN is unset and no usable ccloop package resolves from ${from} (${detail}); ` +
        `run "npm install" in the Orca checkout, or point ORCA_CCLOOP_BIN at a ccloop build's dist/cli.js`,
    );
    this.name = "CcloopNotInstalled";
  }
}

/** The installed package's `bin.ccloop`, found the way Node finds `ccloop` from `from` (a module's file URL or absolute path). */
export function installedCcloopBin(from: string = import.meta.url): string {
  let manifestPath: string;
  try {
    manifestPath = createRequire(from).resolve("ccloop/package.json");
  } catch (error) {
    throw new CcloopNotInstalled(from, String((error as NodeJS.ErrnoException).code ?? error));
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: { ccloop?: unknown } };
  const relative = manifest.bin?.ccloop;
  if (typeof relative !== "string" || relative.length === 0) throw new CcloopNotInstalled(from, `${manifestPath} names no bin.ccloop`);
  const bin = join(dirname(manifestPath), relative);
  if (!existsSync(bin)) throw new CcloopNotInstalled(from, `${bin} is missing: the package was installed without its build`);
  return bin;
}

/**
 * The environment with ORCA_CCLOOP_BIN filled in from the installed package when it is unset. A missing package is
 * returned rather than thrown: the panel boots without an execution port anyway (ruling R5), while `orca agents`
 * stops on it by name. The caller's object is never written to.
 */
export function withDefaultCcloopBin(
  env: NodeJS.ProcessEnv,
  from: string = import.meta.url,
): { env: NodeJS.ProcessEnv; notInstalled: CcloopNotInstalled | null } {
  if (env.ORCA_CCLOOP_BIN !== undefined) return { env, notInstalled: null };
  try {
    return { env: { ...env, ORCA_CCLOOP_BIN: installedCcloopBin(from) }, notInstalled: null };
  } catch (error) {
    if (error instanceof CcloopNotInstalled) return { env, notInstalled: error };
    throw error;
  }
}
```

- [ ] **Step 4: 跑，确认绿 ＋ typecheck**

Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/ccloopBin.test.ts > "$S/c-t2-green.txt" 2>&1; echo rc=$?`，整份读回。Expected: rc=0，`Tests 6 passed (6)`，0 skipped。
Run: `. …/c-env.sh && cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$S/c-t2-tc.txt" 2>&1; echo rc=$?`。Expected: rc=0。

- [ ] **Step 5: diff 读回，提交（Orca）**

```bash
cd /Users/biran/code/skills/loop/Orca
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad
/usr/bin/git status --porcelain > "$S/c-t2-status.txt"
```

读回。Expected：只有 `?? src/control/ccloopBin.ts`、`?? tests/control/ccloopBin.test.ts`（外加本轮其他 Task 自己的文件则停下核对归属）。

```bash
/usr/bin/git add src/control/ccloopBin.ts tests/control/ccloopBin.test.ts
/usr/bin/git commit -m "feat(control): resolve the ccloop binary from the installed package when ORCA_CCLOOP_BIN is unset" -m "Human ruling 2026-09-29: ccloop becomes a locked dependency of Orca by git URL. installedCcloopBin resolves ccloop/package.json the way Node does and returns its bin.ccloop; a missing package, a missing build and a manifest without the bin are each a named ccloop-not-installed error. withDefaultCcloopBin fills a copy of the environment only when the variable is absent, so an explicit value, empty included, still decides." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN"
```

**Mutation**（Task 4 Step 7 里在 `$S/c-orca` 副本做；每条一处，跑 `tests/control/ccloopBin.test.ts`）:

| 名 | 从 | 到 | 应红的判据 |
|---|---|---|---|
| M-B1 | `if (env.ORCA_CCLOOP_BIN !== undefined) return { env, notInstalled: null };` | （删） | never overrides an explicit ORCA_CCLOOP_BIN… |
| M-B2 | `env.ORCA_CCLOOP_BIN !== undefined` | `env.ORCA_CCLOOP_BIN` | never overrides…（空串那条断言） |
| M-B3 | `throw new CcloopNotInstalled(from, String((error as NodeJS.ErrnoException).code ?? error));` | `throw error;` | names a missing package… |
| M-B4 | `if (!existsSync(bin)) throw` | `if (false) throw` | names a package installed without its build… |
| M-B5 | `if (typeof relative !== "string" \|\| relative.length === 0) throw` | `if (false) throw` | names a package whose manifest declares no ccloop bin |
| M-B6 | `if (error instanceof CcloopNotInstalled) return { env, notInstalled: error };` | （删） | names a missing package…（`withDefaultCcloopBin` 那半） |
| M-B7 | `return { env: { ...env, ORCA_CCLOOP_BIN: installedCcloopBin(from) }, notInstalled: null };` | `env.ORCA_CCLOOP_BIN = installedCcloopBin(from); return { env, notInstalled: null };` | is filled into a copy of the environment… |

（M-B5 的 `\|` 是表格转义，实际字符串是 `||`。）

---

### Task 3: 边界接线、用法文字、README、opt-in E2E（Orca）

**Files:**
- Modify: `/Users/biran/code/skills/loop/Orca/src/panel/server.ts`（第 12 行 `import { resolveControlOptions, … } from "./controlOptions.js";` 之后加 import；第 250-252 行 `startPanelFromArgs`）
- Modify: `/Users/biran/code/skills/loop/Orca/src/cli.ts`（第 24 行 `import { runAgentsCommand } from "./agents/command.js";` 之后加 import；第 60 行用法；第 569-571 行 `agents` 分支）
- Modify: `/Users/biran/code/skills/loop/Orca/README.md`（第 398 行之后）
- Create: `/Users/biran/code/skills/loop/Orca/tests/control/ccloopDefaultE2E.test.ts`

- [ ] **Step 0: 扫一遍，确认没有既有判据会因默认值变色**

Run: `cd /Users/biran/code/skills/loop/Orca && /usr/bin/grep -rn "ORCA_AGENTS_TABLE" tests scripts > "$S/c-t3-scan.txt" 2>&1; echo rc=$?`（`S` 用字面值），整份读回。
Expected（2026-09-29 实测的文件集）：`tests/panel/controlOptions.test.ts`、`tests/panel/controlAssemblyDriver.test.ts`、`tests/agents/command.test.ts`、`tests/control/fixtures/ccloopWorld.ts`、`tests/control/ccloopProtocol.integration.test.ts`、`scripts/live-driver-acceptance.ts`、`scripts/verify-control.mjs`。逐个确认：前三个与 `ccloopWorld.ts` 都**显式**给 `ORCA_CCLOOP_BIN` 或直接调纯函数（不经 `startPanelFromArgs`／`cli.ts`），因此不受影响；多出任何文件 ⇒ 停下报控制器。另核 `/usr/bin/grep -rn "estimator flags\|Running work also" tests scripts`：Expected 无输出（没有判据钉用法文字）。

- [ ] **Step 1: 写 E2E** `tests/control/ccloopDefaultE2E.test.ts`

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { installedCcloopBin } from "../../src/control/ccloopBin.js";

/**
 * ccloop dependency plan (2026-09-29) Task 3: Orca against the ccloop package installed in THIS checkout's
 * node_modules, with ORCA_CCLOOP_BIN unset. Opt-in (ORCA_CCLOOP_DEFAULT_E2E=1) like the other real-ccloop criteria,
 * because what it measures is an install, not the source: before the human installs the pinned git dependency there
 * is nothing here to measure. A formal run with ORCA_CCLOOP_BIN set is refused outright, since the override would
 * answer every question this file asks.
 *
 * Deliberately NOT borrowed from ccloopWorld.ts: that fixture takes fake-codex from ccloop's tests/ tree, which the
 * package does not ship. The fake codex here is a two-line shell script, and nothing else of ccloop's is assumed.
 */
const formal = process.env.ORCA_CCLOOP_DEFAULT_E2E === "1";
if (formal && process.env.ORCA_CCLOOP_BIN !== undefined) {
  throw new Error("ccloopDefaultE2E measures the default resolution: run it with ORCA_CCLOOP_BIN unset");
}

const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

type World = { bin: string; repo: string; table: string; env: NodeJS.ProcessEnv };

async function world(): Promise<World> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccd-")));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  await chmod(bin, 0o755); // ccloop's detect never searches a world-writable PATH entry
  // First on PATH: `node` for ccloop's `#!/usr/bin/env node`, and a codex whose --version detect and validate read.
  await symlink(process.execPath, join(bin, "node"));
  await writeFile(join(bin, "codex"), "#!/bin/sh\necho 'codex-cli 9.9.9-fake'\n", { mode: 0o755 });
  const repo = join(root, "repo");
  const home = join(root, "home");
  const [config, cache, data, state] = ["config", "cache", "data", "state"].map((name) => join(root, `xdg-${name}`));
  for (const dir of [repo, home, config!, cache!, data!, state!]) await mkdir(dir);
  const table = join(root, "orca", "agents.json");
  // Rule 17: every user-data root this process tree could reach is inside `root`.
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: process.env.TMPDIR,
    XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache, XDG_DATA_HOME: data, XDG_STATE_HOME: state,
    ORCA_AGENTS_TABLE: table, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"),
  };
  return { bin, repo, table, env };
}

function orca(w: World, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxCli, "src/cli.ts", ...args], { cwd: process.cwd(), env: w.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Everything a panel wrote to stderr up to its browser hint, which comes after the ready line and after assembly. */
async function panelStderr(w: World, over: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, [tsxCli, "src/cli.ts", "panel", "--by", "e2e", "--repo", `proj=${w.repo}`, "--port", "0"], {
    cwd: process.cwd(), env: { ...w.env, ...over }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`no ready line within 60s; stdout: ${stdout} stderr: ${stderr}`)), 60_000);
      const check = (): void => { if (stdout.includes("\n") && stderr.includes("in a browser")) { clearTimeout(timer); ok(); } };
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); check(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); check(); });
      child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`panel exited ${code}; stderr: ${stderr}`)); });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  return stderr;
}

describe.skipIf(!formal)("Orca with ccloop installed as its dependency and ORCA_CCLOOP_BIN unset", () => {
  it("resolves the package in this checkout, whose runtime finds the scripts the package ships", async () => {
    const bin = installedCcloopBin();
    expect(bin).toBe(await realpath(resolve("node_modules/ccloop/dist/cli.js")));
    const pkg = dirname(dirname(bin));
    // The adapter's own answer from its dist/ location -- the layout a checkout's build never exercises.
    const adapter = (await import(pathToFileURL(join(pkg, "dist", "src", "runtime", "claude", "claudeAgentAdapter.js")).href)) as { claudeRunnerPath(): string };
    expect(adapter.claudeRunnerPath()).toBe(join(pkg, "scripts", "claude-phase-runner.mjs"));
    expect(existsSync(adapter.claudeRunnerPath())).toBe(true);
    // The runner's one relative import, loaded for real: a package without it fails here, not in a claude phase.
    const stream = (await import(pathToFileURL(join(pkg, "scripts", "claude-stream.mjs")).href)) as { createLineSplitter?: unknown };
    expect(typeof stream.createLineSplitter).toBe("function");
  });

  it("runs orca agents init and show through the installed ccloop", async () => {
    const w = await world();
    const init = await orca(w, ["agents", "init"]);
    expect(init.code, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toContain(`orca agents: wrote ${w.table}`);
    const written = JSON.parse(await readFile(w.table, "utf8")) as { installations: Record<string, { command: string[]; version: string }> };
    // First on PATH, so ccloop's detect chooses it as the PATH default over any codex in /opt/homebrew/bin or /usr/local/bin.
    expect(written.installations.codex).toMatchObject({ command: [join(w.bin, "codex")], version: "9.9.9-fake" });
    // detect also searches /opt/homebrew/bin and /usr/local/bin whatever PATH says; keep only what this world owns,
    // so `show` measures Orca and ccloop rather than whichever claude this machine has. The file keeps its 0600.
    await writeFile(w.table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { codex: written.installations.codex } }));
    const show = await orca(w, ["agents", "show"]);
    expect(show.code, show.stdout + show.stderr).toBe(0);
    expect(show.stdout).toMatch(/^codex \(codex 9\.9\.9-fake\): .* configHash [0-9a-f]{64}$/m);
  }, 120_000);

  it("boots the panel with an execution port, while an explicit empty ORCA_CCLOOP_BIN still turns it off", async () => {
    const w = await world();
    expect(await panelStderr(w, {})).not.toContain("no execution port");
    // The control: the same world with the variable present but empty. Without this, "not.toContain" could be green
    // because the line was never printed for any reason at all.
    expect(await panelStderr(w, { ORCA_CCLOOP_BIN: "" })).toContain("mounted with no execution port");
  }, 150_000);
});
```

- [ ] **Step 2: 在主树跑正式模式，确认红**（主树此时没装 ccloop 包 ⇒ 三条都该红，且红因是「没装」）

Run: `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh && cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_DEFAULT_E2E=1 ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts > "$S/c-t3-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=1；第 1 条 `ccloop-not-installed:`；第 2 条 `init.code` 为 1、输出含 `ORCA_CCLOOP_BIN must name the ccloop binary`（接线尚未做，agents 走旧路径）；第 3 条 `expected … not to contain 'no execution port'`。前置：`/usr/bin/test -e /Users/biran/code/skills/loop/Orca/node_modules/ccloop; echo rc=$?` 应为 rc=1（主树确实没装）；若为 0（人已做过 Task 5），本步 Expected 改为：第 1 条绿、第 2、3 条红，照实记录。

- [ ] **Step 3: 接线 `src/panel/server.ts`**

第 12 行之后加：

```ts
import { withDefaultCcloopBin } from "../control/ccloopBin.js";
```

第 250-252 行整段换成：

```ts
export async function startPanelFromArgs(args: string[]): Promise<StartedPanel> {
  // ccloop dependency plan (2026-09-29): ORCA_CCLOOP_BIN unset ⇒ the installed ccloop package. Filled here, at the
  // process boundary, so resolveControlOptions and its criteria keep reading only the environment. A missing package
  // leaves the variable unset and the panel boots without an execution port, as ruling R5 requires.
  const { env } = withDefaultCcloopBin(process.env);
  return createPanelServer(parsePanelArgs(args, env), env);
}
```

- [ ] **Step 4: 接线 `src/cli.ts`**

第 24 行之后加：

```ts
import { withDefaultCcloopBin } from "./control/ccloopBin.js";
```

第 569-571 行整段换成：

```ts
  if (command === "agents") {
    // ccloop dependency plan (2026-09-29): ORCA_CCLOOP_BIN unset ⇒ the installed ccloop package; neither ⇒ stop by name.
    const { env, notInstalled } = withDefaultCcloopBin(process.env);
    if (notInstalled !== null) {
      process.stderr.write(`orca agents: ${notInstalled.message}\n`);
      return 1;
    }
    return runAgentsCommand(rest, env, { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) });
  }
```

第 60 行：

```
                                 needs ORCA_CCLOOP_BIN + ORCA_AGENTS_TABLE and the two
```

换成：

```
                                 needs ORCA_AGENTS_TABLE, ccloop (ORCA_CCLOOP_BIN, else the ccloop
                                 package installed with Orca) and the two
```

- [ ] **Step 5: README**（`README.md` 第 398 行「through `ORCA_CCLOOP_BIN` when the checkout has no sibling ccloop repository.」之后空一行插入）

```markdown
`orca panel` and `orca agents` find ccloop through `ORCA_CCLOOP_BIN` when it is set
(an empty value means "no execution port"), and otherwise through the ccloop package
installed as Orca's dependency (`package.json` pins it to a commit by git URL). With
neither, `orca agents` stops with `ccloop-not-installed` and the panel starts without
an execution port. The real-ccloop criteria under `tests/control` and
`npm run verify:control` still need `ORCA_CCLOOP_BIN` pointing at a ccloop checkout's
build, because they use fixtures from ccloop's `tests/` tree, which the package does
not ship. `ORCA_CCLOOP_DEFAULT_E2E=1` (with `ORCA_CCLOOP_BIN` unset) runs
`tests/control/ccloopDefaultE2E.test.ts` against the installed package.
```

- [ ] **Step 6: 跑：typecheck、E2E 默认跳过、相邻判据不变色**

Run: `. …/c-env.sh && cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$S/c-t3-tc.txt" 2>&1; echo rc=$?`。Expected: rc=0。
Run: `. …/c-env.sh && cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts tests/control/ccloopBin.test.ts tests/panel/controlOptions.test.ts tests/agents/command.test.ts tests/panel/readyHint.test.ts > "$S/c-t3-green.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=0；`ccloopDefaultE2E.test.ts` 3 skipped（未设开关，**在报告里写明跳过数**，Rule 12），其余全绿。
Run（主树正式模式，接线后）：同 Step 2 的命令，输出写到 `"$S/c-t3-red2.txt"`。Expected: rc=1；第 1 条仍 `ccloop-not-installed:`；第 2 条 `init.code` 为 1、输出以 `orca agents: ccloop-not-installed:` 开头（接线生效，缺包具名）；第 3 条红（没装 ⇒ unconfigured）。这一步证明主树上「缺包」走的是具名错误而不是崩溃。

- [ ] **Step 7: diff 读回，提交（Orca）**

```bash
cd /Users/biran/code/skills/loop/Orca
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad
/usr/bin/git status --porcelain > "$S/c-t3-status.txt"; /usr/bin/git diff > "$S/c-t3.diff"
```

整份读回。Expected：` M README.md`、` M src/cli.ts`、` M src/panel/server.ts`、`?? tests/control/ccloopDefaultE2E.test.ts`。

```bash
/usr/bin/git add README.md src/cli.ts src/panel/server.ts tests/control/ccloopDefaultE2E.test.ts
/usr/bin/git commit -m "feat(cli): the panel and orca agents default ORCA_CCLOOP_BIN to the installed ccloop" -m "ccloop dependency plan (2026-09-29): the default is filled at the process boundary, startPanelFromArgs and the agents branch of the CLI, so resolveControlOptions and its criteria keep reading only the environment. orca agents stops with ccloop-not-installed when there is neither; the panel boots without an execution port as ruling R5 requires. tests/control/ccloopDefaultE2E.test.ts is opt-in (ORCA_CCLOOP_DEFAULT_E2E=1) and measures an installed package with ORCA_CCLOOP_BIN unset." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN"
```

**Mutation**（Task 4 Step 5 里在 `$S/c-orca` 做，跑 E2E）:
- M-W1 `src/cli.ts`：`withDefaultCcloopBin(process.env)` → `{ env: process.env, notInstalled: null }` ⇒ 红「runs orca agents init and show…」（`init.code` 为 1，`ORCA_CCLOOP_BIN must name the ccloop binary`）。
- M-W2 `src/panel/server.ts`：`withDefaultCcloopBin(process.env)` → `{ env: process.env }` ⇒ 红「boots the panel with an execution port…」（第一条断言看到 `no execution port`）。

---

### Task 4: 离线验证——打包、解包、默认解析的 E2E、全部变异（只在 scratch）

**前置：** Task 1–3 的提交都已在两个主树里；两个主树 `git status --porcelain` 为空（写进 `$S/c-t4-pre-{ccloop,orca}.txt` 读回）。`$S/c-ccloop`、`$S/c-orca`、`$S/c-pack` 都不存在（`/usr/bin/test ! -e …`）。

- [ ] **Step 0: 变异助手**（scratch 里的工具输入文件，不进仓库）

写 `$S/c-mutate.mjs`：

```js
import { readFileSync, writeFileSync } from "node:fs";
const [file, from, to] = process.argv.slice(2);
const text = readFileSync(file, "utf8");
const count = text.split(from).length - 1;
if (count !== 1) { console.error(`mutate: ${JSON.stringify(from)} occurs ${count} times in ${file}`); process.exit(3); }
writeFileSync(file, text.replace(from, () => to));
console.log(`mutated ${file}`);
```

写 `$S/c-pack-check.mjs`：

```js
import { readFileSync } from "node:fs";
const [report] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const files = new Map(report.files.map((f) => [f.path, f.mode]));
const need = ["package.json", "dist/cli.js", "dist/src/cli.js", "dist/src/control/worker.js", "dist/src/runtime/claude/claudeAgentAdapter.js", "scripts/claude-phase-runner.mjs", "scripts/claude-stream.mjs"];
const missing = need.filter((path) => !files.has(path));
const unwanted = [...files.keys()].filter((path) => /^(src|tests|validation|dist\/tests|dist\/validation)\//.test(path));
const binExecutable = ((files.get("dist/cli.js") ?? 0) & 0o111) !== 0;
console.log(JSON.stringify({ count: files.size, missing, unwanted, binExecutable }, null, 2));
process.exit(missing.length === 0 && unwanted.length === 0 && binExecutable ? 0 : 1);
```

- [ ] **Step 1: ccloop 副本 ＋ 离线 `npm pack`（经 `prepare`）**

```bash
. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$S/c-ccloop" > "$S/c-t4-clone-ccloop.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$S/c-ccloop/node_modules"
/usr/bin/test ! -e "$S/c-ccloop/dist"; echo nodist-rc=$?
mkdir "$S/c-pack"
cd "$S/c-ccloop" && npm pack --offline --pack-destination "$S/c-pack" > "$S/c-t4-pack.txt" 2>&1; echo rc=$?
/usr/bin/test -x "$S/c-ccloop/dist/cli.js"; echo built-rc=$?
ls -l "$S/c-pack" > "$S/c-t4-pack-ls.txt" 2>&1
```

整份读回 `c-t4-clone-ccloop.txt`、`c-t4-pack.txt`、`c-t4-pack-ls.txt`。
Expected: clone rc=0；`nodist-rc=0`（副本起初没有 `dist/`）；pack rc=0 且输出里有 `> ccloop@0.1.0 prepare` 与 `> npm run build`；`built-rc=0`（`dist/` 是 `prepare` 造出来的）；`c-pack/ccloop-0.1.0.tgz` 存在。

- [ ] **Step 2: 包内容清单（机械判）**

```bash
. …/c-env.sh
cd "$S/c-ccloop" && npm pack --offline --dry-run --json --ignore-scripts > "$S/c-t4-pack.json" 2> "$S/c-t4-pack-json.err"; echo rc=$?
node "$S/c-pack-check.mjs" "$S/c-t4-pack.json" > "$S/c-t4-pack-check.txt" 2>&1; echo rc=$?
```

整份读回三份文件。Expected: 两个 rc=0；`missing: []`、`unwanted: []`、`binExecutable: true`。

- [ ] **Step 3: Orca 副本，`node_modules` 为真目录（软链农场）＋ 解包 ccloop**

```bash
. …/c-env.sh
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca "$S/c-orca" > "$S/c-t4-clone-orca.txt" 2>&1; echo rc=$?
mkdir "$S/c-orca/node_modules"
for e in /Users/biran/code/skills/loop/Orca/node_modules/* /Users/biran/code/skills/loop/Orca/node_modules/.bin; do
  n=$(basename "$e"); [ "$n" = ccloop ] && continue; ln -s "$e" "$S/c-orca/node_modules/$n"
done
mkdir "$S/c-orca/node_modules/ccloop"
tar -xzf "$S/c-pack/ccloop-0.1.0.tgz" -C "$S/c-orca/node_modules/ccloop" --strip-components=1; echo tar-rc=$?
/usr/bin/test -x "$S/c-orca/node_modules/ccloop/dist/cli.js"; echo x-rc=$?
/usr/bin/test -L "$S/c-orca/node_modules/ccloop"; echo notlink-rc=$?
ls -la "$S/c-orca/node_modules/ccloop" "$S/c-orca/node_modules/ccloop/scripts" > "$S/c-t4-extract-ls.txt" 2>&1
```

整份读回。Expected: clone rc=0；`tar-rc=0`；`x-rc=0`；`notlink-rc=1`（ccloop 是真目录，不是软链——`createCcloopExecutionPort` 拒绝符号链接）；`scripts/` 下恰有 `claude-phase-runner.mjs`、`claude-stream.mjs`；包里没有 `tests/`、`src/`。
⚠️ 跳过 `.vite`：vitest 的缓存会写进 `node_modules/.vite`，软链它等于写主树。
⚠️ 若 `x-rc` 非 0：npm 真装时 bin-links 会 `chmod +x` bin，所以此处允许在副本里 `chmod 755 "$S/c-orca/node_modules/ccloop/dist/cli.js"`，但要把这一偏差写进报告（Step 2 的 `binExecutable` 若为 true 则不会发生）。

- [ ] **Step 4: 默认解析的 E2E（`ORCA_CCLOOP_BIN` 未设）＋ 单元判据**

```bash
. …/c-env.sh
cd "$S/c-orca" && ORCA_CCLOOP_DEFAULT_E2E=1 ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts tests/control/ccloopBin.test.ts > "$S/c-t4-e2e.txt" 2>&1; echo rc=$?
```

整份读回。Expected: rc=0；`RUN` 行指向 `$S/c-orca`（不是主树）；`Test Files 2 passed (2)`、`Tests 9 passed (9)`、**0 skipped**。
随后：`/usr/bin/git -C "$S/c-orca" status --porcelain > "$S/c-t4-orca-status.txt"` 读回，Expected 只有 `?? node_modules/`（或 `node_modules` 被 `.gitignore` 忽略而为空）。

- [ ] **Step 5: 接线变异 M-W1、M-W2**（每条：变 → 跑 E2E → 还原 → 证明 diff 为 0 字节）

```bash
. …/c-env.sh
node "$S/c-mutate.mjs" "$S/c-orca/src/cli.ts" 'withDefaultCcloopBin(process.env)' '{ env: process.env, notInstalled: null }' > "$S/c-mw1-apply.txt" 2>&1; echo rc=$?
cd "$S/c-orca" && ORCA_CCLOOP_DEFAULT_E2E=1 ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts > "$S/c-mw1.txt" 2>&1; echo rc=$?
cat /Users/biran/code/skills/loop/Orca/src/cli.ts > "$S/c-orca/src/cli.ts"
/usr/bin/git -C "$S/c-orca" diff > "$S/c-mw1-restore.diff"; /usr/bin/git -C "$S/c-orca" diff --cached > "$S/c-mw1-restore-cached.diff"
stat -f %z "$S/c-mw1-restore.diff" "$S/c-mw1-restore-cached.diff"
```

Expected: apply rc=0；E2E rc=1，**只**「runs orca agents init and show…」红（`init.code` 1，输出含 `ORCA_CCLOOP_BIN must name the ccloop binary`），另两条绿；两个 diff 都是 `0`。
M-W2 同形：文件 `src/panel/server.ts`，从 `withDefaultCcloopBin(process.env)` 到 `{ env: process.env }`，输出 `c-mw2*.txt`；Expected **只**「boots the panel with an execution port…」红（第一条断言看到 `mounted with no execution port`）；还原用 `cat /Users/biran/code/skills/loop/Orca/src/panel/server.ts > "$S/c-orca/src/panel/server.ts"`，两个 diff 都是 `0`。

- [ ] **Step 6: 包内容变异 M-P5**（证明 E2E 量的是包，而不是 checkout）

```bash
. …/c-env.sh
node -e 'const fs=require("fs");const f=process.argv[1];const p=JSON.parse(fs.readFileSync(f,"utf8"));p.files=p.files.filter((x)=>x!=="scripts/claude-stream.mjs");fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$S/c-ccloop/package.json"
mkdir "$S/c-pack-m5"
cd "$S/c-ccloop" && npm pack --offline --ignore-scripts --pack-destination "$S/c-pack-m5" > "$S/c-mp5-pack.txt" 2>&1; echo rc=$?
/bin/rm -rf /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-orca/node_modules/ccloop
mkdir "$S/c-orca/node_modules/ccloop" && tar -xzf "$S/c-pack-m5/ccloop-0.1.0.tgz" -C "$S/c-orca/node_modules/ccloop" --strip-components=1; echo tar-rc=$?
cd "$S/c-orca" && ORCA_CCLOOP_DEFAULT_E2E=1 ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts > "$S/c-mp5.txt" 2>&1; echo rc=$?
```

Expected: E2E rc=1，**只**第 1 条红（`import` `claude-stream.mjs` 报 `ERR_MODULE_NOT_FOUND`）。还原：

```bash
. …/c-env.sh
cat /Users/biran/code/skills/loop/ccloop/package.json > "$S/c-ccloop/package.json"
/usr/bin/git -C "$S/c-ccloop" diff > "$S/c-mp5-restore.diff"; stat -f %z "$S/c-mp5-restore.diff"
/bin/rm -rf /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-orca/node_modules/ccloop
mkdir "$S/c-orca/node_modules/ccloop" && tar -xzf "$S/c-pack/ccloop-0.1.0.tgz" -C "$S/c-orca/node_modules/ccloop" --strip-components=1; echo tar-rc=$?
cd "$S/c-orca" && ORCA_CCLOOP_DEFAULT_E2E=1 ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts > "$S/c-mp5-back.txt" 2>&1; echo rc=$?
```

Expected: diff `0`；E2E 回到 rc=0、3 passed。

- [ ] **Step 7: 单元变异 M-B1–M-B7**（Task 2 的表；在 `$S/c-orca/src/control/ccloopBin.ts` 上）

每条：`node "$S/c-mutate.mjs" "$S/c-orca/src/control/ccloopBin.ts" '<从>' '<到>'`（rc 必须 0，否则串没对上，停下）→ `cd "$S/c-orca" && ./node_modules/.bin/vitest run tests/control/ccloopBin.test.ts > "$S/c-mb<N>.txt" 2>&1; echo rc=$?` → `cat /Users/biran/code/skills/loop/Orca/src/control/ccloopBin.ts > "$S/c-orca/src/control/ccloopBin.ts"` → `git diff` 与 `git diff --cached` 各写文件、`stat -f %z` 为 `0`。
Expected：每条 rc=1，且红的**正是**表里点名的那条判据（整份读回确认，不看第一条断言就下结论——Rule 9）。

- [ ] **Step 8: ccloop 变异 MP1–MP5**（在 `$S/c-ccloop/package.json` 上，跑 `tests/packaging/gitDependency.test.ts`）

每条用 `node -e` 改 JSON（同 Step 6 的写法），例如 MP1：`p.scripts.prepare` 置 `delete`；MP2：`files` 去 `scripts/claude-stream.mjs`；MP3：去 `dist/src/`；MP4：去 `dist/cli.js`；MP5：`delete p.devDependencies.typescript`。然后：
`cd "$S/c-ccloop" && ./node_modules/.bin/vitest run tests/packaging/gitDependency.test.ts > "$S/c-mp<N>.txt" 2>&1; echo rc=$?` → `cat /Users/biran/code/skills/loop/ccloop/package.json > "$S/c-ccloop/package.json"` → `git diff`／`--cached` 字节数 `0`。
Expected：每条 rc=1，红的是 Task 1 Mutation 行点名的判据。

- [ ] **Step 9: 收尾证据**

两个主树 `git status --porcelain` 写进 `$S/c-t4-post-{ccloop,orca}.txt`，Expected 与前置相同（空）——证明主树零触碰。把 Step 1–8 的 rc 与证据文件名列成一张表交控制器；scratch 副本与 `$T`／`$H` 的清理由控制器在本轮末统一做（删之前先 `/bin/rm -f` 掉 `$S/c-ccloop/node_modules` 这个软链本身）。

---

### Task 5: 人的一步——推送 ccloop 之后，钉进 Orca（**只写不做**）

> ⚠️ agent 不执行本 Task 的任何写动作（`npm install` 改 lock、提交都在人自己的终端）。agent 只能在人做完之后，按 Step 3 的只读命令复核。
> 前提：本轮所有 ccloop 改动（含 A／B 计划若有的 ccloop 半边）都已落在 ccloop `main`，且**人已经 push**。

- [ ] **Step 1: 取被钉的提交，核它确实在 GitHub 上、且含 Task 1**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git fetch origin
SHA=$(/usr/bin/git rev-parse origin/main); echo "$SHA"
/usr/bin/git ls-remote https://github.com/blrbiran/ccloop.git refs/heads/main     # 期望打印同一个 SHA
PKG=$(/usr/bin/git log --format=%H -1 --grep='^build: ship ccloop as a git dependency' main)
/usr/bin/git merge-base --is-ancestor "$PKG" "$SHA" && echo carries-packaging        # 期望 carries-packaging
```

- [ ] **Step 2: 在 Orca 里装并钉住**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git status --porcelain                          # 期望为空
/usr/bin/git show HEAD:package-lock.json > /private/tmp/orca-lock-before.json
npm install "github:blrbiran/ccloop#$SHA"
```

- [ ] **Step 3: 核对（全部是有退出码的命令）**

```bash
cd /Users/biran/code/skills/loop/Orca
# 1) 依赖行正是人裁的形式
node -e 'const p=require("./package.json");const want="github:blrbiran/ccloop#"+process.argv[1];console.log(p.dependencies.ccloop);process.exit(p.dependencies.ccloop===want?0:1)' "$SHA"; echo rc=$?
# 2) lock 钉在同一提交，且只多了 ccloop 自己的条目
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync("/private/tmp/orca-lock-before.json","utf8")).packages,b=require("./package-lock.json").packages;const added=Object.keys(b).filter(k=>!(k in a)),removed=Object.keys(a).filter(k=>!(k in b)),changed=Object.keys(a).filter(k=>k in b&&JSON.stringify(a[k])!==JSON.stringify(b[k]));const c=b["node_modules/ccloop"];console.log(JSON.stringify({added,removed,changed,resolved:c&&c.resolved,version:c&&c.version}));process.exit(c&&c.resolved.endsWith("#"+process.argv[1])&&removed.length===0&&added.every(k=>k.startsWith("node_modules/ccloop"))&&changed.every(k=>k==="")?0:1)' "$SHA"; echo rc=$?
# 3) 只动了这两个文件
/usr/bin/git status --porcelain                          # 期望恰为 " M package.json" 与 " M package-lock.json"
# 4) 装出来的包是 build 过的、带脚本的真目录
/usr/bin/test -x node_modules/ccloop/dist/cli.js && /usr/bin/test -f node_modules/ccloop/scripts/claude-phase-runner.mjs && /usr/bin/test -f node_modules/ccloop/scripts/claude-stream.mjs && ! /usr/bin/test -L node_modules/ccloop; echo rc=$?
# 5) 同一条 E2E，这次对 npm 真装出来的包（ORCA_CCLOOP_BIN 必须未设）
T=$(mktemp -d /private/tmp/cl-XXXX); H=$(mktemp -d /private/tmp/cl-XXXX)
env -u ORCA_CCLOOP_BIN -u NODE_PATH ORCA_CCLOOP_DEFAULT_E2E=1 TMPDIR="$T" HOME="$H" XDG_CONFIG_HOME="$H/c" XDG_CACHE_HOME="$H/k" XDG_DATA_HOME="$H/d" XDG_STATE_HOME="$H/s" ./node_modules/.bin/vitest run tests/control/ccloopDefaultE2E.test.ts tests/control/ccloopBin.test.ts; echo rc=$?
npm run typecheck; echo rc=$?
```

期望：五处 rc 全为 0；E2E `Tests 9 passed (9)`、0 skipped。
- 若 1) 不为 0（npm 把依赖写成了别的形式，如 `git+https://…`）：把 `package.json` 那一行手改成 `"ccloop": "github:blrbiran/ccloop#<SHA>"`，再 `npm install` 一次，重跑 1)–5)。
- 若 2) 因 `resolved` 以 `git+ssh://` 开头而你担心别处的 `npm ci` 没有 SSH：这是 npm 对 `github:` 简写的记法（F12），不影响本机；记进交接即可。
- 若 4)／5) 红：先看 `node_modules/ccloop` 里有没有 `dist/`——没有 ⇒ `prepare` 没跑（多半是 git 安装时 devDeps 没装上），把 `npm install` 的完整输出交给下一个 agent。

- [ ] **Step 4: 提交（人的提交）**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git diff -- package.json
/usr/bin/git add package.json package-lock.json
/usr/bin/git commit -m "build: pin ccloop as a git dependency at ${SHA:0:12}" -m "Human ruling 2026-09-29: ccloop is a locked dependency of Orca by git URL pinned to a commit. With ORCA_CCLOOP_BIN unset, orca panel and orca agents now use node_modules/ccloop/dist/cli.js; tests/control/ccloopDefaultE2E.test.ts passed against this install."
```

之后 Orca 的 `sandbox.ts:79` 那句「never an npm dependency」正式过期（F10），交下一轮清理。

---

## 交接要点（给控制器写 handoff；本计划不写 handoff 文件）

- **解析顺序**：`ORCA_CCLOOP_BIN`（在场即决定，空串 ＝ 显式关）→ Orca `node_modules/ccloop` 的 `bin.ccloop` → 都没有：`orca agents` exit 1 `ccloop-not-installed`，panel 照旧无执行端口启动（R5）。只在 `startPanelFromArgs` 与 `cli.ts` 的 `agents` 分支填默认。
- **仍需 ccloop checkout 的**：`tests/control/*E2E*`、`ccloopProtocol.integration`、`webCcloopSmoke`、`verify:control`、scheduler 集成测试（`sandbox.ts` 兄弟目录／`ORCA_CCLOOP_BIN`）——它们用 ccloop `tests/fixtures`，包里没有。
- **新 opt-in E2E**：`ORCA_CCLOOP_DEFAULT_E2E=1`，且 `ORCA_CCLOOP_BIN` 必须未设；Task 4 在 scratch 的解包件上绿过，Task 5 在人真装的包上再跑。
- **人的待办（`awaitingHuman`）**：push ccloop（含 Task 1）→ Task 5 Step 1–4。Task 5 应在本轮 A／B 的 ccloop 改动都落地并推送之后再做，钉的是那时的 tip。
- **待清理**：`tests/scheduler/sandbox.ts:79,101` 的「never an npm dependency」文案（F10）；ccloop `prepare` 编译 `tests/`，测试类型错误会让 git 安装失败（F3）；lock 的 `git+ssh` 形态（F12）。
- **Task 4 的偏离**：没有 `npm install --no-save <tgz>`，而是 tar 解包进软链农场里的真目录（F9、F16）。

## Self-Review

1. **派活范围覆盖**：(1) ccloop 打包 → Task 1（`prepare`、`files`；tsc 在 devDeps，F4；运行时读取按 `import.meta.url`／`fileURLToPath`／`new URL(` 与 `scripts/` 扫过：`claudeAgentAdapter.ts:23`、`accept.ts:125`，另外三处 `import.meta.url` 只是 main 守卫 `cli.ts:442`、`workerLauncher.ts:98`、`worker.ts:271`；src 下没有非 `.ts` 文件）；`npm pack --dry-run` 清单 → Task 4 Step 2。(2) Orca 解析 → Task 2／3（`ORCA_CCLOOP_BIN` 的所有出现点：`controlOptions.ts:108`、`controlAssembly.ts:123,246`、`agents/command.ts:17,39-40`、`cli.ts:60`、`ledgerWiring.ts:287`（注释）、`unconfiguredPort.ts:5,23`（文案）、`scripts/verify-control.mjs:6-10`、`scripts/live-driver-acceptance.ts:243`；前两者经边界 env 生效，其余不改，理由见 F5／F6／F7）；判据：覆盖优先（Task 2 第 3 条）、夹具目录默认解析（第 1、2 条）、缺包具名（第 4 条，另有缺 build、缺 bin 两条）。(3) 离线验证 → Task 4。(4) 人的一步 → Task 5。(5) 文档 → Task 1 Step 5、Task 3 Step 5、交接要点。
2. **每个新分支都有删它自己的变异**：`withDefaultCcloopBin` 的覆盖分支（M-B1、M-B2）、复制而非写入（M-B7）、缺包回传（M-B6）；`installedCcloopBin` 的 resolve 失败（M-B3）、缺 bin 字段（M-B5）、缺 build（M-B4）；两处接线（M-W1、M-W2）；包内容（M-P5）；ccloop 清单（MP1–MP5）。E2E 第 3 条自带正对照（空串 ⇒ 一定打印那行），防 `not.toContain` 空绿。
3. **Rule 9 形状扫描**：没有排在被测调用之前、读回测试自己刚写值的断言；Task 2 第 2 条对 `input` 的断言排在调用**之后**，量的是「被测函数没写它」。
4. **占位符扫描**：`$SHA` 由 Task 5 Step 1 的命令算出；`$T`／`$H` 由 Task 1 Step 0 生成并写进 `c-env.sh`；`…/c-env.sh` 一律指 `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/c-env.sh`。无 TBD。
5. **名字一致**：`CcloopNotInstalled`／`installedCcloopBin`／`withDefaultCcloopBin`／`ccloop-not-installed`／`ORCA_CCLOOP_DEFAULT_E2E` 在 Interfaces、代码、判据、README、交接里拼写一致。
6. **既有判据零改动**：ccloop 只加 `tests/packaging/gitDependency.test.ts`；Orca 只加两个测试文件，`controlOptions.test.ts`、`agents/command.test.ts`、`readyHint.test.ts`、`sandbox.test.ts` 与所有 `skipIf(!ORCA_CCLOOP_BIN)` 文件不动（Task 3 Step 6 跑前三个确认不变色）。
7. **未实测、只推理的点**（Rule 12，照实标出）：npm 对 `github:` 简写写进 `package.json`／lock 的确切形式（F12，Task 5 Step 3 的 1)、2) 会量出来）；`npm pack` 是否保留 `dist/cli.js` 的可执行位（Task 4 Step 2 的 `binExecutable` 会量出来）；`agents show` 对 fake codex 的 `resolveAgent` 在真 ccloop 下 exit 0（Task 4 Step 4 会量出来）。
