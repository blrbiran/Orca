# Orca panel — DESIGN

Operate mode: a single developer reviews agent decisions and steers task groups. Density and scanability over expression.

## Themes
- Light = warm paper (`--bg #f6f4ef`, cards `#fffdf9`, warm grey text). Dark = neutral graphite (channels within 10, blue ≥ red); never warm.
- Layers separate by stepping LIGHTER in dark, DARKER-edged in light. Values are pinned by `tests/contrast.test.ts` and `tests/lightTheme.test.ts` — re-run both before changing any token.
- The two light blocks are identical by rule (`lightTheme.test.ts`).
- Inset boxes (metric tiles, the project control, notices, detail blocks, nested sections) paint `--well`; form fields paint `--field`. In dark: card < well < field, each one step lighter, and no box ever wears the page colour `--bg`. In light both are the paper well (`--bg`).

## Tone, not role
- `role` is semantics for assistive tech only. A box with `role=alert|status|note` is NEUTRAL by default.
- Colour comes only from `data-tone`: `info` (blue), `ok` (green), `warn` (amber), `danger` (red). Pick by meaning:
  refusals/errors = danger; blocked/waiting/needs-action = warn; recorded/done = ok; running/in-progress = info; config facts and "not read yet" = no tone.
- Static configuration text is `role="note"`, never `alert`.

## Type
- Body 14px. h3 14px/600. h2 18px. h1 22px (Decisions' title is sized as an h2 so every page title matches).
- Numbers that change (counts, rates, ids) use `font-variant-numeric: tabular-nums` where they sit in rows.

## Buttons
- One primary per view: only `.btn-primary` is filled with the accent. `type="submit"` alone is a secondary button.

## Layout
- ≥761px: fixed shell, sidebar and content scroll independently. ≤760px wide or ≤560px tall: the page scrolls as a whole; nav is one horizontally scrolling row; the footer hides. The project caption stays (it explains the hidden Add/Rename).
- On touch (`pointer: coarse`) buttons, selects, inputs and nav items are at least 44px tall; checkboxes and radios keep their native size; the j/k/a/c hint is hidden.
- Panes stay mounted; only `.section-pane:not([data-active="true"])` hides one.
