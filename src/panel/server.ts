import { NO_VIEWER_IDENTITY, PanelRejection } from "./rejection.js";

export interface StartedPanel {
  url: string;
  token: string;
  /** Resolves when the server has closed. */
  closed: Promise<void>;
  close(): Promise<void>;
}

export async function startPanelFromArgs(args: string[]): Promise<StartedPanel> {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const by = flag("--by");
  if (by === undefined || by.length === 0) {
    throw new PanelRejection(
      NO_VIEWER_IDENTITY,
      "orca panel needs --by <who>. Every review and every correction this panel records is " +
        "stamped with it, and `by` is part of both derived ids, so a default would be a sentence " +
        "nobody said written permanently into an append-only ledger.",
    );
  }
  throw new PanelRejection("not-implemented", "orca panel is not implemented yet (plan task 3)");
}
