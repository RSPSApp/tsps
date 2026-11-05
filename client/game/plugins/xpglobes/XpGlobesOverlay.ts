import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import { overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { skillColor } from "../xptracker/skillColor";
import type { XpGlobesPlugin } from "./XpGlobesPlugin";
import { arcPoints, skillProgress, tooltipLines, type TooltipLine, type XpGlobe } from "./xpGlobes";

type Rgba = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

const MINIMUM_STEP = 10;
const PROGRESS_RADIUS_START = 90;
const PROGRESS_BACKGROUND_SIZE = 5;
const TOOLTIP_RECT_SIZE_X = 150;
const GLOBE_ICON_RATIO = 0.65;
const DARK_OVERLAY_COLOR: Rgba = [0, 0, 0, 180 / 255];
/** RuneLite's tooltip panel (ComponentConstants.STANDARD_BACKGROUND_COLOR) and its outline. */
const TOOLTIP_BACKGROUND: Rgba = [70 / 255, 61 / 255, 50 / 255, 156 / 255];
const TOOLTIP_OUTLINE: Rgba = [56 / 255, 48 / 255, 35 / 255, 1];
const TOOLTIP_BORDER = 4;
const LINE_HEIGHT = 16;
const WHITE = 0xffffff;

function argbToRgba(argb: number): Rgba {
    const v = argb >>> 0;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, (v >>> 24 || 255) / 255];
}

/** A globe laid out in overlay units (before scaling). */
type Laid = { globe: XpGlobe; x: number; y: number };

/**
 * RuneLite's XpGlobesOverlay: a movable row (or column) of globes at the top centre, each a
 * background circle, skill icon, outline ring and progress arc; hovering darkens it, shows the
 * percentage and the tooltip, and keeps it from expiring.
 */
export class XpGlobesOverlay implements WidgetOverlay {
    readonly movable = { name: "XpGlobesOverlay", position: OverlayPosition.TOP_CENTER };
    /** Where the overlay was last drawn (device pixels), for hover. */
    private lastPlace?: { x: number; y: number; sx: number; sy: number };

    constructor(private readonly plugin: XpGlobesPlugin) {}

    menuEntries(): OverlayMenuEntry[] {
        return [
            { option: "Configure", target: "XP Globes overlay", onClick: () => this.plugin.openSettings() },
            { option: "Flip", target: "XP Globes overlay", onClick: () => this.plugin.flip() },
        ];
    }

    private size(): number {
        return Math.max(1, Number(this.plugin.config.xpOrbSize()) || 40);
    }

    private arcWidth(): number {
        return Math.max(0, Number(this.plugin.config.progressArcStrokeWidth()) || 0);
    }

    /** RuneLite's layout: globes MINIMUM_STEP apart, the arc's overhang around the edge. */
    private layout(): { laid: Laid[]; width: number; height: number } {
        const globes = this.plugin.globes.globes;
        const size = this.size();
        const offset = Math.ceil(Math.max(PROGRESS_BACKGROUND_SIZE, this.arcWidth()) / 2);
        const vertical = this.plugin.config.alignOrbsVertically() === true;
        let cur = offset;
        const laid: Laid[] = [];
        for (const globe of globes) {
            laid.push(vertical ? { globe, x: offset, y: cur } : { globe, x: cur, y: offset });
            cur += MINIMUM_STEP + size;
        }
        const length = globes.length * (size + offset) + MINIMUM_STEP * (globes.length - 1);
        return vertical
            ? { laid, width: size + offset * 2, height: length }
            : { laid, width: length, height: size + offset * 2 };
    }

    private mouse(): { x: number; y: number } {
        const input: any = (this.plugin.getClient() as any)?.inputManager;
        return { x: Number(input?.mouseX ?? -1), y: Number(input?.mouseY ?? -1) };
    }

    /** The globe under the mouse, by the last drawn position. */
    private hovered(laid: Laid[]): Laid | undefined {
        const at = this.lastPlace;
        if (!at) return undefined;
        const { x: mx, y: my } = this.mouse();
        const r = this.size() / 2;
        return laid.find((l) => {
            const cx = at.x + (l.x + r) * at.sx;
            const cy = at.y + (l.y + r) * at.sy;
            const dx = (mx - cx) / (r * at.sx);
            const dy = (my - cy) / (r * at.sy);
            return dx * dx + dy * dy <= 1;
        });
    }

    signature(): string {
        if (!this.plugin.isStarted() || !this.plugin.isLoggedIn()) return "";
        const { laid } = this.layout();
        if (laid.length === 0) return "";
        const hover = this.hovered(laid);
        const mouse = hover ? this.mouse() : undefined;
        // Hovered with tooltips on: the globe doesn't expire (checked every frame here).
        if (hover && this.plugin.config.enableTooltips()) hover.globe.time = this.plugin.now();
        const c = this.plugin.config;
        return JSON.stringify([
            laid.map((l) => [l.globe.skill, l.globe.currentXp, l.globe.currentLevel, this.plugin.goals(l.globe)]),
            hover?.globe.skill ?? -1, mouse?.x, mouse?.y,
            c.xpOrbSize(), c.progressArcStrokeWidth(), c.alignOrbsVertically(), c.enableCustomArcColor(),
            c.progressArcColor(), c.progressOrbOutLineColor(), c.progressOrbBackgroundColor(), c.enableTooltips(),
        ]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        if (!this.plugin.isStarted() || !this.plugin.isLoggedIn()) return [];
        const { laid, width, height } = this.layout();
        if (laid.length === 0) return [];
        const at = context.place(this, width, height);
        if (!at) return [];
        this.lastPlace = { x: at.x, y: at.y, sx: at.scaleX, sy: at.scaleY };
        const hover = this.hovered(laid);
        const rects: Rect[] = [{ x: at.x - 2, y: at.y - 2, w: width * at.scaleX + 4, h: height * at.scaleY + 4 }];
        for (const l of laid) this.drawGlobe(context, l, l === hover);
        if (hover && this.plugin.config.enableTooltips()) {
            const tip = this.drawTooltip(context, hover.globe);
            if (tip) rects.push(tip);
        }
        return rects;
    }

    private drawGlobe(context: WidgetOverlayDrawContext, l: Laid, hovered: boolean): void {
        const glr: any = context.renderer;
        const at = this.lastPlace!;
        const config = this.plugin.config;
        const size = this.size();
        const r = size / 2;
        const cx = at.x + (l.x + r) * at.sx;
        const cy = at.y + (l.y + r) * at.sy;
        const scale = (at.sx + at.sy) / 2;
        const ellipse = (startDeg: number, extentDeg: number) =>
            arcPoints(0, 0, 1, startDeg, extentDeg).map(([x, y]) => [cx + x * r * at.sx, cy + y * r * at.sy] as [number, number]);
        const circle = ellipse(0, 360).slice(0, -1);
        const { start, end } = this.plugin.goals(l.globe);

        glr.drawPolygon?.(circle, argbToRgba(Number(config.progressOrbBackgroundColor())));

        const icon = context.sprite(skillIconSprite(l.globe.skill));
        const iconSize = (size - this.arcWidth()) * GLOBE_ICON_RATIO;
        if (icon && iconSize > 0) {
            const fit = Math.min(iconSize / icon.w, iconSize / icon.h);
            const w = icon.w * fit * at.sx;
            const h = icon.h * fit * at.sy;
            glr.drawTexture(icon, cx - w / 2, cy - h / 2, w, h);
        }

        if (hovered) {
            glr.drawPolygon?.(circle, DARK_OVERLAY_COLOR);
            if (end > l.globe.currentXp) {
                const text = `${Math.trunc(skillProgress(start, l.globe.currentXp, end))}%`;
                // A TOP_CENTER overlay: the interface font.
                const font = overlayFont("interface");
                const fx = at.sx * font.scale, fy = at.sy * font.scale;
                drawTextGL(context.renderer, context.fontLoader, text, cx - 40 * fx, cy - 8 * fy, 80 * fx,
                    16 * fy, font.id, WHITE, 1, 1, true, 1, undefined, fx, fy);
            }
        }

        glr.drawPolyline?.(circle, PROGRESS_BACKGROUND_SIZE * scale, argbToRgba(Number(config.progressOrbOutLineColor())), true);
        const extent = -(3.6 * skillProgress(start, l.globe.currentXp, end));
        if (Number.isFinite(extent) && extent !== 0) {
            const color = config.enableCustomArcColor()
                ? argbToRgba(Number(config.progressArcColor()))
                : skillColor(l.globe.skill);
            glr.drawPolyline?.(ellipse(PROGRESS_RADIUS_START, Math.max(-360, extent)), this.arcWidth() * scale, color, false);
        }
    }

    /** RuneLite's tooltip: a 150 px panel at the mouse, labels left, values right. */
    private drawTooltip(context: WidgetOverlayDrawContext, globe: XpGlobe): Rect | undefined {
        const config = this.plugin.config;
        const lines: TooltipLine[] = tooltipLines(globe, this.plugin.goals(globe).end, this.plugin.trackerNumbers(globe), {
            showActionsLeft: config.showActionsLeft() === true,
            showXpLeft: config.showXpLeft() === true,
            showXpHour: config.showXpHour() === true,
            showTimeTilGoal: config.showTimeTilGoal() === true,
        });
        const glr: any = context.renderer;
        const at = this.lastPlace!;
        // TooltipManager's tooltip: the tooltip font, its lines growing with it. The width stays.
        const font = overlayFont("tooltip");
        const lineHeight = Math.max(1, Math.round(LINE_HEIGHT * font.scale));
        const fx = at.sx * font.scale, fy = at.sy * font.scale;
        const w = TOOLTIP_RECT_SIZE_X * at.sx;
        const h = (TOOLTIP_BORDER * 2 + lines.length * lineHeight) * at.sy;
        const mouse = this.mouse();
        const canvasW = Number(glr.width) || Infinity;
        const x = Math.max(0, Math.min(mouse.x + 2, canvasW - w));
        const y = Math.max(0, mouse.y - h - 2);
        glr.drawRect(x, y, w, h, TOOLTIP_BACKGROUND);
        glr.drawRect(x, y, w, at.sy, TOOLTIP_OUTLINE);
        glr.drawRect(x, y + h - at.sy, w, at.sy, TOOLTIP_OUTLINE);
        glr.drawRect(x, y, at.sx, h, TOOLTIP_OUTLINE);
        glr.drawRect(x + w - at.sx, y, at.sx, h, TOOLTIP_OUTLINE);
        const innerX = x + TOOLTIP_BORDER * at.sx;
        const innerW = w - 2 * TOOLTIP_BORDER * at.sx;
        lines.forEach((line, i) => {
            const ly = y + (TOOLTIP_BORDER + i * lineHeight) * at.sy;
            const lh = lineHeight * at.sy;
            drawTextGL(context.renderer, context.fontLoader, line.left, innerX, ly, innerW, lh, font.id,
                line.leftColor, 0, 1, true, 1, undefined, fx, fy);
            drawTextGL(context.renderer, context.fontLoader, line.right, innerX, ly, innerW, lh, font.id,
                WHITE, 2, 1, true, 1, undefined, fx, fy);
        });
        return { x, y, w, h };
    }
}
