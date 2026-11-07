/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import * as ObjectID from "@runelite/api/gameval/ObjectID";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { CLICKBOX_BORDER_COLOR, CLICKBOX_FILL_COLOR, CLICKBOX_HOVER_BORDER_COLOR, IMAGE_Z_OFFSET } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { worldPointHashCode } from "./ClueKeys";
import { ClueScroll } from "./ClueScroll";
import type { ObjectClueScroll } from "./ClueScrollTypes";

/** RuneLite's MapClue: a map of where to dig (or a crate to search), one clue item per map. */
export class MapClue extends ClueScroll implements ObjectClueScroll {
    static readonly CHAMPIONS_GUILD = "West of the Champions' Guild";
    static readonly VARROCK_EAST_MINE = "Outside Varrock East Mine";
    static readonly STANDING_STONES = "At the standing stones north of Falador";
    static readonly WIZARDS_TOWER_DIS = "On the south side of the Wizards' Tower (DIS)";
    static readonly SOUTH_OF_DRAYNOR_BANK = "South of Draynor Village Bank";

    private readonly itemId: number;
    private readonly location: WorldPoint;
    private readonly objectId: number;
    private readonly description: string | null;

    /** (item, tile, description) for a dig; (item, tile, object id, description) for a crate to search. */
    constructor(itemId: number, location: WorldPoint, objectIdOrDescription: number | string, description?: string) {
        super();
        this.itemId = itemId;
        this.location = location;
        if (typeof objectIdOrDescription === "number") {
            this.objectId = objectIdOrDescription;
            this.description = description ?? null;
        } else {
            this.objectId = -1;
            this.description = objectIdOrDescription;
        }
        this.setRequiresSpade(this.objectId === -1);
    }

    getItemId(): number {
        return this.itemId;
    }

    getObjectId(): number {
        return this.objectId;
    }

    getDescription(): string | null {
        return this.description;
    }

    getLocation(_plugin: ClueScrollPlugin): WorldPoint {
        return this.location;
    }

    makeOverlayHint(panelComponent: PanelComponent, plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Map Clue").build());
        panelComponent.getChildren().push(LineComponent.builder().left("Click the clue scroll along the edge of your world map to see your destination.").build());
        if (this.objectId !== -1) {
            const objectName = plugin.getClient().getObjectDefinition(this.objectId)?.getName() ?? "N/A";
            panelComponent.getChildren().push(LineComponent.builder().left(`Travel to the destination and click the ${objectName}.`).build());
        } else {
            panelComponent.getChildren().push(LineComponent.builder().left("Travel to the destination and dig on the marked tile.").build());
        }
        if (this.description !== null) {
            panelComponent.getChildren().push(LineComponent.builder().build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.description).build());
        }
        this.renderOverlayNote(panelComponent, plugin);
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        if (!this.location.isInScene(plugin.getClient())) return;
        const scene = plugin.osrsClient;
        if (this.objectId !== -1) {
            const mousePosition = plugin.getClient().getMouseCanvasPosition();
            for (const gameObject of plugin.getObjectsToMark()) {
                OverlayUtil.renderHoverableArea(graphics, gameObject.getClickbox(), mousePosition, CLICKBOX_FILL_COLOR, CLICKBOX_BORDER_COLOR, CLICKBOX_HOVER_BORDER_COLOR);
                OverlayUtil.renderImageLocationAt(scene, graphics, gameObject.getWorldLocation(), plugin.getClueScrollImage(), IMAGE_Z_OFFSET);
            }
        } else {
            OverlayUtil.renderTileOverlay(scene, graphics, this.location, plugin.getSpadeImage(), Color.ORANGE);
        }
    }

    static forItemId(itemId: number): MapClue | null {
        for (const clue of MapClue.CLUES) if (clue.itemId === itemId) return clue;
        return null;
    }

    getObjectIds(): number[] {
        return [this.objectId];
    }

    getConfigKeys(): number[] {
        return [worldPointHashCode(this.location)];
    }

    /** RuneLite 1.13.6's table, row for row (a module constant: the rows build instances of this class). */
    static get CLUES(): readonly MapClue[] {
        return MAP_CLUES;
    }
}

export const MAP_CLUES: readonly MapClue[] = [
        new MapClue(ItemID.TRAIL_EASY_MAP_EXP1, new WorldPoint(3300, 3291, 0), "Al Kharid mine"),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP001, new WorldPoint(3166, 3361, 0), MapClue.CHAMPIONS_GUILD),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP002, new WorldPoint(3290, 3374, 0), MapClue.VARROCK_EAST_MINE),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP003, new WorldPoint(3043, 3398, 0), MapClue.STANDING_STONES),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP004, new WorldPoint(2612, 3482, 0), "Brother Galahad's house, West of McGrubor's Wood."),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP005, new WorldPoint(3110, 3152, 0), MapClue.WIZARDS_TOWER_DIS),
        new MapClue(ItemID.TRAIL_CLUE_EASY_MAP006, new WorldPoint(2970, 3415, 0), "North of Falador."),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP001, new WorldPoint(3091, 3227, 0), MapClue.SOUTH_OF_DRAYNOR_BANK),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP003, new WorldPoint(2907, 3295, 0), "West of the Crafting Guild"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP004, new WorldPoint(2658, 3488, 0), ObjectID.CRATE2_OLD, "The crate in McGrubor's Wood. Fairy ring ALS"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP005, new WorldPoint(2651, 3231, 0), "North of the Tower of Life. Fairy ring DJP"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP006, new WorldPoint(2565, 3248, 0), ObjectID.CRATE2, "The crate west of the Clocktower."),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP007, new WorldPoint(2924, 3210, 0), "Behind the Chemist's house in Rimmington."),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP008, new WorldPoint(2536, 3865, 0), "Miscellania. Fairy ring CIP"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP009, new WorldPoint(3434, 3265, 0), "Mort Myre Swamp, west of Mort'ton. Fairy ring BIP"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP010, new WorldPoint(2454, 3230, 0), "At the entrance to the Ourania Cave."),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP011, new WorldPoint(2578, 3597, 0), "South-east of the Lighthouse. Fairy ring ALP"),
        new MapClue(ItemID.TRAIL_CLUE_MEDIUM_MAP012, new WorldPoint(2666, 3562, 0), "Between Seers' Village and Rellekka. South-west of Fairy ring CJR"),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP001, new WorldPoint(3309, 3503, 0), ObjectID.GERTRUDEEMPTY_CRATE, "A crate in the Lumber Yard, north-east of Varrock."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP002, new WorldPoint(2615, 3078, 0), "Yanille anvils, south of the bank. You can dig from inside the building."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP003, new WorldPoint(2488, 3308, 0), "In the western section of West Ardougne."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP004, new WorldPoint(2457, 3182, 0), ObjectID.ELEM_CRATE_1, "In a crate by the stairs to the Observatory Dungeon."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP005, new WorldPoint(3026, 3628, 0), ObjectID.CRATE2, "In a crate at the Dark Warriors' Fortress in level 14 Wilderness."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP006, new WorldPoint(3021, 3912, 0), "South-east of the Wilderness Agility Course in level 50 Wilderness."),
        new MapClue(ItemID.TRAIL_CLUE_HARD_MAP007, new WorldPoint(2722, 3338, 0), "South of the Legends' Guild. Fairy ring BLR"),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP1, new WorldPoint(2449, 3130, 0), "South-west of Tree Gnome Village."),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP2, new WorldPoint(2953, 9523, 1), "In the Mogre Camp, near Port Khazard. You require a Diving Apparatus and a Fishbowl Helmet"),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP3, new WorldPoint(2202, 3062, 0), "Zul-Andra. Fairy ring BJS"),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP4, new WorldPoint(1815, 3852, 0), "At the Soul Altar, north-east of the Arceuus essence mine."),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP5, new WorldPoint(3538, 3208, 0), "East of Burgh de Rott."),
        new MapClue(ItemID.TRAIL_ELITE_MAP_EXP6, new WorldPoint(2703, 2716, 0), ObjectID.MM_CRATE, "The crate in south-western Ape Atoll"),
        new MapClue(ItemID.CLUEQUEST_CLUE2, new WorldPoint(3203, 3213, 0), "Behind Lumbridge Castle, just outside the kitchen door"),
        new MapClue(ItemID.CLUEQUEST_CLUE3, new WorldPoint(3108, 3262, 0), "South-west of the wheat field east of Draynor Village.")
];
