import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkAppendOnly } from "./ledger/appendOnly.js";
import { validateFile } from "./ledger/validateFile.js";

const USAGE = `usage:
  orca validate <path...>        validate ledger file(s) or directory (directory scans top-level *.jsonl only)
  orca check-append-only         read a git diff from stdin, reject if it contains any deleted line
`;

async function collectLedgerFiles(paths: string[]): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    let info;
    try {
      info = await stat(path);
    } catch {
      errors.push(`cannot stat: ${path}`);
      continue;
    }
    if (info.isDirectory()) {
      // Top-level only: spec §3.0 says .decisions/ has no subdirectories, and
      // §3.7.1's archive/ should not be scanned by default.
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(path, entry.name));
        }
      }
    } else {
      files.push(path);
    }
  }

  return { files, errors };
}

async function runValidate(paths: string[]): Promise<number> {
  if (paths.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const { files, errors } = await collectLedgerFiles(paths);
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }

  let sawRejected = errors.length > 0;
  let sawDowngraded = false;

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const verdict = validateFile(text.split("\n"));

    for (const line of verdict.lines) {
      if (line.result.verdict === "rejected") {
        process.stderr.write(`${file}:${line.lineNumber}: rejected: ${line.result.reasons.join("; ")}\n`);
      } else if (line.result.verdict === "downgraded") {
        process.stderr.write(
          `${file}:${line.lineNumber}: downgraded to tier 0: ${line.result.reasons.join("; ")}\n`,
        );
      }
    }

    if (verdict.verdict === "rejected") sawRejected = true;
    if (verdict.verdict === "downgraded") sawDowngraded = true;
  }

  if (sawRejected) return 1;
  if (sawDowngraded) return 2;

  process.stdout.write(`ok: ${files.length} ledger file(s)\n`);
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[], stdinText?: string): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "validate") {
    return runValidate(rest);
  }

  if (command === "check-append-only") {
    const diffText = stdinText ?? (await readStdin());
    const result = checkAppendOnly(diffText);
    if (result.ok) {
      process.stdout.write("ok: append-only\n");
      return 0;
    }
    for (const reason of result.reasons) {
      process.stderr.write(`${reason}\n`);
    }
    return 1;
  }

  process.stderr.write(USAGE);
  return 1;
}

// Only runs when invoked directly as `tsx src/cli.ts`. Not executed on import.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
