import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readSecretFromTty } from "../../src/panel/accounts/ttySecret.js";

function fake() {
  const stdin = Object.assign(new EventEmitter(), { modes: [] as boolean[], paused: 0, setRawMode(m: boolean) { this.modes.push(m); }, resume() {}, pause() { this.paused++; } });
  const written: string[] = [];
  return { stdin, written, stderr: { write: (t: string) => { written.push(t); } } };
}
const start = (f: ReturnType<typeof fake>) => readSecretFromTty("pw: ", f.stdin, f.stderr);
const listeners = (f: ReturnType<typeof fake>) => ["data", "end", "close", "error"].map((e) => f.stdin.listenerCount(e));

describe("readSecretFromTty: raw mode is restored on every exit and the secret is never echoed (accounts spec §10)", () => {
  it("Enter resolves the typed line; backspace edits; raw on then off; nothing typed reaches stderr", async () => {
    const f = fake();
    const p = start(f);
    f.stdin.emit("data", Buffer.from("abcx"));
    f.stdin.emit("data", Buffer.from("\x7fd\r"));
    expect(await p).toBe("abcd");
    expect(f.stdin.modes).toEqual([true, false]);
    expect(listeners(f)).toEqual([0, 0, 0, 0]);
    expect(f.written.join("")).toBe("pw: \n");
  });

  it.each([["Ctrl-C", "\x03"], ["Ctrl-D", "\x04"]])("%s refuses user-aborted and restores raw mode", async (_n, key) => {
    const f = fake();
    const p = start(f);
    f.stdin.emit("data", Buffer.from(`sec${key}`));
    await expect(p).rejects.toMatchObject({ code: "user-aborted" });
    expect(f.stdin.modes).toEqual([true, false]);
    expect(listeners(f)).toEqual([0, 0, 0, 0]);
    expect(f.written.join("")).not.toContain("sec");
  });

  it.each(["end", "close", "error"])("stdin %s refuses user-aborted and restores raw mode", async (event) => {
    const f = fake();
    const p = start(f);
    f.stdin.emit("data", Buffer.from("sec"));
    f.stdin.emit(event, new Error("hangup"));
    await expect(p).rejects.toMatchObject({ code: "user-aborted" });
    expect(f.stdin.modes).toEqual([true, false]);
    expect(f.stdin.paused).toBe(1);
    expect(listeners(f)).toEqual([0, 0, 0, 0]);
  });

  it("a second exit signal after settling does not restore twice", async () => {
    const f = fake();
    const p = start(f);
    f.stdin.emit("data", Buffer.from("x\r"));
    await p;
    f.stdin.emit("end");
    expect(f.stdin.modes).toEqual([true, false]);
  });
});
