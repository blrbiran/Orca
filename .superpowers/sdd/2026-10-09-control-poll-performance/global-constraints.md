
- D9/M3 完整最新树是实施起点；先记录性能 before commit，再重读下列 exact files/callers，不读取在飞半成品。已有 D9/M3 行为与拒绝原样保留；偏差由 controller 裁定并写新证据。
- 不改旧 spec、旧 sdd ledger、迁移、真实 ~/.orca、ccloop/ccmem 产品；不使用跨请求 mutable business cache，statement 不跨 store。
- 命名计数只承诺被替换的 body/category/completion/latest activity 路径；其它读取单列。
- 变异只在隔离 local clone；验证日志重定向文件后整份读回，不过滤输出或吞 rc；只记录工具实报耗时/计数。
- 用户已有 session 执行授权；不再重问范围。controller 的 fresh 文档审是实施前剩余 gate。push/merge/main/删 worktree 由现有人工 gate 处理，本 plan 不执行。


## Runtime paths clarification — controller, 2026-10-09, M6 base63d9e9b

ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js (clone detached ab824d16004de2d3c1613a76ec0431520aa16cc9). Isolatedrunner /private/tmp/od9/run.py reads env.json, sets worktreecwd, HOME/fourXDG/TMPDIR/CCMEM_DATA_ROOT/corrections temporary, fakeintegrationtable=/private/tmp/od9/agents.json, no realCCMEM_CONFIG_PATH/APIkeys. Commands rtk proxy python3 /private/tmp/od9/run.py uniquelogname commandargs. M6mutationclone /private/tmp/od9/performance-task2-mutation via /usr/bin/git clone --local --no-hardlinks; never useperformance-beforeformutation. Installednode_modules dependencylinkexcludedfromstaging.
