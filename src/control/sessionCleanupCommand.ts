/**
 * Tester #349 (review): the command a person runs to delete a Codex session ccloop could not delete -- ccloop's own
 * recorded argv (its binary, the `-c` config pair it needed, `delete --force <id>`) with the private CODEX_HOME and the
 * HOME it ran with, every word shell-quoted. An entry from a ccloop that sent no argv gets the plain form.
 */
export interface SessionCleanupCommandInput { threadId: string; home: string; command?: readonly string[]; userHome?: string }

export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./=:@%+,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

export function sessionCleanupCommand(entry: SessionCleanupCommandInput): string {
  const env = [`CODEX_HOME=${shellQuote(entry.home)}`, ...(entry.userHome === undefined ? [] : [`HOME=${shellQuote(entry.userHome)}`])];
  const argv = entry.command !== undefined && entry.command.length > 0 ? entry.command : ["codex", "delete", "--force", entry.threadId];
  return [...env, ...argv.map(shellQuote)].join(" ");
}
