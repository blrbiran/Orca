/**
 * The panel's one menu (tester round 2026-10-28, human ruling "Radix first"): a Radix dropdown menu, non-modal, in a
 * portal, positioned against its button. Behaviour kept from the hand-rolled menu it replaces (GroupActionsMenu, issue
 * #81): a click on the button toggles it like any other button (Radix alone opens on pointerdown), the first enabled
 * item takes focus when it opens, the arrow keys loop, Escape and a press outside close it, and closing by Escape or an
 * item returns focus to the button. The caller owns `open`, so a second gesture (a card's context menu) can open it too.
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useCallback, useRef, type JSX, type ReactElement, type ReactNode } from "react";

export function Menu(props: { open: boolean; onOpenChange: (open: boolean) => void; trigger: ReactElement; children: ReactNode }): JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  // The box mounts (in its portal) with its items; focusing the first enabled one here, before Radix's own open focus
  // runs, keeps that focus -- Radix would otherwise focus the box itself when a pointer opened the menu.
  const content = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus();
  }, []);
  return (
    <DropdownMenu.Root open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <DropdownMenu.Trigger ref={trigger} asChild onPointerDown={(event) => event.preventDefault()} onClick={() => props.onOpenChange(!props.open)}>
        {props.trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content ref={content} align="end" sideOffset={4} loop collisionPadding={8}
          // The button's own press is not "outside": its click toggles the menu closed.
          onPointerDownOutside={(event) => { if (trigger.current?.contains(event.target as Node)) event.preventDefault(); }}
          className="z-50 grid min-w-[170px] gap-0.5 rounded-card border border-line-strong bg-elevated p-1 text-fg shadow-float [&>small]:px-3 [&>small]:pb-1 [&>small]:text-xs [&>small]:text-muted">
          {props.children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One menu item: a button (so `disabled` is the real attribute) with the menuitem role and Radix's roving focus. */
export function MenuItem(props: { onSelect: () => void; disabled?: boolean; describedBy?: string; children: ReactNode }): JSX.Element {
  return (
    <DropdownMenu.Item asChild disabled={props.disabled} onSelect={props.onSelect}>
      <button type="button" disabled={props.disabled} aria-describedby={props.describedBy}
        className="ms-0 justify-start border-transparent bg-transparent text-left shadow-none hover:enabled:border-transparent hover:enabled:bg-hover data-highlighted:bg-hover">
        {props.children}
      </button>
    </DropdownMenu.Item>
  );
}
