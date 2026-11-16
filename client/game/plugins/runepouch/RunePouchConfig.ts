/*
 * Ported from RuneLite's Rune Pouch plugin (RunepouchConfig).
 * Copyright (c) 2017, Tyler <https://github.com/tylerthardy>
 * Copyright (c) 2022, Adam <Adam@sigterm.info>
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** Where the pouch's contents show. */
export enum RunePouchOverlayMode {
    /** Only on the pouch's item. */
    INVENTORY = "INVENTORY",
    /** Only in a tooltip while the mouse is over the pouch. */
    MOUSE_HOVER = "MOUSE_HOVER",
    /** Both. */
    BOTH = "BOTH",
}

/** RuneLite's RunepouchConfig: group, keys and defaults as in RuneLite. */
export const RunePouchConfig = ConfigGroup("runepouch", {
    fontColor: ConfigItem({
        keyName: "fontcolor",
        name: "Font color",
        description: "Color of the font for the number of runes in pouch.",
        position: 1,
        color: true,
        default: 0xffffff00,
    }),
    runePouchOverlayMode: ConfigItem<RunePouchOverlayMode>({
        name: "Display mode",
        description: "Configures where rune pouch overlay is displayed.",
        position: 3,
        enum: RunePouchOverlayMode,
        enumLabels: { INVENTORY: "Inventory", MOUSE_HOVER: "Mouse hover", BOTH: "Both" },
        default: RunePouchOverlayMode.BOTH,
    }),
});
