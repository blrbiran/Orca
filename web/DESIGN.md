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
- Key figures (tokens, durations, attempts) take the `.num` utility class (tabular digits), so a polled line or a column does not jitter (ruling H8).

## Buttons
- One primary per view: only `.btn-primary` is filled with the accent. `type="submit"` alone is a secondary button.

## Layout
- ≥761px: fixed shell, sidebar and content scroll independently. ≤760px wide or ≤560px tall: the page scrolls as a whole; nav is one horizontally scrolling row; the footer hides. The project caption stays (it explains the hidden Add/Rename).
- On touch (`pointer: coarse`) buttons, selects, inputs and nav items are at least 44px tall; checkboxes and radios keep their native size; the j/k/a/c hint is hidden.
- Panes stay mounted; only `.section-pane:not([data-active="true"])` hides one.

## Status light (ruling H8, 2026-10-27)
- A group card in the Tasks list and on the Board starts with a 7px dot, `.led[data-led]`, from `groupLed` (`groupCategory.ts`): running = `--ok` with a soft glow, failed/blocked (needs you) = `--danger`, waiting (started or queued, nothing going) = `--warn`, not started or settled = `--muted`, dimmed. Tone tokens only, so both themes follow.
- It is decorative (`aria-hidden`): the card's text already states the state. Nothing else of an "instrument console" look is adopted.

## Settings and navigation (ruling H6, 2026-10-27)
- The sidebar is one list in three bands (work · tools · Settings at the bottom), a thin rule above each later band.
- Settings is one page: a category nav on the left (≥761px, sticky) or wrapped in rows above the content (≤760px); one category shows, the rest stay mounted and hidden by `.settings-category:not([data-active="true"])`.
- The category nav is a panel of its own (`--bg-elevated`, border, radius), as wide as its labels up to ~11rem; its open item is marked like a tab (accent edge and weight, no fill) so it never reads as a second sidebar (tester #64).

