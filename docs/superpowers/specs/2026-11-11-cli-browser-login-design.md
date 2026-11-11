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
