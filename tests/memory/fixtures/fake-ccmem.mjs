// Memory tab spec §6.1, revised for issue #418. A fake `ccmem` for criteria: logs every call, then answers
// by $FAKE_CCMEM_MODE. The global, project and all-projects answers differ, so a criterion can tell which
// one it got (an answer that is the same constant for every input would hide a wrong --scope). `list --json`
// and `show --json` answer the version-1 read contract; `export` keeps its version-0.7 shape.
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_CCMEM_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), env: { CCMEM_DATA_ROOT: process.env.CCMEM_DATA_ROOT, HOME: process.env.HOME, ORCA_T4_SENTINEL: process.env.ORCA_T4_SENTINEL ?? null } })}\n`);

const mode = process.env.FAKE_CCMEM_MODE ?? "ok";
const scopeAt = argv.indexOf("--scope");
const scope = scopeAt === -1 ? undefined : argv[scopeAt + 1];
const data = () => JSON.parse(readFileSync(process.env.FAKE_CCMEM_DATA, "utf8"));
const rowsFor = (d) => (scope === "global" ? d.global : scope === "project" ? d.project : d.all);
const answer = (memories, over = {}) => JSON.stringify({ version: "0.7", exported_at: Date.now(), memories, ...over }, null, 2);
// Never call process.exit after a write: on macOS a pipe write is asynchronous and exiting right after it loses output, so the script just ends and stdout drains first.
const say = (text) => process.stdout.write(`${text}\n`);

function option(name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** Positional values after the verb, excluding the values of options that take one. */
function positionals() {
  const skip = new Set();
  for (const flag of ["--limit", "--offset", "--scope"]) {
    const at = argv.indexOf(flag);
    if (at !== -1) skip.add(at + 1);
  }
  return argv.filter((arg, idx) => idx > 0 && !arg.startsWith("--") && !skip.has(idx));
}

const byDefaultOrder = (a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at) || (b.id - a.id);
const byScore = (a, b) => (b.score.fused - a.score.fused) || byDefaultOrder(a, b);

function listAnswer() {
  const d = data();
  const query = positionals().join(" ");
  let matched = (mode === "wrong-scope" || mode === "list-wrong-scope") ? [...d.all] : [...d.global, ...d.project];
  if (query !== "") {
    const needle = query.toLowerCase();
    matched = matched
      .filter((row) => String(row.content).toLowerCase().includes(needle))
      .map((row) => {
        const hits = String(row.content).toLowerCase().split(needle).length - 1;
        return { ...row, score: { fused: hits, fts: hits, jaccard: hits / (hits + 1), semantic: 0 } };
      })
      .sort(byScore);
  } else {
    matched = matched.map((row) => ({ ...row, score: null })).sort(byDefaultOrder);
  }
  const limit = Number(option("--limit") ?? 50);
  const offset = Number(option("--offset") ?? 0);
  say(JSON.stringify({
    version: 1,
    query: query === "" ? null : query,
    scope: "project",
    project_key: d.project[0]?.project_key ?? null,
    total: matched.length,
    memories: matched.slice(offset, offset + limit),
  }));
}

function showAnswer() {
  const d = data();
  const id = Number(positionals()[0]);
  const row = [...d.global, ...d.project].find((candidate) => candidate.id === id);
  say(JSON.stringify({
    version: 1,
    project_key: d.project[0]?.project_key ?? null,
    memory: row ? { ...row, score: null } : null,
  }));
}

if (mode.startsWith("exit:")) {
  process.stderr.write(`fake-ccmem: failing on purpose (${argv[0]} ${scope ?? ""})\n`);
  process.exitCode = Number(mode.slice(5));
} else if (mode.startsWith("kill:")) {
  process.kill(process.pid, mode.slice(5));
  setTimeout(() => {}, 60_000);
} else if (mode === "sleep") {
  setTimeout(() => {}, 60_000);
} else if (mode === "usage" && (argv[0] === "list" || argv[0] === "show") && argv.includes("--json")) {
  // An older ccmem: no --json for list/show, so the flag is a usage error. Exports still work.
  process.stderr.write("fake-ccmem: unknown option --json\n");
  process.exitCode = 64;
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
} else if ((mode === "wrong-scope" || mode === "list-wrong-scope") && argv[0] !== "list") {
  say(answer(data().all));
} else if (argv[0] === "list") {
  listAnswer();
} else if (argv[0] === "show") {
  showAnswer();
} else {
  say(answer(rowsFor(data())));
}