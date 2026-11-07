/*
 * Copyright (c) 2018, Seth <http://github.com/sethtroll>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite's ClueScrollConfig.IdentificationMode: when a clue in the inventory becomes the active clue. */
export const IdentificationMode = { ON_READ: "ON_READ", IF_INACTIVE: "IF_INACTIVE", ON_PICKUP: "ON_PICKUP" } as const;
export type IdentificationMode = keyof typeof IdentificationMode;

/** RuneLite 1.13.6 ClueScrollConfig: group, keys, names and defaults as in RuneLite. */
export const ClueScrollConfig = ConfigGroup("cluescroll", {
    displayHintArrows: ConfigItem({
        keyName: "displayHintArrows",
        name: "Display hint arrows",
        description: "Configures whether or not to display hint arrows for clues.",
        default: true,
    }),
    identify: ConfigItem<string>({
        keyName: "identify",
        name: "Identify",
        description: "Identify clue scrolls when read, picked up, or always on pickup. Does not work for beginner or master clues.",
        enum: IdentificationMode,
        default: "ON_READ",
    }),
});

/** RuneLite's ClueScrollConfig.GROUP. */
export const CLUE_SCROLL_CONFIG_GROUP = "cluescroll";
