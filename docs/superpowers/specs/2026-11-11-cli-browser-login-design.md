# CLI login through the browser (#208) — proposal

Status: **proposal, awaiting the human's rulings (§5).** Written 2026-11-11 (tester follow-up C). Nothing implemented.

## 1. The problem

A person-only command over the CLI (`settle-usage`, `set-limit`, spend caps…) needs a person token. Today the only way
to get one is `orca login --name <user>`, which asks for the panel password at the terminal; on the real panel
`--password-stdin` is refused (CLI v2 spec §15.3, F6 ruling: only isolated test panels). The Web login page points a new
owner at `<control root>/initial-password`. The tester: "this is not how a modern AI CLI logs in" — `gh auth login`,
`claude`, `codex login` open a browser where you are already signed in and hand the CLI a token.

The case that matters most is an agent session: the human is at the Web panel, an agent in a terminal needs one
person-only action. Typing a password into a terminal an agent can read is the wrong shape.

## 2. What exists

- `src/commands/person.ts`: `orca login` asks the panel over its control socket for a token of the account whose
  password is typed, stores `{token,sid,user,expiresAt}` in `$ORCA_PERSON_DIR/token.json` (0600; default
  `~/.orca/person`); `--as-person` sends it as `x-orca-person-token`; never under the dispatched-run marker.
- The Web panel has its own session (cookie) for the same accounts; owner/member permissions live in
  `src/panel/permissions.ts`.
- The panel is local: the CLI reaches it through a Unix socket, the browser through `http://127.0.0.1:<port>`.

## 3. Proposal: `orca auth login`, a one-time code approved in the browser

1. `orca auth login` asks the panel over the socket for a **login request**: a random request id, a short code
   (8 characters, shown to the person), an expiry (5 minutes). The panel keeps it in memory only.
2. The CLI prints the code and the URL `http://127.0.0.1:<port>/cli-login?code=<code>`, and opens it with the system
   browser unless `--no-browser` (or no display / under the dispatched-run marker, where it only prints).
3. In the browser the signed-in person sees: which machine user and terminal asked (the socket peer's uid and the
   process's command line the panel can read), the code, and **Approve / Deny**. Not signed in ⇒ the normal login page,
   then back. Only a principal that may do human-only actions can approve (as today's token).
4. The CLI waits on the socket (long poll, at most the expiry). Approve ⇒ the panel issues the same person token
   `orca login` issues today, bound to the approving account; the CLI stores it exactly as today. Deny or expiry ⇒ exit
   with a named code (`cli-login-denied`, `cli-login-expired`).
5. `orca auth logout` = today's `orca logout`; `orca auth status` prints the user and expiry (never the token).
   `orca login` stays as the compatibility entry; help and the skill point to `orca auth login`.

Why not OAuth/PKCE: the panel is the only party, on the same machine, reachable over a socket already authenticated by
filesystem permissions; a device-code flow over that socket gives the same guarantee (the token never crosses the
browser) with no redirect handler and no client secret.

**Under the dispatched-run marker** (a run Orca itself started) the command is refused, as `--as-person` is today.

**The Web first-owner page**: keep the initial-password file (it is the only bootstrap when no browser session exists),
but word it as a one-time setup step, not the normal way in.

## 4. Criteria to write when implementing

Approve issues a token only after an owner's approval; deny/expiry issue none; a code is single-use; a member's
approval is refused; the token never appears in stdout, logs or the browser page; the marker refuses; `--no-browser`
never spawns a browser; the stored file keeps today's modes (Rule 17).

## 5. Questions for the human

- **Q1.** Device-code over the local socket (recommended), or a paste-a-token page only?
- **Q2.** Should `orca auth login` replace `orca login` in help and the skill now, keeping the old verb working?
- **Q3.** Token lifetime: keep today's expiry, or offer `--days`?

## 6. Review round 1 and the answers taken (2026-11-11, Orca session `f958ec3f`)

The human was away and asked the session to proceed on its own recommendations and report them for review afterwards
("这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核"). An independent reviewer read this proposal
against the code at the commit that added it. Its findings were adopted as below; §1–§5 above are kept as written, and
**this section wins where they disagree**.

**Answers.** Q1: device code over the local socket. Q2: yes — help, generated CLI docs and the skill point to
`orca auth login`; `orca login` keeps working unchanged (members and isolated test panels still need it). Q3: keep
today's lifetime (the Web session length); no `--days`.

**Corrections to §3.**
1. *URL.* The panel serves files by exact name and routes the Web app on the URL hash, and the CLI only discovers the
   socket. So the panel builds the URL and returns it in the socket answer: `<panel url>/#cli-login/<CODE>` (a hash, so
   the code never reaches a request line or a Referer); a wildcard bind is shown as `127.0.0.1`. The CLI checks the
   answer is a loopback `http` URL of that exact shape before opening it.
2. *Who is asking.* Node cannot read a Unix socket peer's credentials, so the page cannot show "the socket peer's uid
   and command line". It shows: a process of the panel's own OS user (true by construction — the socket is 0600); the
   client, pid, ppid, cwd and start time **as reported by the requester, not verified**; the code; when it was asked and
   when it expires; the account it will log in as and the token lifetime; and the sentence "Approve only if you just ran
   `orca auth login` in a terminal you are watching and it shows this code." The flow cannot tell processes of the same
   OS user apart (the same boundary as cli-v2's Correction of 2026-10-22).
3. *No long poll.* A held response would delay panel shutdown past launchd's exit timeout, and the CLI's socket client
   gives up after 120 s idle. Each poll answers at once (`pending`, the token, or a refusal); the CLI polls at the
   interval the panel returns until the expiry.
4. *Two ids.* The 8-character code (alphabet without 0/O/1/I/L, shown `XXXX-XXXX`, from `crypto.randomInt`) is only
   for the human to compare. The CLI collects with a separate request id (32 random bytes, base64url) that is never
   printed and never in a URL. Approve, deny and cancel consume the code; a collect consumes the request id.
5. *Mint on collect.* Approval records the approver; the token is minted only when the CLI collects it, after re-reading
   the approver (still enabled, still an owner). An approved request nobody collects leaves no session.
6. *Owner only.* Unlike `orca login` (which issues to any account), only an owner may approve; a member's approval is
   refused (`owner-required`). A remote member must not be able to grant a token to a process on the panel's machine.
7. *Marker.* Under the dispatched-run marker the CLI refuses (no socket request, no browser), and the socket route
   refuses a start that carries the marker header (`control-dispatched-run-refused`). This is defence in depth; a
   process that unsets the variables is not stopped.
8. *MCP.* `auth login` is refused over MCP (`cli-login-not-over-mcp`); `auth status` and `auth logout` are allowed.
9. *Restart and limits.* State is in memory: after a panel restart a poll answers `cli-login-unknown` and the CLI says
   to run `orca auth login` again. At most 16 pending requests (`cli-login-busy`); expired entries are dropped on each
   access; the panel's auth clock is used so criteria can move time.
10. *Cancel.* On SIGINT/SIGTERM the CLI sends a best-effort cancel, so the page shows "cancelled".
11. *Browser.* Opened with `execFile` (`open` / `xdg-open`), no shell, detached; not opened with `--no-browser`, over
    SSH on macOS, or without `DISPLAY`/`WAYLAND_DISPLAY` on Linux; a failure to spawn only prints. The CLI's io gains an
    `openUrl` seam so criteria never open a real browser.
12. *Names.* `cli-login-denied` 403, `cli-login-expired` 409, `cli-login-unknown` 404, `cli-login-busy` 429.
    `orca auth status` prints the stored token's user and expiry only (labelled as the stored token).

**Criteria** are the reviewer's list, each seen red under a named mutation: start answer shape (no token key); pending
before approval with no session row; owner approval then collect issues a working token (mutation: mint on approve ⇒ an
uncollected approval leaves a session); single use of code and request id; deny; expiry by moved clock; member refused;
CSRF / login / forced password change / foreign Host refused by the existing middleware; approver disabled before
collect; marker refused on both sides; MCP refused; `openUrl` called 0 times with `--no-browser` or over SSH and once
otherwise; a non-loopback URL refused; token and request id never in CLI output or Web response bodies; token store
modes under a temporary `ORCA_PERSON_DIR` only (Rule 17); 17th pending start refused; panel close not delayed; restart
⇒ `cli-login-unknown`; `auth status` never prints the token; `auth logout` revokes; `orca login` unchanged; the Web
approval page renders the fields above and calls approve/deny.
