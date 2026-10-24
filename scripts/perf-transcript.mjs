#!/usr/bin/env node
// Live transcript spec §10.7 T11 + §12.4 C8 "T11" (on demand; never part of `npm test`, CLAUDE.md Rule 18):
//   npm run perf:transcript [-- --sizes 64,512] [-- --keep]
// Generates claude-shaped transcripts of 64 MiB and 512 MiB into a temp directory (the 512 MiB one carries one 200 MiB
// line; multi-byte text sits at every 4 KiB boundary; secrets are planted after `\n` escapes, across page edges and as a
// 9000-character token), then runs the window / follow / expand workload in a child under `node --max-old-space-size=96`.
// Peak heapUsed+external+arrayBuffers must stay <= 64 MiB and no planted secret may be served: otherwise (or on an OOM)
// the script exits non-zero. Latency and the redaction cost are printed against the §12.2 budget with the commit:
// recorded, not gated (Rule 14). The temp directory is removed unless --keep.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024, PAGE = 65536;
export const MARK = "Zq9X";
const args = process.argv.slice(2);
const sizes = (args.includes("--sizes") ? args[args.indexOf("--sizes") + 1] : "64,512").split(",").map(Number);
const keep = args.includes("--keep");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const AL = "ABCDEFGHIJKLMNOPRSTUVWYabcdefghijklmnoprstuvwy0123456789";
const WORDS = "the agent reads file src/index.ts and runs npm test then edits function parse returns const 中文 测试 café naïve 東京".split(" ");

function generate(file, totalMiB) {
  const r = rng(42 + totalMiB), rs = (n) => { let s = ""; for (let i = 0; i < n; i++) s += AL[Math.floor(r() * AL.length)]; return s; };
  const words = (units) => { const out = []; let n = 0; while (n < units) { const w = WORDS[Math.floor(r() * WORDS.length)]; out.push(w); n += w.length + 1; } return out.join(" ").slice(0, units); };
  const fd = openSync(file, "w", 0o600);
  let written = 0, planted = 0;
  const put = (line) => { const b = Buffer.from(line + "\n"); writeSync(fd, b); written += b.length; };
  const target = totalMiB * MiB;
  let bigDone = totalMiB < 256;
  while (written < target) {
    if (!bigDone && written > target * 0.4) {
      // One 200 MiB line: a tool result whose decoded text holds page-edge plants (spec §12.2's fixture shapes).
      const head = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"big","content":"';
      writeSync(fd, head); written += head.length;
      let units = 0, raw = 0;
      const emit = (s) => { const b = Buffer.from(JSON.stringify(s).slice(1, -1)); writeSync(fd, b); written += b.length; raw += b.length; units += s.length; };
      const fill = (to) => { while (units < to) { const n = Math.min(4096 - (units % 4096) - 1, to - units); if (n > 0) emit(words(n)); if (units < to) emit("東"); } };
      for (let k = 100; units < 200 * MiB; k += 150) {
        fill(k * PAGE - 5000);
        if (k % 3 === 0) { emit("\n-----BEGIN RSA PRIV" + "ATE KEY-----\n"); fill(k * PAGE + 200); emit("\n" + MARK + rs(40) + "\n"); fill(k * PAGE + 1500); emit("\n-----END RSA PRIV" + "ATE KEY-----\n"); }
        else if (k % 3 === 1) { const t = rs(9000); emit("\nSERVICE_TOKEN=" + t.slice(0, 8000) + MARK + t.slice(8000) + "\n"); }
        else { emit("\n" + "gh" + "p_" + MARK + rs(36) + "\n"); }
        planted++;
        if (raw > 200 * MiB) break;
      }
      const tail = '"}]}}\n'; writeSync(fd, tail); written += tail.length;
      bigDone = true;
      continue;
    }
    const kind = r();
    let body = kind < 0.002 ? words(256 * 1024 + Math.floor(r() * 600 * 1024)) : words(200 + Math.floor(r() * 12000));
    if (r() < 0.02) { body = body.slice(0, 4093) + " gh" + "p_" + MARK + rs(36) + " " + body.slice(4093); planted++; }
    if (r() < 0.02) { body = "out:\n" + "OPENAI_API_KEY=sk-" + "proj-" + MARK + rs(40) + "\n" + body; planted++; }
    if (kind < 0.4) put(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: body }] } }));
    else if (kind < 0.5) put(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t" + written, name: "Bash", input: { command: body.slice(0, 500) } }] } }));
    else if (kind < 0.6) put(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: body.slice(0, 300) } } }));
    else put(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: body }] }, tool_use_result: { stdout: body } }));
  }
  closeSync(fd);
  return { bytes: written, planted };
}

const dir = mkdtempSync(join(tmpdir(), "orca-perf-transcript-"));
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
let failed = false;
try {
  for (const size of sizes) {
    const sourceDir = join(dir, `src-${size}`);
    const callDir = join(sourceDir, "run", "claude", "1", "execute", "call-perf");
    mkdirSync(callDir, { recursive: true });
    const started = Date.now();
    const generated = generate(join(callDir, "transcript.jsonl"), size);
    console.log(`fixture ${size} MiB: ${generated.bytes} bytes, ${generated.planted} planted secrets, generated in ${Date.now() - started} ms`);
    const child = spawnSync(process.execPath, ["--max-old-space-size=96", "--import", "tsx", join(root, "scripts", "perf-transcript-child.ts"), sourceDir], { cwd: root, encoding: "utf8", maxBuffer: 64 * MiB });
    if (child.status !== 0) {
      console.error(`child failed (status ${child.status}, signal ${child.signal}):\n${child.stderr.slice(-4000)}`);
      failed = true;
      continue;
    }
    const result = JSON.parse(child.stdout.trim().split("\n").at(-1));
    const row = (label, v, budget) => console.log(`  ${label.padEnd(44)} ${String(v).padStart(10)}${budget === undefined ? "" : `   budget ${budget}`}`);
    console.log(`fixture ${size} MiB at commit ${commit}, node ${process.version}:`);
    row("index build (cold), ms", result.indexMs);
    row("window latency median / p95 / max, ms", `${result.window.median} / ${result.window.p95} / ${result.window.max}`);
    row("window redaction median / p95 / max, ms", `${result.windowRedaction.median} / ${result.windowRedaction.p95} / ${result.windowRedaction.max}`, "<= 100 ms per window (§12.2)");
    row("windows served", result.window.n);
    row("follow read after growth, ms", result.followMs);
    row("forward page redaction median / max, ms", `${result.forwardPage.median} / ${result.forwardPage.max}`, "<= 2 ms (§12.2)");
    if (result.oversized !== null) {
      row("oversized checkpoint pass, ms", result.oversized.buildMs);
      row("resumed page median / p95 / max, ms", `${result.oversized.median} / ${result.oversized.p95} / ${result.oversized.max}`, "<= 15 ms per resumed page (§12.2)");
      row("oversized pages served", result.oversized.n);
    }
    row("planted marks in served text", `${result.marksOut} of ${result.marksIn}`, "0 (gated)");
    row("peak heapUsed+external+arrayBuffers, MiB", result.peakMiB, "<= 64 MiB (gated)");
    if (result.peakMiB > 64) { console.error(`FAIL: peak ${result.peakMiB} MiB > 64 MiB`); failed = true; }
    if (result.marksIn === 0 || result.marksOut !== 0) { console.error(`FAIL: marks planted in served ranges ${result.marksIn}, served ${result.marksOut}`); failed = true; }
  }
} finally {
  if (keep) console.log(`kept ${dir}`); else rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
