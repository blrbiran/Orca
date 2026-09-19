import { z } from "zod";
export const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const amountSchema = z.object({tokens:safeInteger,activeMs:safeInteger,attempts:safeInteger,sessions:safeInteger}).strict();
export const grantSchema = z.object({work:amountSchema,handoff:amountSchema}).strict();
