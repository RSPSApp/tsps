import { useCallback, useSyncExternalStore, type JSX } from "react";

import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { imageIcon, runeliteImage } from "@runelite/client/ui/runeliteImages";
import type { MenuSwapperPlugin } from "./MenuSwapperPlugin";
import type { MenuSwap, MenuSwapKind, MenuSwapperPresets } from "./types";

const PRESET_LABELS: ReadonlyArray<[keyof MenuSwapperPresets, string]> = [
    ["bank", "Bank: bankers and bank booths"],
    ["trade", "Trade: shopkeepers"],
    ["pickpocket", "Pickpocket"],
    ["shiftDrop", "Shift-click drop, every item"],
];

type SwapRow = { kind: MenuSwapKind; key: string; swap: MenuSwap };

function swapRows(swaps: Record<string, MenuSwap>, kind: MenuSwapKind): SwapRow[] {
    return Object.entries(swaps).map(([key, swap]) => ({ kind, key, swap }));
}

/** The Menu Entry Swapper's sidebar panel: presets, and the saved swaps with remove buttons. */
export function MenuSwapperPanel({ plugin }: { plugin: MenuSwapperPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const { config } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const rows = [...swapRows(config.swaps, "left"), ...swapRows(config.shiftSwaps, "shift")].sort(
        (a, b) => a.swap.name.localeCompare(b.swap.name),
    );

    return (
        <div className="rl-sidebar-panel-content rl-sidebar-scrollable">
            <p className="rl-sidebar-panel-copy">
                Hold Shift and right-click an NPC, object or item, then pick "Swap left click" or
                "Swap shift click". With a shop open, you can set an item's shift-click to a sell
                option such as Sell 50.
            </p>

            {PRESET_LABELS.map(([preset, label]) => (
                <label key={preset} className="rl-sidebar-check">
                    <input
                        type="checkbox"
                        checked={config.presets[preset]}
                        onChange={(event) =>
                            plugin.setConfig({
                                presets: { ...config.presets, [preset]: event.target.checked },
                            })
                        }
                    />
                    <span>{label}</span>
                </label>
            ))}

            <div className="rl-sidebar-panel-title">Your swaps</div>
            {rows.length === 0 && <p className="rl-sidebar-panel-copy">No swaps saved yet.</p>}
            {rows.map(({ kind, key, swap }) => (
                <div key={`${kind}:${key}`} className="rl-sidebar-plugin-toggle">
                    <span className="rl-sidebar-plugin-meta">
                        <span className="rl-sidebar-plugin-name">{swap.name || key}</span>
                        <span className="rl-sidebar-plugin-desc">
                            {kind === "left" ? "Left-click" : "Shift-click"}: {swap.option}
                        </span>
                    </span>
                    <button
                        type="button"
                        className="rl-sidebar-text-button"
                        onClick={() => plugin.setSwap(kind, key, null, swap.name)}
                    >
                        Remove
                    </button>
                </div>
            ))}
            {rows.length > 0 && (
                <button
                    type="button"
                    className="rl-sidebar-text-button"
                    onClick={() => plugin.resetSwaps()}
                >
                    Remove all swaps
                </button>
            )}
        </div>
    );
}

/** The Menu Entry Swapper's sidebar button. */
export function createMenuSwapperNavigationButton(plugin: MenuSwapperPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Menu Entry Swapper")
        .icon(imageIcon(runeliteImage("menu_swapper_icon.png")))
        .priority(5)
        .panel(() => <MenuSwapperPanel plugin={plugin} />)
        .build();
}
