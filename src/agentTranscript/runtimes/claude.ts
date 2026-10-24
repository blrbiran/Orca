/**
 * claude `-p --output-format stream-json --verbose --include-partial-messages`, as ccloop's runner records it
 * (spec §10.2.1: every complete line except `stream_event` content_block_delta). Shapes from a real stream
 * (`/private/tmp/orca-ffec7b28/o2/evidence/claude.stdout.jsonl`, spec §12.1).
 *
 * C1: any `stream_event` that reaches a transcript is a delta line -- counted and indexed, never served. The `user`
 * line's `tool_use_result` repeats the tool output (F4); only `message.content` is mapped, so it renders once.
 */
import { contentText, editChange, event, list, plain, record, str, type Mapper, type RawEvent } from "../events.js";

export const claudeMapper: Mapper = (line) => {
  const type = str(line.type);
  if (type === "stream_event" || type === "rate_limit_event") return [];
  if (type === "system") {
    if (str(line.subtype) !== "init") return [];
    return [event("notice", { meta: { notice: "session", model: str(line.model) } })];
  }
  if (type === "assistant" || type === "user") {
    const message = record(line.message);
    if (message === null) return [event("unknown", { fields: { raw: { composite: line } } })];
    const role = str(message.role) ?? type;
    const content = message.content;
    if (typeof content === "string") return [event("message", { meta: { role }, fields: { text: { plain: content } } })];
    const out: RawEvent[] = [];
    for (const raw of list(content)) {
      const block = record(raw);
      const kind = str(block?.type);
      if (block === null) continue;
      if (kind === "text") out.push(event("message", { meta: { role }, fields: { text: plain(block.text) } }));
      else if (kind === "thinking") out.push(event("thinking", { fields: { text: plain(block.thinking) } }));
      else if (kind === "tool_use") {
        const input = record(block.input);
        const name = str(block.name);
        out.push(event("tool_call", { meta: { id: str(block.id), name }, fields: { input: str(input?.command) !== undefined ? { plain: str(input?.command)! } : { composite: block.input ?? null } } }));
        const change = editChange(name, input);
        if (change !== null) out.push(change);
      } else if (kind === "tool_result") {
        out.push(event("tool_result", { meta: { id: str(block.tool_use_id) }, flag: { error: block.is_error === true }, fields: { output: plain(contentText(block.content) ?? "") } }));
      } else out.push(event("unknown", { fields: { raw: { composite: block } } }));
    }
    return out;
  }
  if (type === "result") {
    return [event("result", { meta: { subtype: str(line.subtype) }, flag: { error: line.is_error === true }, fields: { text: plain(line.result) } })];
  }
  return [event("unknown", { fields: { raw: { composite: line } } })];
};
