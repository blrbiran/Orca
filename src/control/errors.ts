export class ControlError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ControlError"; }
}
