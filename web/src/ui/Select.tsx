/**
 * The panel's one picker (session b999cc81, human: 「(a) 全量换」; spec 2026-10-29-radix-select-everywhere-design.md §2):
 * a Radix select in the panel's look. The trigger is a field-height button with the field's surface, edge, focus and
 * invalid edge; the list floats in a portal like the menu (Menu.tsx), with scroll buttons when it is longer than the room.
 * Every prop it does not name (aria-label, aria-invalid, id, data-testid, ...) goes onto the trigger. `className` replaces
 * only the default minimum width and appends; a parent sizes the trigger through `[data-select-trigger]`.
 *
 * Empty values: Radix reserves "" for "no value" (it would show the placeholder instead of the option's label), so an
 * option whose value is "" is carried as EMPTY inside and handed back as "". The limit: inside a <form> Radix's hidden
 * native select posts EMPTY for that option, so `name` is not allowed together with an option whose value is "" -- the
 * type refuses it when the option values are literals; a value computed as `string` cannot be checked, and a caller who
 * posts one must not offer "". A value that is not among the options shows the trigger empty with the placeholder, and
 * nothing reads as chosen (human ruling (a), spec §4): what is shown is what is sent.
 */
import * as RadixSelect from "@radix-ui/react-select";
import type { ComponentPropsWithoutRef, JSX } from "react";

export interface SelectOption<V extends string = string> { value: V; label: string; disabled?: boolean }
const EMPTY = "\u0000empty";
const inner = (value: string): string => (value === "" ? EMPTY : value);
const outer = (value: string): string => (value === EMPTY ? "" : value);

type TriggerProps = Omit<ComponentPropsWithoutRef<"button">, "value" | "defaultValue" | "onChange" | "name" | "disabled" | "children" | "type" | "className" | "placeholder">;
/** `name` posts the value with a form, so it is refused when an option literal is "" (it would post the sentinel). */
type Naming<V extends string> = string extends V ? { name?: string } : "" extends V ? { name?: never } : { name?: string };
export type SelectProps<V extends string = string> = TriggerProps & Naming<V> & {
  value: string;
  options: readonly SelectOption<V>[];
  onValueChange: (value: V) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export function Select<const V extends string>(props: SelectProps<V>): JSX.Element {
  const { value, options, onValueChange, disabled, placeholder, className, ...rest } = props;
  const { name, ...trigger } = rest as TriggerProps & { name?: string };
  const known = options.some((option) => option.value === value);
  return (
    <RadixSelect.Root name={name} value={known ? inner(value) : ""} onValueChange={(next) => onValueChange(outer(next) as V)} disabled={disabled}>
      <RadixSelect.Trigger data-select-trigger={name ?? ""} {...trigger}
        className={"ms-0 inline-flex h-control items-center justify-between gap-2 rounded-control border border-line-strong bg-field px-[10px] text-sm font-normal text-fg-strong shadow-none"
          + " hover:enabled:border-line-strong focus-visible:border-accent focus-visible:outline-offset-1 aria-[invalid=true]:border-danger data-placeholder:text-muted"
          + ` ${className ?? "min-w-[10rem]"}`}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-muted" aria-hidden>▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={4} collisionPadding={8}
          className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-line-strong bg-elevated text-fg shadow-float">
          <RadixSelect.ScrollUpButton className="flex h-6 cursor-default items-center justify-center text-muted" aria-hidden>▴</RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={inner(option.value)} disabled={option.disabled}
                className="relative flex cursor-pointer items-center rounded-control py-1.5 ps-7 pe-3 text-sm outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-hover data-[state=checked]:font-semibold data-[state=checked]:text-fg-strong">
                <RadixSelect.ItemIndicator className="absolute start-2 text-accent">✓</RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-6 cursor-default items-center justify-center text-muted" aria-hidden>▾</RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
