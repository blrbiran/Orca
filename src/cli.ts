import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// CLI v2 plan Task 1 (Review Focus 1): every handler's modules load on demand, inside the arm that needs them, so a
// command that only talks to the socket (`orca status`) never loads the control plane. Help is generated from the
// registry (src/commands/help.ts); the old top-level names are gone without aliases (plan Task 14, human ruling).

/**
 * The commands outside the registry (their own grammar, unchanged by CLI v2 §4): the panel service, its accounts, the
 * raw socket client and the MCP server. Printed after the generated help when no command matches; moved verbatim from
 * the old USAGE (plan Task 14), which tests/panel/usage.test.ts pins.
 */
const SERVICE_USAGE = `The service, its accounts, the raw socket client and the MCP server:
  orca panel run --by <who> [--port <n>] [--bind <addr>] [--root <dir>] [--repo <key>=<path>]...
             [--no-control] [--control-state-dir <path>] [--control-wake-ms <n>]
             [--estimator-profile <id> --estimate-mode strict|soft] [--session-days <n>]
                                 serve the panel on the loopback interface. The browser logs in
                                 with an account; a session lasts --session-days (1-30, default
                                 15). --bind opens it to other machines and needs
                                 --i-know-this-is-exposed as well: there is no TLS, so external
                                 mode suits you across your own machines and does not suit a team.
                                 The task control plane mounts with the panel; --no-control leaves
                                 it off. Its state lives under $ORCA_CONTROL_DIR (default
                                 ~/.orca/control/<repo key>); more than one --repo has no key to
                                 name it after, so it needs --control-state-dir. Running work also
                                 needs ORCA_AGENTS_TABLE, ccloop (ORCA_CCLOOP_BIN, else the ccloop
                                 package installed with Orca) and the two
                                 estimator flags -- without them the panel still starts and still
                                 shows recovery, and refuses those commands by name.
                                 ORCA_CCMEM_BIN (an absolute path to ccmem) turns on the read-only
                                 Memory section; unset, the panel never starts ccmem.
                                 --ccmem-corrections also writes each closed correction to the
                                 repository's ccmem project memory (retrieval only) and archives it
                                 when withdrawn; it needs ORCA_CCMEM_BIN and the control plane.
                                 \`orca panel <args>\` is the same command (kept as an alias).
  orca panel install [--dry-run] <orca panel run args>
                                 record the args and the named ORCA_* variables in ~/.orca/panel/service.json
                                 and install a per-user service: a launchd LaunchAgent on macOS, a systemd user
                                 unit on Linux. Runs node dist/cli.js (npm run build first). --dry-run prints the
                                 files and runs nothing
  orca panel start [--detach] | stop | restart | uninstall
                                 drive that service. Without a service manager, start --detach starts a process
                                 that neither restarts on crash nor survives a reboot. These touch the person's
                                 running system: an agent does not run them, it should ask the person
  orca panel status              the manager's view and a real request to the panel; exit 0 only if it answered
  orca panel logs [-f] [-n <lines>]
                                 the panel's log files (macOS, detached) or its journal (Linux)
  orca user add <name> [--role owner|member] | passwd <name> | disable <name> | list | rotate-key
                                 (passwords are typed at a terminal, never passed as arguments)
                                 manage panel accounts in the control root's accounts store: the same
                                 ORCA_CONTROL_DIR as the service panel, or it refuses (user-store-missing).
                                 rotate-key logs every session out; restart the panel afterwards. Exit 1 = refused
  orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
  orca control send <route> --expected-revision <n> (--payload <json> | --payload-file <file>)
                    [--command-id <id>] [--control-state-dir <dir>] [--client-name <name>]
                                 talk to a running panel over its control socket (<state dir>/control.sock,
                                 found from --control-state-dir, the service's panel.json, the projects file's
                                 controlStateDir, $ORCA_CONTROL_DIR/panel or ~/.orca/control/panel, else the one
                                 socket under that control root; several are named, not chosen). stdout is one JSON line,
                                 {"schema":"orca-cli-response-v1",status,commandId?,body}. Never starts a panel.
                                 set-limit and a budget limit field are refused: a person sets those in the
                                 Web UI. Exit 0 answered 2xx, 1 refused here (panel-not-running included),
                                 2 the panel answered an error; 3 is reserved for crashes (unexpected errors)
  orca mcp serve [--control-state-dir <dir>]
                                 a stdio MCP server with one tool, orca, whose args are this CLI's argv (run
                                 with --json; the panel, user and dev domains are refused)
`;

async function runPanel(args: string[]): Promise<number> {
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
