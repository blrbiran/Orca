// Live transcript spec Correction (session 3cfc2e73, F5): `orca run transcript` asks the panel's transcript routes, never
// a file. Why: the CLI must not grow a second reader with its own redaction or path rules -- it sends the Web's own
// query (tail by default, before/after, include=thinking) and prints the panel's answer; --json is that body verbatim.
// A window option without --call is refused here (exit 1) rather than silently listing.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const LISTING = { schema: "orca-run-transcripts-v1", runId: "run-1", available: true, calls: [
  { attempt: 1, phase: "plan", seq: 1, runtime: "claude", recorded: true, bytes: 120, final: true, truncatedAt: null },
  { attempt: 2, phase: "execute", seq: 1, runtime: null, recorded: false, bytes: 0, final: true, truncatedAt: null },
] };
const WINDOW = { schema: "orca-transcript-window-v1", runId: "run-1", attempt: 1, phase: "plan", seq: 1, runtime: "claude", source: "run", final: true, truncatedAt: null,
  events: [{ at: 0, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: { text: "hello [REDACTED]", length: 16, more: false } } }], start: 0, end: 40, indexedEnd: 40, counted: 40 };

const panel = () => fakePanel({
  "GET runs/run-1/transcripts": { status: 200, body: LISTING },
  "GET runs/run-1/transcripts/1/plan/1?tail=1": { status: 200, body: WINDOW },
  "GET runs/run-1/transcripts/1/plan/1?before=40": { status: 200, body: WINDOW },
  "GET runs/run-1/transcripts/1/plan/1?after=12&include=thinking": { status: 200, body: WINDOW },
  "GET runs/run-2/transcripts": { status: 403, body: { error: { code: "control-dispatched-run-refused", message: "no", retryable: false } } },
});

describe("orca run transcript", () => {
  it("without --call lists the calls: --json is the listing body verbatim, human text names each call by attempt/phase/seq", async () => {
    const p = await panel();
    const json = await cli(["run", "transcript", "run-1", "--json"], p.dir);
    expect(json.code, json.stderr).toBe(0);
    expect(json.json()).toEqual({ schema: "orca-cli-response-v1", status: 200, body: LISTING });
    const human = await cli(["run", "transcript", "run-1"], p.dir);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("1/plan/1  claude  120 B  final");
    expect(human.stdout).toContain("2/execute/1  ?  not recorded");
    expect(p.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET runs/run-1/transcripts", "GET runs/run-1/transcripts"]);
  });

  it("--call asks the Web's window route: tail by default, --before / --after offsets, --thinking adds include=thinking", async () => {
    const p = await panel();
    for (const extra of [[], ["--before", "40"], ["--after", "12", "--thinking"]]) {
      const out = await cli(["run", "transcript", "run-1", "--call", "1/plan/1", ...extra, "--json"], p.dir);
      expect(out.code, out.stderr).toBe(0);
      expect(out.json().body).toEqual(WINDOW);
    }
    expect(p.requests.map((r) => r.path)).toEqual(["runs/run-1/transcripts/1/plan/1?tail=1", "runs/run-1/transcripts/1/plan/1?before=40", "runs/run-1/transcripts/1/plan/1?after=12&include=thinking"]);
    const human = await cli(["run", "transcript", "run-1", "--call", "1/plan/1"], p.dir);
    expect(human.stdout).toContain("claude window [0, 40) final");
    expect(human.stdout).toContain("@0 message role=assistant");
    expect(human.stdout).toContain("text: hello [REDACTED]");
  });

  it("refuses here, before asking the panel: a window option without --call, a malformed --call, both --before and --after", async () => {
    const p = await panel();
    for (const argv of [["--before", "4"], ["--thinking"], ["--call", "plan/1"], ["--call", "1/plan/1/../x"], ["--call", "1/plan/1", "--before", "4", "--after", "2"]]) {
      const out = await cli(["run", "transcript", "run-1", ...argv, "--json"], p.dir);
      expect([out.code, out.json().body.error.code], JSON.stringify(argv)).toEqual([1, "control-cli-argument-invalid"]);
    }
    expect(p.requests).toEqual([]);
  });

  it("the panel's refusal (a dispatched run) is printed as its answer: exit 2", async () => {
    const p = await panel();
    const env = { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json", ORCA_DISPATCHED_RUN: "run-9" };
    const out = await cli(["run", "transcript", "run-2", "--json"], p.dir, { env });
    expect([out.code, out.json().body.error.code]).toEqual([2, "control-dispatched-run-refused"]);
    // The marker rides on the request, so the panel (not the CLI) is the one that refuses.
    expect(p.requests[0]!.headers["x-orca-dispatched-run"]).toBe("run-9");
  });
});
