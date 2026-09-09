/**
 * A named refusal `orca metrics` can make. Shape copied from
 * src/corrections/rejection.ts so the two subsystems answer the same way.
 *
 * Only exit code 1 — "the input is wrong and retrying will not help". This cut
 * takes no lock (spec §5.1) so there is no 4; it writes nothing so there is no
 * 5. Exit 6 is NOT a rejection: it means the report printed in full and some
 * lines were bad (spec §5.2), and the CLI returns it rather than throwing.
 */
export class MetricsRejection extends Error {
  readonly exitCode = 1 as const;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MetricsRejection";
  }
}
