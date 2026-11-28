import { createHash } from "node:crypto";
import { git } from "../scheduler/gitExec.js";
import { QUIET_GIT } from "./workspace.js";
import { checkPaths, definesChecks, isTestConfigurationPath, isTestFilePath } from "./criteriaProtection.js";

export interface ExistingTestChanges {
  paths: string[];
  weakeningSignals: string[];
  digest: string;
}

export interface AcceptanceCheckInputs { checks: readonly string[]; setupCommands: readonly string[] }

const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\bassert\s+\S/g;
const SKIP = /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.skip|\bt\.skip\s*\(|\b(?:skip|only|todo)\s*:\s*(?:true|["'`][^"'`]*["'`])/g;
const TEST_DECLARATION = /\b(?:it|test)\s*(?:\.(?:only|skip|todo)\s*)?\(|\bx(?:it|test)\s*\(/g;
const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

async function show(repo: string, rev: string, path: string): Promise<string> {
  return git(repo, [...QUIET_GIT, "show", `${rev}:${path}`]);
}

function packageScripts(text: string): Record<string, string> | null {
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown } | null)?.scripts;
    return typeof scripts === "object" && scripts !== null
      ? Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
  } catch { return null; }
}

const packagePath = (path: string): boolean => path === "package.json" || path.endsWith("/package.json");
const workflowPath = (path: string): boolean => path.startsWith(".github/workflows/");

/** Compare test files and the existing files that determine which checks run at this frozen base and checked tip. */
export async function existingTestChanges(
  repo: string, base: string, tip: string, inputs: AcceptanceCheckInputs = { checks: [], setupCommands: [] },
): Promise<ExistingTestChanges> {
  const fromChecks = checkPaths(inputs.checks, inputs.setupCommands);
  const changed = (await git(repo, [...QUIET_GIT, "diff", "--no-renames", "--name-status", "-z", base, tip])).split("\0").filter((part) => part !== "");
  const paths = new Set<string>();
  const weakeningSignals = new Set<string>();
  for (let index = 0; index + 1 < changed.length; index += 2) {
    const status = changed[index]!;
    const path = changed[index + 1]!;
    if (!definesChecks(path, fromChecks)) continue;

    if (packagePath(path)) {
      if (status === "A") continue;
      const before = packageScripts(await show(repo, base, path));
      const after = status === "D" ? {} : packageScripts(await show(repo, tip, path));
      if (before === null || after === null) {
        paths.add(path);
        weakeningSignals.add(`package-scripts-unreadable:${path}`);
        continue;
      }
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((name) => before[name] !== after[name]);
      const changedExisting = names.filter((name) => before[name] !== undefined);
      if (changedExisting.length === 0) continue;
      paths.add(path);
      for (const name of changedExisting) {
        if (after[name] === undefined) weakeningSignals.add(`script-removed:${path}#${name}`);
        else weakeningSignals.add(`script-changed:${path}#${name}`);
      }
      continue;
    }

    if (isTestFilePath(path)) {
      if (status === "A") {
        const after = await show(repo, tip, path);
        if (count(after, SKIP) > 0) {
          paths.add(path);
          weakeningSignals.add(`skip-added:${path}`);
        }
        continue;
      }
      paths.add(path);
      if (status === "D") {
        weakeningSignals.add(`deleted:${path}`);
        continue;
      }
      const before = await show(repo, base, path);
      const after = await show(repo, tip, path);
      const beforeAssertions = count(before, ASSERTION), afterAssertions = count(after, ASSERTION);
      if (afterAssertions < beforeAssertions) weakeningSignals.add(`fewer-assertions:${path}:${beforeAssertions}->${afterAssertions}`);
      if (count(after, SKIP) > count(before, SKIP)) weakeningSignals.add(`skip-added:${path}`);
      const beforeDeclarations = count(before, TEST_DECLARATION), afterDeclarations = count(after, TEST_DECLARATION);
      if (afterDeclarations < beforeDeclarations) weakeningSignals.add(`test-declaration-removed:${path}:${beforeDeclarations}->${afterDeclarations}`);
      continue;
    }

    if (isTestConfigurationPath(path)) {
      paths.add(path);
      weakeningSignals.add(status === "A" ? `test-config-added:${path}` : `test-config-changed:${path}`);
      continue;
    }
    if (workflowPath(path)) {
      if (status === "A") continue;
      paths.add(path);
      weakeningSignals.add(`workflow-changed:${path}`);
      continue;
    }
    if (fromChecks.has(path) && status !== "A") {
      paths.add(path);
      weakeningSignals.add(status === "D" ? `check-script-deleted:${path}` : `check-script-changed:${path}`);
    }
  }
  const sortedPaths = [...paths].sort();
  return { paths: sortedPaths, weakeningSignals: [...weakeningSignals].sort(), digest: sha256(JSON.stringify(sortedPaths)) };
}
