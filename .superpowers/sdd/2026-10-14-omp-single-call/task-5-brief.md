### Task 5 (ccloop): Decode, output rule, usage, and `OmpAdapter.singleCall` (criteria 5, 6, 7)

**Files:**
- Modify: `src/runtime/omp/ompProtocol.ts:12` (export `assistantUsage`)
- Modify: `src/runtime/omp/ompSingleCall.ts` (add `parseSingleCallObject`, `decodeOmpSingleCall`)
- Modify: `src/runtime/omp/ompAdapter.ts:1-65` (`singleCall`)
- Modify: `src/runtime/types.ts:230` (append-only note)
- Test: `tests/runtime/omp/ompSingleCall.test.ts` (add), `tests/control/ompSingleCallWorker.test.ts` (new)

**Interfaces:**
- Consumes: Task 4's `runOmpSingleCall`, `OmpSingleCallRefused`; `SingleCallOutputInvalid`, `SingleCallResult` (`src/runtime/types.ts:198-207`); `ModelUsageV1` (`src/control/usage.ts`).
- Produces:
  - `export function assistantUsage(message: Record<string, unknown>): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }` (ompProtocol.ts, now exported, unchanged body).
  - `export function parseSingleCallObject(text: string): Record<string, unknown> | undefined`.
  - `export function decodeOmpSingleCall(events: string, expectedSelector: string, evidenceDir: string): SingleCallResult`.
  - `OmpAdapter.singleCall(request: SingleCallRequest): Promise<SingleCallResult>`.

- [ ] **Step 1: Write the failing criteria 5, 6, 7 and the Review Focus items 3-5** — append to `tests/runtime/omp/ompSingleCall.test.ts` (and add `decodeOmpSingleCall, parseSingleCallObject` to its `ompSingleCall.js` import, `SingleCallOutputInvalid` to its `types.js` import, and `import { OmpAdapter } from "../../../src/runtime/omp/ompAdapter.js";`):

```ts
const usage = { input: 8, output: 2, cacheRead: 3, cacheWrite: 1, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (over: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text: "{\"answer\":\"42\"}" }], provider: "gateway", model: "model-a", stopReason: "stop", usage, ...over });
const end = (m: unknown) => ({ type: "message_end", message: m });
const lines = (...rows: unknown[]) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const decodeFailure = (events: string): unknown => { try { decodeOmpSingleCall(events, "gateway/model-a", "/evidence"); return null; } catch (error) { return error; } };

describe("decode (§3.3.5, criterion 5): one request, no tool, the selected model", () => {
  it("decodes one complete answer with its usage and per-model breakdown", () => {
    expect(decodeOmpSingleCall(lines({ type: "agent_start" }, end(message()), { type: "agent_end", isTerminal: true }), "gateway/model-a", "/evidence")).toEqual({
      output: { answer: "42" }, tokenUsage: 14,
      usageEvidence: expect.objectContaining({ usageStatus: "present", normalizedTotal: 14 }),
      modelUsage: [{ model: "gateway/model-a", input: 8, output: 2, cacheRead: 3, cacheWrite: 1 }],
    });
  });

  it("C5: refuses two assistant messages as multiple requests, booking both", () => {
    expect(decodeFailure(lines(end(message()), end(message())))).toMatchObject({ message: "omp-single-call-multiple-requests", observedTokens: 28 });
  });

  it("C5: refuses a tool event even beside a complete answer, booking what was spent", () => {
    expect(decodeFailure(lines({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
  });

  it("C5: refuses an extension UI request or a subagent event like a tool event", () => {
    expect(decodeFailure(lines({ type: "extension_ui_request" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
    expect(decodeFailure(lines({ type: "subagent_start" }, end(message())))).toMatchObject({ message: "omp-phase-tool-forbidden", observedTokens: 14 });
  });

  it("C5: refuses an answer from a different model, booking what was spent", () => {
    expect(decodeFailure(lines(end(message({ model: "model-b" }))))).toMatchObject({ message: "omp-model-mismatch", observedTokens: 14 });
  });

  it("books null when there is no assistant message or its usage is not readable", () => {
    for (const events of [lines({ type: "agent_start" }), lines(end(message({ usage: { ...usage, totalTokens: 15 } }))), "not json\n"]) {
      expect(observedTokensOf(decodeFailure(events))).toBeNull();
    }
  });
});

describe("stop reasons (§3.3.5, criterion 6)", () => {
  it("C6: a length stop is an output-invalid answer that still books the observed usage", () => {
    const failure = decodeFailure(lines(end(message({ stopReason: "length", content: [{ type: "text", text: "{\"answer\":\"4\"}" }] }))));
    expect(failure).toBeInstanceOf(SingleCallOutputInvalid);
    expect(failure).toMatchObject({ code: "single-call-output-invalid", tokenUsage: 14, usageEvidence: expect.objectContaining({ normalizedTotal: 14 }) });
  });

  it("C6: another stop reason is the named failure, booking the observed usage", () => {
    for (const stopReason of ["error", "toolUse", "aborted"]) {
      expect([stopReason, decodeFailure(lines(end(message({ stopReason }))))]).toEqual([stopReason, expect.objectContaining({ code: `omp-single-call-stop:${stopReason}`, observedTokens: 14 })]);
    }
  });

  it("keeps the failure code bounded when the stop reason is not a short word", () => {
    for (const stopReason of [{ nested: true }, "x".repeat(33), "has space"]) {
      expect(decodeFailure(lines(end(message({ stopReason }))))).toMatchObject({ code: "omp-single-call-stop:invalid" });
    }
  });
});

describe("output rule (§3.3.6, criterion 7)", () => {
  it("C7: only one plain object, with at most one fence around it, is an answer", () => {
    expect(parseSingleCallObject("[{\"answer\":\"42\"}]")).toBeUndefined();
    expect(parseSingleCallObject("42")).toBeUndefined();
    expect(parseSingleCallObject("null")).toBeUndefined();
    expect(parseSingleCallObject("Here: {\"answer\":\"4\"} and {\"answer\":\"2\"}")).toBeUndefined();
    expect(parseSingleCallObject("```json\n{\"a\":1}\n```\n```json\n{\"a\":2}\n```")).toBeUndefined();
    expect(parseSingleCallObject("```json\n{\"answer\":\"42\"}\n```")).toEqual({ answer: "42" });
    expect(parseSingleCallObject("  {\"answer\":\"42\"}\n")).toEqual({ answer: "42" });
  });

  it("C7: an answer that is not one object is output-invalid and books what the call spent", () => {
    for (const text of ["[{\"answer\":\"42\"}]", "42", ""]) {
      const failure = decodeFailure(lines(end(message({ content: [{ type: "text", text }] }))));
      expect([text, failure instanceof SingleCallOutputInvalid, (failure as { tokenUsage?: unknown }).tokenUsage]).toEqual([text, true, 14]);
    }
  });
});

describe("OmpAdapter.singleCall (§3.3, §3.3.7)", () => {
  it("returns the fake's answer through the real process path", async () => {
    const w = await ompWorld();
    await expect(new OmpAdapter(w.config).singleCall(w.request())).resolves.toMatchObject({ output: { answer: "42" }, tokenUsage: 14 });
  });

  it("books null when omp exits non-zero after a complete message, and uses none of it", async () => {
    const w = await ompWorld({ single: { exitCode: 3 } });
    const failure = await failureOf(new OmpAdapter(w.config).singleCall(w.request()));
    expect((failure as Error).message).toMatch(/^omp-exit-error: /);
    expect(observedTokensOf(failure)).toBeNull();
  });

  it("stops the call at the request's time limit when it is below the installation's", async () => {
    const w = await ompWorld({ single: { hang: true }, installationTimeoutMs: 30_000 });
    const started = Date.now();
    const failure = await failureOf(new OmpAdapter(w.config).singleCall(w.request({ timeoutMs: 300 })));
    expect((failure as Error).message).toMatch(/^omp-timeout: /);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(observedTokensOf(failure)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the worker-level criteria** — `tests/control/ompSingleCallWorker.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { parseAgentsTable } from "../../src/agents/table.js";
import { collectExecution } from "../../src/control/collect.js";
import { readEvidence } from "../../src/control/evidence.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import { singleCallEnvelope } from "./agentsFixture.js";

// OMP single call (Orca spec 2026-10-14 §3.3.1, §3.3.7) through the control worker, read back as Orca reads it: a complete
// call books its observed usage and answer; a call refused at spawn because the catalog cap rose above the envelope's
// maxOutputTokens (4096 here) books 0 and names the cap -- nothing was sent, so nothing may be charged.
const FAKE_OMP = resolve("tests/fixtures/fake-omp.mjs");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    try {
      for (const registered of JSON.parse(await readFile(join(dir, "control", "processes.json"), "utf8")) as Array<{ pgid: number }>) {
        try { process.kill(-registered.pgid, "SIGKILL"); } catch {}
      }
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

async function world(maxTokens: number) {
  const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-source-")));
  const aux = await realpath(await mkdtemp(join(tmpdir(), "ccloop-omp-single-aux-")));
  dirs.push(sourceDir, aux);
  const marker = join(aux, "omp-marker");
  await writeFile(`${marker}.catalog.json`, JSON.stringify([{ provider: "gateway", kind: "chat", id: "model-a", selector: "gateway/model-a", contextWindow: 200000, maxTokens }]));
  const binary = join(aux, "omp");
  await writeFile(binary, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_OMP}' '${marker}' "$@"\n`, { mode: 0o700 });
  const table = parseAgentsTable({ schema: "ccloop-agents-table-v1", installations: {
    omp: { kind: "omp", command: [binary], version: "18.10.1", configDir: null, timeoutMs: 60_000, killGraceMs: 300, defaultModel: "gateway/model-a", profile: null },
  } });
  const { config, resolution } = await resolveAgent(table, { agent: "omp" });
  const envelope = singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash });
  const controlDir = join(sourceDir, "control");
  await ensurePrivateDirectory(sourceDir, controlDir);
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "config.json"), Buffer.from(canonicalJson(config)));
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
  await writeAccepted(sourceDir, {
    protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: envelope.claim.configHash,
    generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
  });
  await runControlWorker(["--source-dir", sourceDir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);
  const collected = await collectExecution(envelope, 0);
  const record = JSON.parse((await readEvidence(sourceDir, collected.candidate!.handoff)).toString("utf8")) as { outcome: string; errorCode: string | null };
  return { sourceDir, marker, collected, record };
}
const booked = (events: Array<{ bucket: string; cumulative: { tokens: number } | null }>) => events.map((event) => [event.bucket, event.cumulative?.tokens ?? null]);

describe("omp single calls through the control worker", { timeout: 30_000 }, () => {
  it("books a complete call's observed usage and its answer", async () => {
    const w = await world(4096);
    expect(booked(w.collected.events)).toEqual([["work", 14], ["handoff", 0]]);
    expect(w.record).toMatchObject({ outcome: "complete", errorCode: null });
    expect(JSON.parse((await readEvidence(w.sourceDir, w.collected.candidate!.artifacts[0]!)).toString("utf8"))).toEqual({ answer: "42" });
  });

  it("C3: books 0 and names the cap when the catalog cap exceeds the envelope's maxOutputTokens", async () => {
    const w = await world(8192);
    expect(booked(w.collected.events)).toEqual([["work", 0], ["handoff", 0]]);
    expect(w.record).toMatchObject({ outcome: "failed", errorCode: "omp-single-call-cap-exceeded" });
    expect(existsSync(`${w.marker}.calls`)).toBe(false);
  });
});
```

- [ ] **Step 3: Run red**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts > /private/tmp/osc/logs/t5-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-red.log
```
Read it whole. Expected: `decodeOmpSingleCall`/`parseSingleCallObject` not exported (`is not a function`); the adapter tests fail on `singleCall is not a function`; the worker tests fail with `single-call-unsupported` (`src/control/singleCall.ts:65`).

- [ ] **Step 4: Implement**

`src/runtime/omp/ompProtocol.ts` line 12: `function assistantUsage(` → `export function assistantUsage(` (body unchanged).

`src/runtime/omp/ompSingleCall.ts` — the imports become:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ompSingleCallExecution, readOmpCatalog } from "../../agents/ompModels.js";
import type { CatalogRowV1, MaterializedAgentConfigV1 } from "../../agents/types.js";
import type { ModelUsageV1 } from "../../control/usage.js";
import { SingleCallOutputInvalid, type SingleCallRequest, type SingleCallResult, type UsageEvidence } from "../types.js";
import { assistantUsage } from "./ompProtocol.js";
import { singleCallSystemPrompt } from "./phasePrompt.js";
import { runOmpProcess, type OmpPhaseOutcome } from "./runOmpPhase.js";
```

and append:

```ts
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** §3.3.6: the trimmed text, with at most one surrounding fenced block removed, must parse to a plain non-array object. */
export function parseSingleCallObject(text: string): Record<string, unknown> | undefined {
  let body = text.trim();
  const fenced = /^```[A-Za-z0-9_-]*\n([\s\S]*)\n```$/.exec(body);
  if (fenced) body = fenced[1]!.trim();
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** §3.3.7: the assistant messages' usage with the per-model breakdown; unreadable usage is "not observed" (null). */
function observedUsage(messages: Record<string, unknown>[], selector: string): { total: number; usageEvidence: UsageEvidence; modelUsage: ModelUsageV1[] } {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const message of messages) {
    const usage = assistantUsage(message);
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) totals[key] += usage[key];
  }
  if (!Object.values(totals).every(Number.isSafeInteger) || totals.total === 0) throw new Error("omp-usage-invalid");
  const usageEvidence: UsageEvidence = {
    usageStatus: "present",
    fields: {
      input_tokens: { status: "absent" }, output_tokens: { status: "absent" },
      inputTokens: { status: "finite", value: totals.input }, outputTokens: { status: "finite", value: totals.output },
    },
    cacheFields: {
      cache_creation_input_tokens: { status: "finite", value: totals.cacheWrite },
      cache_read_input_tokens: { status: "finite", value: totals.cacheRead },
    },
    selectedInputField: "inputTokens", selectedOutputField: "outputTokens", normalizedTotal: totals.total,
  };
  return { total: totals.total, usageEvidence, modelUsage: [{ model: selector, input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite }] };
}

/**
 * §3.3.5-§3.3.7, fail closed: exactly one assistant message, no tool event, the selected model, a "stop" with one object.
 * Every refusal after the usage was read books that observed total; "length" is a truncated answer (output-invalid).
 */
export function decodeOmpSingleCall(events: string, expectedSelector: string, evidenceDir: string): SingleCallResult {
  const messages: Record<string, unknown>[] = [];
  let toolEvent = false;
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error("omp-events-invalid"); }
    if (!record(raw) || typeof raw.type !== "string") throw new Error("omp-events-invalid");
    if (raw.type.startsWith("tool_execution_") || raw.type === "extension_ui_request" || raw.type.includes("subagent")) toolEvent = true;
    if (raw.type === "message_end" && record(raw.message) && raw.message.role === "assistant") messages.push(raw.message);
  }
  if (messages.length === 0) throw new Error("omp-no-completion");
  const usage = observedUsage(messages, expectedSelector);
  const observed = { observedTokens: usage.total };
  if (messages.length > 1) throw Object.assign(new Error("omp-single-call-multiple-requests"), observed);
  if (toolEvent) throw Object.assign(new Error("omp-phase-tool-forbidden"), observed);
  const message = messages[0]!;
  if (`${message.provider}/${message.model}` !== expectedSelector) throw Object.assign(new Error("omp-model-mismatch"), observed);
  if (message.stopReason === "length") throw new SingleCallOutputInvalid(evidenceDir, usage.total, usage.usageEvidence);
  if (message.stopReason !== "stop") {
    const reason = typeof message.stopReason === "string" && /^[A-Za-z]{1,32}$/.test(message.stopReason) ? message.stopReason : "invalid";
    throw Object.assign(new Error(`omp-single-call-stop:${reason}`), { code: `omp-single-call-stop:${reason}`, ...observed });
  }
  const text = Array.isArray(message.content)
    ? message.content.filter((item): item is { type: "text"; text: string } => record(item) && item.type === "text" && typeof item.text === "string").map((item) => item.text).join("")
    : "";
  const output = parseSingleCallObject(text);
  if (output === undefined) throw new SingleCallOutputInvalid(evidenceDir, usage.total, usage.usageEvidence);
  return { output, tokenUsage: usage.total, usageEvidence: usage.usageEvidence, modelUsage: usage.modelUsage };
}
```

`src/runtime/omp/ompAdapter.ts` — line 5 becomes `import type { AttemptContext, RuntimeAdapter, SingleCallRequest, SingleCallResult } from "../types.js";`; after line 8 add `import { decodeOmpSingleCall, runOmpSingleCall } from "./ompSingleCall.js";`; after `verify(…)` (line 64) add:

```ts

  /**
   * OMP single call (Orca spec 2026-10-14 §3.3): one read-only structured call bounded by the catalog cap, refused before
   * spawning when that cap exceeds the request's. A process that did not end cleanly books null even after a complete
   * message (§3.3.7); its observed total stays diagnostic, as for a phase.
   */
  async singleCall(request: SingleCallRequest): Promise<SingleCallResult> {
    const outcome = await runOmpSingleCall(this.config, request);
    if (outcome.reason !== "completed") {
      const lowerBound = ompUsageLowerBound(outcome.events);
      if (lowerBound !== null) await writeFile(join(outcome.evidenceDir, "usage-lower-bound.json"), JSON.stringify({ tokens: lowerBound }), { mode: 0o600 });
      throw Object.assign(new Error(`omp-${outcome.reason}: ${outcome.evidenceDir}`), { neverStarted: outcome.neverStarted });
    }
    try {
      const result = decodeOmpSingleCall(outcome.events, this.config.selection.model, outcome.evidenceDir);
      await writeFile(join(outcome.evidenceDir, "usage.json"), JSON.stringify(result.usageEvidence), { mode: 0o600 });
      return result;
    } catch (error) {
      await writeFile(join(outcome.evidenceDir, "decode-error.txt"), String(error), { mode: 0o600 });
      throw error;
    }
  }
```

`src/runtime/types.ts` — the comment at line 230 is published (ccloop Rule 16): first scan for every copy of the sentence being corrected, then append, never replace:

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && /usr/bin/grep -rn 'only a kind whose descriptor answers singleCallExecution' src tests docs > /private/tmp/osc/logs/t5-scan.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-scan.log
```
Read it whole (expected: `src/runtime/types.ts:230` only; append the same note to any other hit). Then change line 230 into:

```ts
  /** Orca single-call estimate (2026-09-27): only a kind whose descriptor answers singleCallExecution "v1" has it.
   * *** ERRATUM (OMP single call, Orca spec 2026-10-14 §3.2, session 7ea088aa) -- the omp adapter has it while its
   * descriptor answers "v1" only for some catalog rows; accept refuses the rest by the resolution, and the adapter
   * refuses again at spawn. *** */
```
(the original sentence kept verbatim on its first line).

- [ ] **Step 5: Run green**

```bash
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && ./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompSingleCallWorker.test.ts tests/control/ompSingleCallAccept.test.ts tests/control/singleCall.test.ts tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts > /private/tmp/osc/logs/t5-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-green.log
cd /Users/biran/code/skills/orca/ccloop-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t5-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t5-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call add src/runtime/omp/ompProtocol.ts src/runtime/omp/ompSingleCall.ts src/runtime/omp/ompAdapter.ts src/runtime/types.ts tests/runtime/omp/ompSingleCall.test.ts tests/control/ompSingleCallWorker.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t5-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop-wt/omp-single-call commit -q -F - <<'EOF'
feat(omp): decode one single-call answer fail-closed and book its observed usage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

