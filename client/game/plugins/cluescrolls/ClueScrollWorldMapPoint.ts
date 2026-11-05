/*
 * Copyright (c) 2018, Morgan Lewis <https://github.com/MESLewis>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { WorldMapPoint } from "@runelite/client/ui/overlay/worldmap/WorldMapPoint";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";

/**
 * The clue's marker on the world map: RuneLite's clue arrow with the clue scroll drawn over it,
 * anchored at the arrow's tip; snapped to the map's edge it shows the plain clue scroll.
 */
export class ClueScrollWorldMapPoint extends WorldMapPoint {
    private readonly clueScrollWorldImage: HTMLCanvasElement | null;
    private readonly clueScrollWorldImagePoint: { x: number; y: number } | null;

    constructor(worldPoint: WorldPoint, private readonly plugin: ClueScrollPlugin) {
        super(worldPoint, null);
        const arrow = plugin.getMapArrow();
        const scroll = plugin.getClueScrollImage();
        this.clueScrollWorldImage = arrow ? compose(arrow, scroll) : scroll;
        this.clueScrollWorldImagePoint = this.clueScrollWorldImage ? { x: Math.trunc(this.clueScrollWorldImage.width / 2), y: this.clueScrollWorldImage.height } : null;
        this.setSnapToEdge(true);
        this.setJumpOnClick(true);
        this.setName("Clue Scroll");
        this.setImage(this.clueScrollWorldImage);
        this.setImagePoint(this.clueScrollWorldImagePoint);
    }

    onEdgeSnap(): void {
        this.setImage(this.plugin.getClueScrollImage());
        this.setImagePoint(null);
    }

    onEdgeUnsnap(): void {
        this.setImage(this.clueScrollWorldImage);
        this.setImagePoint(this.clueScrollWorldImagePoint);
    }
}

/** The arrow with the clue scroll drawn at its top left, as RuneLite composes the marker. */
function compose(arrow: HTMLCanvasElement, scroll: HTMLCanvasElement | null): HTMLCanvasElement | null {
    if (typeof document === "undefined") return arrow;
    const canvas = document.createElement("canvas");
    canvas.width = arrow.width;
    canvas.height = arrow.height;
    const context = canvas.getContext("2d");
    if (!context) return arrow;
    context.drawImage(arrow, 0, 0);
    if (scroll) context.drawImage(scroll, 0, 0);
    return canvas;
}
