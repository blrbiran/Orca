## Task 13: The model list API (Orca, part C server, spec §5)

**Files:**
- Modify: `src/control/executionPort.ts:44-46` (optional `listModels`), `src/control/ccloopPort.ts` (schema + method),
  `src/control/webProtocol.ts` (`agentModelsViewSchema` after `agentsViewSchema` at 1763), `src/panel/controlApi.ts:36,289-309`
- Modify (fixture, listed for the human): `tests/panel/fixtures/controlPanel.ts:67-77,144-150` (`BootOptions.listModels`)
- Test: `tests/panel/agentModelsApi.test.ts`, `tests/control/ccloopModels.test.ts`

**Interfaces:**
- Produces:
  - `ExecutionPort.listModels?(installation: string, refresh: boolean): Promise<AgentModelsView>`;
    `AgentModelsView = { installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null; models: Array<{ model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }> }`
  - `agentModelsViewSchema` (`schema: "orca-agent-models-v1"` + the fields above), exported from `webProtocol.ts`
  - `GET /api/control/agents/:installation/models[?refresh=1]` → 200 view; 400 `query-invalid`; 403 `owner-required` (refresh by a member); 401 without a session; 424 `ccloop-failed` with `ccloop-failed:<code>: <detail>`.

- [ ] **Step 1: failing tests.** `tests/control/ccloopModels.test.ts` (real ccloop build): build a table with the build's
  fake codex (as `webCcloopSmoke.test.ts:56-62` does), `createCcloopExecutionPort({...}).listModels!("codex", false)` ⇒
  `toEqual({ installation: "codex", kind: "codex", source: "probe", observedAt: expect.any(String), models: [
  { model: "gpt-6-luna", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
  { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" } ] })`; the
  second call answers `source: "cache"`; `listModels!("gone", false)` rejects with `{ code: "agent-installation-missing" }`
  (`named()` maps it). `tests/panel/agentModelsApi.test.ts` with `createHarness` + `BootOptions.listModels` (harness,
  `boot` and `afterAll(dispose)` set up exactly as `tests/panel/agentSelectionApi.test.ts` does):

```ts
// Spec 2026-10-15 §5 (R3, R4): owner and member read; refresh=1 is owner-only (it spawns the CLI); no Orca-side cache.
it("serves the view to a session, refuses refresh to a member, and passes refresh to the port", async () => {
  const seen: Array<[string, boolean]> = [];
  const panel = await boot("epoch-models", { listModels: async (installation, refresh) => { seen.push([installation, refresh]);
    return { installation, kind: "codex", source: "cache", observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] }; } });
  expect(await json(await get(panel, "/api/control/agents/codex/models"))).toEqual({ schema: "orca-agent-models-v1", installation: "codex", kind: "codex", source: "cache",
    observedAt: "2026-10-15T00:00:00.000Z", models: [{ model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" }] });
  expect((await get(panel, "/api/control/agents/codex/models?refresh=1")).status).toBe(200);
  expect((await get(panel, "/api/control/agents/codex/models", "none")).status).toBe(401);
  expect((await get(panel, "/api/control/agents/codex/models?refresh=yes")).status).toBe(400);
  expect((await get(panel, "/api/control/agents/codex/models?other=1")).status).toBe(400);
  seedUser(join(panel.root, "accounts"), "member", "member");
  const member = await login(panel.url, "member");
  expect((await member.fetch("/api/control/agents/codex/models")).status).toBe(200);
  const denied = await member.fetch("/api/control/agents/codex/models?refresh=1");
  expect([denied.status, (await denied.json() as { code: string }).code]).toEqual([403, "owner-required"]);
  expect(seen).toEqual([["codex", false], ["codex", true], ["codex", false]]);
});
it("names ccloop's failure (424 ccloop-failed) and a missing installation (RF5)", async () => {
  const panel = await boot("epoch-models-fail", { listModels: async (installation) => {
    if (installation === "gone") throw new ControlError("agent-installation-missing", "gone");
    throw new ControlError("control-peer-exit", "1:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12"); } });
  const failed = await get(panel, "/api/control/agents/codex/models");
  expect([failed.status, ((await failed.json()) as { code: string; message: string })]).toEqual([424, expect.objectContaining({ code: "ccloop-failed", message: "ccloop-failed:agent-catalog-unavailable: exit 5 · stage exit · elapsedMs 12" })]);
  expect(((await (await get(panel, "/api/control/agents/gone/models")).json()) as { code: string }).code).toBe("agent-installation-missing");
});
```

  (imports: `seedUser`, `login` from `./fixtures/auth.js`; `ControlError` from `../../src/control/errors.js`; `join`.)

- [ ] **Step 2: red** (P-2 both files with `ORCA_CCLOOP_BIN="$B/repo/dist/cli.js"`; `numPendingTests` 0).

- [ ] **Step 3: implement.** `executionPort.ts`: add the optional method and the `AgentModelsView` type next to
  `AgentsView`. `ccloopPort.ts`:

```ts
// Spec 2026-10-15 §3, §5: ccloop's `control models` answer (ccloop-models-v1), strict, so a wrong one refuses the answer.
const agentModelsSchema=z.object({schema:z.literal("ccloop-models-v1"),installation:idSchema,kind:z.string().min(1),source:z.enum(["cache","probe","none"]),observedAt:z.string().datetime().nullable(),
 models:z.array(z.object({model:z.string().min(1).max(200),contextWindowTokens:safeInteger.positive().nullable(),maxOutputTokens:safeInteger.positive().nullable(),singleCallExecution:z.enum(["v1","v1-soft"]).nullable()}).strict())}).strict();
```

  and in the port object `async listModels(installation,refresh){let answer:unknown;try{answer=await raw("models",{installation,refresh});}catch(error){throw named(error);}const {schema:_schema,...view}=parse(agentModelsSchema,answer);return view;},`.
  `webProtocol.ts`: `export const agentModelsViewSchema = z.object({ schema: z.literal("orca-agent-models-v1"), installation: idSchema, kind: nonemptyString, source: z.enum(["cache", "probe", "none"]), observedAt: z.string().nullable(), models: z.array(z.object({ model: nonemptyString, contextWindowTokens: positiveSafeInteger.nullable(), maxOutputTokens: positiveSafeInteger.nullable(), singleCallExecution: z.enum(["v1", "v1-soft"]).nullable() }).strict()) }).strict();`
  `controlApi.ts`: `port?: Pick<ExecutionPort, "listAgents" | "resolveAgent" | "listModels">;` and inside `if (deps.port)`:

```ts
      // Spec 2026-10-15 §5 (R3, R4): the installation's models for the selection editor; ccloop's file cache serves it.
      app.get("/api/control/agents/:installation/models", asyncRoute(async (req, res) => {
        const installation = String(req.params.installation);
        const refreshText = req.query.refresh;
        if (!idSchema.safeParse(installation).success || Object.keys(req.query).some((key) => key !== "refresh") || (refreshText !== undefined && refreshText !== "1")) {
          sendMappedControlError(res, new ControlError("query-invalid")); return;
        }
        const refresh = refreshText === "1";
        if (refresh && !owner(res)) return;
        if (port.listModels === undefined) { sendMappedControlError(res, new ControlError("control-protocol-unavailable")); return; }
        try { res.json(agentModelsViewSchema.parse({ schema: "orca-agent-models-v1", ...(await port.listModels(installation, refresh)) })); }
        catch (error) { sendMappedControlError(res, error); }
      }));
```

  (`idSchema` from `../control/schema.js`; check that `query-invalid` and `control-protocol-unavailable` map to 400/503 in
  `readErrorStatuses`; if `query-invalid` is not there, read how the results route at `controlApi.ts:315` gets its 400 and
  use the same.) `controlPanel.ts` fixture: `BootOptions.listModels?: ExecutionPort["listModels"]` and
  `...(options.listModels === undefined ? {} : { listModels: options.listModels }),` in the port literal.

- [ ] **Step 4: green.** **Step 5: mutations.** M13.1 `if (refresh && !owner(res)) return;` → `` ⇒ red the member 403.
  M13.2 the `refreshText !== "1"` clause removed ⇒ red `refresh=yes` 400. M13.3 `refresh` → `false` in the
  `listModels(installation, refresh)` call ⇒ red `seen`. M13.4 `throw named(error)` → `throw error` ⇒ red the
  `agent-installation-missing` code in `ccloopModels.test.ts`.

- [ ] **Step 6: commit**, subject `feat(panel): serve an installation's models from ccloop`.

---

