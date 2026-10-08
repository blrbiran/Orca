#!/usr/bin/env node
// A scripted `gh` for the integration criteria (integration spec §6.4, §10). Everything lives under $FAKE_GH_DIR:
// - calls.jsonl: one line per invocation, {"argv": [...], "stdin": "..."} (stdin only when the caller wrote any);
// - state.json: { prs: [{number,url,state,isDraft,head,base}], authOk: true, refuseDraft: false,
//   fail: { "<sub command>": "<stderr>" } } -- `fail` makes that sub command ("pr create", "auth status", ...) print
//   the words to stderr and exit 1, as gh does when its API call fails.
// Unknown commands exit 2.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_GH_DIR;
if (!dir) { process.stderr.write("fakeGh: FAKE_GH_DIR is not set\n"); process.exit(3); }
const argv = process.argv.slice(2);
const statePath = join(dir, "state.json");
const state = { prs: [], authOk: true, refuseDraft: false, fail: {}, ...(existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}) };

let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; }
appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(stdin.length > 0 ? { argv, stdin } : { argv })}\n`);

/** The value of `--name value` or `--name=value`. */
function flag(name) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}`) return argv[i + 1];
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3);
  }
  return undefined;
}
const positional = argv.filter((arg, i) => !arg.startsWith("-") && !(i > 0 && argv[i - 1].startsWith("--") && !argv[i - 1].includes("=") && argv[i - 1] !== "--draft"));
const sub = positional.slice(0, 2).join(" ");
const save = () => writeFileSync(statePath, JSON.stringify(state));
const die = (words, code = 1) => { process.stderr.write(`${words}\n`); process.exit(code); };

if (typeof state.fail[sub] === "string") die(state.fail[sub]);
const find = (number) => state.prs.find((pr) => pr.number === Number(number));

switch (sub) {
  case "auth status":
    if (!state.authOk) die("You are not logged into any GitHub hosts. To log in, run: gh auth login");
    process.stdout.write(`${flag("hostname")}\n  ✓ Logged in\n`);
    break;
  case "pr list": {
    const wanted = (flag("state") ?? "open").toUpperCase();
    const matching = state.prs.filter((pr) => pr.head === flag("head") && pr.base === flag("base") && (wanted === "ALL" || pr.state === wanted));
    process.stdout.write(`${JSON.stringify(matching.map(({ number, url, state: s, isDraft }) => ({ number, url, state: s, isDraft })))}\n`);
    break;
  }
  case "pr create": {
    const draft = argv.includes("--draft");
    if (draft && state.refuseDraft) die("pull request create failed: GraphQL: Draft pull requests are not supported in this repository. (createPullRequest)");
    const number = state.prs.length + 1;
    const url = `https://${flag("repo")}/pull/${number}`;
    state.prs.push({ number, url, state: "OPEN", isDraft: draft, head: flag("head"), base: flag("base") });
    save();
    process.stdout.write(`${url}\n`);
    break;
  }
  case "pr ready": {
    const pr = find(positional[2]);
    if (pr === undefined) die(`no pull requests found for ${positional[2]}`);
    pr.isDraft = false;
    save();
    process.stdout.write(`✓ Pull request #${pr.number} is marked as "ready for review"\n`);
    break;
  }
  case "pr view": {
    const pr = find(positional[2]);
    if (pr === undefined) die(`no pull requests found for ${positional[2]}`);
    process.stdout.write(`${JSON.stringify({ state: pr.state, isDraft: pr.isDraft })}\n`);
    break;
  }
  default:
    die(`fakeGh: unknown command: ${argv.join(" ")}`, 2);
}
