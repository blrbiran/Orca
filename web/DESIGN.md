# Orca panel — DESIGN

Operate mode: a single developer reviews agent decisions and steers task groups. Density and scanability over expression.

## Themes
- Light = warm paper (`--bg #f6f4ef`, cards `#fffdf9`, warm grey text). Dark = neutral graphite (channels within 10, blue ≥ red); never warm.
- Layers separate by stepping LIGHTER in dark, DARKER-edged in light. Values are pinned by `tests/contrast.test.ts` and `tests/lightTheme.test.ts` — re-run both before changing any token.
- The two light blocks are identical by rule (`lightTheme.test.ts`).
- Selectable themes (session e236bbe4; reworked and extended in the tester round 2026-10-28, controller session a9f9d6de, human: 「之前的主题都不好看，你可以都整体再优化一遍」): `system` (follows the browser) · `light` · `dark` stay the defaults above and keep the shared scale. The candidates the human kept (session 2026-10-29: 霜白，深色，浅色，蔷薇，紫夜，暮色，余烬; `ink`, `contrast`, `navy`, `lagoon` and `terminal` dropped) each set palette, type, corners and density together — light ones first:
  - `frost` — crisp cool daylight, ocean-blue accent; Inter; radii 5/8/12; roomier controls (34/28).
  - `rose` — warm ivory, rose accent; Inter; radii 6/10/16; spacious (5 px step, controls 36/30).
  - `violet` — Linear-style near-black with a violet cast, lilac accent; Inter; radii 4/6/8; compact.
  - `dusk` — soft low-glare slate, lavender accent; system type; radii 6/10/16; spacious.
  - `ember` — forge-at-night brown-black, bronze accent; system type; radii 2/3/4; tighter controls (30/24).
- Each candidate is one `:root[data-theme="<id>"]` block placed after the system-light block, defining every colour token the light block does, with the right `color-scheme`. A theme changes the look beyond colour ONLY through the scale tokens: `--font` / `--mono` (the bundled `var(--font-sans)` / `var(--font-mono)`, or left to the system stack), `--radius-xs` / `--radius-sm` / `--radius`, and density as a whole scale (`--space-1..5` on the 1-2-3-4-6 ratio, `--control-h`, `--control-h-sm`). `index.css` hands these to the utilities (`--spacing` is `--space-1`, `rounded-*` the radii, `h-control` the heights), so migrated and legacy components follow one switch; px literals in the legacy sheet do not, until they migrate.
- `web/tests/themes.test.ts` holds every theme to the same bar: text ≥7 and secondary ≥4.5 on every surface, accent links ≥4.5, labels on the accent (resting and hover) ≥4.5, tones ≥4.5, focus ring ≥3, dark themes step lighter (page < card < well < field); and every candidate sets its radii plus its type or density, density as a whole scale, fonts only from the bundle. A stored choice of a dropped id reads as `system`.
- Inset boxes (metric tiles, the project control, notices, detail blocks, nested sections) paint `--well`; form fields paint `--field`. In dark: card < well < field, each one step lighter, and no box ever wears the page colour `--bg`. In light both are the paper well (`--bg`).

## Tone, not role
- `role` is semantics for assistive tech only. A box with `role=alert|status|note` is NEUTRAL by default.
- Colour comes only from `data-tone`: `info` (blue), `ok` (green), `warn` (amber), `danger` (red). Pick by meaning:
  refusals/errors = danger; blocked/waiting/needs-action = warn; recorded/done = ok; running/in-progress = info; config facts and "not read yet" = no tone.
- Static configuration text is `role="note"`, never `alert`.

## Type
- Body 14px. h3 14px/600. h2 18px. h1 22px (Decisions' title is sized as an h2 so every page title matches).
- Numbers that change (counts, rates, ids) use `font-variant-numeric: tabular-nums` where they sit in rows.
- Key figures (tokens, durations, attempts) take the `num` utility class (tabular digits; `@utility num` in `src/index.css`), so a polled line or a column does not jitter (ruling H8).

## Components (session e236bbe4)
- Scale tokens (in the first `:root` block; the default pair uses them as is, a candidate theme may override them — see Themes): space 4/8/12/16/24, radius 4 (xs) / 6 (controls) / 10 (cards), control height 32 (26 small), motion 120ms ease-out. Colour comes only from the theme tokens.
- Buttons: secondary by default (elevated fill, strong edge, small shadow); one primary per view: only `.btn-primary` is filled with the accent (hover `--accent-hover`). `type="submit"` alone is a secondary button. `.btn-quiet` drops the chrome (cancel, dismiss). Both are `@utility` classes in `src/index.css` (the final pass of the Tailwind migration dropped `.btn-danger`: no view used it). Every button has hover, a 1px press, a 2px accent focus ring (offset 2), disabled at 50%, `aria-busy` shows progress. Two adjacent buttons get 8px apart unless their row spaces itself.
- Fields: inputs, selects and textareas share one look (`--field`, strong edge, 32px, accent caret, accent ring on focus, muted placeholder, `aria-invalid` edge in danger); selects carry the token chevron; checkboxes and radios stay native at 16px, tinted with the accent.
- Tabs: ONE component (`tabRow` / `tabItem` in `src/ui/classes.ts`; a tab that is a button adds `tabButton`, its row `tabButtonRow`) — the Settings category row, the group detail's region tabs and the corrections tabs: a row over a bottom rule, quiet medium-weight items, the open one bold over a 2px accent underline; it wraps when narrow.
- Pills and badges: 12px, medium weight, hairline edge; a badge's colour is its `data-tone` (none = neutral). `pill` / `badge` are `@utility` classes in `src/index.css`.
- Tables: uppercase 12px headers over a strong rule, 8×10 cells, row hover tint, no rule under the last row. On ≤760px a table's box scrolls sideways and a headed table keeps 40rem, so the page never scrolls sideways.
- Confirmations: an inline `role="dialog"` box is a well with a strong edge; a confirm group (`.confirm-inline`, e.g. the #62 charge retry) is an inline box toned `warn`; the modal dialog (`src/ui/Dialog.tsx`, Radix) floats on `--shadow-pop` over a dimmed page. Menus (`src/ui/Menu.tsx`, Radix) float on `--shadow-pop` too; they are the only menu and dialog implementations.
- The browser's own surfaces follow the theme: text selection, caret, scrollbars, link underline offset, summary markers.
- Motion is limited to colour/edge/shadow transitions and the press; under `prefers-reduced-motion` they and the running pulse stop.

## Styling (tester round 2026-10-28)
- Tailwind v4 utilities over the tokens above (`src/index.css` maps them; Tailwind's own palette is cleared); the theme blocks in `styles.css` stay the only theme source.
- Layers (final pass of the migration): theme, base, utilities. The base is Tailwind's preflight, then `styles.css` — the theme blocks, the browser defaults the look keeps (list bullets and indents, h4–h6, link underlines, `small`, `pre`, inline media), the element base, the `role` / `data-tone` rules and the few rules on hooks (panes, Settings categories, the dependency graph). The shared component classes (`pill`, `badge`, `btn-primary`, `callout`, `split*`, `detail-block`, `led`, …) are `@utility` blocks in `src/index.css`, so an element's own utilities still override them. How to write and migrate a component: `web/TAILWIND-MIGRATION.md`.
- Inter and JetBrains Mono are bundled (woff2) as `--font-sans` / `--font-mono`; the default look keeps the system stack (`--font`); a candidate theme chooses them by setting `--font` / `--mono` (see Themes).

## Layout
- ≥761px: fixed shell, sidebar and content scroll independently. ≤760px wide or ≤560px tall: the page scrolls as a whole; nav is one horizontally scrolling row; the footer hides. The project caption stays (it explains the hidden Add/Rename).
- On touch (`pointer: coarse`) buttons, selects, inputs and nav items are at least 44px tall; checkboxes and radios keep their native size; the j/k/a/c hint is hidden.
- Panes stay mounted; only `.section-pane:not([data-active="true"])` hides one.

## Status light (ruling H8, 2026-10-27)
- A group card in the Tasks list and on the Board starts with a 7px dot, the `led` utility with `data-led` (`@utility led`, `src/index.css`), from `groupLed` (`groupCategory.ts`): running = `--ok` with a soft glow, failed/blocked (needs you) = `--danger`, waiting (started or queued, nothing going) = `--warn`, not started or settled = `--muted`, dimmed. Tone tokens only, so both themes follow.
- It is decorative (`aria-hidden`): the card's text already states the state. Nothing else of an "instrument console" look is adopted.

## Settings and navigation (ruling H6, 2026-10-27)
- The sidebar is one list in three bands (work · tools · Settings at the bottom), a thin rule above each later band.
- Settings is one page: a category nav above the content; one category shows, the rest stay mounted and hidden by `.settings-category:not([data-active="true"])`.
- The category nav is a row of tabs (tester #64, revised by the human in session 3cd8fb02): links with `aria-current`, not an ARIA tablist; inactive items quiet (`--muted`), the open one underlined in the accent over the row's bottom rule; the row wraps when narrow (no horizontal scroll) and the content takes the full width below.

