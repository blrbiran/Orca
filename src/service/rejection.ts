/** Panel service spec: a named refusal. The CLI prints `rejected: <code>: <message>` and exits 1. */
export class ServiceRejection extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ServiceRejection";
  }
}
