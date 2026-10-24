/**
 * codex `exec --json`, as ccloop records its stdout into `transcript.jsonl` (spec §10.2.1). Shapes from a real stream
 * (`/private/tmp/orca-ffec7b28/o2/evidence/codex.stdout.jsonl`, spec §12.1) and codex's item types.
 *
 * §10.3: a tool's start and end are two events linked by the item id (`item.started` / `item.completed`), so a window
 * stays line-local. `file_change` is emitted where codex reports one. Plan D6: `item.updated` is progress of an item whose
 * `item.completed` carries the content -- counted, not served, so nothing renders twice (the C1 principle).
 */
import { event, list, plain, record, str, type Mapper, type RawEvent } from "../events.js";

function item(phase: "started" | "completed", it: Record<string, unknown>): RawEvent[] {
  const type = str(it.type);
  const id = str(it.id);
  if (type === "agent_message") return phase === "completed" ? [event("message", { meta: { role: "assistant" }, fields: { text: plain(it.text) } })] : [];
  if (type === "reasoning") return phase === "completed" ? [event("thinking", { fields: { text: plain(it.text) } })] : [];
  if (type === "command_execution") {
    if (phase === "started") return [event("tool_call", { meta: { id, name: "shell" }, fields: { input: plain(it.command) } })];
    const exit = typeof it.exit_code === "number" ? it.exit_code : undefined;
    return [event("tool_result", { meta: { id }, num: { exitCode: exit }, flag: { error: (exit !== undefined && exit !== 0) || str(it.status) === "failed" }, fields: { output: plain(it.aggregated_output ?? "") } })];
  }
  if (type === "file_change") {
    if (phase === "started") return [];
    return list(it.changes).map((raw) => {
      const change = record(raw);
      return event("file_change", { meta: { change: str(change?.kind) }, fields: { path: plain(change?.path) } });
    });
  }
  if (type === "mcp_tool_call") {
    const name = [str(it.server), str(it.tool)].filter((part) => part !== undefined).join(".");
    if (phase === "started") return [event("tool_call", { meta: { id, name }, fields: { input: { composite: it.arguments ?? null } } })];
    return [event("tool_result", { meta: { id }, flag: { error: it.error !== undefined && it.error !== null }, fields: { output: { composite: it.result ?? it.error ?? null } } })];
  }
  if (type === "web_search") return phase === "started" ? [event("tool_call", { meta: { id, name: "web_search" }, fields: { input: plain(it.query) } })] : [];
  if (type === "error") return [event("notice", { meta: { notice: "runtime" }, fields: { text: plain(it.message) } })];
  return [event("unknown", { fields: { raw: { composite: it } } })];
}

export const codexMapper: Mapper = (line) => {
  const type = str(line.type);
  if (type === "thread.started" || type === "turn.started" || type === "item.updated") return [];
  if (type === "item.started" || type === "item.completed") {
    const it = record(line.item);
    return it === null ? [event("unknown", { fields: { raw: { composite: line } } })] : item(type === "item.started" ? "started" : "completed", it);
  }
  if (type === "turn.completed") {
    const usage = record(line.usage);
    return [event("result", { num: { inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined, outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined } })];
  }
  if (type === "turn.failed") return [event("result", { flag: { error: true }, fields: { text: plain(str(record(line.error)?.message)) } })];
  if (type === "error") return [event("notice", { meta: { notice: "runtime" }, fields: { text: plain(line.message) } })];
  return [event("unknown", { fields: { raw: { composite: line } } })];
};
