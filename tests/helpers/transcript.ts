export const SESSION = "0a1b2c3d-0000-4000-8000-000000000000";

export interface Usage {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

export function modelRow(modelId: string, sessionId = SESSION): Record<string, unknown> {
  return { type: "attachment", sessionId, attachment: { type: "model", identity: { modelId } } };
}

export function usageRow(
  u: Usage,
  opts: { sessionId?: string; sidechain?: boolean; model?: string; at?: string } = {},
): { type: string; sessionId: string; isSidechain: boolean; timestamp: string; message: { model: string; usage: Record<string, number> } } {
  return {
    type: "assistant",
    sessionId: opts.sessionId ?? SESSION,
    isSidechain: opts.sidechain ?? false,
    timestamp: opts.at ?? "2026-09-17T00:00:00.000Z",
    message: {
      model: opts.model ?? "claude-opus-5",
      usage: {
        input_tokens: u.input,
        cache_read_input_tokens: u.cacheRead,
        cache_creation_input_tokens: u.cacheCreation,
        output_tokens: u.output,
      },
    },
  };
}

export const jsonl = (rows: object[]): string => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
