/**
 * Flow engine spec §6.4: `fp1` fingerprints, frozen (§18). sha256 over canonical JSON, each tagged `fp1` so a later
 * definition (`fp2`) can never collide with one of these.
 *
 * - definitionHash: the step's expanded definition, the prompt bytes after fragment expansion, the lock entries of the
 *   step's skills (source id, resolved commit, content_md5), its check commands, its tools and the kind's version.
 *   Agent and model are recorded on the execution but are never inputs: they are suggestions (H14).
 * - ranOn: the base commit's tree id, the active output hash of every earlier step ordered by (template position,
 *   step id) -- stable however parallel siblings finished -- and the params' sha256.
 * - outputHash: for a commit, over the sorted (path, blob id) pairs it changed against its parent; for a record, the
 *   record's artifact hash.
 */
import { sha256Canonical } from "../../control/canonicalJson.js";

export interface SkillLock { sourceId: string; resolvedCommit: string; contentMd5: string }
export interface DefinitionInput {
  step: unknown;
  promptBytes: string | Buffer;
  skillLocks: readonly SkillLock[];
  checks: readonly string[];
  tools: unknown;
  kindVersion: number;
  /** Recorded with the execution, excluded from the hash. */
  agent?: string | null;
  model?: string | null;
}

/** Plain JSON (absent keys dropped), so the canonical encoder sees the definition as it was written. */
const plain = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

export function definitionHash(input: DefinitionInput): string {
  const prompt = typeof input.promptBytes === "string" ? Buffer.from(input.promptBytes, "utf8") : input.promptBytes;
  return sha256Canonical({
    fp: "fp1/definition",
    step: plain(input.step),
    promptSha256: sha256Canonical(prompt.toString("base64")),
    skills: input.skillLocks.map((lock) => ({ sourceId: lock.sourceId, resolvedCommit: lock.resolvedCommit, contentMd5: lock.contentMd5 })),
    checks: [...input.checks],
    tools: plain(input.tools),
    kindVersion: input.kindVersion,
  });
}

export interface EarlierOutput { stepKey: string; templatePos: number; outputHash: string }

export function ranOn(baseTreeId: string, earlier: readonly EarlierOutput[], paramsSha256: string): string {
  const ordered = [...earlier].sort((a, b) => a.templatePos - b.templatePos || (a.stepKey < b.stepKey ? -1 : a.stepKey > b.stepKey ? 1 : 0));
  return sha256Canonical({ fp: "fp1/ranOn", baseTreeId, earlier: ordered.map((e) => [e.stepKey, e.outputHash]), paramsSha256 });
}

export function fingerprint(definition: string, ran: string): string {
  return sha256Canonical({ fp: "fp1", definitionHash: definition, ranOn: ran });
}

export function outputHashOfCommit(changes: ReadonlyArray<{ path: string; blob: string }>): string {
  const sorted = [...changes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Canonical({ fp: "fp1/output", changes: sorted.map((c) => [c.path, c.blob]) });
}

export const outputHashOfRecord = (artifactSha256: string): string => artifactSha256;
