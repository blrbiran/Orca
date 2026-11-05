/**
 * `--password-stdin` for an isolated test panel (human ruling, session 3cfc2e73: 「同意给隔离测试特殊处理。」; CLI v2 spec
 * §15.3, Correction 2). `orca login` and `orca user add|passwd` read a password at a terminal so that an unattended
 * process cannot act as the person on the person's own panel. A test panel an agent started under a scratch directory
 * has no such person: its first password is in that directory already. So the flag is accepted only when every path the
 * command would touch lies outside the operating-system user's real `~/.orca` -- the real home read from the password
 * database (os.userInfo), not $HOME, which an isolated environment relocates. Anything under it is refused by name.
 */
import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const PASSWORD_STDIN_FLAG = "password-stdin";

/** Where the person's own Orca data lives, whatever $HOME says. */
export function realOrcaDir(): string {
  return join(userInfo().homedir, ".orca");
}

/** The path with every existing ancestor resolved through symlinks (macOS /tmp -> /private/tmp; a link into ~/.orca). */
function canonical(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(basename(head));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

export function insideDir(path: string, dir: string): boolean {
  const rel = relative(canonical(dir), canonical(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The first of `paths` (labelled) that lies in the real ~/.orca, or null when the command may read stdin. */
export function realPanelPath(paths: Readonly<Record<string, string>>, real: string): { label: string; path: string } | null {
  for (const [label, path] of Object.entries(paths)) if (insideDir(path, real)) return { label, path };
  return null;
}

/** One line: a single trailing newline is dropped; empty, more than one line, or a NUL is refused (null). */
export function passwordFromStdin(text: string): string | null {
  const line = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
  if (line === "" || /[\r\n\0]/.test(line)) return null;
  return line;
}

export const REAL_PANEL_REFUSAL = "password-stdin-real-panel";
export const STDIN_INVALID_REFUSAL = "password-stdin-invalid";
export const realPanelMessage = (hit: { label: string; path: string }, real: string): string =>
  `--password-stdin is only for an isolated test panel; the ${hit.label} ${hit.path} is under ${real}: type the password at a terminal`;
export const STDIN_INVALID_MESSAGE = "--password-stdin reads exactly one non-empty line from stdin";
