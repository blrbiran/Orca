/** Saved result reads share the panel session/refusal transport; no command is sent. */
import { controlGet } from "./controlApi.js";
import type { GroupResultsV1, RunResultsV1, ResultOutputV1 } from "./controlTypes.js";
const segment = encodeURIComponent;
export const resultOutputPath = (runId: string, outputId: string): string => `/api/control/runs/${segment(runId)}/results/outputs/${segment(outputId)}`;
export const fetchRunResults = (runId: string, signal?: AbortSignal): Promise<RunResultsV1> => controlGet(`/api/control/runs/${segment(runId)}/results`, signal);
export const fetchGroupResults = (groupId: string, signal?: AbortSignal): Promise<GroupResultsV1> => controlGet(`/api/control/groups/${segment(groupId)}/results`, signal);
export const fetchResultOutput = (runId: string, outputId: string, signal?: AbortSignal): Promise<ResultOutputV1> => controlGet(resultOutputPath(runId, outputId), signal);
