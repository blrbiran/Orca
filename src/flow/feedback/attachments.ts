/**
 * Gaps spec §4.7, §16 (Rule 17): the feedback attachment store. Content-addressed files
 * `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<png|jpg|webp>`, accepted by their magic bytes only, at most 5 MiB each
 * (and at most 4 per message, messages.ts). The directory is made 0700 and each file 0600 explicitly, never from umask;
 * an existing file is never rewritten or re-moded (same name = same bytes). A write goes to a temporary file first and
 * is renamed into place, so a failed upload leaves no named file. The root comes from the passed environment through
 * the one resolver (`controlRoot`), never from `os.homedir()` at this call site.
 *
 * ⚠️ Spec §4.7's copy into the child's attempt workspace (`.orca/attachments/`) is NOT built: the premise failed with the
 * real driver -- ccloop opens attempt worktrees from the run workspace's HEAD, so nothing Orca writes reaches them, and
 * ccloop's live-workspace copy bypasses the vault's `info/exclude` (spec §21 entry 2; evidence
 * logs/gaps/t5-g14-premise.{sh,log}). Until the human decides -- an absolute path outside the workspace plus ccloop's
 * read access, or a ccloop seeding change -- every call and work prompt names attachments by id only.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { controlRoot } from "../../panel/controlOptions.js";
import { FlowRefusal } from "../kernel.js";
import { makePrivateDirs } from "../vault/vault.js";

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 4;
export type AttachmentExt = "png" | "jpg" | "webp";
/** `<sha256>.<ext>`: how a message names a stored attachment. */
export const ATTACHMENT_ID = /^[0-9a-f]{64}\.(png|jpg|webp)$/;

export const attachmentsDir = (env: NodeJS.ProcessEnv): string => join(controlRoot(env), "flow-attachments");
export const attachmentPath = (env: NodeJS.ProcessEnv, id: string): string => join(attachmentsDir(env), id);
export const hasAttachment = (env: NodeJS.ProcessEnv, id: string): boolean => ATTACHMENT_ID.test(id) && existsSync(attachmentPath(env, id));

/** The image type by its first bytes; the name or a declared type is never trusted. */
export function sniffImage(bytes: Buffer): AttachmentExt | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

export function storeAttachment(env: NodeJS.ProcessEnv, bytes: Buffer): { sha256: string; ext: AttachmentExt } {
  if (bytes.length > ATTACHMENT_MAX_BYTES) throw new FlowRefusal("flow-attachment-invalid", `larger than ${ATTACHMENT_MAX_BYTES} bytes`);
  const ext = sniffImage(bytes);
  if (ext === null) throw new FlowRefusal("flow-attachment-invalid", "not a png, jpg or webp image by its bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = attachmentsDir(env);
  makePrivateDirs(dir);
  const file = join(dir, `${sha256}.${ext}`);
  if (existsSync(file)) return { sha256, ext };
  const temp = join(dir, `.${sha256}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, bytes, { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return { sha256, ext };
}
