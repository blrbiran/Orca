/**
 * Session b999cc81 (spec 2026-10-29-radix-select-everywhere-design.md §5 item 2): the agent pickers are the Radix
 * `Select` and carry no `name` (no form posts them), so criteria find them the way a person does -- by where they sit.
 */

/**
 * A SelectionFields layer (AgentFields.tsx) is found by its model box, which keeps `name="<prefix>:model"`; inside that
 * layer's fieldset the agent picker is the one combobox before the box, the context picker the one after it.
 */
export function agentField(root: ParentNode, prefix: string, field: "agent" | "context"): HTMLElement {
  const model = root.querySelector<HTMLInputElement>(`input[name="${prefix}:model"]`);
  const fieldset = model?.closest("fieldset");
  if (!model || !fieldset) throw new Error(`no agent fields for ${prefix}`);
  const found = [...fieldset.querySelectorAll<HTMLElement>('[role="combobox"]')]
    .filter((box) => ((box.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) === (field === "agent"));
  if (found.length !== 1) throw new Error(`${found.length} ${field} pickers for ${prefix}`);
  return found[0]!;
}

/** The settings page's default-agent picker (AgentSettings.tsx): the one combobox outside every layer's fieldset. */
export function defaultAgentField(root: ParentNode): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('[role="combobox"]')].filter((box) => box.closest("fieldset") === null);
  if (found.length !== 1) throw new Error(`${found.length} default-agent pickers`);
  return found[0]!;
}
