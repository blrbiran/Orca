import { AccountsRejection } from "./store.js";

/**
 * Reads one line from the terminal with echo off: the prompt goes to stderr, bytes are collected in raw mode until Enter,
 * backspace edits, Ctrl-C refuses (`user-aborted`). Raw mode is restored in `finally`. The caller has already checked
 * that stdin is a TTY; nothing here is ever reached with piped input.
 */
export function readSecretFromTty(prompt: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    const finish = (settle: () => void): void => {
      stdin.off("data", onData);
      try { stdin.setRawMode(false); } finally { stdin.pause(); }
      process.stderr.write("\n");
      settle();
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish(() => resolvePromise(buffer));
        if (char === "\x03") return finish(() => reject(new AccountsRejection("user-aborted", 400, "cancelled")));
        if (char === "\x7f" || char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
    };
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
