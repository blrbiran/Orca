# Orca panel — DESIGN

Operate mode: a single developer reviews agent decisions and steers task groups. Density and scanability over expression.

## Themes
- Light = warm paper (`--bg #f6f4ef`, cards `#fffdf9`, warm grey text). Dark = neutral graphite (channels within 10, blue ≥ red); never warm.
- Layers separate by stepping LIGHTER in dark, DARKER-edged in light. Values are pinned by `tests/contrast.test.ts` and `tests/lightTheme.test.ts` — re-run both before changing any token.
- The two light blocks are identical by rule (`lightTheme.test.ts`).
- Selectable themes (session e236bbe4, candidates the human keeps or drops): `system` (follows the browser) · `light` · `dark` are the default pair above; `frost` (cool-neutral light, petrol accent), `contrast` (high-contrast light, every text pair ≥7:1), `navy` (deep blue dark, periwinkle accent), `ember` (warm brown dark, copper accent), `dusk` (soft slate dark, lavender accent), `terminal` (green-black, green accent, monospaced type). Each is one `:root[data-theme="<id>"]` block placed after the system-light block, defining every colour token the light block does, with the right `color-scheme`. `web/tests/themes.test.ts` holds every theme to the same bar: text ≥7 and secondary ≥4.5 on every surface, accent links ≥4.5, labels on the accent (resting and hover) ≥4.5, tones ≥4.5, focus ring ≥3, and dark themes step lighter (page < card < well < field).
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

## Components (session e236bbe4)
- Scale tokens (in the first `:root` block, shared by every theme): space 4/8/12/16/24, radius 4 (xs) / 6 (controls) / 10 (cards), control height 32 (26 small), motion 120ms ease-out. Colour comes only from the theme tokens.
- Buttons: secondary by default (elevated fill, strong edge, small shadow); one primary per view: only `.btn-primary` is filled with the accent (hover `--accent-hover`). `type="submit"` alone is a secondary button. `.btn-quiet` drops the chrome (cancel, dismiss); `.btn-danger` tints an irreversible action. Every button has hover, a 1px press, a 2px accent focus ring (offset 2), disabled at 50%, `aria-busy` shows progress. Two adjacent buttons get 8px apart unless their row spaces itself.
- Fields: inputs, selects and textareas share one look (`--field`, strong edge, 32px, accent caret, accent ring on focus, muted placeholder, `aria-invalid` edge in danger); selects carry the token chevron; checkboxes and radios stay native at 16px, tinted with the accent.
- Tabs: ONE component — the Settings category row, the group detail's region tabs and the corrections tabs: a row over a bottom rule, quiet medium-weight items, the open one bold over a 2px accent underline; it wraps when narrow.
- Pills and badges: 12px, medium weight, hairline edge; a badge's colour is its `data-tone` (none = neutral).
- Tables: uppercase 12px headers over a strong rule, 8×10 cells, row hover tint, no rule under the last row. On ≤760px a table's box scrolls sideways and a headed table keeps 40rem, so the page never scrolls sideways.
- Confirmations: an inline `role="dialog"` box is a well with a strong edge; a confirm group (`.confirm-inline`, e.g. the #62 charge retry) is an inline box toned `warn`; a native `<dialog>` floats on `--shadow-pop` over a dimmed page. Menus float on `--shadow-pop` too.
- The browser's own surfaces follow the theme: text selection, caret, scrollbars, link underline offset, summary markers.
- Motion is limited to colour/edge/shadow transitions and the press; under `prefers-reduced-motion` they and the running pulse stop.

## Layout
- ≥761px: fixed shell, sidebar and content scroll independently. ≤760px wide or ≤560px tall: the page scrolls as a whole; nav is one horizontally scrolling row; the footer hides. The project caption stays (it explains the hidden Add/Rename).
- On touch (`pointer: coarse`) buttons, selects, inputs and nav items are at least 44px tall; checkboxes and radios keep their native size; the j/k/a/c hint is hidden.
- Panes stay mounted; only `.section-pane:not([data-active="true"])` hides one.

## Status light (ruling H8, 2026-10-27)
- A group card in the Tasks list and on the Board starts with a 7px dot, `.led[data-led]`, from `groupLed` (`groupCategory.ts`): running = `--ok` with a soft glow, failed/blocked (needs you) = `--danger`, waiting (started or queued, nothing going) = `--warn`, not started or settled = `--muted`, dimmed. Tone tokens only, so both themes follow.
- It is decorative (`aria-hidden`): the card's text already states the state. Nothing else of an "instrument console" look is adopted.

## Settings and navigation (ruling H6, 2026-10-27)
- The sidebar is one list in three bands (work · tools · Settings at the bottom), a thin rule above each later band.
- Settings is one page: a category nav above the content; one category shows, the rest stay mounted and hidden by `.settings-category:not([data-active="true"])`.
- The category nav is a row of tabs (tester #64, revised by the human in session 3cd8fb02): links with `aria-current`, not an ARIA tablist; inactive items quiet (`--muted`), the open one underlined in the accent over the row's bottom rule; the row wraps when narrow (no horizontal scroll) and the content takes the full width below.

