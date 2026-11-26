import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("the root build publishes both backend and browser outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "orca-root-build-"));
  roots.push(root);
  const web = join(root, "web");
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(web);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "package.json"), readFileSync("package.json"));
  writeFileSync(join(web, "package.json"), readFileSync("web/package.json"));
  writeFileSync(join(bin, "tsc"), '#!/bin/sh\nmkdir -p dist && printf backend > dist/cli.js\n', { mode: 0o700 });
  writeFileSync(join(bin, "vite"), '#!/bin/sh\nmkdir -p dist && printf browser > dist/index.html\n', { mode: 0o700 });

  const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", env: {
    PATH: process.env.PATH, HOME: root, npm_config_cache: join(root, "npm-cache"), npm_config_logs_dir: join(root, "npm-logs"),
    npm_config_userconfig: join(root, "npmrc"), npm_config_globalconfig: join(root, "global-npmrc"),
  } });
  expect(build.status, build.stderr).toBe(0);
  expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("backend");
  expect(readFileSync(join(web, "dist", "index.html"), "utf8")).toBe("browser");
});
