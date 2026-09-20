import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import { readRun } from "./budget.js";
import { readArtifact } from "./archive.js";
import { readCommittedCheckpoint } from "./checkpoints.js";
import { ControlError } from "./errors.js";
import { privateDirectory, syncDirectory } from "./paths.js";
import { snapshotSchema } from "./snapshot.js";

export interface InputCheckpointV1 {
  predecessorRunId: string;
  checkpointId: string;
  checkpointHash: string;
  bundlePath: string;
}

export interface ResumeBundleV1 {
  protocol: 1;
  predecessorRunId: string;
  checkpointId: string;
  checkpointHash: string;
  checkpoint: ArtifactRef;
  snapshot: ArtifactRef;
  artifacts: Array<{ ref: ArtifactRef; file: string }>;
  unfinished: string[];
  pendingDecisions: string[];
  awaitingHuman: string[];
}

export interface ResumeBundleDependencies {
  admit?<T>(operation: () => Promise<T>): Promise<T>;
  afterStage?: () => Promise<void>;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectRefs(value: unknown, refs: Map<string, ArtifactRef>): void {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.artifactId === "string" && typeof record.hash === "string") {
      const ref = { artifactId: record.artifactId, hash: record.hash };
      const old = refs.get(ref.artifactId);
      if (old && old.hash !== ref.hash) throw new ControlError("resume-artifact-conflict");
      refs.set(ref.artifactId, ref);
      return;
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) collectRefs(child, refs);
}

async function writePrivate(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

async function rereadRegular(path: string, expectedHash?: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new ControlError("resume-bundle-unsafe-file");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try { bytes = await file.readFile(); }
  finally { await file.close(); }
  if (expectedHash && sha256(bytes) !== expectedHash) throw new ControlError("resume-bundle-hash-mismatch");
  return bytes;
}

export async function exportResumeBundle(store: ControlStore, input: { predecessorRunId: string; newSourceDir: string }, deps: ResumeBundleDependencies = {}): Promise<InputCheckpointV1> {
  if (!isAbsolute(input.newSourceDir)) throw new ControlError("resume-source-dir-not-absolute");
  const run = readRun(store, input.predecessorRunId);
  if (run.state !== "settled" || !run.recoverable || !run.checkpointId) throw new ControlError("resume-predecessor-unrecoverable");
  const checkpoint = await readCommittedCheckpoint(store, input.predecessorRunId);
  if (checkpoint.result !== "complete" || checkpoint.missing.length || !checkpoint.snapshot) throw new ControlError("resume-predecessor-unrecoverable");

  const checkpointBytes = Buffer.from(JSON.stringify(checkpoint));
  const checkpointHash = sha256(checkpointBytes);
  const row = store.db.prepare("SELECT hash FROM checkpoints WHERE id=? AND run_id=?").get(checkpoint.checkpointId, checkpoint.runId);
  if (!row || String(row.hash) !== checkpointHash) throw new ControlError("checkpoint-hash-mismatch");

  const snapshotBytes = await readArtifact(store, checkpoint.snapshot);
  const parsed = snapshotSchema.safeParse(JSON.parse(snapshotBytes.toString()));
  if (!parsed.success) throw new ControlError("snapshot-invalid");
  if (parsed.data.missing.length) throw new ControlError("snapshot-partial");

  const refs = new Map<string, ArtifactRef>();
  collectRefs(checkpoint, refs);
  collectRefs(parsed.data, refs);
  const artifactBytes = new Map<string, Buffer>();
  for (const ref of refs.values()) artifactBytes.set(ref.artifactId, await readArtifact(store, ref));

  const checkpointRef = { artifactId: `checkpoint-${checkpointHash}`, hash: checkpointHash };
  if (refs.has(checkpointRef.artifactId)) throw new ControlError("resume-artifact-conflict");
  const staging = privateDirectory(join(privateDirectory(dirname(input.newSourceDir)), `.resume-staging-${randomUUID()}`));
  const artifactsDir = privateDirectory(join(staging, "artifacts"));
  try {
    const artifacts: ResumeBundleV1["artifacts"] = [{ ref: checkpointRef, file: "checkpoint.json" }];
    await writePrivate(join(staging, "checkpoint.json"), checkpointBytes);
    for (const ref of [...refs.values()].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
      const file = `artifacts/${ref.artifactId}.bin`;
      await writePrivate(join(staging, file), artifactBytes.get(ref.artifactId)!);
      artifacts.push({ ref, file });
    }
    let handoff: { unfinished: string[]; pendingDecisions: string[]; awaitingHuman: string[] } | undefined;
    const handoffRef = (checkpoint as unknown as { handoff?: ArtifactRef }).handoff;
    if (handoffRef) {
      try {
        const raw = JSON.parse(artifactBytes.get(handoffRef.artifactId)!.toString()) as Record<string, unknown>;
        if (![raw.unfinished, raw.pendingDecisions, raw.awaitingHuman].every(value => Array.isArray(value) && value.every(item => typeof item === "string"))) throw new Error();
        handoff = { unfinished: raw.unfinished as string[], pendingDecisions: raw.pendingDecisions as string[], awaitingHuman: raw.awaitingHuman as string[] };
      } catch { throw new ControlError("resume-handoff-invalid"); }
    }
    const manifest: ResumeBundleV1 = {
      protocol: 1,
      predecessorRunId: input.predecessorRunId,
      checkpointId: checkpoint.checkpointId,
      checkpointHash,
      checkpoint: checkpointRef,
      snapshot: checkpoint.snapshot,
      artifacts,
      unfinished: handoff?.unfinished ?? [],
      pendingDecisions: handoff?.pendingDecisions ?? [],
      awaitingHuman: handoff?.awaitingHuman ?? [],
    };
    await writePrivate(join(staging, "resume-bundle.json"), Buffer.from(JSON.stringify(manifest)));
    syncDirectory(artifactsDir); syncDirectory(staging);
    await rereadRegular(join(staging, "resume-bundle.json"));
    for (const entry of artifacts) await rereadRegular(join(staging, entry.file), entry.ref.hash);
    await deps.afterStage?.();

    const publish = async (): Promise<string> => {
      const sourceDir = privateDirectory(input.newSourceDir);
      const inputDir = privateDirectory(join(sourceDir, "input"));
      const finalDir = join(inputDir, checkpoint.checkpointId);
      try { await lstat(finalDir); throw new ControlError("resume-bundle-exists"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await rename(staging, finalDir); syncDirectory(inputDir);
      return finalDir;
    };
    const finalDir = await (deps.admit ? deps.admit(publish) : publish());
    return { predecessorRunId: input.predecessorRunId, checkpointId: checkpoint.checkpointId, checkpointHash, bundlePath: finalDir };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
