import { createHash } from "node:crypto";
import { git } from "../scheduler/gitExec.js";
import { QUIET_GIT } from "./workspace.js";
import { isTestFilePath } from "./criteriaProtection.js";

export interface ExistingTestChanges {
  paths: string[];
  weakeningSignals: string[];
  digest: string;
}

const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\bassert\s+\S/g;
const SKIP = /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.skip|\bt\.skip\s*\(|\b(?:skip|only|todo)\s*:\s*(?:true|["'`][^"'`]*["'`])/g;
const TEST_DECLARATION = /\b(?:it|test)\s*(?:\.(?:only|skip|todo)\s*)?\(|\bx(?:it|test)\s*\(/g;
const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

async function show(repo: string, rev: string, path: string): Promise<string> {
  return git(repo, [...QUIET_GIT, "show", `${rev}:${path}`]);
}

/** Compare only test files in the checked tree against its frozen base; no task target-path or review metadata is consulted. */
export async function existingTestChanges(repo: string, base: string, tip: string): Promise<ExistingTestChanges> {
  const changed = (await git(repo, [...QUIET_GIT, "diff", "--no-renames", "--name-status", "-z", base, tip])).split("\0").filter((part) => part !== "");
  const paths = new Set<string>();
  const weakeningSignals = new Set<string>();
  for (let index = 0; index + 1 < changed.length; index += 2) {
    const status = changed[index]!;
    const path = changed[index + 1]!;
    if (!isTestFilePath(path)) continue;
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
  }
  const sortedPaths = [...paths].sort();
  return { paths: sortedPaths, weakeningSignals: [...weakeningSignals].sort(), digest: sha256(JSON.stringify(sortedPaths)) };
}
