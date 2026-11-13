/**
 * Tester #306: Import a plan is an item of the Tasks page's secondary "New" menu (beside Start a flow), no longer a
 * button of its own. These open it the way a person does: the New button, then the menu item.
 */
import { fireEvent, screen, within } from "@testing-library/react";

export function openImportMenu(zh = false): void {
  fireEvent.click(screen.getByRole("button", { name: zh ? "新建" : "New" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: zh ? "导入计划…" : "Import a plan…" }));
}

export async function findAndOpenImportMenu(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "New" }));
  fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Import a plan…" }));
}
