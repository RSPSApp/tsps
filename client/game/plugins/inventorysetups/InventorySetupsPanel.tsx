import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { InventorySetup, InventorySetupsPlugin } from "./InventorySetupsPlugin";

const EQUIPMENT_SLOTS = ["Head", "Cape", "Amulet", "Weapon", "Body", "Shield", "", "Legs", "Hair", "Hands", "Feet", "Jaw", "Ring", "Ammo"];

export function InventorySetupsPanel({ plugin }: { plugin: InventorySetupsPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [name, setName] = useState("");
    const setup = state.setups.find((candidate) => candidate.id === state.selectedId);
    const itemName = useCallback((itemId: number) => {
        try { return plugin.getClient().objTypeLoader?.load?.(itemId)?.name || `Item ${itemId}`; }
        catch { return `Item ${itemId}`; }
    }, [plugin]);

    const bankCounts = plugin.getBankCounts();
    const bankOpen = plugin.isBankOpen();

    return (
        <div className="rl-sidebar-panel-content" style={{ padding: 10, overflow: "auto" }}>
            <strong>Inventory setups</strong>
            <div style={{ display: "flex", gap: 5, margin: "9px 0" }}>
                <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { plugin.saveCurrent(name); setName(""); } }}
                    placeholder="Setup name"
                    aria-label="Setup name"
                    style={{ minWidth: 0, flex: 1 }}
                />
                <button type="button" onClick={() => { plugin.saveCurrent(name); setName(""); }} disabled={!name.trim()}>
                    Save current
                </button>
            </div>
            {state.setups.length > 0 && (
                <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                    <select aria-label="Select inventory setup" value={state.selectedId} onChange={(event) => plugin.selectSetup(event.target.value)} style={{ minWidth: 0, flex: 1 }}>
                        {state.setups.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                    {setup && <button type="button" onClick={() => plugin.deleteSetup(setup.id)} title={`Delete ${setup.name}`}>Delete</button>}
                </div>
            )}
            {!setup ? (
                <p style={{ opacity: 0.7, lineHeight: 1.45 }}>Save your current inventory and equipment to create your first setup. Saving a name again updates that setup.</p>
            ) : (
                <SetupDetails setup={setup} plugin={plugin} itemName={itemName} bankCounts={bankCounts} bankOpen={bankOpen} />
            )}
        </div>
    );
}

function SetupDetails({
    setup,
    plugin,
    itemName,
    bankCounts,
    bankOpen,
}: {
    setup: InventorySetup;
    plugin: InventorySetupsPlugin;
    itemName(itemId: number): string;
    bankCounts: Map<number, number>;
    bankOpen: boolean;
}): JSX.Element {
    const currentInventory = plugin.getCurrentInventory();
    const currentEquipment = plugin.getCurrentEquipment();
    const inventoryCounts = counts(currentInventory);
    const currentOwnedCounts = new Map(inventoryCounts);
    for (const slot of currentEquipment) if (slot.itemId >= 0) currentOwnedCounts.set(slot.itemId, (currentOwnedCounts.get(slot.itemId) ?? 0) + Math.max(1, slot.quantity));

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.7, fontSize: 11, marginBottom: 8 }}>
                <span>{setup.inventory.length} inventory slots · {setup.equipment.length} equipment slots</span>
                <span>{bankOpen ? "Bank open" : "Open bank for availability"}</span>
            </div>
            <Section title="Equipment">
                {setup.equipment.length === 0 ? <EmptyLine text="No equipment saved" /> : setup.equipment.slice().sort((a, b) => a.slot - b.slot).map((required) => {
                    const current = currentEquipment[required.slot];
                    const currentQuantity = current?.itemId === required.itemId ? Math.max(0, current.quantity) : 0;
                    const missingEquipped = Math.max(0, required.quantity - currentQuantity);
                    const ready = current?.itemId === required.itemId && missingEquipped === 0;
                    const inInventory = (inventoryCounts.get(required.itemId) ?? 0) >= required.quantity;
                    const inBank = (bankCounts.get(required.itemId) ?? 0) >= required.quantity;
                    const equippedElsewhere = !ready && currentEquipment.some((slot, index) => index !== required.slot && slot.itemId === required.itemId);
                    const status = ready ? "Equipped" : current?.itemId === required.itemId ? `Need ${missingEquipped} more` : equippedElsewhere ? "Equipped elsewhere" : inInventory ? "In inventory" : bankOpen && inBank ? "In bank" : bankOpen ? "Missing" : "";
                    return <SetupRow key={`${required.slot}-${required.itemId}`} label={EQUIPMENT_SLOTS[required.slot] || `Slot ${required.slot + 1}`} name={itemName(required.itemId)} status={status} ready={ready} />;
                })}
            </Section>
            <Section title="Inventory">
                {setup.inventory.length === 0 ? <EmptyLine text="No inventory items saved" /> : setup.inventory.slice().sort((a, b) => a.slot - b.slot).map((required) => {
                    const current = currentInventory[required.slot];
                    const ready = current?.itemId === required.itemId && current.quantity >= required.quantity;
                    const held = inventoryCounts.get(required.itemId) ?? 0;
                    const missing = Math.max(0, required.quantity - held);
                    const bank = bankCounts.get(required.itemId) ?? 0;
                    const inAnotherSlot = !ready && currentInventory.some((slot, index) => index !== required.slot && slot.itemId === required.itemId);
                    const status = ready ? "Ready" : inAnotherSlot ? "Move to slot" : missing === 0 ? "Wrong amount" : bankOpen ? (bank >= missing ? `Bank: ${bank}` : `Need ${missing - bank}`) : `Need ${missing}`;
                    return <SetupRow key={`${required.slot}-${required.itemId}`} label={`Slot ${required.slot + 1}`} name={`${itemName(required.itemId)}${required.quantity > 1 ? ` × ${required.quantity}` : ""}`} status={status} ready={ready} />;
                })}
            </Section>
            {bankOpen && <BankSummary setup={setup} bankCounts={bankCounts} currentOwnedCounts={currentOwnedCounts} itemName={itemName} />}
            <p style={{ opacity: 0.6, fontSize: 11, lineHeight: 1.4, marginTop: 12 }}>This panel saves and compares setups; equip and withdraw items through the normal game interfaces.</p>
        </div>
    );
}

function BankSummary({ setup, bankCounts, currentOwnedCounts, itemName }: {
    setup: InventorySetup; bankCounts: Map<number, number>; currentOwnedCounts: Map<number, number>; itemName(itemId: number): string;
}): JSX.Element {
    const required = new Map<number, number>();
    for (const slot of [...setup.inventory, ...setup.equipment]) required.set(slot.itemId, (required.get(slot.itemId) ?? 0) + slot.quantity);
    const shortages = [...required].flatMap(([id, quantity]) => {
        const needed = Math.max(0, quantity - (currentOwnedCounts.get(id) ?? 0));
        const bank = bankCounts.get(id) ?? 0;
        return needed > bank ? [{ id, amount: needed - bank }] : [];
    });
    if (shortages.length === 0) return <p style={{ color: "#9fce8d", fontSize: 12 }}>All required items are on hand or in your bank.</p>;
    return <div style={{ marginTop: 10 }}><strong style={{ fontSize: 12 }}>Still missing</strong>{shortages.map(({ id, amount }) => <div key={id} style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>{itemName(id)} × {amount}</div>)}</div>;
}

function counts(slots: readonly { itemId: number; quantity: number }[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const slot of slots) if (slot.itemId >= 0 && slot.quantity > 0) result.set(slot.itemId, (result.get(slot.itemId) ?? 0) + slot.quantity);
    return result;
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
    return <section style={{ marginTop: 11 }}><strong style={{ display: "block", marginBottom: 4 }}>{title}</strong><div style={{ display: "grid", gap: 3 }}>{children}</div></section>;
}

function SetupRow({ label, name, status, ready }: { label: string; name: string; status: string; ready: boolean }): JSX.Element {
    return <div style={{ display: "grid", gridTemplateColumns: "68px minmax(0,1fr) auto", gap: 6, alignItems: "baseline", fontSize: 12 }}>
        <span style={{ opacity: 0.65 }}>{label}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>{name}</span>
        <span style={{ color: ready ? "#9fce8d" : "#e6b76b", whiteSpace: "nowrap" }}>{status}</span>
    </div>;
}

function EmptyLine({ text }: { text: string }): JSX.Element {
    return <span style={{ opacity: 0.6, fontSize: 12 }}>{text}</span>;
}

function SetupIcon({ label }: { label: string }): JSX.Element {
    return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
        <path d="M7 4h10l2 3v13H5V7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 4v5h8V4M9 13h6M9 16h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>;
}

export function createInventorySetupsNavigationButton(plugin: InventorySetupsPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Inventory Setups")
        .icon(SetupIcon)
        .priority(9)
        .panel(() => <InventorySetupsPanel plugin={plugin} />)
        .build();
}
