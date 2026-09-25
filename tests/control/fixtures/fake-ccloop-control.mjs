#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): this stand-in speaks the wire
// of agent selection spec §4.5/§4.6/§5 -- `control <method> --agents <table>` (the retired `--adapter` form is
// refused by name, as ccloop refuses it), envelope protocol 2 with `claim.agent`, and capabilities protocol 3: the
// table view for `{agent: null}`, one selection's resolution for `{agent: partial}` (requested fields echoed, the
// fixture's defaults for the rest). Its own knobs live in the file passed as the table: it never parses a real one.
// Exit codes and stderr follow real ccloop's `control` (plan P15, ccloop T5): a named refusal -- an agent error or a
// protocol refusal -- exits 2 with `<code>[: <detail>]` on stderr; a bad argv (or any unnamed failure) exits 1.
const [control, method, agentsFlag, tablePath, ...rest] = process.argv.slice(2);
if (control !== "control" || agentsFlag !== "--agents" || tablePath === undefined || rest.length > 0) {
  process.stderr.write("control-command-invalid\n"); process.exit(1);
}
const config = JSON.parse(await readFile(tablePath, "utf8"));
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
if (config.record) await writeFile(config.record, JSON.stringify({ argv: process.argv.slice(2), stdin }));
if (config.mode === "exit2") { process.stderr.write("remote-refusal\n"); process.exit(2); }
if (config.refuse) { process.stderr.write(`${config.refuse}\n`); process.exit(2); }
if (config.fail) { process.stderr.write(`${config.fail}\n`); process.exit(1); }
if (config.mode === "bad-json") { process.stdout.write("not-json\n"); process.exit(0); }
if (config.mode === "oversized") { await new Promise(resolve=>process.stdout.write(JSON.stringify({blob:"x".repeat(25 * 1024 * 1024)})+"\n",resolve)); process.exit(0); }
const payload = JSON.parse(stdin || "{}");
const view = { usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null };
const defaults = { agent:"codex",model:"fixture-model",contextWindow:"agent-default" };
const refuse = (code) => { process.stderr.write(`${code}\n`); process.exit(2); };
// Real ccloop refuses any envelope that is not protocol 2 by name, and a protocol-2 one without a selection as invalid.
const envelopeOk = (input) => { if (input?.protocol !== 2) refuse("control-protocol-unsupported"); if (input.claim?.agent === undefined) refuse("control-request-invalid"); return true; };
let value;
if (method === "capabilities") {
  // Capabilities v3 requires the `agent` key (null for the table view); `{}` is refused as real ccloop refuses it.
  if (!Object.hasOwn(payload, "agent")) refuse("control-request-invalid");
  if (config.mode === "protocol-2") value = { protocol:2,...view };
  else if (payload.agent === null) value = { protocol:3,installations:config.installations ?? [{ id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture" }] };
  else {
    const selection = { ...defaults, ...payload.agent };
    if (config.mode === "rewrite-model") selection.model = "rewritten-model";
    value = { protocol:3,selection,configHash:config.configHash ?? "d".repeat(64),timeoutMs:120000,killGraceMs:5000,capabilities:config.capabilities ?? view };
  }
}
else if (method === "accept" || method === "inspect") {
  envelopeOk(payload);
  value = { kind:"accepted",executionId:"execution-1",configHash:payload.claim.configHash };
}
else if (["handoff", "collect", "read-evidence"].includes(method) && !envelopeOk(payload.input)) throw new Error("unreachable");
else if (method === "handoff") value = { kind:"latched",requestId:payload.request.requestId };
else if (method === "collect") value = { events:config.collectRef?[{runId:payload.input.claim.runId,generation:payload.input.claim.generation,eventSeq:1,bucket:"work",cumulative:null,source:config.collectRef}]:[],candidate:null,terminal:null };
else if (method === "read-evidence") {
  const bytes = Buffer.from(config.evidence ?? "evidence");
  value = { artifactId:payload.ref.artifactId,hash:config.badHash ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex"),base64:bytes.toString("base64") };
}
else throw new Error(`unexpected method ${control} ${method} ${agentsFlag}`);
process.stdout.write(`${JSON.stringify(value)}\n`);
