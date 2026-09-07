/**
 * A named refusal `orca correct` can make, carrying the exit code the CLI
 * should answer with. Spec §14.14: 1 = the input is wrong and retrying will
 * not help; 4 = someone else holds a lock (transient, retry later); 5 = the
 * ledger is on disk but the commit did not happen (re-run the same --close).
 *
 * 3 is deliberately NOT in the union: it is what cli.ts's top-level arm
 * answers for an exception nobody anticipated, and a rejection that named
 * itself 3 would be claiming the opposite of what it knows.
 * 2 is deliberately not reusable either — `orca validate` already answers 2
 * for a downgraded ledger and `package.json`'s verify script tolerates it.
 */
export type CorrectExitCode = 1 | 4 | 5;

export class CorrectRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: CorrectExitCode = 1,
  ) {
    super(message);
    this.name = "CorrectRejection";
  }
}
