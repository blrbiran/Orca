import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { directorySize } from "../../src/control/diskUsage.js";

it("counts a multiply linked inode once under the measured root (#549)", async () => {
  const parent = await mkdtemp(join(tmpdir(), "orca-disk-"));
  try {
    const root = join(parent, "root");
    await mkdir(join(root, "nested"), { recursive: true });
    const file = join(root, "file");
    await writeFile(file, "hello");
    await link(file, join(root, "copy"));
    await link(file, join(root, "nested", "link"));
    await writeFile(join(root, "regular"), "world");
    await symlink(file, join(root, "symbolic"));
    expect(await directorySize(root)).toEqual({ bytes: 10, truncated: false });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

it("the reclaim estimate excludes an inode with links outside the removed directory (#549)", async () => {
  const parent = await mkdtemp(join(tmpdir(), "orca-reclaim-"));
  try {
    const root = join(parent, "root");
    await mkdir(root);
    const shared = join(root, "shared");
    const owned = join(root, "owned");
    await writeFile(shared, "hello");
    await link(shared, join(parent, "outside"));
    await writeFile(owned, "abc");
    await link(owned, join(root, "owned-link"));
    expect(await directorySize(root, 500_000, { reclaim: true })).toEqual({ bytes: 3, truncated: false });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
