import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlStore } from "../../../src/control/store.js";
export async function openTestStore() {
  const root = await mkdtemp(join(tmpdir(), "orca-control-"));
  const store = await openControlStore({ stateDir: join(root, "state") });
  return { root, store, async dispose() { store.close(); await rm(root, { recursive: true, force: true }); } };
}
