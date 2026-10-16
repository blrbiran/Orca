## Task 5: `control models` and `ccloop agents models` (ccloop, part A, spec §3)

**Files:**
- Create: `src/agents/models.ts`
- Modify: `src/control/protocol.ts:9-27,132-150,152-162,291-310`; `src/control/command.ts:195-214,247-291,293-318`;
  `src/agents/command.ts:24-54`
- Test: `tests/control/modelsControl.test.ts`

**Interfaces:**
- Produces:
  - `export interface AgentModelV1 { model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }`
  - `export interface AgentModelsV1 { schema: "ccloop-models-v1"; installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: AgentModelV1[] }`
  - `export async function listAgentModels(tablePath: string, installationId: string, options?: { refresh?: boolean; log?: (line: string) => void }): Promise<AgentModelsV1>`
  - wire: `ccloop control models --agents <table>`, stdin `{"installation":"<id>","refresh":false}`; CLI `ccloop agents models --agents <table> --installation <id> [--refresh]`.

- [ ] **Step 1: failing tests** `tests/control/modelsControl.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentsCommand } from "../../src/agents/command.js";
import { runControlCommand } from "../../src/control/command.js";
import { claudeInstallation, codexInstallation, FAKE_CLAUDE_CLI, writeAgentsTable } from "./agentsFixture.js";

// Every-agent requirement chain (Orca spec 2026-10-15 §3, part A): one installation's models, sorted by model in code-unit
// order; codex lists only `list` rows; claude has no catalog command and answers none.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs"), FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
async function world() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-models-")));
  const ompMarker = join(dir, "omp-marker"), codexMarker = join(dir, "codex-marker");
  await writeFile(`${ompMarker}.catalog.json`, JSON.stringify([
    { provider: "openrouter", kind: "chat", id: "z", selector: "openrouter/z", contextWindow: 64000, maxTokens: 4096 },
    { provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens: 8192 },
    { provider: "gateway", kind: "chat", id: "B", selector: "gateway/B", contextWindow: 128000 },
  ]));
  const omp = join(dir, "omp");
  await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${ompMarker}' "$@"\n`, { mode: 0o700 });
  const script = join(dir, "script.json"); await writeFile(script, "{}\n", { mode: 0o600 });
  const t = await writeAgentsTable({
    omp: { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 50, defaultModel: "gateway/model-a", profile: null },
    codex: await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", codexMarker], sandbox: "read-only", budgetMode: "soft", timeoutMs: 60_000, killGraceMs: 100 }),
    claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", join(dir, "claude-marker"), script]),
  }, dir);
  return { dir, ...t, ompMarker, codexMarker };
}
const models = (path: string, installation: string, refresh = false) => runControlCommand(["models", "--agents", path], JSON.stringify({ installation, refresh }));

describe("control models (spec §3)", { timeout: 30_000 }, () => {
  it("answers omp's rows sorted in code-unit order with window, cap and single-call answer", async () => {
    const w = await world();
    const answer = await models(w.path, "omp");
    expect(answer.code, answer.stderr).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ schema: "ccloop-models-v1", installation: "omp", kind: "omp", source: "probe", models: [
      { model: "gateway/B", contextWindowTokens: 128000, maxOutputTokens: null, singleCallExecution: null },
      { model: "gateway/model-a", contextWindowTokens: 200000, maxOutputTokens: 8192, singleCallExecution: "v1" },
      { model: "openrouter/z", contextWindowTokens: 64000, maxOutputTokens: 4096, singleCallExecution: null },
    ] });
    expect(JSON.parse((await models(w.path, "omp")).stdout).source).toBe("cache");
  });

  it("answers codex's listed rows only, each v1-soft with no output cap", async () => {
    const w = await world();
    expect(JSON.parse((await models(w.path, "codex")).stdout).models).toEqual([
      { model: "gpt-6-luna", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
      { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
    ]);
  });

  it("answers claude with no models and source none, spawning nothing", async () => {
    const w = await world();
    expect(JSON.parse((await models(w.path, "claude")).stdout)).toEqual({ schema: "ccloop-models-v1", installation: "claude", kind: "claude", source: "none", observedAt: null, models: [] });
  });

  it("refresh probes again", async () => {
    const w = await world();
    await models(w.path, "omp"); await models(w.path, "omp", true);
    expect(readFileSync(`${w.ompMarker}.catalog-calls`, "utf8").trim().split("\n")).toEqual(["models", "models"]);
  });

  it("names a missing installation with exit 2 (RF5) and a catalog failure with exit 1 and the kind's code", async () => {
    const w = await world();
    expect(await models(w.path, "gone")).toEqual({ code: 2, stdout: "", stderr: "agent-installation-missing: gone\n" });
    await writeFile(join(w.dir, "codex-marker.catalog.json"), JSON.stringify({ exitCode: 5 }));
    const failed = await models(w.path, "codex");
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/^agent-catalog-unavailable: exit 5 · stage exit · elapsedMs \d+\n$/);
  });

  it("refuses a request without a boolean refresh", async () => {
    const w = await world();
    expect(await runControlCommand(["models", "--agents", w.path], JSON.stringify({ installation: "omp" }))).toMatchObject({ code: 2, stderr: "control-request-invalid\n" });
  });

  it("prints the same answer from `ccloop agents models`, and logs a miss on stderr", async () => {
    const w = await world();
    const cli = await runAgentsCommand(["models", "--agents", w.path, "--installation", "codex"]);
    expect(cli.code, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout).models.map((row: { model: string }) => row.model)).toEqual(["gpt-6-luna", "gpt-6-sol"]);
    expect(existsSync(`${w.codexMarker}.catalog-calls`)).toBe(true);
  });
});
```

- [ ] **Step 2: red.** P-2 → `$LOGS/t5-red.log` (expected: every test red with `control-command-invalid`).

- [ ] **Step 3: implement.** `src/agents/models.ts`:

```ts
import { readAgentCatalog } from "./agentCatalog.js";
import { ompSingleCallExecution } from "./ompModels.js";
import { readAgentsTable } from "./table.js";
import { AgentError } from "./types.js";

/** Every-agent requirement chain (Orca spec 2026-10-15 §3, part A): one installation's models, for Orca's drop-down. */
export interface AgentModelV1 { model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }
export interface AgentModelsV1 { schema: "ccloop-models-v1"; installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: AgentModelV1[] }

export async function listAgentModels(tablePath: string, id: string, options: { refresh?: boolean; log?: (line: string) => void } = {}): Promise<AgentModelsV1> {
  const table = await readAgentsTable(tablePath);
  const installation = Object.hasOwn(table.installations, id) ? table.installations[id] : undefined;
  if (installation === undefined) throw new AgentError("agent-installation-missing", id);
  const empty: AgentModelsV1 = { schema: "ccloop-models-v1", installation: id, kind: installation.kind, source: "none", observedAt: null, models: [] };
  if (installation.kind !== "omp" && installation.kind !== "codex") return empty;
  const catalog = await readAgentCatalog(installation, { refresh: options.refresh, log: options.log });
  if (catalog.catalogError !== null || catalog.rows === null) throw new Error(catalog.catalogError ?? "agent-catalog-unavailable: no rows");
  const codex = installation.kind === "codex";
  const models = catalog.rows.filter((row) => !codex || row.listed === true).map((row): AgentModelV1 => ({
    model: row.selector, contextWindowTokens: row.contextWindow, maxOutputTokens: codex ? null : row.maxTokens,
    singleCallExecution: codex ? "v1-soft" : ompSingleCallExecution(row),
  })).sort((left, right) => (left.model < right.model ? -1 : left.model > right.model ? 1 : 0));
  return { ...empty, source: catalog.source, observedAt: catalog.observedAt, models };
}
```

  `src/control/protocol.ts`: add `| "models"` to `ControlMethodV1` (after `"capabilities"`), `| { method: "models"; installation: string; refresh: boolean }`
  to `ControlRequestV1`, `| { installation: string; refresh: boolean }` to `ControlPayloadV1`, and
  `models: z.object({ installation: idSchema, refresh: z.boolean() }).strict(),` to `payloadSchemas` (the default branch of
  `attachControlMethod` already spreads it). `src/control/command.ts`: add `"models"` to `METHODS`; in `defaultHandler`
  `if (request.method === "models") return await listAgentModels(context.agentsTablePath, request.installation, { refresh: request.refresh });`;
  add the response schema and its `validateResponse` line:

```ts
// Every-agent requirement chain (Orca spec 2026-10-15 §3): refused here rather than printed for Orca to refuse whole.
const modelsSchema = z.object({
  schema: z.literal("ccloop-models-v1"), installation: z.string().min(1), kind: z.string().min(1), source: z.enum(["cache", "probe", "none"]),
  observedAt: z.string().datetime().nullable(),
  models: z.array(z.object({ model: z.string().min(1).max(200), contextWindowTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(), singleCallExecution: z.enum(["v1", "v1-soft"]).nullable() }).strict()),
}).strict();
```

  `src/agents/command.ts`: a `models` branch before `throw new AgentError("agents-command-invalid")`, parsing exactly
  `--agents <table> --installation <id> [--refresh]` (any other shape ⇒ `agents-command-invalid`), calling
  `listAgentModels(table, id, { refresh, log: (line) => process.stderr.write(\`${line}\n\`) })`, printing the JSON; update
  the doc comment at line 24 to name the new verb (it is this function's own comment; additive sentence, not an edit of
  published text -- append it as a new line).

- [ ] **Step 4: green.** P-2 `tests/control/modelsControl.test.ts tests/control/command.test.ts tests/control/protocol.test.ts tests/agents/command.test.ts` → `$LOGS/t5-green.log`; RC=0.

- [ ] **Step 5: mutations.** M5.1 `!codex || row.listed === true` → `true` ⇒ red "codex's listed rows only". M5.2 the sort
  comparator → `0` ⇒ red "sorted in code-unit order". M5.3 `if (installation.kind !== "omp" && installation.kind !== "codex") return empty;`
  deleted ⇒ red "claude ... source none" (claude has no catalog: answer would be `source: "probe"`). M5.4 in `modelsSchema`
  `.strict()` of the row → removed and a stray key added in `listAgentModels` (`{ ...row, extra: 1 }`) ⇒ only red when
  strict; record. M5.5 `refresh: request.refresh` → `refresh: false` ⇒ red "refresh probes again".

- [ ] **Step 6: commit** `src/agents/models.ts src/control/protocol.ts src/control/command.ts src/agents/command.ts tests/control/modelsControl.test.ts`,
  subject `feat(control): list an installation's models (control models, agents models)`.

---

