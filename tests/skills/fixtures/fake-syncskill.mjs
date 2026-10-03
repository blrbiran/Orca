// Syncskill integration spec §4.5, plan Task 2. A fake `syncskill`: logs argv as one JSON line to $FAKE_SYNCSKILL_LOG,
// then behaves by $FAKE_SYNCSKILL_MODE. Never calls process.exit after a write (macOS pipe writes are async).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_SYNCSKILL_LOG, `${JSON.stringify(argv)}\n`);
const mode = process.env.FAKE_SYNCSKILL_MODE ?? "profile-ok";
const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const result = (summary) => say({ type: "result", command: argv.includes("inject") ? "inject" : "profile ls", summary });
const profile = argv[argv.indexOf("ls") + 1];

const lockEntry = (name, over = {}) => ({ name, source: { name: "src", type: "git", url: "https://example.invalid/s.git", branch: "main" }, resolved_commit: "abc123", content_md5: `md5-${name}`, ...over });

if (mode === "profile-ok") result({ profiles: { [profile]: ["beta", "alpha"] } });
else if (mode === "profile-dupes") result({ profiles: { [profile]: ["beta", "alpha", "beta"] } });
else if (mode === "profile-empty") result({ profiles: { [profile]: [] } });
else if (mode === "profile-comma") result({ profiles: { [profile]: ["alpha", "b,c"] } });
else if (mode === "profile-other") result({ profiles: { other: ["alpha"] } });
else if (mode === "profile-missing") { say({ type: "error", code: "E_PROFILE_NOT_FOUND", message: "no such profile" }); process.exitCode = 2; }
else if (mode === "error-on-stderr") { process.stderr.write(`${JSON.stringify({ type: "error", code: "E_SKILL_NOT_FOUND", message: "nope" })}\n`); process.exitCode = 2; }
else if (mode === "inject-ok" || mode === "inject-bad-shape" || mode === "inject-bad-source") {
  const target = argv[argv.indexOf("--target") + 1];
  const names = argv[argv.indexOf("--skills") + 1].split(",");
  for (const name of names) { mkdirSync(join(target, name), { recursive: true }); writeFileSync(join(target, name, "SKILL.md"), `# ${name}\n`); }
  const skills = names.map((n, i) => lockEntry(n, i === 0 && mode === "inject-bad-shape" ? { extra: 1 } : i === 0 && mode === "inject-bad-source" ? { source: { name: "src", type: "git", url: "u", extra: 1 } } : i === 1 ? { source: null, resolved_commit: null } : {}));
  // As the real inject does (plan Task 6): the lock file beside the injected skills, holding the same entries.
  writeFileSync(join(target, "syncskill-lock.json"), `${JSON.stringify({ profile: null, skills }, null, 2)}\n`);
  result({ target, lock: join(target, "syncskill-lock.json"), skills });
} else if (mode === "inject-renamed") { result({ target: argv[argv.indexOf("--target") + 1], skills: argv[argv.indexOf("--skills") + 1].split(",").map((n) => lockEntry(`${n}-other`)) }); }
else if (mode === "inject-not-found") { say({ type: "error", code: "E_SKILL_NOT_FOUND", message: "skill not found" }); process.exitCode = 2; }
else if (mode === "crash") { process.stderr.write("fake-syncskill: boom\n"); process.exitCode = 1; }
else if (mode === "garbage") { process.stdout.write("not json\n{broken\n"); }
else if (mode === "big") { process.stdout.write(`${"x".repeat(200000)}\n`); }
else if (mode === "waits-for-stdin") { process.stdin.resume(); process.stdin.on("end", () => result({ profiles: { [profile]: ["alpha"] } })); }
else if (mode === "sleep") { setTimeout(() => {}, 60000); }
