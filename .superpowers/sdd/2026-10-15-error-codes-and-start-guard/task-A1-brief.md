### Task A1: One parser for a peer failure (spec A §4.1; criterion 2)

**Files:**
- Modify: `src/control/ccloopPort.ts:51-59` (the `peerErrorCode` block; the rest of the file is untouched)
- Test (create): `tests/control/peerFailure.test.ts`

**Interfaces:**
- Consumes: `ControlError` (`src/control/errors.ts:354-359`).
- Produces (all exported from `src/control/ccloopPort.ts`):
  - `export const PEER_DETAIL_MAX = 512;`
  - `export interface PeerFailure { readonly exit: string; readonly code: string | null; readonly detail: string }`
  - `export function peerFailure(error: unknown): PeerFailure | null`
  - `export function peerErrorCode(error: unknown): string | null` (same signature as today)
  - `export function peerCode(error: ControlError): string`
  - `export function peerExitText(failure: PeerFailure): string`
  - `export function ccloopFailedMessage(failure: PeerFailure): string`
  - `export function peerFailureLogLine(runId: string, error: unknown): string | null`

- [ ] **Step 1: Write the failing test** — create `tests/control/peerFailure.test.ts`:

```ts
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
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerFailure.test.ts > /private/tmp/oec/logs/a1-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-red.log
```
Read it whole. Expected: every test red with `peerFailure is not a function` / `peerCode is not a function` (not exported yet), `rc=1`. The `peerErrorCode` half of the third test would pass today; it is the regression pin for the redefinition.

- [ ] **Step 3: Implement** — replace `src/control/ccloopPort.ts:51-59` (the doc comment from `/**` through the closing `}` of `peerErrorCode`) with:

```ts
/** Spec 2026-10-15 ccloop error codes §4.1: the most of a peer's stderr Orca keeps or shows, in UTF-16 code units. */
export const PEER_DETAIL_MAX = 512;
/**
 * ccloop's leading code: `<exit>:<code>` followed by the end, whitespace, `: ` or a final `:` -- so `1:file:///x` names
 * no code (plan correction K1: a bare `:` after the code is a URL's, not ccloop's `<code>: <detail>`).
 */
const PEER_CODE = /^[^:]*:([a-z][a-z0-9-]{0,63})(?=$|\s|:\s|:$)/;
/** C0 and C1 control characters, written as \u escapes in this source (never as raw bytes). */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u0080-\u009f]/g;
export interface PeerFailure { readonly exit: string; readonly code: string | null; readonly detail: string }

function cutDetail(text: string): string {
  const flat = text.trim().replace(CONTROL_CHARACTERS, " ").trim();
  if (flat.length <= PEER_DETAIL_MAX) return flat;
  let end = PEER_DETAIL_MAX - 1;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${flat.slice(0, end)}…`;
}

/**
 * A `control-peer-exit` (ccloop exited non-zero; its detail is `<exit>:<stderr>`) taken apart: the exit, ccloop's leading
 * code when it printed one, and the rest of its stderr cut for storage and display. Null for any other failure.
 */
export function peerFailure(error: unknown): PeerFailure | null {
  if (!(error instanceof ControlError) || error.code !== "control-peer-exit") return null;
  const raw = error.detail ?? "";
  const colon = raw.indexOf(":");
  const exit = colon === -1 ? raw : raw.slice(0, colon), stderr = colon === -1 ? "" : raw.slice(colon + 1);
  const code = PEER_CODE.exec(raw)?.[1] ?? null;
  return { exit, code, detail: cutDetail(code === null ? stderr : stderr.slice(code.length).replace(/^:/, "")) };
}

/**
 * The ccloop error code inside a `control-peer-exit` (ccloop prints `<code>[: detail]` on stderr and exits non-zero),
 * or null for any other failure. Agent selection spec §7: `agent-selection-rejected:<taskId|slot>:<ccloop code>`
 * names the code, so it is read here, where the peer's output is parsed, and nowhere else.
 */
export function peerErrorCode(error: unknown): string | null {
  return peerFailure(error)?.code ?? null;
}

/** §4.3: the code Orca stores for a failure -- ccloop's own for a peer exit (else `control-peer-exit`), another ControlError's code. */
export function peerCode(error: ControlError): string {
  if (error.code !== "control-peer-exit") return error.code;
  return peerFailure(error)?.code ?? "control-peer-exit";
}

/** §4.4: a peer exit after its reason prefix -- `<exit>[:<code>][: <detail>]`, the detail cut. */
export function peerExitText(failure: PeerFailure): string {
  const body = failure.code === null ? failure.detail : failure.detail === "" ? failure.code : `${failure.code}: ${failure.detail}`;
  return body === "" ? failure.exit : `${failure.exit}:${body}`;
}

/** §4.2: the message of a `ccloop-failed` answer. */
export function ccloopFailedMessage(failure: PeerFailure): string {
  return `ccloop-failed:${failure.code ?? "unknown"}${failure.detail === "" ? "" : `: ${failure.detail}`}`;
}

/** §4.9: the stderr line for a peer failure a path leaves as "unknown"; null for any other failure. */
export function peerFailureLogLine(runId: string, error: unknown): string | null {
  const failure = peerFailure(error);
  if (failure === null) return null;
  return `orca-driver: ${runId}: ccloop ${failure.code ?? "unknown"}${failure.detail === "" ? "" : `: ${failure.detail}`}\n`;
}
```

⚠️ The write tool can turn `\u0000` into a raw NUL byte (handoff §6.6). After writing, prove the bytes: `python3 -I -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\\x00'), b.count(b'\\\\u0000-\\\\u001f'))" src/control/ccloopPort.ts > /private/tmp/oec/logs/a1-bytes.log 2>&1` and read it: expected `0 1`.

- [ ] **Step 4: Run green, with the port's existing criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerFailure.test.ts tests/control/ccloopPort.test.ts tests/control/agentFreeze.test.ts tests/control/taskResultCollector.test.ts > /private/tmp/oec/logs/a1-green.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-green.log
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && npm run typecheck > /private/tmp/oec/logs/a1-tc.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a1-tc.log
```
Read both whole: all pass, 0 skipped (`ccloopPort.test.ts:188-195` "reads ccloop's error code out of a peer exit…" stays green unchanged); typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && /usr/bin/git add src/control/ccloopPort.ts tests/control/peerFailure.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard diff --cached > /private/tmp/oec/logs/a1-diff.log 2>&1
printf 'feat(control): read ccloop'"'"'s code and cut detail out of a peer exit\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\n' > /private/tmp/oec/logs/a1-msg.txt
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard commit -q -F /private/tmp/oec/logs/a1-msg.txt
```
Read `a1-diff.log` before committing (only the two paths).

- [ ] **Step 6 (reviewer, clone `a1`): mutations** — file `src/control/ccloopPort.ts`, test `tests/control/peerFailure.test.ts`, dir `root`:
  - `A1a` drop the code-end anchor: `{"from": "(?=$|\\s|:\\s|:$)", "to": ""}` — red: "names no code for a URL…" (`code: "file"` received) only.
  - `A1b` drop the cut: `{"from": "  if (flat.length <= PEER_DETAIL_MAX) return flat;\n", "to": "  return flat;\n"}` — red: "cuts the detail to 512…".
  - `A1c` keep control characters: `{"from": ".replace(CONTROL_CHARACTERS, \" \")", "to": ""}` — red: "replaces every C0 and C1…".
  - `A1d` split a surrogate: `{"from": "  if (last >= 0xd800 && last <= 0xdbff) end -= 1;\n", "to": ""}` — red: "cuts the detail…" at the emoji line only.

---

