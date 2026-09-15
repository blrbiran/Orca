/**
 * Final review I-3 / ruling R66: spec §5's first-class error page. When the
 * metrics or the to-do list cannot be loaded -- above all when E2's integrity
 * gate refuses (`unresolved-project-keys`, which names the keys it could not
 * resolve) -- the person must be able to read WHAT was refused, not only that
 * something answered 409. Pure, for `renderToStaticMarkup`.
 */
import type { JSX } from "react";
import type { PanelRefusal } from "./api.js";

export function ErrorPage({ failure }: { failure: PanelRefusal }): JSX.Element {
  return (
    <main className="error-page" role="alert">
      <h1>orca panel could not load</h1>
      <p data-testid="error-status">
        {failure.status === null ? "no answer from the panel" : `answered ${failure.status}`}
      </p>
      <p>
        <code data-testid="error-code">{failure.code}</code>
      </p>
      <p data-testid="error-message">{failure.message}</p>
    </main>
  );
}
