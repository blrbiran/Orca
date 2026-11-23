import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// CLI v2 plan Task 1 (Review Focus 1): every handler's modules load on demand, inside the arm that needs them, so a
// command that only talks to the socket (`orca status`) never loads the control plane. Help is generated from the
// registry (src/commands/help.ts); the old top-level names are gone without aliases (plan Task 14, human ruling).

// The service usage text lives in a leaf so `orca help panel|user|mcp` can print its blocks (tester #342).
import { SERVICE_USAGE } from "./commands/serviceUsage.js";

async function runPanel(args: string[]): Promise<number> {
  // Tester #450: `orca panel --help` used to reach startPanelFromArgs and START a panel (random port, never
  // exits). Every other domain answers --help with its usage line; this arm does too, and must run before the
  // --service check so `--service --help` cannot start the managed form either.
  if (args.includes("--help") || args.includes("-h")) {
    const { PANEL_USAGE } = await import("./commands/serviceUsage.js");
    process.stdout.write("usage: orca panel <run|install|start|stop|restart|status|logs|uninstall>\n\n" + PANEL_USAGE);
    return 0;
  }
  // Panel service spec §5 / plan D2: only the managed form takes the lock and writes panel.json.
  if (args.includes("--service")) {
    const { runServicePanel } = await import("./service/servicePanel.js");
    return runServicePanel(args.filter((arg) => arg !== "--service"), process.env, { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) });
  }
  try {
    // Argument parsing and the machine-readable line live here; everything the
    // panel actually DOES lives behind createPanelServer, which touches
    // neither argv nor stdout. That is the same seam the correction row got in
    // src/corrections/record.ts, for the same reason: a request handler cannot
    // call something that writes stdout and returns an exit code.
    const { panelReadyLines, startPanelFromArgs } = await import("./panel/server.js");
    const started = await startPanelFromArgs(args);
    // 🔴 spec §7: ONE machine-readable line on stdout. Without it the success
    // criterion cannot read back the port it needs, and a
    // criterion that cannot read its own subject is exactly the "success
    // criterion that never exits 0" E2 §7.1 caught.
    const lines = panelReadyLines(started);
    process.stdout.write(lines.stdout);
    // For the person at the terminal, on stderr so stdout keeps its one line: open the url and
    // log in (accounts spec §3.4, D11).
    process.stderr.write(lines.stderr);
    await started.closed;
    return 0;
  } catch (err) {
    const { PanelRejection } = await import("./panel/rejection.js");
    if (err instanceof PanelRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

export async function main(argv: string[], stdinText?: string): Promise<number> {
  // CLI v2 spec §11: the registry first; `panel`, `user` and `mcp` keep their own grammar in the arms below.
  const { processIo, runRegistered, unknownCommand } = await import("./commands/run.js");
  const io = processIo(stdinText);
  const registered = await runRegistered(argv, io);
  if (registered !== null) return registered;

  const [command, ...rest] = argv;

  if (command === "panel") {
    const sub = rest[0];
    if (sub === "run") return runPanel(rest.slice(1));
    const { SERVICE_SUBCOMMANDS } = await import("./service/subcommands.js");
    if (sub !== undefined && (SERVICE_SUBCOMMANDS as readonly string[]).includes(sub)) {
      const { runServiceCommand } = await import("./service/command.js");
      return runServiceCommand(sub, rest.slice(1), process.env, { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) });
    }
    return runPanel(rest); // spec §2: the old form is kept as an alias of `orca panel run`
  }

  if (command === "user") {
    const { runUserCommand } = await import("./panel/accounts/userCommand.js");
    const { readSecretFromTty } = await import("./panel/accounts/ttySecret.js");
    return runUserCommand(rest, {
      stdinIsTTY: process.stdin.isTTY === true, readSecret: readSecretFromTty,
      out: (line) => process.stdout.write(line), err: (line) => process.stderr.write(line), env: process.env, nowMs: Date.now,
    });
  }

  if (command === "mcp") {
    const { runMcpServe } = await import("./entry/mcp.js");
    return runMcpServe(rest, process.env);
  }

  const unknown = unknownCommand(argv, io);
  if (unknown !== null) return unknown;
  const { renderHelp } = await import("./commands/help.js");
  process.stderr.write(`${renderHelp([])}\n${SERVICE_USAGE}`);
  return 1;
}

// True when this module is the process entry point. Both sides are resolved to real
// paths: node realpaths the main module but leaves argv[1] as typed, so an install
// reached through a symlink (or a /var -> /private/var tmpdir) would otherwise match
// nothing and exit 0 silently.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = realpathSync(fileURLToPath(import.meta.url));
  try {
    return self === realpathSync(entry);
  } catch (err) {
    // An entry that does not exist cannot be a symlink to this module: compare it as typed.
    // Anything else (a bad argument, EACCES) must surface; swallowing it would be the silent exit 0 again.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return self === entry;
  }
}

// Only runs when invoked directly (`tsx src/cli.ts` or `node dist/cli.js`). Not executed on import.
if (isMainModule()) {
  // Tester follow-up K: a reader that stopped reading (`orca help | head -1`) closes stdout; node then throws an
  // unhandled EPIPE with a stack trace. Nothing more can reach that reader, so stop writing and exit 0, as head expects.
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    // Fix round 1, finding 2. Without this arm a rejection out of main() is an
    // unhandled promise rejection: node decides the exit code, not this
    // program, and the error text lands in node's own crash format. 3 is spec
    // §6.3's escalation code and is the honest answer for an exception no
    // handler anticipated — 1 would claim "the input was rejected", which is a
    // diagnosis this arm has no way to make.
    (err: unknown) => {
      process.stderr.write(`orca: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exitCode = 3;
    },
  );
}
