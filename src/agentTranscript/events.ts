/**
 * Live transcript spec §5.1 / §10.3 / §12.4 C1: the normalized event a runtime's line maps to. A mapper returns raw
 * events whose text fields are decoded values; `window.ts` cuts and redacts them before anything is served.
 *
 * Field kinds: `plain` is one decoded string (redacted by span at serve time, C3); `composite` is a decoded JSON value
 * (a tool's input object, an unknown line), redacted whole -- every string in it -- then stringified (F4).
 */
export type EventKind = "message" | "tool_call" | "tool_result" | "file_change" | "thinking" | "result" | "notice" | "unknown";
export type RawField = { plain: string } | { composite: unknown };

export interface RawEvent {
  kind: EventKind;
  /** Short metadata (role, tool name/id, file-change kind, notice kind): redacted whole and capped when served. */
  meta?: Record<string, string>;
  /** Numeric facts (a notice's bytes / atBytes, an exit code). */
  num?: Record<string, number>;
  /** Booleans (a tool result's error). */
  flag?: Record<string, boolean>;
  fields?: Record<string, RawField>;
}

/** What a mapper sees: the parsed line. */
export type Mapper = (line: Record<string, unknown>) => RawEvent[];

export const plain = (value: unknown): RawField | undefined => (typeof value === "string" ? { plain: value } : undefined);
export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The text of a content value that is a string or an array of `{type:"text", text}` blocks. */
export function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value.map((block) => str(record(block)?.text)).filter((text): text is string => text !== undefined);
  return parts.length === 0 ? undefined : parts.join("\n");
}

export function event(kind: EventKind, parts: { meta?: Record<string, string | undefined>; num?: Record<string, number | undefined>; flag?: Record<string, boolean | undefined>; fields?: Record<string, RawField | undefined> } = {}): RawEvent {
  const out: RawEvent = { kind };
  const clean = <T>(source: Record<string, T | undefined> | undefined): Record<string, T> | undefined => {
    if (source === undefined) return undefined;
    const kept = Object.entries(source).filter((entry): entry is [string, T] => entry[1] !== undefined);
    return kept.length === 0 ? undefined : Object.fromEntries(kept);
  };
  const meta = clean(parts.meta), num = clean(parts.num), flag = clean(parts.flag), fields = clean(parts.fields);
  if (meta) out.meta = meta;
  if (num) out.num = num;
  if (flag) out.flag = flag;
  if (fields) out.fields = fields;
  return out;
}

/** Edit tools whose input names a file (§10.3: claude and omp `file_change` is derived from a known edit tool's input). */
export function editChange(name: string | undefined, input: Record<string, unknown> | null): RawEvent | null {
  if (name === undefined || input === null) return null;
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (path === undefined) return null;
  const tool = name.toLowerCase();
  const kind = tool === "write" ? "write" : tool === "edit" || tool === "multiedit" || tool === "notebookedit" ? "edit" : null;
  if (kind === null) return null;
  const text = str(input.content) ?? str(input.new_string) ?? str(input.new_source)
    ?? (Array.isArray(input.edits) ? list(input.edits).map((e) => str(record(e)?.new_string) ?? "").join("\n") : undefined);
  return event("file_change", { meta: { change: kind }, fields: { path: { plain: path }, text: plain(text) } });
}
