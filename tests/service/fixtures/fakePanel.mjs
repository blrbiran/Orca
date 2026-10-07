// A stand-in for `node dist/cli.js panel run --service`: serves the summary on a socket and writes panel.json.
import { spawnSync } from "node:child_process";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const dir = process.env.ORCA_PANEL_DIR;
const socketPath = join(dir, "s.sock");
const startTime = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).stdout.trim();
const server = createServer((req, res) => {
  res.writeHead(req.url === "/api/control/summary" ? 200 : 404, { "content-type": "application/json" });
  res.end("{}");
});
server.listen(socketPath, () => {
  writeFileSync(join(dir, "panel.json.tmp"), JSON.stringify({ pid: process.pid, startTime, url: "http://127.0.0.1:1", socketPath, version: "fake" }), { mode: 0o600 });
  renameSync(join(dir, "panel.json.tmp"), join(dir, "panel.json"));
  process.stderr.write("fake-panel ready\n");
});
process.on("SIGTERM", () => server.close(() => { try { unlinkSync(join(dir, "panel.json")); } catch {} process.exit(0); }));
