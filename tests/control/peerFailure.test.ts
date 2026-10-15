import { describe, expect, it } from "vitest";
import { ccloopFailedMessage, peerCode, peerErrorCode, peerExitText, peerFailure, peerFailureLogLine } from "../../src/control/ccloopPort.js";
import { ControlError } from "../../src/control/errors.js";

// ccloop error codes spec (2026-10-15) §4.1, criterion 2: ccloop exits non-zero with `<code>[: <detail>]` on stderr and Orca
// sees `control-peer-exit` with detail `<exit>:<stderr>`. One parser takes it apart; every site that stores or shows a
// ccloop failure reads it, so a wrong code or an uncut stderr here reaches the database and the browser.
const peer = (detail?: string) => new ControlError("control-peer-exit", detail);

describe("peerFailure (spec A §4.1)", () => {
  it("reads ccloop's code and the detail after it", () => {
    expect(peerFailure(peer("2:omp-model-catalog-unavailable: spawn ENOENT"))).toEqual({ exit: "2", code: "omp-model-catalog-unavailable", detail: "spawn ENOENT" });
    expect(peerFailure(peer("2:agent-version-drift"))).toEqual({ exit: "2", code: "agent-version-drift", detail: "" });
    expect(peerFailure(peer("2:agent-x something else"))).toEqual({ exit: "2", code: "agent-x", detail: "something else" });
  });

  it("names no code for a URL, an upper-case word or a 65-character run, and keeps the whole stderr as the detail", () => {
    expect(peerFailure(peer("1:file:///x"))).toEqual({ exit: "1", code: null, detail: "file:///x" });
    expect(peerFailure(peer("1:Error: socket closed"))).toEqual({ exit: "1", code: null, detail: "Error: socket closed" });
    const sixtyFour = `a${"b".repeat(63)}`;
    expect(peerFailure(peer(`2:${sixtyFour}: d`))).toEqual({ exit: "2", code: sixtyFour, detail: "d" });
    expect(peerFailure(peer(`2:${sixtyFour}b: d`))).toEqual({ exit: "2", code: null, detail: `${sixtyFour}b: d` });
  });

  it("replaces every C0 and C1 control character with a space and trims", () => {
    expect(peerFailure(peer("2:agent-config-invalid: line1\nline2\tx\u0085y\u0007"))).toEqual({ exit: "2", code: "agent-config-invalid", detail: "line1 line2 x y" });
  });

  it("cuts the detail to 512 UTF-16 units with a trailing ellipsis, never splitting a surrogate pair", () => {
    const long = peerFailure(peer(`1:${"a".repeat(600)}`))!;
    expect([long.code, long.detail, long.detail.length]).toEqual([null, `${"a".repeat(511)}…`, 512]);
    const emoji = peerFailure(peer(`1:${"😀".repeat(300)}`))!;
    expect([emoji.detail, emoji.detail.length]).toEqual([`${"😀".repeat(255)}…`, 511]);
  });

  it("answers an empty failure for a peer exit with no detail, and null for anything that is not a peer exit", () => {
    expect(peerFailure(peer())).toEqual({ exit: "", code: null, detail: "" });
    expect(peerFailure(new ControlError("control-peer-timeout"))).toBeNull();
    expect(peerFailure(new Error("control-peer-exit:2:agent-version-drift"))).toBeNull();
  });
});

describe("the forms built on it (spec A §4.2-§4.4, §4.9)", () => {
  it("peerCode is ccloop's code, else control-peer-exit, and any other ControlError's own code", () => {
    expect([peerCode(peer("2:omp-model-catalog-unavailable: x")), peerCode(peer("1:Error: x")), peerCode(new ControlError("control-peer-timeout"))])
      .toEqual(["omp-model-catalog-unavailable", "control-peer-exit", "control-peer-timeout"]);
    expect([peerErrorCode(peer("1:file:///x")), peerErrorCode(peer("2:agent-version-drift: table says 2.1.0"))]).toEqual([null, "agent-version-drift"]);
  });

  it("writes the stored, HTTP and log forms", () => {
    expect([peerExitText(peerFailure(peer("2:agent-config-invalid: bad"))!), peerExitText(peerFailure(peer("2:agent-version-drift"))!),
      peerExitText(peerFailure(peer("1:Error: x"))!), peerExitText(peerFailure(peer("1"))!), peerExitText(peerFailure(peer())!)])
      .toEqual(["2:agent-config-invalid: bad", "2:agent-version-drift", "1:Error: x", "1", ""]);
    expect([ccloopFailedMessage(peerFailure(peer("2:omp-model-catalog-unavailable: spawn ENOENT"))!), ccloopFailedMessage(peerFailure(peer())!),
      ccloopFailedMessage(peerFailure(peer("1:Error: x"))!)])
      .toEqual(["ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", "ccloop-failed:unknown", "ccloop-failed:unknown: Error: x"]);
    expect([peerFailureLogLine("run-1", peer("2:agent-config-invalid: bad")), peerFailureLogLine("run-1", peer("1:Error: x")),
      peerFailureLogLine("run-1", new ControlError("control-peer-timeout"))])
      .toEqual(["orca-driver: run-1: ccloop agent-config-invalid: bad\n", "orca-driver: run-1: ccloop unknown: Error: x\n", null]);
  });
});
