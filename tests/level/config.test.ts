import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LevelConfigRejection, loadLevelConfig } from "../../src/level/config.js";

async function repoWith(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-level-config-"));
  if (content !== undefined) {
    await mkdir(join(dir, ".orca"));
    await writeFile(join(dir, ".orca", "level.json"), content);
  }
  return dir;
}

describe("loadLevelConfig (D spec 4: thresholds live in repository config)", () => {
  it("defaults to Rule 6's 330,000 and 450,000 when the repository has no config", async () => {
    expect(await loadLevelConfig(await repoWith())).toEqual({ t1: 330_000, t2: 450_000, windows: {} });
  });

  it("reads thresholds and the window table from .orca/level.json", async () => {
    const repo = await repoWith(JSON.stringify({ t1: 1000, t2: 2000, windows: { "claude-opus-5": 200_000 } }));
    expect(await loadLevelConfig(repo)).toEqual({ t1: 1000, t2: 2000, windows: { "claude-opus-5": 200_000 } });
  });

  it("refuses a config that is not JSON, naming the file", async () => {
    await expect(loadLevelConfig(await repoWith("{"))).rejects.toThrow(".orca/level.json is not JSON");

    // Correction 1, E2-2: .orca/level.json existing as a directory (EISDIR) is a distinct "cannot be read"
    // branch from the missing-file (ENOENT) default path above.
    const repo = await mkdtemp(join(tmpdir(), "orca-level-config-"));
    await mkdir(join(repo, ".orca"));
    await mkdir(join(repo, ".orca", "level.json"));
    await expect(loadLevelConfig(repo)).rejects.toThrow(LevelConfigRejection);
    await expect(loadLevelConfig(repo)).rejects.toThrow(".orca/level.json cannot be read");
  });

  it("refuses an unknown key instead of ignoring it", async () => {
    await expect(loadLevelConfig(await repoWith(JSON.stringify({ t3: 1 })))).rejects.toThrow(LevelConfigRejection);
  });

  it("refuses t1 at or above t2", async () => {
    await expect(loadLevelConfig(await repoWith(JSON.stringify({ t1: 450_000 })))).rejects.toThrow(
      "t1 (450000) must be below t2 (450000)",
    );
  });
});
