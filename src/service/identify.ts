import { requestOverSocket } from "../entry/socketClient.js";
import { EntryRejection } from "../entry/envelope.js";
import { readPanelJson, type PanelJsonV1 } from "./instance.js";

export type Identity = { answering: true; panel: PanelJsonV1 } | { answering: false; panel: PanelJsonV1 | null; reason: string };

/** Spec §5 / plan D12: a real request to the panel panel.json names -- over its socket, else GET / on its url. */
export async function identifyPanel(panelJsonFile: string): Promise<Identity> {
  let read: ReturnType<typeof readPanelJson>;
  // A read that fails other than ENOENT (EACCES, ENOTDIR, EISDIR) is a reason to print, not a crash of `status`.
  try { read = readPanelJson(panelJsonFile); }
  catch (error) { return { answering: false, panel: null, reason: `panel.json unreadable: ${error instanceof Error ? error.message : String(error)}` }; }
  if (read.kind === "missing") return { answering: false, panel: null, reason: `no panel.json at ${panelJsonFile}` };
  if (read.kind === "invalid") return { answering: false, panel: null, reason: `panel.json invalid: ${read.reason}` };
  const panel = read.body;
  try {
    if (panel.socketPath !== null) {
      const answer = await requestOverSocket({ socketPath: panel.socketPath, method: "GET", path: "summary", client: "cli:orca-service-status", timeoutMs: 5_000 });
      return answer.status === 200 ? { answering: true, panel } : { answering: false, panel, reason: `summary answered ${answer.status}` };
    }
    const response = await fetch(`${panel.url}/`, { signal: AbortSignal.timeout(5_000) });
    return response.status === 200 ? { answering: true, panel } : { answering: false, panel, reason: `GET / answered ${response.status}` };
  } catch (error) {
    return { answering: false, panel, reason: error instanceof EntryRejection ? `${error.code}: ${error.message}` : String(error) };
  }
}
