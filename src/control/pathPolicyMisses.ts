import { z } from "zod";

/** ccloop's bounded, concrete Git-observed allowlist misses. No caller-supplied path is authority. */
export const pathPolicyMissesSchema = z.array(z.object({
  repoKey: z.string().min(1).refine((key) => Buffer.byteLength(key, "utf8") <= 128).nullable(),
  path: z.string().min(1).refine((path) => Buffer.byteLength(path, "utf8") <= 4096),
}).strict()).min(1).max(128);

export type PathPolicyMissV1 = z.infer<typeof pathPolicyMissesSchema>[number];

export function exactObservedPath(path: string): boolean {
  return !path.startsWith("/") && !path.includes("*")
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
