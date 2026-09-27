// Live acceptance helper (scripts/live-driver-acceptance.ts, --claude): `node claude-tee.mjs <raw dir> <claude...>`
// runs `<claude...>` with the remaining arguments, passes stdin, stdout, stderr and the exit status straight through,
// and also keeps each call's stdout as `<raw dir>/<n>.json`. ccloop's claude runner keeps only input/output tokens
// from claude's result envelope; the envelope's own total_cost_usd and cache token counts are what the tool reports,
// and the acceptance summary copies them from here instead of estimating. Since Orca claude stream usage (2026-09-27)
// the runner calls `-p --output-format stream-json`, so the kept stdout is NDJSON (the file name keeps `.json`) and
// the envelope is its last `type: "result"` line -- absent when the call was cut first. `--version` is not kept.
// Each call is kept as `<ms>-<pid>.json` with its argv beside it as `<ms>-<pid>.argv.json`: parallel calls (the
// conflict scenario) must not overwrite each other, and the argv is where a selection's `--model` is observed.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rawDir, command, ...args] = process.argv.slice(2);
const keep = args.at(-1) !== "--version";
const started = Date.now();
const child = spawn(command, args, { stdio: ["inherit", "pipe", "inherit"] });
const chunks = [];
child.stdout.on("data", (chunk) => { chunks.push(chunk); process.stdout.write(chunk); });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("close", (code, signal) => {
  if (keep) {
    mkdirSync(rawDir, { recursive: true, mode: 0o700 });
    const name = `${String(started).padStart(15, "0")}-${process.pid}`;
    writeFileSync(join(rawDir, `${name}.json`), Buffer.concat(chunks), { mode: 0o600 });
    writeFileSync(join(rawDir, `${name}.argv.json`), JSON.stringify(args), { mode: 0o600 });
  }
  // A child killed by a signal is a failed call to the runner, like any non-zero exit.
  process.exit(signal !== null ? 1 : code ?? 1);
});
