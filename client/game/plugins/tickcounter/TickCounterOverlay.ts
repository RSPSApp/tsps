import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { TickCounterPlugin } from "./TickCounterPlugin";

type Rect = { x: number; y: number; w: number; h: number };
type Rgba = [number, number, number, number];

const HEIGHT = 18;
const BACKGROUND: Rgba = [1, 1, 1, 0.96];
const TEXT = 0x0000a0;

/** The compact number badge, positioned over the chatbox like the RuneLite tick counter. */
export class TickCounterOverlay implements WidgetOverlay {
    readonly movable = { name: "TickCounterOverlay", position: OverlayPosition.ABOVE_CHATBOX_RIGHT };

    constructor(private readonly plugin: TickCounterPlugin) {}

    signature(): string {
        const tick = this.plugin.getVisibleTick();
        return tick === undefined ? "" : `${tick}/${this.plugin.getTicksPerCycle()}`;
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const tick = this.plugin.getVisibleTick();
        if (tick === undefined) return [];

        const width = Math.max(16, String(this.plugin.getTicksPerCycle()).length * 8 + 8);
        const at = context.place(this, width, HEIGHT);
        if (!at) return [];

        const rect = { x: at.x, y: at.y, w: width * at.scaleX, h: HEIGHT * at.scaleY };
        context.renderer.drawRect(rect.x, rect.y, rect.w, rect.h, BACKGROUND);
        drawTextGL(
            context.renderer,
            context.fontLoader,
            String(tick),
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            FONT_PLAIN_11,
            TEXT,
            1,
            1,
            false,
            1,
            undefined,
            at.scaleX,
            at.scaleY,
        );
        return [rect];
    }
}
