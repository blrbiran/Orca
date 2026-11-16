import { z } from "zod";
import { idSchema } from "./schema.js";

const historyRefSchema = z.string().regex(/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/).refine(ref =>
  !ref.includes("..") && !ref.includes("//") && !ref.endsWith("/") && !ref.endsWith(".") && !ref.endsWith(".lock"),
);
const historyTargetRefSchema = historyRefSchema.refine(ref => !ref.startsWith("refs/heads/orca/"));
const historyArtifactSchema = z.string().min(1).max(4096).refine(path =>
  !path.startsWith("/") && !path.split("/").some(part => part === "" || part === "." || part === ".." || part === ".git") && !path.includes("\\") && !/[\x00-\x1f]/.test(path),
);

/** Explicit, ordered source-parent claim. Parsing it does not yet establish that any ref exists. */
export const historyExpectationSchema = z.object({
  version: z.literal(1), targetRef: historyTargetRefSchema, directSecondParent: z.literal(true),
  sourceRefs: z.array(z.object({ taskId: idSchema, ref: historyRefSchema }).strict()).min(1).max(64),
  artifactPaths: z.array(historyArtifactSchema).max(64).optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sourceRefs.map(entry => entry.taskId)).size !== value.sourceRefs.length || new Set(value.sourceRefs.map(entry => entry.ref)).size !== value.sourceRefs.length)
    ctx.addIssue({ code: "custom", message: "history-source-duplicate", path: ["sourceRefs"] });
  if (value.artifactPaths && new Set(value.artifactPaths).size !== value.artifactPaths.length)
    ctx.addIssue({ code: "custom", message: "history-artifact-duplicate", path: ["artifactPaths"] });
});
export type HistoryExpectation = z.infer<typeof historyExpectationSchema>;
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const historySourceObservationSchema = z.object({ taskId: idSchema, sourceRef: historyRefSchema, sourceSha: commit,
  contractHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HistorySourceObservation = z.infer<typeof historySourceObservationSchema>;
export const historyBindingSchema = historySourceObservationSchema.extend({ runId: idSchema, landedCommit: commit, noChange: z.literal(true).optional() }).strict();
export type HistoryBinding = z.infer<typeof historyBindingSchema>;
