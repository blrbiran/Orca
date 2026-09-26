// Ruling review R3 (2026-09-27): a CLI that upgrades itself in place. `node version-wrapper.mjs <version file> <cli...>`
// answers `--version` with the file's current content and runs `<cli...>` with every other argument list, so a
// criterion can change what the installed CLI reports without touching the table or the command.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [versionFile, ...cli] = process.argv.slice(2);
if (cli.at(-1) === "--version") {
  process.stdout.write(readFileSync(versionFile, "utf8"));
  process.exit(0);
}
const child = spawnSync(process.execPath, cli, { stdio: "inherit" });
process.exit(child.status ?? 1);
