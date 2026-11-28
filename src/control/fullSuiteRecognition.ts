export interface FullSuiteCommand {
  /** Stable family used only to compare a requirement's named runner with an adopted check. */
  runner: "npm-test" | "pnpm-test" | "yarn-test" | "node-test" | "vitest" | "pytest" | "go-test" | "cargo-test" | "make-test";
  /** Normalized direct invocation; never a shell-expanded command. */
  command: string;
}

const normalize = (command: string): string => command.trim().replace(/[\t ]+/g, " ");

function directInvocation(command: string): FullSuiteCommand | null {
  const value = normalize(command);
  if (/[\r\n;'"`$<>|]/.test(value) || value.includes("&&") || value.includes("||")) return null;

  const npm = /^(npm|pnpm|yarn) (?:run )?test(?::(?:full|unit))?(?: --silent)?(?: -- --reporter=(?:dot|spec|tap|verbose))?$/.exec(value);
  if (npm !== null) {
    const runner = npm[1] === "npm" ? "npm-test" : npm[1] === "pnpm" ? "pnpm-test" : "yarn-test";
    return { runner, command: value };
  }
  if (/^npx vitest run(?: --reporter=(?:dot|default|verbose))?$/.test(value)) return { runner: "vitest", command: value };
  if (/^node --test(?: --test-reporter=(?:tap|spec|dot))?$/.test(value)) return { runner: "node-test", command: value };
  if (/^pytest(?: -q| --quiet)?$/.test(value)) return { runner: "pytest", command: value };
  if (/^go test \.\/\.\.\.(?: -v|-json|-count=1)*$/.test(value)) return { runner: "go-test", command: value };
  if (/^cargo test(?: --quiet)?$/.test(value)) return { runner: "cargo-test", command: value };
  if (value === "make test") return { runner: "make-test", command: value };
  return null;
}

/**
 * Recognizes only direct, known full-run commands. The sole shell-list suffix retained from #536 is `&& true`, which
 * preserves the suite's failure exit. Test filters, file arguments, pipelines, and arbitrary wrappers are rejected.
 */
export function recognizeFullSuiteCommand(command: string): FullSuiteCommand | null {
  const value = normalize(command);
  const suffix = /^(.*?) && true$/.exec(value);
  return directInvocation(suffix === null ? value : suffix[1]!);
}

/** Runtime retry support is narrower than finalVerification: only two identical, direct suite invocations qualify. */
export function sameSuiteRetryBranches(command: string): [string, string] | null {
  const value = normalize(command);
  const separator = " || ";
  const index = value.indexOf(separator);
  if (index < 0 || value.indexOf(separator, index + separator.length) >= 0) return null;
  const first = normalize(value.slice(0, index));
  const second = normalize(value.slice(index + separator.length));
  if (first !== second || directInvocation(first) === null) return null;
  return [first, second];
}

const SUITE_MENTION = /\b(?:npm (?:run )?test(?::(?:full|unit))?|pnpm (?:run )?test(?::(?:full|unit))?|yarn (?:run )?test(?::(?:full|unit))?|node --test|npx vitest run|pytest|go test \.\/\.\.\.|cargo test|make test)\b/i;

/** Does the requirement mention a known suite family, and which family did it name? */
export function namedFullSuiteCommand(document: string): FullSuiteCommand | null {
  const match = SUITE_MENTION.exec(document);
  return match === null ? null : directInvocation(match[0]);
}

/** The check covers a named suite only when it uses the same runner family; generic suite prose accepts any recognized family. */
export function coversFullSuite(document: string, checks: readonly string[]): boolean {
  const named = namedFullSuiteCommand(document);
  return checks.some((check) => {
    const recognized = recognizeFullSuiteCommand(check);
    return recognized !== null && (named === null || recognized.runner === named.runner);
  });
}
