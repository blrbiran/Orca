import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadChainConfig, modelWindowKnown } from "../../src/chain/config.js";

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "orca-chain-config-"));
  await mkdir(join(repo, ".orca"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(repo, ".orca", name), text);
  return repo;
}

describe(".orca/chain.json (D-launch spec §2.2-4, §4.2, §5.1-5)", () => {
  it("CF1 missing is refused by name", async () => {
    await expect(loadChainConfig(await repoWith({}))).rejects.toMatchObject({ code: "chain-config-missing" });
  });
  it("CF2 not JSON, an unknown key, or an empty model is chain-config-invalid", async () => {
    for (const text of ["{", '{"model":"m","extra":1}', '{"model":""}']) {
      await expect(loadChainConfig(await repoWith({ "chain.json": text })), text).rejects.toMatchObject({ code: "chain-config-invalid" });
    }
  });
  it("CF3 the timeout defaults to 360 minutes and can be set", async () => {
    expect(await loadChainConfig(await repoWith({ "chain.json": '{"model":"m"}' }))).toEqual({ model: "m", sessionTimeoutMin: 360 });
    expect(await loadChainConfig(await repoWith({ "chain.json": '{"model":"m","sessionTimeoutMin":90}' }))).toEqual({ model: "m", sessionTimeoutMin: 90 });
  });
  it("CF4 a model has a window when orca level would find one: the [1m] suffix, or .orca/level.json windows", async () => {
    const bare = await repoWith({});
    expect(await modelWindowKnown(bare, "claude-opus-5[1m]")).toBe(true);
    expect(await modelWindowKnown(bare, "claude-haiku-4-5-20251001")).toBe(false);
    const listed = await repoWith({ "level.json": '{"windows":{"claude-haiku-4-5-20251001":200000}}' });
    expect(await modelWindowKnown(listed, "claude-haiku-4-5-20251001")).toBe(true);
    await expect(modelWindowKnown(await repoWith({ "level.json": "{" }), "m")).rejects.toMatchObject({ code: "level-config-invalid" });
  });
});
