// @vitest-environment jsdom
/**
 * The shared picker (spec 2026-10-29-radix-select-everywhere-design.md §2, §3, §4; session b999cc81). Every native
 * <select> in the panel moves onto this one component, so what a native select gave for free -- an "All" option that
 * reads "All", a disabled option nobody can pick, a value that posts with its form, a name from the wrapping label, a
 * red edge when invalid -- has to hold here, or it breaks on every page at once.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "../src/ui/Select.js";
import { optionsOf, pickOption } from "./selectControl.js";

afterEach(() => cleanup());

const OPTIONS: SelectOption[] = [{ value: "", label: "All" }, { value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];

/** A caller that keeps the value in its own state, as every page does, and reports what reached it. */
function Picker(props: { start: string; options: readonly SelectOption[]; seen?: (value: string) => void; name?: string; placeholder?: string }): JSX.Element {
  const [value, setValue] = useState(props.start);
  const onValueChange = (next: string): void => { props.seen?.(next); setValue(next); };
  return props.name === undefined
    ? <Select aria-label="Repository" value={value} options={props.options} onValueChange={onValueChange} placeholder={props.placeholder} />
    : <Select aria-label="Repository" name={props.name} value={value} options={props.options} onValueChange={onValueChange} placeholder={props.placeholder} />;
}

// The type refuses `name` with an option literal "": Radix's hidden native select would post the internal sentinel.
// @ts-expect-error -- the sentinel would reach the form's reader
export const refused = (): JSX.Element => <Select name="x" value="" options={[{ value: "", label: "All" }]} onValueChange={() => {}} />;
export const allowed = (): JSX.Element => <Select name="x" value="a" options={[{ value: "a", label: "Alpha" }]} onValueChange={() => {}} />;

describe("the shared Select", () => {
  it("shows an empty-valued option by its own label and hands back \"\" (an \"All\" filter must read All, not a blank placeholder)", async () => {
    // mutation: drop the EMPTY mapping -> Radix treats "" as no value and shows the placeholder, red
    const seen = vi.fn();
    render(<Picker start="a" options={OPTIONS} seen={seen} placeholder="Choose…" />);
    const trigger = screen.getByRole("combobox", { name: "Repository" });
    await pickOption(trigger, "All");
    expect(seen).toHaveBeenLastCalledWith("");
    expect(trigger.textContent).toContain("All");
    expect(trigger.textContent).not.toContain("Choose…");
    expect(trigger.hasAttribute("data-placeholder")).toBe(false);
  });

  it("refuses a disabled option (a placeholder like \"Pick a repository\" must never become the value)", async () => {
    // mutation: drop the `disabled` passthrough on the item -> Enter chooses it, red
    const seen = vi.fn();
    render(<Picker start="a" options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }]} seen={seen} />);
    const trigger = screen.getByRole("combobox", { name: "Repository" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "Beta" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(seen).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("Alpha");
  });

  it("posts the chosen value with its form under `name` (ChainPanel reads its repository from FormData)", async () => {
    // mutation: drop `name` from the Root -> FormData has no entry, red
    const { container } = render(<form><Picker start="a" options={OPTIONS.slice(1)} name="repoKey" /></form>);
    await pickOption(screen.getByRole("combobox", { name: "Repository" }), "Beta");
    const form = container.querySelector("form");
    if (form === null) throw new Error("no form");
    expect(new FormData(form).get("repoKey")).toBe("b");
  });

  it("is named by a wrapping <label>, so a screen reader announces which picker it is", () => {
    // mutation: wrap the trigger in an aria-hidden span -> no combobox named Project, red
    render(<label>Project<Select value="a" options={OPTIONS} onValueChange={() => {}} /></label>);
    expect(screen.getByRole("combobox", { name: /^Project/ })).toBeTruthy();
  });

  it("draws the danger edge when the caller marks it invalid (AgentFields flags a bad choice this way)", () => {
    // mutation: drop aria-[invalid=true]:border-danger -> an invalid picker looks valid, red
    render(<Select aria-label="Model" aria-invalid value="a" options={OPTIONS} onValueChange={() => {}} />);
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.className.split(/\s+/)).toContain("aria-[invalid=true]:border-danger");
  });

  it("shows a value that is not among the options as the placeholder, with nothing chosen and nothing posted (human ruling (a): what is shown is what is sent)", async () => {
    // mutation: hand Radix the unknown value instead of "" -> the trigger is blank without the placeholder, red
    const { container } = render(<form><Picker start="zzz" options={OPTIONS.slice(1)} name="answer" placeholder="Choose…" /></form>);
    const trigger = screen.getByRole("combobox", { name: "Repository" });
    expect(trigger.textContent).toContain("Choose…");
    expect(trigger.hasAttribute("data-placeholder")).toBe(true);
    const form = container.querySelector("form");
    if (form === null) throw new Error("no form");
    expect(new FormData(form).get("answer") ?? "").toBe("");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    await screen.findByRole("listbox");
    for (const option of screen.getAllByRole("option")) expect(option.getAttribute("data-state")).toBe("unchecked");
  });

  it("reports the offered options in order with their disabled state, by name without the ✓ (criteria about the list read it)", async () => {
    // mutation: the helper reads textContent -> the chosen option reads "✓Gamma", red
    render(<Picker start="c" options={[{ value: "c", label: "Gamma" }, { value: "a", label: "Alpha", disabled: true }, { value: "b", label: "Beta" }]} />);
    const trigger = screen.getByRole("combobox", { name: "Repository" });
    expect(await optionsOf(trigger)).toEqual([["Gamma", false], ["Alpha", true], ["Beta", false]]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
