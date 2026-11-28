import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ControlStore } from "./store.js";

export interface AcceptanceFailureIdentity {
  key: string;
  file: string;
  testPath: string[];
  diagnosticHash: string;
}

export type FailureIdentityParseStatus = "complete" | "unsupported" | "ambiguous";
export interface FailureIdentityParse {
  identities: AcceptanceFailureIdentity[];
  parseStatus: FailureIdentityParseStatus;
  reportedFailures: number | null;
  blockCount: number;
}
export interface AcceptanceFailureAttempt {
  exit: string;
  failureIdentityStatus?: FailureIdentityParseStatus;
  failureIdentities?: AcceptanceFailureIdentity[];
  reportedFailures?: number | null;
  blockCount?: number;
  tests?: number | null;
  tail?: string;
}

interface SubtestFrame { indent: number; name: string }
interface FailureFrame {
  indent: number;
  name: string;
  file: string;
  testPath: string[];
  diagnostic: string[];
  fileFailure: boolean;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;
const SUBTEST = /^\s*# Subtest: (.+?)\s*$/;
const NOT_OK = /^\s*not ok\s+\d+(?:\s+-\s*(.*?))?\s*$/;
const DIAGNOSTIC_FIELD = /^\s{2,}(error|failureType|code|actual|expected|operator|message|cause|location|type):\s*(.*)$/;
const BLOCK_SCALAR = /^[|>][-+]?$/;
const FAILURE_SUFFIX = /\.(?:test|spec)\.[^/]+$/i;
const TEST_DIRECTORY = /(^|\/)(?:test|tests|__tests__|spec)\//;

function fileName(value: string): boolean {
  return TEST_DIRECTORY.test(value) || FAILURE_SUFFIX.test(value);
}

function realpathAllowMissing(value: string): string | null {
  let current = resolve(value);
  const suffix: string[] = [];
  while (true) {
    try { return join(realpathSync(current), ...suffix); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

function repoPath(value: string, cwd: string): string | null {
  const slash = value.trim().replaceAll("\\", "/");
  if (slash === "" || slash.startsWith("file://")) return null;
  const canonicalCwd = realpathAllowMissing(cwd);
  if (canonicalCwd === null) return null;
  const candidate = isAbsolute(value) ? value : join(canonicalCwd, slash.replace(/^\.\//, ""));
  const canonicalCandidate = realpathAllowMissing(candidate);
  if (canonicalCandidate === null) return null;
  const normalized = relative(canonicalCwd, canonicalCandidate).split(sep).join("/").replaceAll("\\", "/");
  if (normalized === "" || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}

function normalizedDiagnostic(lines: readonly string[], cwd: string): string | null {
  const selected: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = DIAGNOSTIC_FIELD.exec(line);
    if (match === null) continue;
    const field = match[1]!;
    if (field === "location" || field === "type") continue;
    let value = match[2]!.trim();
    if (BLOCK_SCALAR.test(value)) {
      const indent = /^\s*/.exec(line)![0].length;
      const body: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        if (next.trim() === "" || /^\s*/.exec(next)![0].length <= indent) break;
        body.push(next.trim());
        index += 1;
      }
      value = body.join("\n").trim();
    }
    if (value === "" || value === "subtestsFailed") continue;
    value = value.replaceAll(resolve(cwd), "<cwd>");
    const canonicalCwd = realpathAllowMissing(cwd);
    if (canonicalCwd !== null) value = value.replaceAll(canonicalCwd, "<cwd>");
    value = value.replaceAll("\\", "/");
    value = value.replace(/:\d+(?::\d+)?(?=['"\s]|$)/g, ":<position>");
    value = value.replace(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration>");
    selected.push(`${match[1]}:${value}`);
  }
  if (selected.length === 0) return null;
  return selected.sort().join("\n");
}

/** A node:test TAP `location:` names the file a top-level test failure belongs to. */
function locationFile(lines: readonly string[], cwd: string): string | null {
  for (const line of lines) {
    const match = /^\s{2,}location:\s*'(.+?):\d+:\d+'\s*$/.exec(line);
    if (match === null) continue;
    const file = repoPath(match[1]!, cwd);
    if (file !== null) return file;
  }
  return null;
}

/** Parse only the node:test TAP structure used for failure identity comparison. */
function failureIdentitiesInBlock(output: string, cwd: string): FailureIdentityParse {
  const text = output.replace(ANSI, "");
  if (!/^TAP version \d+\s*$/m.test(text)) return { identities: [], parseStatus: "unsupported", reportedFailures: null, blockCount: 1 };

  const frames: SubtestFrame[] = [];
  const childFiles = new Set<string>();
  const identities: AcceptanceFailureIdentity[] = [];
  const seenTestPaths = new Set<string>();
  let failure: FailureFrame | null = null;
  let malformed = false;
  let reportedFailures: number | null = null;
  const lines = text.split(/\r?\n/);

  const addFailure = (current: FailureFrame): void => {
    if (current.diagnostic.some((line) => /^\s{2,}type:\s*'suite'\s*$/.test(line))
      && current.diagnostic.some((line) => /^\s{2,}failureType:\s*'subtestsFailed'\s*$/.test(line))) return;
    const diagnostic = normalizedDiagnostic(current.diagnostic, cwd);
    if (diagnostic === null) { malformed = true; return; }
    const diagnosticHash = sha256(diagnostic);
    const testPath = current.testPath;
    const pathKey = `${current.file}\0${testPath.join("\0")}`;
    if (seenTestPaths.has(pathKey)) { malformed = true; return; }
    seenTestPaths.add(pathKey);
    const key = sha256(`${current.file}\0${testPath.join("\0")}\0${diagnosticHash}`);
    identities.push({ key, file: current.file, testPath, diagnosticHash });
    if (testPath.length > 0) childFiles.add(current.file);
  };

  const finishFailure = (): void => {
    if (failure === null) return;
    resolveFailure(failure);
    failure = null;
  };

  const resolveFailure = (current: FailureFrame): void => {
    const fileFrame = [...frames].reverse().find((frame) => fileName(frame.name));
    const candidateFile = fileName(current.name) ? current.name : fileFrame?.name ?? locationFile(current.diagnostic, cwd);
    if (candidateFile === undefined || candidateFile === null) { malformed = true; return; }
    const file = repoPath(candidateFile, cwd);
    if (file === null) { malformed = true; return; }
    const fileFailure = fileName(current.name);
    const testPath = fileFailure ? [] : [...frames.filter((frame) => frame.name !== candidateFile).map((frame) => frame.name), current.name];
    if (testPath.some((part) => part === "")) { malformed = true; return; }
    current.file = file;
    current.fileFailure = fileFailure;
    current.testPath = testPath;
    if (fileFailure && childFiles.has(file)) return;
    addFailure(current);
  };

  for (const line of lines) {
    const summary = /^# fail (\d+)\s*$/.exec(line);
    if (summary !== null) reportedFailures = Number(summary[1]);
    if (failure !== null) {
      if (/^\s*\.\.\.\s*$/.test(line)) { finishFailure(); continue; }
      failure.diagnostic.push(line);
      continue;
    }

    const subtest = SUBTEST.exec(line);
    if (subtest !== null) {
      const indent = /^\s*/.exec(line)![0].length;
      while (frames.at(-1) !== undefined && frames.at(-1)!.indent >= indent) frames.pop();
      frames.push({ indent, name: subtest[1]!.trim() });
      continue;
    }

    const notOk = NOT_OK.exec(line);
    if (notOk === null) continue;
    const indent = /^\s*/.exec(line)![0].length;
    while (frames.at(-1) !== undefined && frames.at(-1)!.indent >= indent) frames.pop();
    const name = (notOk[1] ?? "").trim();
    failure = { indent, file: "", testPath: [], diagnostic: [], fileFailure: false, name };
  }
  finishFailure();
  if (reportedFailures === null || reportedFailures !== identities.length) malformed = true;
  identities.sort((a, b) => a.file.localeCompare(b.file) || a.testPath.join("\0").localeCompare(b.testPath.join("\0")) || a.key.localeCompare(b.key));
  return { identities, parseStatus: malformed ? "ambiguous" : "complete", reportedFailures, blockCount: 1 };
}

export function failureIdentitiesOf(output: string, reporter: "node-test-tap-v1", cwd: string): FailureIdentityParse {
  void reporter;
  const text = output.replace(ANSI, "");
  const starts = [...text.matchAll(/^TAP version \d+\s*$/gm)];
  if (starts.length === 0) return { identities: [], parseStatus: "unsupported", reportedFailures: null, blockCount: 0 };
  const blocks = starts.map((match, index) => {
    const begin = match.index ?? 0;
    const end = starts[index + 1]?.index ?? text.length;
    return failureIdentitiesInBlock(text.slice(begin, end), cwd);
  });
  const identities = new Map<string, AcceptanceFailureIdentity>();
  for (const block of blocks) for (const identity of block.identities) identities.set(identity.key, identity);
  const reportedFailures = blocks.every((block) => block.reportedFailures !== null)
    ? blocks.reduce((total, block) => total + block.reportedFailures!, 0)
    : null;
  const ordered = [...identities.values()].sort((a, b) => a.file.localeCompare(b.file)
    || a.testPath.join("\0").localeCompare(b.testPath.join("\0")) || a.key.localeCompare(b.key));
  return {
    identities: ordered,
    parseStatus: blocks.some((block) => block.parseStatus !== "complete") ? "ambiguous" : "complete",
    reportedFailures,
    blockCount: blocks.length,
  };
}

export function acceptanceSetupDigest(setup: readonly string[]): string {
  return sha256(JSON.stringify([...setup]));
}

export interface AcceptanceFailureBaselineKey {
  repoId: string;
  base: string;
  command: string;
  setupDigest: string;
  reporter: "node-test-tap-v1";
}

export interface RecordAcceptanceFailureIdentitiesInput extends AcceptanceFailureBaselineKey {
  identities: readonly AcceptanceFailureIdentity[];
  source: "task-base-check" | "group-acceptance";
  groupId: string;
  runId: string;
  at: number;
  /** The base run's own `# tests N` and exit, kept so a cached baseline still feeds #387's shortfall rule. */
  tests?: number | null;
  exit?: string;
}

/** Add complete red observations without allowing a later green run to erase known base failures. */
export function recordAcceptanceFailureIdentities(store: ControlStore, input: RecordAcceptanceFailureIdentitiesInput): void {
  const insert = store.db.prepare(`INSERT INTO acceptance_failure_baselines
    (repo_id,base,command,setup_digest,reporter,identity,file,test_path_json,diagnostic_hash,source,group_id,run_id,first_seen_at,last_seen_at,tests,exit)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(repo_id,base,command,setup_digest,reporter,identity) DO UPDATE SET last_seen_at=excluded.last_seen_at`);
  for (const identity of input.identities) {
    insert.run(input.repoId, input.base, input.command, input.setupDigest, input.reporter, identity.key, identity.file,
      JSON.stringify(identity.testPath), identity.diagnosticHash, input.source, input.groupId, input.runId, input.at, input.at,
      input.tests ?? null, input.exit ?? null);
  }
}

/** The base run's own shape behind a stored key, for rules that compare test counts (tester #387). */
export function readAcceptanceBaselineShape(store: ControlStore, key: AcceptanceFailureBaselineKey): { tests: number | null; exit: string | null } | null {
  const row = store.db.prepare(`SELECT MAX(tests) AS tests, MAX(exit) AS exit FROM acceptance_failure_baselines
    WHERE repo_id=? AND base=? AND command=? AND setup_digest=? AND reporter=?`)
    .get(key.repoId, key.base, key.command, key.setupDigest, key.reporter) as { tests: number | null; exit: string | null } | undefined;
  return row === undefined ? null : { tests: row.tests === null ? null : Number(row.tests), exit: row.exit === null ? null : String(row.exit) };
}

/** Read only identities recorded for every component of the exact execution key. */
export function readAcceptanceFailureIdentities(store: ControlStore, key: AcceptanceFailureBaselineKey): AcceptanceFailureIdentity[] {
  return store.db.prepare(`SELECT identity,file,test_path_json,diagnostic_hash FROM acceptance_failure_baselines
    WHERE repo_id=? AND base=? AND command=? AND setup_digest=? AND reporter=? ORDER BY identity`)
    .all(key.repoId, key.base, key.command, key.setupDigest, key.reporter).map((row) => ({
      key: String(row.identity), file: String(row.file), testPath: JSON.parse(String(row.test_path_json)) as string[], diagnosticHash: String(row.diagnostic_hash),
    }));
}
