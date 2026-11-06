import type { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";

type Rect = { x: number; y: number; w: number; h: number };

const BACKGROUND: [number, number, number, number] = [0.12, 0.1, 0.07, 0.94];
const BORDER: [number, number, number, number] = [0.62, 0.52, 0.34, 0.95];
const TITLE = 0xff981f;
const TEXT = 0xffffff;
const WIDTH = 264;
const PAD_X = 7;
const PAD_Y = 5;
const HEADER_HEIGHT = 16;
const LINE_HEIGHT = 14;

/** Small, movable panel shared by the skilling assistants. */
export class AssistantPanelOverlay implements WidgetOverlay {
    readonly movable: WidgetOverlay["movable"];

    constructor(
        name: string,
        position: OverlayPosition,
        private readonly title: string,
        private readonly rows: () => string[],
    ) {
        this.movable = { name, position };
    }

    signature(): string {
        const rows = this.rows();
        return rows.length ? `${this.title}\n${rows.join("\n")}` : "";
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const rows = this.rows();
        if (rows.length === 0) return [];

        const height = PAD_Y * 2 + HEADER_HEIGHT + rows.length * LINE_HEIGHT;
        const at = context.place(this, WIDTH, height);
        if (!at) return [];
        const { x, y, scaleX: sx, scaleY: sy } = at;
        const rect = { x, y, w: WIDTH * sx, h: height * sy };
        const renderer = context.renderer;

        renderer.drawRect(rect.x, rect.y, rect.w, rect.h, BACKGROUND);
        renderer.drawRect(rect.x, rect.y, rect.w, sy, BORDER);
        renderer.drawRect(rect.x, rect.y + rect.h - sy, rect.w, sy, BORDER);
        renderer.drawRect(rect.x, rect.y + sy, sx, rect.h - 2 * sy, BORDER);
        renderer.drawRect(rect.x + rect.w - sx, rect.y + sy, sx, rect.h - 2 * sy, BORDER);

        this.drawText(context, this.title, rect.x + PAD_X * sx, rect.y + PAD_Y * sy,
            rect.w - PAD_X * 2 * sx, HEADER_HEIGHT * sy, TITLE, sx, sy);
        rows.forEach((row, index) => this.drawText(
            context,
            row,
            rect.x + PAD_X * sx,
            rect.y + (PAD_Y + HEADER_HEIGHT + index * LINE_HEIGHT) * sy,
            rect.w - PAD_X * 2 * sx,
            LINE_HEIGHT * sy,
            TEXT,
            sx,
            sy,
        ));
        return [rect];
    }

    private drawText(
        context: WidgetOverlayDrawContext,
        text: string,
        x: number,
        y: number,
        width: number,
        height: number,
        color: number,
        sx: number,
        sy: number,
    ): void {
        drawTextGL(context.renderer, context.fontLoader, text, x, y, width, height, FONT_PLAIN_11,
            color, 0, 1, true, 1, undefined, sx, sy);
    }
}
