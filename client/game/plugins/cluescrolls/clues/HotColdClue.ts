/*
 * Copyright (c) 2018, Eadgars Ruse <https://github.com/Eadgars-Ruse>
 * Copyright (c) 2019, Jordan Atwood <nightfirecat@protonmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as ItemID from "@runelite/api/gameval/ItemID";
import { LineComponent } from "@runelite/client/ui/overlay/components/LineComponent";
import type { PanelComponent } from "@runelite/client/ui/overlay/components/PanelComponent";
import { TitleComponent } from "@runelite/client/ui/overlay/components/TitleComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { IMAGE_Z_OFFSET, TITLED_CONTENT_COLOR } from "../ClueScrollColors";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";
import { ClueScroll } from "./ClueScroll";
import type { LocationClueScroll, LocationsClueScroll, NpcClueScroll } from "./ClueScrollTypes";
import type { HotColdArea } from "./hotcold/HotColdArea";
import { HotColdLocation } from "./hotcold/HotColdLocation";
import { HotColdSolver } from "./hotcold/HotColdSolver";
import { HotColdTemperature } from "./hotcold/HotColdTemperature";
import { HotColdTemperatureChange } from "./hotcold/HotColdTemperatureChange";

const LEAGUE_TUTOR_CLUE_TEXT = "Buried beneath the ground, who knows where it's found. The League Tutor may have a strange device lying around.";

/**
 * The beginner and master hot-cold clues (RuneLite's HotColdClue): who gives the strange device,
 * then every device reading narrows the dig spots until it shakes.
 */
export class HotColdClue extends ClueScroll implements LocationClueScroll, LocationsClueScroll, NpcClueScroll {
    private hotColdSolver!: HotColdSolver;
    private location: WorldPoint | null = null;

    private constructor(
        private readonly text: string,
        private readonly npc: string,
        private readonly solution: string,
        private readonly npcLocation: WorldPoint,
        private readonly beginner: boolean,
    ) {
        super();
        this.setRequiresSpade(true);
        this.initializeSolver();
    }

    private static readonly BEGINNER_CLUE = new HotColdClue(
        "Buried beneath the ground, who knows where it's found. Lucky for you, A man called Reldo may have a clue.",
        "Reldo",
        "Speak to Reldo to receive a strange device.",
        new WorldPoint(3211, 3494, 0),
        true,
    );
    private static readonly MASTER_CLUE = new HotColdClue(
        "Buried beneath the ground, who knows where it's found. Lucky for you, A man called Jorral may have a clue.",
        "Jorral",
        "Speak to Jorral to receive a strange device.",
        new WorldPoint(2436, 3347, 0),
        false,
    );
    private static readonly LEAGUE_TUTOR_BEGINNER_CLUE = new HotColdClue(LEAGUE_TUTOR_CLUE_TEXT, "Leagues Tutor", "Speak to Leagues Tutor to receive a strange device.", new WorldPoint(1500, 5596, 0), true);
    private static readonly LEAGUE_TUTOR_MASTER_CLUE = new HotColdClue(LEAGUE_TUTOR_CLUE_TEXT, "Leagues Tutor", "Speak to Leagues Tutor to receive a strange device.", new WorldPoint(1500, 5596, 0), false);

    /** The clue for a scroll's text; the shared instance is reset for the new trail. */
    static forText(text: string, clueItemId: number): HotColdClue | null {
        const lower = text.toLowerCase();
        if (lower === HotColdClue.BEGINNER_CLUE.text.toLowerCase()) {
            HotColdClue.BEGINNER_CLUE.reset();
            return HotColdClue.BEGINNER_CLUE;
        }
        if (lower === HotColdClue.MASTER_CLUE.text.toLowerCase()) {
            HotColdClue.MASTER_CLUE.reset();
            return HotColdClue.MASTER_CLUE;
        }
        if (lower === LEAGUE_TUTOR_CLUE_TEXT.toLowerCase()) {
            if (clueItemId === ItemID.TRAIL_CLUE_BEGINNER) {
                HotColdClue.LEAGUE_TUTOR_BEGINNER_CLUE.reset();
                return HotColdClue.LEAGUE_TUTOR_BEGINNER_CLUE;
            }
            if (clueItemId === ItemID.TRAIL_CLUE_MASTER) {
                HotColdClue.LEAGUE_TUTOR_MASTER_CLUE.reset();
                return HotColdClue.LEAGUE_TUTOR_MASTER_CLUE;
            }
        }
        return null;
    }

    getText(): string {
        return this.text;
    }

    getNpc(): string {
        return this.npc;
    }

    getSolution(): string {
        return this.solution;
    }

    isBeginner(): boolean {
        return this.beginner;
    }

    getLocation(_plugin: ClueScrollPlugin): WorldPoint | null {
        return this.location;
    }

    getLocations(_plugin: ClueScrollPlugin): WorldPoint[] {
        if (this.hotColdSolver.getLastWorldPoint() === null) return [this.npcLocation];
        return [...this.hotColdSolver.getPossibleLocations()].map((location) => location.getWorldPoint());
    }

    makeOverlayHint(panelComponent: PanelComponent, _plugin: ClueScrollPlugin): void {
        panelComponent.getChildren().push(TitleComponent.builder().text("Hot/Cold Clue").build());
        if (this.hotColdSolver.getLastWorldPoint() === null && this.location === null) {
            // The strange device has not been used yet: say how to get it.
            panelComponent.getChildren().push(LineComponent.builder().left("NPC:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.npc).leftColor(TITLED_CONTENT_COLOR).build());
            panelComponent.getChildren().push(LineComponent.builder().left("Solution:").build());
            panelComponent.getChildren().push(LineComponent.builder().left(this.solution).leftColor(TITLED_CONTENT_COLOR).build());
            return;
        }
        // The device has been used: the possible dig spots, by area.
        panelComponent.getChildren().push(LineComponent.builder().left("Possible locations:").build());
        const digLocations = this.hotColdSolver.getPossibleLocations();
        const counts = new Map<HotColdArea, number>();
        for (const digLocation of digLocations) counts.set(digLocation.getHotColdArea(), (counts.get(digLocation.getHotColdArea()) ?? 0) + 1);
        if (digLocations.size > 10) {
            for (const [area, count] of counts) {
                panelComponent.getChildren().push(LineComponent.builder().left(area.getName()).right(String(count)).build());
            }
            return;
        }
        for (const area of counts.keys()) {
            panelComponent.getChildren().push(LineComponent.builder().left(`${area.getName()}:`).build());
            for (const digLocation of digLocations) {
                if (digLocation.getHotColdArea() !== area) continue;
                panelComponent.getChildren().push(LineComponent.builder().left(`- ${digLocation.getArea()}`).leftColor(Color.LIGHT_GRAY).build());
                const enemy = digLocation.getEnemy();
                if (digLocations.size <= 5 && enemy) {
                    panelComponent.getChildren().push(LineComponent.builder().left(enemy.getText()).leftColor(Color.YELLOW).build());
                }
            }
        }
    }

    makeWorldOverlayHint(graphics: Graphics2D, plugin: ClueScrollPlugin): void {
        const scene = plugin.osrsClient;
        // The final spot has been found.
        if (this.location !== null) {
            if (this.location.isInScene(plugin.getClient())) OverlayUtil.renderTileOverlay(scene, graphics, this.location, plugin.getSpadeImage(), Color.ORANGE);
            return;
        }
        // The device has not been used yet: show who gives it.
        if (this.hotColdSolver.getLastWorldPoint() === null) {
            for (const npc of plugin.getNpcsToMark()) {
                OverlayUtil.renderActorOverlayImage(scene, graphics, npc, plugin.getClueScrollImage(), Color.ORANGE, IMAGE_Z_OFFSET);
            }
        }
        // Under ten possible spots: mark them.
        const digLocations = this.hotColdSolver.getPossibleLocations();
        if (digLocations.size < 10) {
            for (const digLocation of digLocations) {
                const point = digLocation.getWorldPoint();
                if (!point.isInScene(plugin.getClient())) return;
                OverlayUtil.renderTileOverlay(scene, graphics, point, plugin.getSpadeImage(), Color.ORANGE);
            }
        }
    }

    /** Feeds a device message to the solver; true when it was a reading. */
    update(message: string, plugin: ClueScrollPlugin): boolean {
        const temperatureSet = this.beginner ? HotColdTemperature.BEGINNER_HOT_COLD_TEMPERATURES : HotColdTemperature.MASTER_HOT_COLD_TEMPERATURES;
        const temperature = HotColdTemperature.getFromTemperatureSet(temperatureSet, message);
        if (!temperature) return false;
        const player = plugin.getClient().getLocalPlayer();
        if (!player) return false;
        // From the real location to the overworld (Prifddinas's map copy).
        const localWorld = WorldPoint.getMirrorPoint(player.getWorldLocation(), true);
        if ((this.beginner && temperature === HotColdTemperature.BEGINNER_VISIBLY_SHAKING) || (!this.beginner && temperature === HotColdTemperature.MASTER_VISIBLY_SHAKING)) {
            this.markFinalSpot(localWorld);
        } else {
            this.location = null;
        }
        this.hotColdSolver.signal(localWorld, temperature, HotColdTemperatureChange.of(message));
        return true;
    }

    reset(): void {
        this.location = null;
        this.initializeSolver();
    }

    private initializeSolver(): void {
        this.hotColdSolver = new HotColdSolver(new Set(HotColdLocation.values().filter((location) => location.isBeginnerClue() === this.beginner)));
    }

    private markFinalSpot(point: WorldPoint): void {
        this.location = point;
    }

    getNpcs(_plugin: ClueScrollPlugin): Array<string | null> {
        return [this.npc];
    }
}
