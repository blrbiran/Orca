/**
 * Tester #285 (follow-up J): a transcript's last write says a run is producing output only while the run is not blocked
 * and the write is recent. A worker that died leaves the file's last write behind (the dogfood run said "producing output"
 * 25 hours later). TRANSCRIPT_STALE_MS is the bound: longer than an agent's quiet stretch inside one call (a long tool run,
 * a model turn), short enough that a dead worker stops being called live within minutes. A controller choice.
 * Pure (no store, no I/O) so the CLI and the panel share it.
 */
export const TRANSCRIPT_STALE_MS = 10 * 60_000;

/** Whether a run's transcript, last written at `lastTranscriptAt`, still says it is producing output at `now`. */
export function transcriptLive(run: { state?: string; blocked?: boolean }, lastTranscriptAt: number, now: number): boolean {
  return run.state !== "blocked" && run.blocked !== true && now - lastTranscriptAt <= TRANSCRIPT_STALE_MS;
}
