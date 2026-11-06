/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { type Graphics2D, RecordingGraphics2D } from "@runelite/awt/Graphics2D";
import { type DrawnRect, GLGraphics2D } from "@runelite/client/ui/overlay/GLGraphics2D";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";

/** The metrics the signature pass measures with; content, not pixel layout, is what changes a frame. */
const SIGNATURE_METRICS = { stringWidth: (text: string) => text.length * 6, getHeight: () => 16 };

/**
 * A RuneLite `OverlayPosition.DYNAMIC` overlay on the client's overlay contract: `render` draws in
 * canvas pixels through a Graphics2D, as the Java does. `signature()` renders into a recording
 * with `live` false, so side effects (scrolling a list) happen only in the real draw.
 */
export abstract class ClueScrollDynamicOverlay implements WidgetOverlay {
    protected constructor(private readonly name: string) {}

    /** Draw the frame; `live` is false during the signature pass. */
    protected abstract render(graphics: Graphics2D, live: boolean): void;

    signature(): string {
        const recording = new RecordingGraphics2D(SIGNATURE_METRICS);
        this.render(recording, false);
        const signature = recording.signature();
        return signature === "[[],[],[],[],[]]" ? "" : `${this.name}:${signature}`;
    }

    draw(context: WidgetOverlayDrawContext): DrawnRect[] {
        const graphics = new GLGraphics2D(context, { x: 0, y: 0, scaleX: 1, scaleY: 1 }, "dynamic");
        this.render(graphics, true);
        return graphics.drawn;
    }
}
