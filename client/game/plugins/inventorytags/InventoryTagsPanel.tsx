import React, { useCallback, useState, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { InventoryTagsPlugin } from "./InventoryTagsPlugin";

export function InventoryTagsPanel({ plugin }: { plugin: InventoryTagsPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const snapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, snapshot, snapshot);
    const [name, setName] = useState("");
    const [color, setColor] = useState("#ff9900");
    const [ids, setIds] = useState("");
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<{ index: number; original: string }>();
    const resetForm = () => {
        setName(""); setIds(""); setError(""); setEditing(undefined);
    };
    const remove = (index: number) => {
        plugin.setGroups(state.groups.filter((_, at) => at !== index));
        if (editing?.index === index) resetForm();
        else if (editing && index < editing.index) setEditing({ ...editing, index: editing.index - 1 });
    };
    const save = (event: React.FormEvent) => {
        event.preventDefault();
        try {
            if (!ids.trim()) throw new Error("Enter at least one item ID.");
            const tokens = ids.trim().split(/[\s,]+/);
            if (tokens.some(token => !token)) throw new Error("Enter an item ID before and after each comma.");
            const group = { name, color, itemIds: tokens.map(Number) };
            if (editing) {
                if (JSON.stringify(state.groups[editing.index]) !== editing.original) {
                    throw new Error("This group changed or was removed. Choose Edit again before saving.");
                }
                const groups = [...state.groups];
                groups[editing.index] = group;
                plugin.setGroups(groups);
            } else {
                plugin.setGroups([...state.groups.filter(existing => existing.name !== name.trim()), group]);
            }
            resetForm();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the item group."); }
    };
    return <div className="rl-sidebar-panel-content">
        <h3>Inventory Tags</h3>
        <p>Group items by their exact item IDs. Choose Edit to change a group.</p>
        {(error || state.error) && <p role="alert">{error || state.error}</p>}
        {state.groups.map((group, index) => <section key={index} style={{ borderLeft: `4px solid ${group.color}`, padding: 8 }}>
            <strong>{group.name}</strong><p>{group.itemIds.join(", ")}</p>
            <button onClick={() => { setEditing({ index, original: JSON.stringify(group) }); setName(group.name); setColor(group.color); setIds(group.itemIds.join(", ")); setError(""); }}>Edit</button>{" "}
            <button aria-label={`Remove ${group.name}`} onClick={() => remove(index)}>Remove</button>
        </section>)}
        <form onSubmit={save}>
            <p><label>Group name<input aria-label="Group name" value={name} onChange={(event) => setName(event.target.value)} required style={{ width: "100%" }} /></label></p>
            <p><label>Colour <input aria-label="Group colour" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label></p>
            <p><label>Item IDs<textarea aria-label="Item IDs" value={ids} onChange={(event) => setIds(event.target.value)} placeholder="4151, 11840" required style={{ width: "100%" }} /></label></p>
            <button type="submit">Save group</button>
        </form>
    </div>;
}
function TagIcon({ label }: { label: string }): JSX.Element {
    return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}><path d="M3 3H12L22 13L13 22L3 12Z" /><circle cx="8" cy="8" r="1.5" /></svg>;
}
export function createInventoryTagsNavigationButton(plugin: InventoryTagsPlugin): NavigationButton {
    return NavigationButton.builder().tooltip("Inventory Tags").icon(TagIcon).priority(6).panel(() => <InventoryTagsPanel plugin={plugin} />).build();
}
