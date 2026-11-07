/*
 * Copyright (c) 2019, Hydrox6 <ikada@protonmail.ch>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as InterfaceID from "@runelite/api/gameval/InterfaceID";
import type { LocationClueScroll } from "./ClueScrollTypes";
import { MapClue } from "./MapClue";

/**
 * RuneLite's BeginnerMapClue: beginner maps share one item id, so each is told apart by the
 * interface group that shows it.
 */
export class BeginnerMapClue extends MapClue implements LocationClueScroll {
    private constructor(
        private readonly widgetGroupID: number,
        location: WorldPoint,
        description: string,
    ) {
        super(-1, location, description);
        this.setRequiresSpade(true);
    }

    getWidgetGroupID(): number {
        return this.widgetGroupID;
    }

    static forWidgetID(widgetGroupID: number): BeginnerMapClue | null {
        for (const clue of BEGINNER_MAP_CLUES) if (clue.widgetGroupID === widgetGroupID) return clue;
        return null;
    }

    static get CLUES(): readonly BeginnerMapClue[] {
        return BEGINNER_MAP_CLUES;
    }

    /** RuneLite 1.13.6's table, row for row. */
    static readonly ROWS = (): readonly BeginnerMapClue[] => [
        new BeginnerMapClue(InterfaceID.TRAIL_MAP01, new WorldPoint(3167, 3360, 0), MapClue.CHAMPIONS_GUILD),
        new BeginnerMapClue(InterfaceID.TRAIL_MAP02, new WorldPoint(3290, 3373, 0), MapClue.VARROCK_EAST_MINE),
        new BeginnerMapClue(InterfaceID.TRAIL_MAP03, new WorldPoint(3092, 3226, 0), MapClue.SOUTH_OF_DRAYNOR_BANK),
        new BeginnerMapClue(InterfaceID.TRAIL_MAP06, new WorldPoint(3043, 3399, 0), MapClue.STANDING_STONES),
        new BeginnerMapClue(InterfaceID.TRAIL_MAP11, new WorldPoint(3109, 3153, 0), MapClue.WIZARDS_TOWER_DIS),
    ];
}

const BEGINNER_MAP_CLUES: readonly BeginnerMapClue[] = BeginnerMapClue.ROWS();
