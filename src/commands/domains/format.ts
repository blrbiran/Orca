/** Human text for a body no row formats more specifically: scalars as `key: value`, lists one compact line per item. */
export function text(body: unknown, indent = ""): string {
  if (body === null || typeof body !== "object") return `${indent}${String(body)}`;
  if (Array.isArray(body)) return body.length === 0 ? `${indent}(none)` : body.map((item) => `${indent}- ${compact(item)}`).join("\n");
  const lines: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === null || typeof value !== "object") lines.push(`${indent}${key}: ${String(value)}`);
    else if (Array.isArray(value)) lines.push(`${indent}${key}: ${value.length === 0 ? "(none)" : ""}`, ...(value.length === 0 ? [] : [text(value, `${indent}  `)]));
    else lines.push(`${indent}${key}: ${compact(value)}`);
  }
  return lines.length === 0 ? `${indent}(empty)` : lines.join("\n");
}

export function compact(value: unknown, max = 160): string {
  const json = JSON.stringify(value) ?? String(value);
  return json.length <= max ? json : `${json.slice(0, max - 1)}…`;
}

export const field = (body: unknown, key: string): unknown => (body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);
