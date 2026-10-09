## Part F — ccloop re-pin, final gate and closing (spec §7, §9)

Part F runs after Parts A–E. Task F1 waits for the human to push the ccloop branch `fix/codex-planner-output` (merged
into ccloop `main`); until then F2 runs against the current pin and F1 is listed under `awaitingHuman`.

No existing test is rewritten by this part.

