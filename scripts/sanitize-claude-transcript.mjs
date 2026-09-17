#!/usr/bin/env node
// D spec 7 item 7: a fixture keeps only what the Claude Code reading adapter looks at —
// structure keys and usage counts. No message content, no tool input, no paths, no message id
// (correction 1, E2-1: the adapter never reads message.id).
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, session] = process.argv.slice(2);
if (!input || !output || !session) {
  console.error("usage: sanitize-claude-transcript.mjs <transcript> <fixture> <replacement-session-id>");
  process.exit(1);
}
const kept = [];
for (const line of readFileSync(input, "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line);
  if (row.type === "attachment" && row.attachment?.type === "model") {
    kept.push({ type: row.type, sessionId: session, attachment: { type: "model", identity: { modelId: row.attachment.identity?.modelId } } });
  } else if (row.type === "assistant" && row.message?.usage) {
    const u = row.message.usage;
    kept.push({
      type: row.type,
      sessionId: session,
      isSidechain: row.isSidechain,
      timestamp: row.timestamp,
      message: {
        model: row.message.model,
        usage: {
          input_tokens: u.input_tokens,
          cache_read_input_tokens: u.cache_read_input_tokens,
          cache_creation_input_tokens: u.cache_creation_input_tokens,
          output_tokens: u.output_tokens,
        },
      },
    });
  }
}
writeFileSync(output, `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`);
console.log(`kept ${kept.length} rows`);
