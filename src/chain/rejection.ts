/** Named refusals of `orca chain`. Exit 1 = refused before anything was written (D-launch spec §4.3); 2 = an anomaly. */
export class ChainRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "ChainRejection";
  }
}
