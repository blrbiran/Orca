import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/entry/controlCommand.js";
import { bindControlSocket, buildControlSocketApp, socketPathTooLong } from "../../src/panel/controlSocket.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { command, createHarness, GROUP, revision } from "./fixtures/controlPanel.js";
import { overSocket } from "./fixtures/socketPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, confirm } = createOverviewFixtures(h);

// Start guard spec (2026-10-15) §5 criterion 5: the refusal is the same over the control socket (agents) and through
// `orca control send` (status 409 in the envelope, exit 2), because both reach scheduleStart through the same routes.
describe("a second start over the control socket and the CLI (spec B criterion 5)", () => {
  it("answers 409 group-execution-pending on the socket, and the CLI prints that envelope and exits 2", async () => {
    const { panel } = await panelFixture(); await confirm(panel);
    expect((await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "start-1", expectedRevision: await revision(panel), payload: {} })).status).toBe(202);
    const stateDir = await realpath(await mkdtemp(join(tmpdir(), "s")));
    const path = join(stateDir, "control.sock");
    expect(socketPathTooLong(path)).toBe(false);
    const bound = await bindControlSocket(buildControlSocketApp({ store: panel.store, epoch: panel.epoch, config: undefined as never, service: panel.service }), path);
    if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
    try {
      const rev = await revision(panel);
      const socket = await overSocket(path, "POST", `/api/control/groups/${GROUP}/start`, { "x-orca-client": "cli" }, { commandId: "start-socket", expectedRevision: rev, payload: {} });
      expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([409, "group-execution-pending"]);
      const printed: string[] = [];
      const exit = await runControlCommand(["send", `groups/${GROUP}/start`, "--expected-revision", String(rev), "--payload", "{}", "--command-id", "start-cli", "--control-state-dir", stateDir], {},
        { write: (line) => { printed.push(line); }, readFile: () => "" });
      expect([exit, JSON.parse(printed.join("")).status, JSON.parse(printed.join("")).body.error.code]).toEqual([2, 409, "group-execution-pending"]);
    } finally { await bound.close(); }
  }, 30_000);
});
