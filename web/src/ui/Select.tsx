/**
 * Trial (session 2026-10-29, human: 「是不是可以换成 Radix Select 看下效果」): a Radix select in the panel's look, for the
 * human to compare with the native <select> on the settings page before deciding whether every picker moves. The
 * trigger is a field-height button with the field's surface and edge; the list floats in a portal like the menu
 * (Menu.tsx). Radix reserves the empty string for "no value", so an option whose value is "" is carried as EMPTY inside.
 * `name` also renders Radix's hidden native select, so the value still posts with a form.
 */
import * as RadixSelect from "@radix-ui/react-select";
import type { JSX } from "react";

export interface SelectOption { value: string; label: string; disabled?: boolean }
const EMPTY = "\u0000empty";
const inner = (value: string): string => (value === "" ? EMPTY : value);
const outer = (value: string): string => (value === EMPTY ? "" : value);

export function Select(props: { name: string; value: string; options: readonly SelectOption[]; onValueChange: (value: string) => void; disabled?: boolean; placeholder?: string }): JSX.Element {
  return (
    <RadixSelect.Root name={props.name} value={inner(props.value)} onValueChange={(value) => props.onValueChange(outer(value))} disabled={props.disabled}>
      <RadixSelect.Trigger data-select-trigger={props.name}
        className="ms-0 inline-flex h-control min-w-[10rem] items-center justify-between gap-2 rounded-control border border-line-strong bg-field px-[10px] text-sm font-normal text-fg-strong shadow-none hover:enabled:border-line-strong focus-visible:border-accent data-placeholder:text-muted">
        <RadixSelect.Value placeholder={props.placeholder} />
        <RadixSelect.Icon className="text-muted" aria-hidden>▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-line-strong bg-elevated text-fg shadow-float">
          <RadixSelect.Viewport className="p-1">
            {props.options.map((option) => (
              <RadixSelect.Item key={option.value} value={inner(option.value)} disabled={option.disabled}
                className="relative flex cursor-pointer items-center rounded-control py-1.5 ps-7 pe-3 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-hover data-[state=checked]:font-semibold data-[state=checked]:text-fg-strong">
                <RadixSelect.ItemIndicator className="absolute start-2 text-accent">✓</RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
