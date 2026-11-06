import type { Color } from "@runelite/awt/Color";
import { type Dimension } from "@runelite/awt/Shapes";
import { type Graphics2D, RecordingGraphics2D } from "@runelite/awt/Graphics2D";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../../../../game/plugins/ClientPluginManager";
import { ComponentConstants } from "./components/ComponentConstants";
import { PanelComponent } from "./components/PanelComponent";
import { type DrawnRect, GLGraphics2D } from "./GLGraphics2D";
import { OverlayPosition } from "./OverlayPosition";

/** A right-click entry on an overlay (RuneLite's OverlayMenuEntry): opcode, option and target. */
export type OverlayPanelMenuEntry = { opcode: number; option: string; target: string; onClick?: () => void };

/** The metrics the signature pass uses: content, not pixel-exact layout, is what changes a frame. */
const SIGNATURE_METRICS = { stringWidth: (text: string) => text.length * 6, getHeight: () => 16 };

/**
 * RuneLite's OverlayPanel as a movable WidgetOverlay: subclasses fill `panelComponent` in
 * `render(graphics)` and return `super.render(graphics)`. The panel is measured, placed at its
 * saved snap corner, then drawn; its children are cleared after each frame as RuneLite does.
 */
export abstract class OverlayPanel implements WidgetOverlay {
    protected readonly panelComponent = new PanelComponent();
    readonly movable: { name: string; position: OverlayPosition };
    private readonly entries: OverlayPanelMenuEntry[] = [];
    private preferredSize: Dimension | null = null;
    private preferredColor: Color | null = null;
    private clearChildren = true;
    /** Draw under the widgets (RuneLite's ABOVE_SCENE layer); panels sit above them. */
    drawBelowWidgets = false;

    protected constructor(name: string, position: OverlayPosition = OverlayPosition.TOP_LEFT) {
        this.movable = { name, position };
    }

    /** Fill the panel for this frame; return `super.render(graphics)` (RuneLite's render contract). */
    render(graphics: Graphics2D): Dimension | null {
        const oldSize = this.panelComponent.getPreferredSize();
        if (this.preferredSize) this.panelComponent.setPreferredSize(this.preferredSize);
        const oldBackground = this.panelComponent.getBackgroundColor();
        if (this.preferredColor && oldBackground && ComponentConstants.STANDARD_BACKGROUND_COLOR.equals(oldBackground)) {
            this.panelComponent.setBackgroundColor(this.preferredColor);
        }
        let dimension: Dimension | null;
        try {
            dimension = this.panelComponent.render(graphics);
        } finally {
            if (this.clearChildren) this.panelComponent.getChildren().length = 0;
        }
        this.panelComponent.setPreferredSize(oldSize);
        this.panelComponent.setBackgroundColor(oldBackground);
        return dimension;
    }

    setPreferredSize(size: Dimension | null): void {
        this.preferredSize = size;
    }

    getPreferredSize(): Dimension | null {
        return this.preferredSize;
    }

    setPreferredColor(color: Color | null): void {
        this.preferredColor = color;
    }

    setClearChildren(clear: boolean): void {
        this.clearChildren = clear;
    }

    addMenuEntry(opcode: number, option: string, target: string, onClick?: () => void): void {
        this.entries.push({ opcode, option, target, onClick });
    }

    removeMenuEntry(opcode: number, option: string, target: string): void {
        const index = this.entries.findIndex((e) => e.opcode === opcode && e.option === option && e.target === target);
        if (index >= 0) this.entries.splice(index, 1);
    }

    menuEntries(): OverlayMenuEntry[] {
        return this.entries.map((e) => ({ option: e.option, target: e.target, onClick: () => e.onClick?.() }));
    }

    // ------------------------------------------------------------------ WidgetOverlay

    signature(): string {
        const recording = new RecordingGraphics2D(SIGNATURE_METRICS);
        const size = this.render(recording);
        return size ? `${this.movable.name}:${recording.signature()}` : "";
    }

    draw(context: WidgetOverlayDrawContext): DrawnRect[] {
        // Render once with the real fonts into a recording, place the panel, then replay the
        // recording at the placement's origin and scale.
        const metricsSource = new GLGraphics2D(context, { x: 0, y: 0, scaleX: 1, scaleY: 1 }, "interface");
        const recording = new RecordingGraphics2D(metricsSource.getFontMetrics(), (font) => metricsSource.getFontMetrics(font));
        recording.setFont(metricsSource.getFont());
        const size = this.render(recording);
        if (!size || size.width <= 0 || size.height <= 0) return [];
        const at = context.place(this, size.width, size.height);
        if (!at) return [];
        recording.replay(new GLGraphics2D(context, { x: at.x, y: at.y, scaleX: at.scaleX, scaleY: at.scaleY }, "interface"));
        return [{ x: at.x, y: at.y, w: size.width * at.scaleX, h: size.height * at.scaleY }];
    }
}
