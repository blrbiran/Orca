// Loaded into every node process of a criterion through NODE_OPTIONS=--require. One JSON line per process, so the
// criterion sees every src/cli.ts the supervisor starts — including one started by an absolute path, which a PATH stub
// cannot see (D-launch spec §8.2-11). Measured at 96cae2b: tsx's own child process loads it too.
if (process.env.ORCA_TEST_NODE_LOG) {
  require("node:fs").appendFileSync(process.env.ORCA_TEST_NODE_LOG, `${JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv })}\n`);
}
