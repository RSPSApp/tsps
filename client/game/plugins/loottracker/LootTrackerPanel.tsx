import { useCallback, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { LootTrackerPlugin } from "./LootTrackerPlugin";

const formatCoins = (amount: number) => {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}m`;
    if (amount >= 10_000) return `${Math.round(amount / 1000)}k`;
    return Math.round(amount).toLocaleString();
};

export function LootTrackerPanel({ plugin }: { plugin: LootTrackerPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const items = [...state.items].sort((a, b) => b.quantity * b.unitPrice - a.quantity * a.unitPrice || a.name.localeCompare(b.name));
    const totalQuantity = state.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = state.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    return (
        <div className="rl-sidebar-panel-content" style={{ padding: 10, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <strong>Loot tracker</strong>
                <button type="button" onClick={() => plugin.clear()} title="Clear tracked loot" disabled={items.length === 0}>Clear</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                <Summary label="Items" value={totalQuantity.toLocaleString()} />
                <Summary label="Est. GE value" value={`${formatCoins(totalValue)} gp`} />
            </div>
            {items.length === 0 ? (
                <p style={{ opacity: 0.75, lineHeight: 1.45 }}>Personal ground drops will appear here while the plugin is enabled.</p>
            ) : (
                <div style={{ display: "grid", gap: 5 }}>
                    {items.map((item) => (
                        <div key={item.itemId} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #ffffff18", padding: "5px 0" }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.name}>
                                {item.name}{item.quantity > 1 ? ` × ${item.quantity.toLocaleString()}` : ""}
                            </span>
                            <span style={{ whiteSpace: "nowrap", opacity: 0.8 }}>
                                {item.unitPrice > 0 ? `${formatCoins(item.unitPrice * item.quantity)} gp` : "—"}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            <p style={{ opacity: 0.6, fontSize: 11, marginTop: 12 }}>Uses guide prices when available, with the cache price as a fallback.</p>
        </div>
    );
}

function Summary({ label, value }: { label: string; value: string }): JSX.Element {
    return <div style={{ background: "#ffffff0a", borderRadius: 4, padding: 7 }}><div style={{ opacity: 0.65, fontSize: 11 }}>{label}</div><strong>{value}</strong></div>;
}

function LootIcon({ label }: { label: string }): JSX.Element {
    return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
        <path d="M4 8.5 12 4l8 4.5v10L12 23l-8-4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M4.4 8.7 12 13l7.6-4.3M12 13v9M8 6.3l8 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>;
}

export function createLootTrackerNavigationButton(plugin: LootTrackerPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Loot Tracker")
        .icon(LootIcon)
        .priority(8)
        .panel(() => <LootTrackerPanel plugin={plugin} />)
        .build();
}
