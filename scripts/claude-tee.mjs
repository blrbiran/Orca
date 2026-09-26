// Live acceptance helper (scripts/live-driver-acceptance.ts, --claude): `node claude-tee.mjs <raw dir> <claude...>`
// runs `<claude...>` with the remaining arguments, passes stdin, stdout, stderr and the exit status straight through,
// and also keeps each call's stdout as `<raw dir>/<n>.json`. ccloop's claude runner keeps only input/output tokens
// from the `-p --output-format json` envelope; the envelope's own total_cost_usd and cache token counts are what the
// tool reports, and the acceptance summary copies them from here instead of estimating. `--version` is not kept.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [rawDir, command, ...args] = process.argv.slice(2);
const keep = args.at(-1) !== "--version";
const child = spawn(command, args, { stdio: ["inherit", "pipe", "inherit"] });
const chunks = [];
child.stdout.on("data", (chunk) => { chunks.push(chunk); process.stdout.write(chunk); });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("close", (code, signal) => {
  if (keep) {
    mkdirSync(rawDir, { recursive: true, mode: 0o700 });
    const n = readdirSync(rawDir).length + 1;
    writeFileSync(join(rawDir, `${String(n).padStart(3, "0")}.json`), Buffer.concat(chunks), { mode: 0o600 });
  }
  // A child killed by a signal is a failed call to the runner, like any non-zero exit.
  process.exit(signal !== null ? 1 : code ?? 1);
});
