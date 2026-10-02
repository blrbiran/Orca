// Memory tab spec §6.1. A fake `ccmem` for criteria: logs every call, then answers by $FAKE_CCMEM_MODE.
// The global, project and all-projects answers differ, so a criterion can tell which one it got
// (an answer that is the same constant for every input would hide a wrong --scope).
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_CCMEM_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), env: { CCMEM_DATA_ROOT: process.env.CCMEM_DATA_ROOT, HOME: process.env.HOME } })}\n`);

const mode = process.env.FAKE_CCMEM_MODE ?? "ok";
const scopeAt = argv.indexOf("--scope");
const scope = scopeAt === -1 ? undefined : argv[scopeAt + 1];
const data = () => JSON.parse(readFileSync(process.env.FAKE_CCMEM_DATA, "utf8"));
const rowsFor = (d) => (scope === "global" ? d.global : scope === "project" ? d.project : d.all);
const answer = (memories, over = {}) => JSON.stringify({ version: "0.7", exported_at: Date.now(), memories, ...over }, null, 2);
// Wait for the write callback: on macOS a pipe write is asynchronous and exiting right after it loses output.
const say = (text) => process.stdout.write(`${text}\n`);

if (mode.startsWith("exit:")) {
  process.stderr.write(`fake-ccmem: failing on purpose (scope ${scope})\n`);
  process.exitCode = Number(mode.slice(5));
} else if (mode === "sleep") {
  setTimeout(() => {}, 60_000);
} else if (mode === "garbage") {
  say("this is not json");
} else if (mode === "huge") {
  say(answer([], { padding: "x".repeat(1024 * 1024) }));
} else if (mode === "extra-field") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, embedding: "AAAA" }))));
} else if (mode === "bad-enum") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, type: "opinion" }))));
} else if (mode === "bad-tags") {
  say(answer(rowsFor(data()).map((row) => ({ ...row, tags: "not json" }))));
} else if (mode === "wrong-scope") {
  say(answer(data().all));
} else {
  say(answer(rowsFor(data())));
}
