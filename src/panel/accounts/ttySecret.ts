import { AccountsRejection } from "./store.js";

interface TtyIn {
  setRawMode(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Reads one line from the terminal with echo off: the prompt goes to stderr, bytes are collected in raw mode until Enter,
 * backspace edits, Ctrl-C and Ctrl-D refuse (`user-aborted`). Every way out (Enter, Ctrl-C, Ctrl-D, stdin `end`, `close`
 * or `error`) goes through one cleanup that removes the listeners and restores cooked mode. The caller has already
 * checked that stdin is a TTY; nothing here is reached with piped input. `stdin`/`stderr` are seams for the criteria.
 */
export function readSecretFromTty(prompt: string, stdin: TtyIn = process.stdin as unknown as TtyIn, stderr: { write(text: string): unknown } = process.stderr): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let done = false;
    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.off("end", onClose);
      stdin.off("close", onClose);
      stdin.off("error", onClose);
      try { stdin.setRawMode(false); } finally { stdin.pause(); }
      stderr.write("\n");
    };
    const settle = (fn: () => void): void => {
      if (done) return;
      done = true;
      try { cleanup(); } finally { fn(); }
    };
    const abort = (): void => settle(() => reject(new AccountsRejection("user-aborted", 400, "cancelled")));
    const onClose = (): void => abort();
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return settle(() => resolvePromise(buffer));
        if (char === "\x03" || char === "\x04") return abort();
        if (char === "\x7f" || char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
    };
    stderr.write(prompt);
    stdin.on("data", onData);
    stdin.on("end", onClose);
    stdin.on("close", onClose);
    stdin.on("error", onClose);
    try {
      stdin.setRawMode(true);
      stdin.resume();
    } catch (error) {
      settle(() => reject(error));
    }
  });
}
