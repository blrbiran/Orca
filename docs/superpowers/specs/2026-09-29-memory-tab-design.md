# Memory tab ＋ MemoryAdapter（goal.md N5）设计

> 会话 `2724716d`（控制器派子代理起草），2026-09-29。出处：`docs/handoff/goal.md` §10 N5；人裁 G9（§10.2：第一版只读，写入只走 correction）。
> 本文只是设计，**不含实现**。实现要等人审过本文再开（§1 S-1）。
> 文中 ccmem 源码的引用都是起草时现读的，读的是 ccmem 仓 `e4e8309`（`/Users/biran/code/skills/ccmem`）；Orca 这边现读时 HEAD 为 `084f15f`，写完时已被别的 agent 推进到 `e3f6c16`，本文未读那笔提交之后的改动。行号、字节数引用前要现测（Rule 14）。

## 0. 要做成什么

- 面板多一个 **Memory** 区：选一个仓库，列出这个仓库能看到的记忆（全局的＋这个项目的），可以搜索，点开一条看全文。
- Orca 与记忆存储之间隔一层 `MemoryAdapter`。第一版只有 ccmem 一个实现，以后别的记忆插件实现同一个接口即可接入。
- **只读**（G9）。Orca 这边在仓库外不写任何东西；但读 ccmem 会**由 ccmem 自己**在它的数据根里做迁移，这件事在 §4 按 Rule 17 登记。

### 0.1 不做（v1）

- **写入**：面板上增、删、改记忆都不做。写入口 `recordCorrection` 只保留名字，不声明方法、不实现（§2.3）。
- **「这条记忆由哪次 correction 产生」不做。** goal.md N5 原文把它列在 UI 第一版里，本文把它移出，理由是**没有数据源**：
  - ccmem 的 `memories` 表没有任何指向 Orca 的字段。`export` 输出的列是 `id, scope, project_key, type, content, pinned, source, trust_score, tags, created_at, updated_at`（`scripts/lib/cmd/export.mjs`）；`source` 是闭集 `user_explicit | tool_output | auto_inferred | cron_consolidated | cerebrum_import | external`（`scripts/migrations/001_initial.sql`），里面没有 Orca。
  - Orca 这边的 correction（`src/corrections/schema.ts`：`id`、`projectKey`、`decisionId`…）也从来没有写进过 ccmem：`orca correct` 只写 `~/.orca/corrections.jsonl`。
  - ⇒ 以后要做，至少要三件事，都不在本轮：① ccmem 侧能存一个外部引用（新列，或约定一个 tag 形状如 `orca:correction:<id>`，由 ccmem 仓人裁）；② Orca 的 `recordCorrection` 真正把 correction 写进 ccmem 并带上这个引用；③ 回填历史 correction 与否（人裁）。
- **排序**：搜索只做子串过滤，结果按固定键排序（§3.5）。相关性排序不做。ccmem 自己的混合检索（`list <query>`）不能用，理由见 §3.1。
- 缓存、分页、实时刷新（轮询／SSE）都不做。

## 1. 本会话的人裁与待人裁

| 编号 | 问题 | 状态 |
|---|---|---|
| **S-1** | 先写 spec 还是直接实现 | **人裁（2026-09-29）：先写 spec，人审过后再实现。** |
| **S-2** | N5 能否先于 §10.1 的顺序做（§10.1 把 N5 排第 5，前面是 §3.3 loop 方案层、N1、N2） | **待人裁**。控制器建议：**可以先做**。依据：N5 对 §3.3、N1 没有依赖；goal.md N5 自己写的前置只有两条——「ccmem CLI 能不能输出 JSON」「支不支持按 `projectKey` 查」——本文已按源码核过，都成立（§3.1、§3.2），且 ccmem 仓一个字不用改。 |
| **S-3** | 读 ccmem 走什么接口 | **待人裁**。控制器建议：**走 `ccmem export --json` 这个 CLI 接口**，不 vendor ccmem 的任何代码，**也不直接读它的 SQLite**。并按 Rule 17 在本文登记：这样读**可能在用户真实的 ccmem 数据根上触发 ccmem 自己的数据库迁移**（谁触发、写哪个路径、失败留什么，见 §4）。 |

S-3 不直接读 SQLite 的理由：
- ccmem handoff §15「可以直接拿去用的教训」第 1 条：**只读 SQLite 连接也会触及 SHM 元数据，`mode=ro` 不是零触碰证明。** 直接读库省不掉「碰了别人的数据」这件事，只是换成 Orca 自己去碰，还要 Orca 自己跟 ccmem 的表结构（16 个迁移、带 WAL）。
- 直接读库等于把 ccmem 的表结构抄进 Orca，与「一个字都不 vendor」（decision-ledger spec §9、ccmem handoff §15）冲突。
- 走 CLI 的代价是迁移（§4），这是 ccmem 自己的行为、由 ccmem 自己负责，Orca 只需如实登记。

## 2. `MemoryAdapter` 接口

新目录 `src/memory/`。`adapter.ts` 只放类型，不 import 任何具体实现。

### 2.1 类型

```ts
/** The repository a request is about. `repoPath` is only ever a path the panel already discovered. */
export interface MemoryScope {
  readonly projectKey: string; // the panel's key for the repo (--repo key=path, or --root discovery)
  readonly repoPath: string;
}

export interface MemoryCapabilities {
  readonly search: true;
  readonly get: true;
  /** G9: v1 is read-only. Typed as the literal `false` so no adapter can claim it until the write spec lands. */
  readonly recordCorrection: false;
}

export type MemoryErrorCode =
  | "ccmem-missing"
  | `ccmem-failed:${string}`   // exit code, or signal name
  | "ccmem-timeout"
  | "ccmem-output-too-large"
  | "ccmem-output-invalid";

export type MemoryHealth =
  | { readonly status: "ok" }
  | { readonly status: "unavailable"; readonly code: MemoryErrorCode; readonly message: string };

/** Adapter-neutral. `kind`/`source` are strings here; each adapter validates its own closed sets at its boundary. */
export interface MemoryRecord {
  readonly ref: string;                   // opaque, adapter-scoped; ccmem: the decimal row id
  readonly scope: "global" | "project";
  readonly projectKey: string | null;     // as the store recorded it (ccmem's key, not the panel's)
  readonly kind: string;                  // ccmem: type
  readonly content: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly source: string;
  readonly trust: number | null;
  readonly createdAt: string;             // ISO 8601
  readonly updatedAt: string;
}

export interface MemorySearchOptions {
  readonly query: string;  // "" means list everything in scope
  readonly limit: number;  // 1..200
}

export interface MemoryPage {
  readonly records: readonly MemoryRecord[];
  readonly total: number;      // matches before `limit`
  readonly truncated: boolean; // total > records.length
}

export interface MemoryAdapter {
  readonly id: string; // "ccmem"
  capabilities(): MemoryCapabilities;
  /** Static checks only. Must NOT start the store (for ccmem: must not spawn it -- spawning opens the DB, §4). */
  health(): Promise<MemoryHealth>;
  search(scope: MemoryScope, options: MemorySearchOptions): Promise<MemoryPage>;
  /** null when the ref is not visible in this scope (not "does not exist anywhere"). */
  get(scope: MemoryScope, ref: string): Promise<MemoryRecord | null>;
}

export class MemoryError extends Error {
  constructor(readonly code: MemoryErrorCode, message: string) { super(message); }
}
```

### 2.2 与 goal.md 草案的差别

- 草案是 `search(query, { projectKey, limit })`、`get(ref)`。本文把仓库收成 `MemoryScope`，并带上 `repoPath`：ccmem 按**进程 cwd** 算项目键（§3.2），只给 `projectKey` 它无从得知是哪个目录。
- `get` 也带 scope：ref 只在「全局 ＋ 这个项目」的集合里有效，别的项目的记忆不能靠猜 id 读到。这与 `/api/decision` 要求 `projectKey` 与 id 同时成立的做法一致（`src/panel/api.ts`）。

### 2.3 `recordCorrection`

只保留名字与语义（goal.md N5：复用 `orca correct` 的样本形状，ccmem handoff §15「对照样本」的语义）。v1 **不在接口上声明这个方法**：声明一个不实现的方法，就是给某条代码路径留下误调的口子（Rule 2）。`capabilities().recordCorrection` 的类型是字面量 `false`，写入的 spec 落地时再改类型。

## 3. ccmem adapter（`src/memory/ccmem.ts`）

### 3.1 用哪个命令

**只用 `ccmem export --json --scope <global|project>`。** 现读 ccmem 源码核过的事实：

- `export` 在 `scripts/cli.mjs` 的分派里只做一件事：`cmdExport(getDb(), { scope, projectKey })`，结果 `JSON.stringify(payload, null, 2)` 写 stdout。**不调 `maybeRunTier15`**。
- `list` 与 `show` 都先调 `maybeRunTier15(db)`，它会 `UPDATE memories` 并 `DELETE FROM recent_injections`／`task_runs`／`config_kv`（`scripts/lib/tier15.mjs`）——**是写**。`list <query>` 还会走 `retrieveMemories`，写 `query_embedding_cache`，并可能调嵌入服务（按 ccmem 配置可能是付费 API）。⇒ 这两个动词不能用于只读视图。
- `--json` 这个旗标 ccmem **并不读**：`export` 总是输出 JSON。Orca 仍然传它，因为 ccmem 的帮助文本就是这么写的（`export --json [--scope global|project]`），也为了以后 ccmem 真的区分时不出意外。
- ⚠️ `--scope` 的值 ccmem **不校验**：不是 `global`／`project`（或缺了值）时，`cmdExport` 不加任何过滤，**输出所有项目的全部记忆**。⇒ Orca 只能传这两个字面量，argv 由判据逐字断言（§6 M1）。
- 失败形状：`cli.mjs` 的主体是 `try { … } finally { closeDb(); }`，没有 `catch` ⇒ 任何异常都是 Node 未捕获异常，退出码 1，栈打在 stderr。
- 输出形状：`{ version: '0.7', exported_at: <ms>, memories: [...] }`；只含 `decay_status IN ('active','probation')` 的行，按 `id` 升序。

### 3.2 项目范围：cwd ＝ 目标仓库

- `--scope project` 时 ccmem 用 `resolveProjectKey(process.cwd())`（`cli.mjs` export 分支）。⇒ adapter 以 `cwd: scope.repoPath` 启动子进程，**项目键由 ccmem 自己算，Orca 不算**。这样本功能就不依赖 Orca 那份移植（`src/corrections/projectKey.ts`），也就没有 ccmem handoff §15 登记的「两份 `normalizeRemoteUrl` 静默分叉」风险。
- 两份实现现读对照：
  - 有 remote 时，`git config --get remote.origin.url` → `normalizeRemoteUrl`，两边逐字相同（正则一样，都不用 `git remote get-url`）。
  - **没有 remote 时两边不同**：ccmem 退到 `path:<sha256(cwd) 前 16 位 hex>`（`fallbackProjectKey`）；Orca 的移植**故意不移植**这一支，直接拒绝（`target-has-no-remote`）。
  - remote 不是 URL 形状（如 `git clone --local` 留下的路径）时：Orca 拒绝（`target-remote-not-keyable`）；ccmem 的 `new URL()` 抛异常 ⇒ `export --scope project` 退 1 ⇒ Orca 报 `ccmem-failed:1`。
- ⚠️ **无 remote 仓库的已知缺口**：ccmem 钩子写记忆时用的是钩子数据里的 `hookData.cwd`（`scripts/handlers/stop.mjs`、`session-start.mjs`），是 Claude 会话的工作目录原样字符串（可能是子目录、可能没解析软链）；Orca 启动的子进程里 `process.cwd()` 是解析过软链的仓库根（macOS 上 `/tmp` 会变成 `/private/tmp`）。两者不同时哈希不同 ⇒ **这类仓库的项目记忆可能显示为空**。v1 接受这一点，UI 在该仓库的项目段为空时写明「项目键由 ccmem 按 cwd 计算；没有 remote 的仓库可能对不上」。见 §8 Q5。
- 面板里仓库的 `projectKey`（`--repo key=path` 给的，或 `--root` 发现的）**只用来选仓库**，不传给 ccmem。记录上显示的 `projectKey` 是 ccmem 行里的 `project_key`。

### 3.3 每次调用做什么

一次 `search`／`get` ＝ **顺序**启动两次 ccmem：先 `--scope global`，再 `--scope project`（顺序而不是并发：第一次可能触发迁移，§4，并发会让两个进程争同一把写锁）。任一次失败，整个请求失败并带上那一次的错误码（Rule 12：不给半份结果）；消息里点名是哪个 scope。

子进程参数（`execFile`，不经 shell）：

| 项 | 值 |
|---|---|
| 可执行文件 | `options.ccmemBin`（§3.4） |
| argv | 逐字 `["export", "--json", "--scope", "global"]` 或 `[..., "project"]` |
| `cwd` | `scope.repoPath` |
| `env` | 面板收到的那份 env **原样**传下去（`PanelOptions.memory.env`，与 `chainEnv` 同样的注入方式），**不读 `process.env`**。`CCMEM_DATA_ROOT`、`HOME`、`PATH`（ccmem 的 `bin/ccmem` 用 PATH 上的 `node`）、`CCMEM_CONFIG_PATH` 都随之透传；Orca 不补、不删、不改任何一个 |
| stdin | `ignore` |
| `timeout` | 默认 30 000 ms，由 options 注入（判据缩短）。下限理由：ccmem `openDb` 先装 `busy_timeout = 5000`，daemon 持锁时单次开库就可能合法地等满 5 秒；迁移还要整份复制数据库（§4）。**30 秒是估的，没量过**，见 §8 Q6 |
| `maxBuffer` | 默认 64 MiB，由 options 注入。**真实 export 大小没量过**：唯一的参考是 decision-ledger spec §4 里 2026-08-29 的「9918 条记忆」（历史值，不是现值）；`ls -la ~/.claude/ccmem` 于 2026-09-29（Orca `084f15f`）看到 `global.db` 207.4M，但其中有嵌入向量，export 不输出，不能据此推 JSON 大小 |
| 超时后 | Node 默认 `SIGTERM`；报 `ccmem-timeout`。残留见 §4 |

错误映射（沿用 `src/control/ccloopPort.ts` 的写法）：

- `ccmemBin` 为 `null` ⇒ `ccmem-missing`，**不启动任何进程**；`ENOENT`／`EACCES` ⇒ `ccmem-missing`（消息写路径与原因）；
- 超出 `maxBuffer` ⇒ `ccmem-output-too-large`；被超时杀掉 ⇒ `ccmem-timeout`；
- 其他非 0 退出 ⇒ `ccmem-failed:<退出码>`（被信号杀 ⇒ `ccmem-failed:<信号名>`），消息附 stderr 的前 2 KiB；
- 退出 0 但 stdout 不是 JSON，或不过 §3.6 的 schema ⇒ `ccmem-output-invalid`，消息点名第一处不符（路径＋行 id）。

### 3.4 找到 ccmem 可执行文件

- `ORCA_CCMEM_BIN`：绝对路径，从传入的 env 读，在 `parsePanelArgs(args, env)` 里解析（与 `correctionsDir(env)` 同一时机），存进 `PanelOptions.memory.ccmemBin`。
- **没设 ⇒ `null` ⇒ memory 区显示「未配置」，不去 PATH 上找。** 这与 `ORCA_CCLOOP_BIN` 的约定一致（`src/panel/controlOptions.ts`：没设就是 `unconfigured`，Rule 11），也让判据只有在**点名**一个 ccmem 路径时才可能碰到真的 ccmem（§6.2）。本机 `/usr/local/bin/ccmem` 是指向 ccmem 仓 `bin/ccmem` 的软链，人要用就把 `ORCA_CCMEM_BIN` 设成它。是否改成「没设就在 PATH 上找 `ccmem`」见 §8 Q3。
- `health()` 只做静态检查：已配置、是绝对路径、`stat`（跟随软链）是普通文件、`access(X_OK)` 通过。**不启动 ccmem**——任何一次启动都会开库（§4）。

### 3.5 搜索（Orca 这边做）

- `query` 先 `trim()`，长度 0–200 个 code point，含控制字符拒绝（`memory-query-invalid`，由路由层查）。
- 匹配：`query` 与候选文本都做 NFC 后 `toLowerCase()`，**子串**包含即命中；候选文本 ＝ `content` 以及每个 tag 各自一份。空 query 命中全部。
- 排序（固定键，不是相关性）：`pinned` 在前 → `updatedAt` 降序 → `ref` 按数值降序。
- `total` ＝ 命中数，`records` ＝ 前 `limit` 条。

### 3.6 export 的 zod schema（strict）

依据 `001_initial.sql` 的 `memories` 定义、`export.mjs` 的列清单、`save.mjs` 写 tags 的方式（`JSON.stringify(uniqueTags(tags))`；老行可能是 `NULL`）现读得出：

```ts
const ccmemExportRowSchema = z.object({
  id: z.number().int().positive(),
  scope: z.enum(["global", "project"]),
  project_key: z.string().nullable(),
  type: z.enum(["rule", "fact", "episode", "consolidated"]),
  content: z.string(),
  pinned: z.union([z.literal(0), z.literal(1)]),
  source: z.enum(["user_explicit", "tool_output", "auto_inferred", "cron_consolidated", "cerebrum_import", "external"]),
  trust_score: z.number(),
  tags: z.string().nullable(),          // JSON text of string[]; parsed below
  created_at: z.number().int(),          // ms since epoch
  updated_at: z.number().int(),
}).strict();

const ccmemExportSchema = z.object({
  version: z.literal("0.7"),
  exported_at: z.number().int(),
  memories: z.array(ccmemExportRowSchema),
}).strict();
```

- `tags`：`null` ⇒ `[]`；否则 `JSON.parse` 必须得到字符串数组，否则整份 `ccmem-output-invalid`（点名行 id）。不学 ccmem `import` 那样把坏 tags 静默当 `[]`。
- 每一行还要满足：`--scope global` 的应答里 `scope === "global"`；`--scope project` 的应答里 `scope === "project"` 且 `project_key` 非空。不满足 ⇒ `ccmem-output-invalid`。这一条防的正是 §3.1 那个「scope 值不对就吐全部」的形状。
- **strict 的代价**：ccmem 以后给 export 加一列、给 `type`／`source` 加一个值，Orca 的 memory 区就整个报 `ccmem-output-invalid`。这是有意的（Rule 12：大声失败，而不是静默丢字段）；跨仓词表不一致是 ccmem handoff §15 记录过的反复根因。可逆，控制器定。

### 3.7 缓存

不缓存，每个请求现调。`get` 也重新 export 两次再按 `ref` 找。理由：ccmem 的数据被钩子与 daemon 持续改写，缓存就要回答「何时失效」，v1 没有这个需求。实施时量一次单请求耗时（量法：计时 fake 与真 ccmem 各一次，记命令与 commit）；如果慢到影响使用，再议请求内去重，不在本轮。

## 4. Rule 17 登记：Orca 触发的、写在仓库外的东西

**Orca 自己在仓库外不写任何文件。** 但 Orca 启动的 `ccmem export` 会写 ccmem 的数据根。以下按 ccmem 源码现读（`scripts/lib/db.mjs` `openDb`／`runMigration`／`createMigrationBackup`／`pruneMigrationBackups`，`scripts/lib/paths.mjs` `getDataRoot`）：

- **谁触发**：面板进程，在处理 `GET /api/memory/list|search|item` 时（`/status` 不触发）。前提是人设了 `ORCA_CCMEM_BIN`。
- **写哪个路径**：`$CCMEM_DATA_ROOT`；没设时是 ccmem 自己算的 `os.homedir()/.claude/ccmem`（POSIX 上取子进程 env 的 `HOME`）。两者都取自 Orca 透传的 env。本机默认数据根是 `~/.claude/ccmem`。
- **每次都会发生的**：`mkdirSync(dataRoot, { recursive: true })`（不存在时按 umask 建）；打开 `global.db`（不存在时**新建一个空库并建全套表**）；`PRAGMA journal_mode = WAL`；`global.db-wal`／`global.db-shm` 的读写与元数据变化；`reconcileFtsArtifacts` 在 FTS 表或触发器缺失时补建。
- **只在有待跑迁移时发生的**（ccmem 代码比库新，即人更新了 ccmem、还没有任何钩子开过库）：
  - 迁移前**整份复制**数据库为 `global.db.bak.<毫秒时间戳>`（已有可复用的备份时跳过）。本机 2026-09-29 `ls -la ~/.claude/ccmem` 看到 `global.db` 为 207.4M，即一次复制约这么大；
  - 然后按 `migration_backup.max_keep`（缺省 5）**删除更早的备份**。本机同一次 `ls` 看到已有 5 个 `global.db.bak.*`，即一次迁移会删掉最早的一个；
  - 逐个跑 `scripts/migrations/` 下的迁移。
- **失败留什么**：
  - 超时被 `SIGTERM` 杀在复制备份途中 ⇒ 可能留下**不完整的 `global.db.bak.<ts>`**（而 ccmem 的「可复用备份」判定会不会把它当成可用备份，**未核**）；
  - 杀在迁移途中 ⇒ 迁移是否整体在一个事务里，**未核**（`runVersionedMigration` 没读）；
  - 数据根原本不存在 ⇒ 留下一个新建的空 ccmem 库。
- **mode**：以上文件与目录都由 ccmem 按 umask 建（本机观测为 `644`），**不适用** Orca Rule 17 的 `0700／0600` 条款——那一条管的是 Orca 自己写的东西；ccmem 的数据按 ccmem 的规则（Rule 16）。
- **缓解**：① 不设 `ORCA_CCMEM_BIN` 就不会启动 ccmem（§3.4）；② 超时取 30 秒而不是几秒，降低杀在复制途中的概率；③ memory 区状态行写明「读取经 ccmem，ccmem 可能在自己的数据根里迁移」。**不**让 Orca 预先检查 `global.db` 是否存在：那需要 Orca 复制 ccmem 的 `getDataRoot` 规则，等于再造一个 `projectKey` 式的双份实现。

## 5. HTTP 与 Web

### 5.1 路由（`src/panel/memoryApi.ts`，挂在现有 `/api` token 中间件之后）

全部是 GET；仓库用查询串 `projectKey` 选（它含 `/`，同 `/api/decision` 的理由）。`projectKey` 必须是本次请求里面板**已经发现**的仓库之一（沿用 `/api/decision` 的做法：路径只能来自发现结果，绝不由用户输入拼路径），否则 `404 memory-repo-unknown`，**不启动 ccmem**。

| 路由 | 参数 | 成功应答 |
|---|---|---|
| `GET /api/memory/status` | — | `{ adapter: { id, capabilities }, health, repos: [{ projectKey }] }` |
| `GET /api/memory/list` | `projectKey`，`limit`（默认 50，1–200） | `{ projectKey, query: "", page: MemoryPage }` |
| `GET /api/memory/search` | `projectKey`，`q`，`limit` | `{ projectKey, query, page: MemoryPage }` |
| `GET /api/memory/item` | `projectKey`，`ref`（`^[1-9][0-9]{0,15}$`） | `{ record: MemoryRecord }` |

- 应答各有一个 **strict** 的 zod schema（`memoryStatusResponseSchema`、`memoryPageResponseSchema`、`memoryItemResponseSchema`），服务端发出前自己 `parse` 一遍，web 端解码用同一份形状（web 与服务端怎么对齐，实施时现读 `tests/panel/webParity.test.ts` 的做法照办）。
- 错误体沿用 `{ code, message }`：`ccmem-missing` → 503；`ccmem-failed:*`／`ccmem-timeout`／`ccmem-output-too-large`／`ccmem-output-invalid` → 502；`memory-repo-unknown`／`memory-not-found` → 404；`memory-query-invalid`（含 `limit`、`ref` 格式不对）→ 400。
- **G9 的机械体现**：`/api/memory` 下不注册任何非 GET 路由；判据断言 POST／PUT／DELETE 得到 404。

### 5.2 Web

- `web/src/sections.ts` 的 `SECTIONS` 加 `"memory"`（排在 `"metrics"` 前后由实施时按导航实际定，不影响语义）；`Shell.tsx` 的导航随之出现；URL hash `#memory`。
- 新组件 `web/src/MemoryView.tsx`，请求封装放 `web/src/memoryApi.ts`：
  - 顶部：仓库选择（来自 `/status` 的 `repos`；只有一个就不显示下拉）＋状态行（`health` 不是 `ok` 时显示错误码与消息，下面的列表不请求）；
  - 搜索框：回车或按钮才发请求，**不按键即搜、不轮询**（每次请求都要启动两次 ccmem）；
  - 列表：每行显示 scope 徽标（global／project）、`kind`、`pinned`、内容前 200 个字符、tags、`updatedAt`；`truncated` 时在列表底部写「显示 N / 共 M 条，缩小搜索范围」；
  - 详情：点一行后请求 `/item`，显示全文与全部字段；
  - 错误：原样显示错误码（复用 `Refusal`）。
- 不显示任何写操作的按钮。

## 6. 判据（每个新分支点名一条删掉它自己的变异，看见红才算）

### 6.1 夹具

- **fake ccmem**：`tests/memory/fixtures/fake-ccmem.mjs`（带 shebang、可执行）。每次被调用往 `$FAKE_CCMEM_LOG` 追加一行 JSON：`{ argv, cwd: process.cwd(), env: { CCMEM_DATA_ROOT, HOME } }`。行为由 `$FAKE_CCMEM_MODE` 选：`ok`（从 `$FAKE_CCMEM_DATA` 读 `{ global: [...], project: [...], all: [...] }` 按 argv 的 scope 输出；**scope 不是两个字面量时输出 `all`，里面放别的项目的行**）、`exit:<n>`、`sleep`、`garbage`、`huge`、`extra-field`、`bad-enum`、`bad-tags`、`wrong-scope`。
- **每个判据的 env 由一个 helper 生成**（`tests/memory/helpers.ts` `ccmemCriterionEnv()`）：`CCMEM_DATA_ROOT` 指向本文件的临时目录、`ORCA_CCMEM_BIN` 指向 fake、`FAKE_CCMEM_LOG` 在临时目录里。
- ⚠️ 夹具不许「对所有输入答同一个常量」（ccmem handoff §15 第 10 条）：global 与 project 两份数据内容不同，`all` 与两者都不同。

### 6.2 不碰真实 ccmem 数据根的护栏

照 `tests/setup/relocateUserData.ts` 的思路，但**不能照搬它的快照比对**，理由是实测的：真实数据根有**活的写入方**。2026-09-29 `ls -la ~/.claude/ccmem`（Orca `084f15f`）看到 `daemon.err.log`、`daemon-cost.jsonl`、`metrics.jsonl`、`global.db-wal`（55.2M）等，而 ccmem 的钩子在**每次** `UserPromptSubmit`／`Stop` 都会开库（`hooks/hooks.json`）——跑测试的这个 Claude 会话本身就在写它。按大小或 mtime 比对必然因无关写入而红；而最可能的一种触碰（打开一个已存在、无需迁移的库）只动 WAL／SHM 的内容，在活写入方旁边根本分辨不出来。所以护栏分三层：

1. **改道（防止忘）**：新 setup 文件 `tests/setup/relocateCcmem.ts` 在每个测试文件开始前把 `process.env.CCMEM_DATA_ROOT` 设成本文件的临时目录，文件结束删掉；加进 `vitest.config.ts` 的 `setupFiles`。继承 `process.env` 的任何子进程都落在临时目录。
2. **收窄入口（防止绕过）**：adapter 只从 `PanelOptions.memory` 拿可执行文件与 env，没有任何缺省路径（§3.4）。一个判据要碰到真的 ccmem，只能**亲手写出**它的路径；这类判据只有 §6.3 的 R1 一条，且必须用 `ccmemCriterionEnv()`。
3. **快照（只抓看得见的那部分）**：同一个 setup 文件记录真实数据根（用 `homedir()/.claude/ccmem`，并允许 `ORCA_TEST_CCMEM_REAL_ROOT` 为护栏自己的判据改道）的**条目名集合**，文件结束比对：多出 `global.db.bak.*`、少掉任何条目、或数据根从无到有，都红，并点名。它看得见「触发迁移」「新建数据根」，**看不见「开了一次已有的库」**——这个盲区在本文登记，由第 1、2 层兜。
   - 护栏自己的判据：把 `ORCA_TEST_CCMEM_REAL_ROOT` 指向一个临时目录，往里新增一个 `global.db.bak.1`，断言比对函数报差异；删掉一个条目，同样报差异。**这条判据绝不指向真实数据根。**

### 6.3 判据清单

| 编号 | 断言 | 删掉它自己的变异 |
|---|---|---|
| **M1** | fake 日志里 argv 逐字为 `["export","--json","--scope","global"]` 与 `[…,"project"]`，顺序先 global 后 project | 去掉 `--scope project` 的值 ⇒ fake 吐 `all` ⇒ 行校验（§3.6 第二条）报 `ccmem-output-invalid` ⇒ 断言「成功」的格红；再删行校验 ⇒ 断言「结果里没有别的项目」的格红 |
| **M2** | fake 日志里 `cwd` 等于 `realpath(repoPath)` | 改成不传 `cwd` ⇒ 红 |
| **M3** | fake 日志里 `CCMEM_DATA_ROOT`、`HOME` 等于判据传给 `parsePanelArgs` 的 env 里的值，而**不是** `process.env` 里的（判据故意让两者不同） | 子进程改用 `process.env` ⇒ 红 |
| **M4** | `ORCA_CCMEM_BIN` 未设 ⇒ `/status` 的 `health` 为 `unavailable/ccmem-missing`，`/list` 为 503 `ccmem-missing`，fake 日志**不存在**。判据同时在 env 的 `PATH` 前面放一个名为 `ccmem` 的 fake | 加上「在 PATH 上找 `ccmem`」 ⇒ fake 日志出现 ⇒ 红 |
| **M5** | `exit:3` ⇒ 502 `ccmem-failed:3`，消息含 stderr 与 scope 名 | 把所有非 0 都报成同一个码 ⇒ 红 |
| **M6** | `sleep` ＋ 注入 `timeoutMs: 200` ⇒ `ccmem-timeout`，且在 2 秒内返回 | 去掉 `timeout` ⇒ 判据超时红 |
| **M7** | `huge` ＋ 注入小 `maxBuffer` ⇒ `ccmem-output-too-large` | 去掉 `maxBuffer` 的分支 ⇒ 红 |
| **M8** | `garbage`、`extra-field`、`bad-enum`、`bad-tags`、`wrong-scope` 各一格 ⇒ `ccmem-output-invalid`，消息点名行 id | 各自：schema 改 `.passthrough()`；`type` 放宽成 `z.string()`；坏 tags 当 `[]`；去掉行 scope 校验 ⇒ 对应格红 |
| **M9** | 搜索：大小写不敏感、NFC（`é` 的两种写法互相命中）、只命中 tag 的也算、空 query 列全部、排序键、`limit` 与 `truncated`／`total` | 只搜 `content` ⇒「只命中 tag」格红；去掉 NFC ⇒ `é` 格红；排序改成 id 升序 ⇒ 排序格红 |
| **M10** | `/item`：global 与本项目的 ref 可读；fake 数据里只在 `all` 出现的 ref ⇒ 404 `memory-not-found` | `get` 改为不限 scope ⇒ 红 |
| **M11** | 未发现的 `projectKey` ⇒ 404 `memory-repo-unknown`，fake 日志不存在；`q` 超长、含控制字符，`limit` 0 或 201，`ref` 非数字 ⇒ 400 | 去掉仓库成员检查 ⇒ 日志出现 ⇒ 红 |
| **M12** | G9：`POST`／`PUT`／`DELETE /api/memory/list` ⇒ 404；`capabilities().recordCorrection === false`；无 token ⇒ 401 | 注册一个 POST ⇒ 红 |
| **M13** | 每个成功应答过 strict 的应答 schema；服务端发出前的自检在应答多一个键时抛错 | 删掉自检 ⇒ 判据里人为塞一个键的那一格红 |
| **R1** | **真 ccmem**（`describe.skipIf(!process.env.ORCA_CCMEM_REAL_BIN)`）：临时 `CCMEM_DATA_ROOT`、临时 git 仓（`remote.origin.url` 设成 `https://example.invalid/o/r.git`），用同一个真 ccmem 在临时根里 `save` 一条全局、一条项目记忆（`save <content> [--global]`，cwd 为临时仓），再经 adapter 读回：两条都在，字段过 §3.6 的 schema。这条补的是「fake 只认形状」（ccmem handoff §15 第 10 条）| 把 schema 的 `tags` 改成 `z.array(z.string())` ⇒ 红（真 ccmem 输出的是 JSON 文本）|
| **W1** | web（jsdom）：`#memory` 显示；未配置时显示状态行、不请求列表；搜索只在提交时请求；`truncated` 提示；详情请求 `/item`；错误显示错误码；页面上没有写操作按钮 | 改成按键即搜 ⇒「提交才请求」格红 |
| **G1** | §6.2 第 3 层的护栏判据 | 比对函数恒返回「相同」⇒ 红 |

R1 会调用嵌入吗：`save` 按 ccmem 配置可能计算嵌入。判据的临时根里没有 `config.json` ⇒ ccmem 用 `DEFAULT_CONFIG`（`config.mjs` `loadConfig`）。`config.default.json` 的嵌入 `provider` 缺省是 `transformers-local`（现读），即不调付费 API；但本地模型首次使用会不会联网下载、会不会慢到超时，**未核**。实施时先量；若会联网或太慢，改用 `ccmem import <file>` 灌数据（`cmdImport` 是否同样计算嵌入，也要一并核），并在台账记一行。

### 6.4 收尾的门（成功判据）

Orca 全新 `git clone --local` 副本，HOME 与四个 XDG 根改道，`TMPDIR` 用短路径真目录，json reporter，结果重定向到文件再整份读回（Rule 14，不过滤）：

```sh
npm run typecheck                                                  # RC 0
npx vitest run --reporter=json --outputFile="$OUT/all.json"        # RC 0（已登记的 flake 除外，逐条点名）
ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem \
  npx vitest run tests/memory/ccmemReal.test.ts --reporter=json --outputFile="$OUT/real.json"   # RC 0
node -e 'const r=require(process.argv[1]);const t=r.testResults.flatMap(f=>f.assertionResults);process.exit(t.length>0&&t.every(a=>a.status==="passed")?0:1)' "$OUT/real.json"   # RC 0：R1 是 passed，不是 skipped
npm run build --workspace web && npm run --ws check                # RC 0
node scripts/check-tmp-leak.mjs                                    # RC 0
```

外加真实数据根的**条目名**前后相同（只比名字，理由见 §6.2）：门开始前 `ls -1A ~/.claude/ccmem > "$OUT/ccmem-before.txt"`，结束后同样写 `after`，`cmp "$OUT/ccmem-before.txt" "$OUT/ccmem-after.txt"` RC 0。真 `~/.orca` 前后 `stat` 相同（沿用既有门）。

## 7. 既有判据会不会被动到（Rule 15(a) 预先登记）

- `web/src/sections.ts` 加一项：断言 `SECTIONS` 全等的判据（若有，如 `web/tests/shell.test.tsx`）要改。实施时现读，未经人指名不改；能只加不改的一律只加。
- `vitest.config.ts` 的 `setupFiles` 多一个文件：不改任何判据，但会影响所有测试文件的环境（多一个 `CCMEM_DATA_ROOT`），全量跑一遍确认。
- `PanelOptions` 多一个 `memory` 字段：`parsePanelArgs` 的返回若在某条判据里被 `toEqual` 整个对象比对，那条会红。实施时现读并报人。

## 8. 待人裁与开放问题

- **Q1（＝S-2）** N5 是否提前到 §3.3、N1、N2 之前做。控制器建议：可以（§1）。
- **Q2（＝S-3）** 读 ccmem 走 `ccmem export --json`，不 vendor、不直接读 SQLite；并接受 §4 登记的后果：**面板读记忆可能在你真实的 `~/.claude/ccmem` 上触发 ccmem 自己的迁移，包括复制一份约 200 MB 的备份、删除最早的一份旧备份**。控制器建议：接受。
- **Q3** `ORCA_CCMEM_BIN` 没设时：本文定为「未配置、不启动」（与 `ORCA_CCLOOP_BIN` 一致）。另一种是在 PATH 上找 `ccmem`（本机能找到 `/usr/local/bin/ccmem`），用起来省一步，但任何继承了真实 PATH 的判据都可能碰到真 ccmem。控制器建议：维持本文。
- **Q4** 护栏的形状与任务原意不同：原意是照 `relocateUserData.ts` 做快照比对，本文改为「改道 ＋ 收窄入口 ＋ 只比条目名」，理由是真实数据根有活的写入方（§6.2 的实测）。请确认接受这个盲区：「打开一个已有的库」这种触碰，护栏看不见。
- **Q5** 没有 remote 的仓库，项目记忆可能对不上（§3.2）。v1 只在 UI 上说明，不修。要修就得改 ccmem（例如让 export 接受显式的 `--project-key`），属于 ccmem 仓的人裁。
- **Q6** 超时 30 秒、输出上限 64 MiB 都是估的。量真实 export 的大小与耗时就要对真实数据根跑一次 ccmem（或者用 `sqlite3 -readonly` 做 `.backup` 再量副本），都属于碰你的数据。是否授权量一次？不授权就按估值做，第一次真用时看到 `ccmem-timeout`／`ccmem-output-too-large` 再调。
- **Q7** 「这条记忆由哪次 correction 产生」移出 v1（§0.1）。以后要做，需要 ccmem 侧先能存外部引用，这要不要在 ccmem 仓立项、何时立项。

## 9. 人裁（2026-09-29，会话 `2f65a729` 追加；上文原样保留）

人原话：「Q1–Q7 按上面的建议定」。逐条：
- **Q1／S-2**：**不提前**；排在 goal.md §10.1 的 §3.3 loop 方案层之后。
- **Q2／S-3**：**接受** `ccmem export --json` 与 §4 登记的迁移后果（迁移是 ccmem 自己的行为，下一次 Claude 会话的钩子开库同样会触发）。
- **Q3**：`ORCA_CCMEM_BIN` 没设 ⇒ 未配置、不启动（维持本文）。
- **Q4**：接受护栏形状与它的盲区（「打开一个已有的库」看不见）。
- **Q5**：v1 只在 UI 上说明，不修；要修归 ccmem 仓。
- **Q6**：**不对真实数据量**；实现前先**读 ccmem 源码**核 §4 的两处「未核」——① 被杀在复制途中的半截 `global.db.bak.<ts>` 会不会被当成可复用备份；② `runVersionedMigration` 是否整体在一个事务里。结论安全就按估值（30 s／64 MiB）做；不安全则先在 ccmem 侧加保护，届时再找人。
- **Q7**：现在不在 ccmem 仓立项。

## 10. Plan-time corrections (2026-10-03, session `184d0372`; the text above is kept verbatim)

Source: `docs/superpowers/plans/2026-10-03-memory-tab.md`, "Drafter findings". Where this section and the text above disagree, this section wins.

- **§5.1 (D1)** Repository membership is the panel's discovery, `discoverRepos({ root, repos })`, re-run on every request. It is not `currentMetrics`: the corrections integrity gate guards the correction rate's denominator and has no bearing on reading memory. Discovery's own refusals (`repo-path-missing`, `key-matches-multiple-paths`) still answer 409.
- **§6.2 layer 3 and §6.4 (D2)** The real data root has live writers that create and delete entries of their own (`daemon.wake`; `global.db-wal`/`global.db-shm`, removed by SQLite on the last clean close; listing at Orca `c91d029`). The name comparison flags exactly: the root appearing where there was none; a new `global.db.bak.*` or `global.db-wal.bak.*`; `global.db` disappearing. Other additions and removals are ignored, both in the per-file guard and in the gate.
- **§6.2 layer 3 (D3)** No `ORCA_TEST_CCMEM_REAL_ROOT`. The comparison functions take the root as an argument; the guard's own criterion passes a temp directory.
- **§6.3 R1 (D4)** R1 seeds the temp data root with `ccmem import <file>`, not `save`: `save` embeds synchronously (`transformers-local` by default) and may download a model; `import` inserts with `embedSync: false` and resolves a null `project_key` from the cwd (probe in the plan).
- **§3.4 (D5)** A relative `ORCA_CCMEM_BIN` is refused as `ccmem-missing` without starting a process; `execFile` would otherwise resolve it against the target repository.
- **§6.1 (D6)** The fake is committed as a plain file and run through a `#!/bin/sh` wrapper written at test time with mode `0o755`, as every fake in this repository is.
- **§5.2 (D8)** The view requests nothing until its section is first opened (all panes stay mounted; a fetch on mount would start ccmem on every panel load).
- **§3.6 (D11)** `created_at` and `updated_at` are bounded to `0..8_640_000_000_000_000`; outside that range the export is `ccmem-output-invalid`, naming the row.
