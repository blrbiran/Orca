/**
 * The panel's one modal dialog (tester round 2026-10-28, human ruling "Radix first"): a Radix dialog in a portal over a
 * dimmed page, named by its h2 title, trapping focus, closing on Escape, the overlay or its Close button, and returning
 * focus to the button that opened it. Inline confirmations stay inline boxes (DESIGN.md "Confirmations"), not this.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { JSX, ReactElement, ReactNode } from "react";

export function Dialog(props: { trigger: ReactElement; title: string; closeLabel: string; children: ReactNode }): JSX.Element {
  return (
    <RadixDialog.Root>
      <RadixDialog.Trigger asChild>{props.trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        {/* aria-describedby={undefined}: the body is a list, not one description sentence (Radix asks for either). */}
        <RadixDialog.Content aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 m-0 max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line-strong bg-card p-5 text-fg shadow-float">
          <RadixDialog.Title className="mb-2 text-xl">{props.title}</RadixDialog.Title>
          {props.children}
          <RadixDialog.Close asChild><button type="button">{props.closeLabel}</button></RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
