/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import * as ItemID from "@runelite/api/gameval/ItemID";
import { MenuAction } from "@runelite/api/MenuAction";
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { Dimension } from "@runelite/awt/Shapes";
import { ComponentConstants } from "@runelite/client/ui/overlay/components/ComponentConstants";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import { openConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import type { PluginClass } from "@runelite/client/plugins/Plugin";
import { OverlayPanel } from "@runelite/client/ui/overlay/OverlayPanel";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import type { OverlayMenuEntry } from "../ClientPluginManager";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import type { ItemRequirement } from "./clues/item/ItemRequirement";
import { any, item } from "./clues/item/ItemRequirements";

const HAS_SPADE: ItemRequirement = any("Spade",
    item(ItemID.SPADE),
    item(ItemID.EASTER23_SPADE));

const HAS_LIGHT: ItemRequirement = any("Light Source",
    item(ItemID.TORCH_LIT),
    item(ItemID.LIT_CANDLE),
    item(ItemID.LIT_BLACK_CANDLE),
    item(ItemID.CANDLE_LANTERN_LIT),
    item(ItemID.CANDLE_LANTERN_BLACK_LIT), // lit black candle lantern
    item(ItemID.OIL_LAMP_LIT),
    item(ItemID.OIL_LANTERN_LIT),
    item(ItemID.BULLSEYE_LANTERN_LIT),
    item(ItemID.TOG_SAPPHIRE_LANTERN_LIT),
    item(ItemID.BULLSEYE_LANTERN_LIT_LUNAR_QUEST),
    item(ItemID.CAVE_GOBLIN_MINING_HELMET_LIT),
    item(ItemID.SKILLCAPE_FIREMAKING),
    item(ItemID.SKILLCAPE_FIREMAKING_TRIMMED),
    item(ItemID.SEERS_HEADBAND_EASY),
    item(ItemID.SEERS_HEADBAND_MEDIUM),
    item(ItemID.SEERS_HEADBAND_HARD),
    item(ItemID.SEERS_HEADBAND_ELITE),
    item(ItemID.WINT_TORCH),
    item(ItemID.WINT_TORCH_OFFHAND),
    item(ItemID.SKILLCAPE_MAX),
    item(ItemID.SKILLCAPE_MAX_WORN),
    item(ItemID.ABYSSAL_LANTERN_NORMAL),
    item(ItemID.ABYSSAL_LANTERN_NORMAL_BLUE),
    item(ItemID.ABYSSAL_LANTERN_NORMAL_RED),
    item(ItemID.ABYSSAL_LANTERN_NORMAL_WHITE),
    item(ItemID.ABYSSAL_LANTERN_NORMAL_PURPLE),
    item(ItemID.ABYSSAL_LANTERN_NORMAL_GREEN),
    item(ItemID.ABYSSAL_LANTERN_OAK),
    item(ItemID.ABYSSAL_LANTERN_WILLOW),
    item(ItemID.ABYSSAL_LANTERN_MAPLE),
    item(ItemID.ABYSSAL_LANTERN_YEW),
    item(ItemID.ABYSSAL_LANTERN_BLISTERWOOD),
    item(ItemID.ABYSSAL_LANTERN_MAGIC),
    item(ItemID.ABYSSAL_LANTERN_REDWOOD),
    item(ItemID.LEAGUE_CLUE_COMPASS_TELEPORT));

/** The clue panel: the clue's hint, then spade, light and enemy warnings (RuneLite's ClueScrollOverlay). */
export class ClueScrollOverlay extends OverlayPanel {
    constructor(private readonly plugin: ClueScrollPlugin) {
        super("ClueScrollOverlay", OverlayPosition.TOP_LEFT);
        this.addMenuEntry(MenuAction.RUNELITE_OVERLAY_CONFIG, "Configure", "Clue Scroll overlay", () => openConfiguration(plugin.constructor as PluginClass));
        this.addMenuEntry(MenuAction.RUNELITE_OVERLAY, "Reset", "Clue Scroll overlay", () => plugin.resetClue(true));
    }

    /** The fixed entries plus the "Set note" entries for the active clue (RuneLite adds and removes those). */
    menuEntries(): OverlayMenuEntry[] {
        const notes = this.plugin.getNoteEntries().map((entry) => ({ option: entry.option, target: "Clue Scroll overlay", onClick: entry.onClick }));
        return [...super.menuEntries(), ...notes];
    }

    render(graphics: Graphics2D): Dimension | null {
        const clue = this.plugin.getClue();
        if (clue === null) return null;
        // Once a frame has drawn through the GL context, item images can be made.
        this.panelComponent.setPreferredSize({ width: ComponentConstants.STANDARD_WIDTH, height: 0 });
        clue.makeOverlayHint(this.panelComponent, this.plugin);

        const inventoryItems = this.plugin.getInventoryItems();
        const equippedItems = this.plugin.getEquippedItems();
        const client = this.plugin.getClient();

        if (clue.isRequiresSpade() && inventoryItems !== null) {
            if (!HAS_SPADE.fulfilledBy(inventoryItems)) {
                this.panelComponent.getChildren().push(LineComponent.builder().left("").build());
                this.panelComponent.getChildren().push(LineComponent.builder().left("Requires Spade!").leftColor(Color.RED).build());
            }
        }

        if (clue.isRequiresLight()
            && ((clue.getFirePitVarbitId() === -1 || client.getVarbitValue(clue.getFirePitVarbitId()) !== 1)
                && (inventoryItems === null || !HAS_LIGHT.fulfilledBy(inventoryItems))
                && (equippedItems === null || !HAS_LIGHT.fulfilledBy(equippedItems)))) {
            this.panelComponent.getChildren().push(LineComponent.builder().left("").build());
            this.panelComponent.getChildren().push(LineComponent.builder().left("Requires Light Source!").leftColor(Color.RED).build());
        }

        const enemy = clue.getEnemy();
        if (enemy !== null) {
            this.panelComponent.getChildren().push(LineComponent.builder().left("").build());
            this.panelComponent.getChildren().push(LineComponent.builder().left(enemy.getText()).leftColor(Color.YELLOW).build());
        }

        return super.render(graphics);
    }
}
