/**
 * #122: some third-party providers behind codex refuse `--output-schema` with a 400 about the response format (`text.format`,
 * `response_format`, `output_schema`, `json_schema`). ccloop has an opt-in for them -- `"structuredOutput": "prompt"` on that
 * codex installation in the agents table -- and never chooses it by itself, so a person has to be told. True when any of the
 * run's failure texts is such a refusal. Shared by the CLI's `run show` and the Web's run reason, so it imports nothing.
 */
const FORMAT_FIELD = /text\.format|response_format|output_schema|json_schema/i;
const BAD_REQUEST = /\b400\b|bad request|invalid_request_error/i;

export function rejectsOutputSchema(texts: ReadonlyArray<string | null | undefined>): boolean {
  return texts.some((text) => typeof text === "string" && FORMAT_FIELD.test(text) && BAD_REQUEST.test(text));
}
