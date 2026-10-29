import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Session b999cc81 (spec 2026-10-29-radix-select-everywhere-design.md §3): every picker is the Radix `Select`
 * (web/src/ui/Select.tsx), and a criterion drives it the way a person without a mouse does -- focus the trigger, open
 * the list from the keyboard, choose an option by its accessible name.
 *
 * Tests NEVER query or change Radix's hidden native `<select>`. Radix renders one (with real options) whenever the
 * trigger sits inside a `<form>`, `name` or not, and its onChange sets the value -- so a criterion that drove it would
 * stay green while the control a person actually uses is broken or gone.
 */

/** The accessible name Radix gives an option: its text only (aria-labelledby), not the ✓ beside the chosen one. */
function optionName(option: HTMLElement): string {
  const label = option.getAttribute("aria-labelledby");
  const text = label === null ? null : document.getElementById(label)?.textContent;
  return (text ?? option.textContent ?? "").trim();
}

/*
 * Radix opens and closes the list synchronously inside fireEvent's act, so the helpers look first and only wait when
 * the list is not there yet: RTL's findBy/waitFor end with a setTimeout(0) that never fires under vi.useFakeTimers(),
 * and several App criteria switch the project with fake timers installed (batch 1, session b999cc81).
 */
async function open(trigger: HTMLElement): Promise<HTMLElement> {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.queryByRole("listbox") ?? screen.findByRole("listbox");
}

async function closed(): Promise<void> {
  if (screen.queryByRole("listbox") === null) return;
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
}

/** Focus `trigger`, open its list by keyboard, choose the option named `name` with Enter, and wait for the list to close. */
export async function pickOption(trigger: HTMLElement, name: string | RegExp): Promise<void> {
  await open(trigger);
  const option = screen.queryByRole("option", { name }) ?? await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
  await closed();
}

/** Open `trigger`'s list, return `[name, disabled]` for every option in the order offered, and close it with Escape. */
export async function optionsOf(trigger: HTMLElement): Promise<Array<[string, boolean]>> {
  const list = await open(trigger);
  const offered = screen.getAllByRole("option").map((option): [string, boolean] => [optionName(option), option.getAttribute("aria-disabled") === "true"]);
  fireEvent.keyDown(list, { key: "Escape" });
  await closed();
  return offered;
}

/** The text the closed trigger shows -- the chosen option's label, or the placeholder -- without the ▾ beside it. */
export function shownText(trigger: HTMLElement): string {
  return (trigger.firstElementChild?.textContent ?? "").trim();
}
