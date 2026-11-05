/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import * as ItemID from "@runelite/api/gameval/ItemID";
import { runeliteImage } from "@runelite/client/ui/runeliteImages";

/**
 * The images the Clue Scroll overlays draw: RuneLite's emote.png and clue_arrow.png from
 * public/runelite/cluescrolls, and the clue scroll and spade item images from the item renderer.
 * Each loads once, on first request; a getter returns null until its image is ready.
 */
export class ClueScrollImages {
    private emoteCanvas: HTMLCanvasElement | null = null;
    private arrowCanvas: HTMLCanvasElement | null = null;
    private requested = new Set<string>();
    /** The item renderer, handed in by the overlay draw context (`itemImage`). */
    itemImage?: (itemId: number, quantity: number, outline: number) => HTMLCanvasElement | undefined;
    private clueScrollCanvas: HTMLCanvasElement | null = null;
    private spadeCanvas: HTMLCanvasElement | null = null;

    private load(file: string, onLoad: (canvas: HTMLCanvasElement) => void): void {
        if (this.requested.has(file) || typeof Image === "undefined" || typeof document === "undefined") return;
        this.requested.add(file);
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext("2d")?.drawImage(image, 0, 0);
            onLoad(canvas);
        };
        image.src = runeliteImage(file);
    }

    emote(): HTMLCanvasElement | null {
        if (!this.emoteCanvas) this.load("cluescrolls/emote.png", (canvas) => (this.emoteCanvas = canvas));
        return this.emoteCanvas;
    }

    mapArrow(): HTMLCanvasElement | null {
        if (!this.arrowCanvas) this.load("cluescrolls/clue_arrow.png", (canvas) => (this.arrowCanvas = canvas));
        return this.arrowCanvas;
    }

    /** ItemManager.getImage(TRAIL_CLUE_MASTER). */
    clueScroll(): HTMLCanvasElement | null {
        if (!this.clueScrollCanvas && this.itemImage) this.clueScrollCanvas = this.itemImage(ItemID.TRAIL_CLUE_MASTER, 1, 0) ?? null;
        return this.clueScrollCanvas;
    }

    /** ItemManager.getImage(SPADE). */
    spade(): HTMLCanvasElement | null {
        if (!this.spadeCanvas && this.itemImage) this.spadeCanvas = this.itemImage(ItemID.SPADE, 1, 0) ?? null;
        return this.spadeCanvas;
    }
}
