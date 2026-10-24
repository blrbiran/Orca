/**
 * The transcript routes' own named refusals (spec §10.4.1, §10.6.3). They are reads, never booked as command outcomes,
 * so they are not ControlError codes: the routes send them by name with their status (`sendControlError`).
 */
export type TranscriptRefusalCode =
  | "transcript-path-invalid" | "transcript-gone" | "transcript-not-found" | "transcript-ambiguous"
  | "transcript-unsupported" | "transcript-offset-invalid" | "transcript-archive-invalid" | "query-invalid";

const STATUS: Record<TranscriptRefusalCode, 400 | 403 | 404 | 409 | 422> = {
  "transcript-path-invalid": 403, "transcript-gone": 404, "transcript-not-found": 404, "transcript-ambiguous": 409,
  "transcript-unsupported": 422, "transcript-offset-invalid": 400, "transcript-archive-invalid": 409, "query-invalid": 400,
};

export class TranscriptRefusal extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;
  constructor(readonly code: TranscriptRefusalCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.status = STATUS[code];
  }
}
