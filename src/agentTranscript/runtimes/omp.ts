/**
 * omp `--mode json -p`, as ccloop records its stdout into `transcript.jsonl` (spec §10.2.1). Shapes from a real stream
 * (`/private/tmp/orca-ffec7b28/o2/evidence/omp.stdout.jsonl`, spec §12.1).
 *
 * §12.4 C1, one source per piece of text:
 * - `message_update` (every assistantMessageEvent, `text_end` included) and `tool_execution_update` are delta lines:
 *   counted and indexed, never served, with no flag to ask for them;
 * - an assistant message's text comes only from `message_end.message.content` (its toolCall blocks are not rendered:
 *   the tool shows from `tool_execution_start`);
 * - a tool's output comes only from `tool_execution_end`;
 * - `turn_end` is a turn-boundary event without text; `agent_end` is the `result` event and its `messages` are not
 *   rendered; a `message_start`/`message_end` with role `toolResult` is not rendered as a message.
 */
import { contentText, editChange, event, list, plain, record, str, type Mapper, type RawEvent } from "../events.js";

export const ompMapper: Mapper = (line) => {
  const type = str(line.type);
  switch (type) {
    case "message_update": case "tool_execution_update":
    case "message_start": case "agent_start": case "turn_start":
      return [];
    case "session": return [event("notice", { meta: { notice: "session" } })];
    case "turn_end": return [event("notice", { meta: { notice: "turn-end" } })];
    case "agent_end": return [event("result", {})];
    case "message_end": {
      const message = record(line.message);
      const role = str(message?.role);
      if (message === null || role === "toolResult") return [];
      const out: RawEvent[] = [];
      for (const raw of list(message.content)) {
        const block = record(raw);
        const kind = str(block?.type);
        if (kind === "text") out.push(event("message", { meta: { role }, fields: { text: plain(block?.text) } }));
        else if (kind === "thinking") out.push(event("thinking", { fields: { text: plain(block?.thinking) } }));
      }
      if (typeof message.content === "string") out.push(event("message", { meta: { role }, fields: { text: { plain: message.content } } }));
      return out;
    }
    case "tool_execution_start": {
      const args = record(line.args);
      const name = str(line.toolName);
      const out = [event("tool_call", { meta: { id: str(line.toolCallId), name }, fields: { input: str(args?.command) !== undefined ? { plain: str(args?.command)! } : { composite: line.args ?? null } } })];
      const change = editChange(name, args);
      if (change !== null) out.push(change);
      return out;
    }
    case "tool_execution_end":
      return [event("tool_result", { meta: { id: str(line.toolCallId) }, flag: { error: line.isError === true }, fields: { output: plain(contentText(record(line.result)?.content) ?? "") } })];
    default:
      return [event("unknown", { fields: { raw: { composite: line } } })];
  }
};
