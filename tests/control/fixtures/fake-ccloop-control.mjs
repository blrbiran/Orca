#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [control, method, adapterFlag, adapter, configFlag, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
if (config.record) await writeFile(config.record, JSON.stringify({ argv: process.argv.slice(2), stdin }));
if (config.mode === "exit2") { process.stderr.write("remote-refusal\n"); process.exit(2); }
if (config.mode === "bad-json") { process.stdout.write("not-json\n"); process.exit(0); }
if (config.mode === "oversized") { await new Promise(resolve=>process.stdout.write(JSON.stringify({blob:"x".repeat(25 * 1024 * 1024)})+"\n",resolve)); process.exit(0); }
const payload = JSON.parse(stdin || "{}");
const caps = { protocol:1,durableAccept:true,ownershipIsolation:true,evidenceRetention:true,usageObservation:"phase-end",budgetEnforcement:"soft",requestBoundEvidence:null };
let value;
if (method === "capabilities") value = caps;
else if (method === "accept" || method === "inspect") value = { kind:"accepted",executionId:"execution-1",configHash:payload.claim.configHash };
else if (method === "handoff") value = { kind:"latched",requestId:payload.request.requestId };
else if (method === "collect") value = { events:config.collectRef?[{runId:payload.input.claim.runId,generation:payload.input.claim.generation,eventSeq:1,bucket:"work",cumulative:null,source:config.collectRef}]:[],candidate:null,terminal:null };
else if (method === "read-evidence") {
  const bytes = Buffer.from(config.evidence ?? "evidence");
  value = { artifactId:payload.ref.artifactId,hash:config.badHash ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex"),base64:bytes.toString("base64") };
}
else throw new Error(`unexpected method ${control} ${method} ${adapterFlag} ${adapter} ${configFlag}`);
process.stdout.write(`${JSON.stringify(value)}\n`);
