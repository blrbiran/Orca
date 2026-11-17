// The commands outside the registry (their own grammar, unchanged by CLI v2 §4): the panel service, its accounts, the raw
// socket client and the MCP server. Moved verbatim from src/cli.ts (tester #342) so that `orca help panel|user|mcp` can
// print each block; SERVICE_USAGE, printed after the generated help when no command matches, is the same text as before
// (tests/panel/usage.test.ts pins it). A leaf: no imports.
export const PANEL_USAGE = `  orca panel run --by <who> [--port <n>] [--bind <addr>] [--root <dir>] [--repo <key>=<path>]...
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
`;
export const USER_USAGE = `  orca user add <name> [--role owner|member] | passwd <name> | disable <name> | list | rotate-key
                                 (passwords are typed at a terminal, never passed as arguments; an isolated test
                                 panel outside the real ~/.orca may pipe one line with --password-stdin)
                                 manage panel accounts in the control root's accounts store: the same
                                 ORCA_CONTROL_DIR as the service panel, or it refuses (user-store-missing).
                                 rotate-key logs every session out; restart the panel afterwards. Exit 1 = refused
`;
export const CONTROL_USAGE = `  orca control get <path> [--control-state-dir <dir>] [--client-name <name>]
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
`;
export const MCP_USAGE = `  orca mcp serve [--control-state-dir <dir>]
                                 a stdio MCP server with one tool, orca, whose args are this CLI's argv (run
                                 with --json; the panel, user and dev domains are refused)
`;
export const SERVICE_USAGE = `The service, its accounts, the raw socket client and the MCP server:\n${PANEL_USAGE}${USER_USAGE}${CONTROL_USAGE}${MCP_USAGE}`;
/** Tester #342: the domains cli.ts dispatches outside the registry, each with its help block and a one-line summary. */
export const SERVICE_DOMAINS: Record<string, { usage: string; summary: string }> = {
  panel: { usage: PANEL_USAGE, summary: "the panel service: run, install, start, stop, restart, uninstall, status, logs" },
  user: { usage: USER_USAGE, summary: "the panel's accounts: add, passwd, disable, list, rotate-key" },
  mcp: { usage: MCP_USAGE, summary: "a stdio MCP server whose one tool runs this CLI" },
};
