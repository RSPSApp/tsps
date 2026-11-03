import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { skillIconSprite } from "../../../rs/skill/skillIcons";
import { SKILL_NAME, type SkillId } from "../../../rs/skill/skills";
import { FONT_PLAIN_11, FONT_PLAIN_12 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { BoostsPlugin } from "./BoostsPlugin";

type Rgba = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];
/** RuneLite's ComponentConstants.STANDARD_BACKGROUND_COLOR and the panel outline. */
const BACKGROUND = rgba(70, 61, 50, 156);
const OUTLINE = rgba(56, 48, 35, 255);
const BUFFED = rgba(0, 200, 0);
const DEBUFFED = rgba(238, 51, 51);
const WHITE = 0xffffff;
/** Color.RED.brighter(). */
const RED_BRIGHTER = 0xff0000;
const INFOBOX_SIZE = 35;
const INFOBOX_GAP = 2;
const INFOBOX_ICON = 25;
const PANEL_WIDTH = 129;
const PANEL_BORDER = 4;
const LINE_HEIGHT = 15;
const COMPACT_ICON = 16;
/** CompactBoostsOverlay's H_PADDING, V_PADDING and TEXT_WIDTH. */
const H_PADDING = 2;
const V_PADDING = 1;
const TEXT_WIDTH = 22;

/** One row of an overlay: a skill (or a buff/debuff arrow) and its text. */
type Entry = { skill?: SkillId; arrow?: "up" | "down"; text: string; color: number; tooltip: string };

function menuEntries(plugin: BoostsPlugin): OverlayMenuEntry[] {
    return [{ option: "Configure", target: "Boosts overlay", onClick: () => plugin.openSettings() }];
}

/** The skill rows, then the debuff and buff restore timers (RuneLite's infobox and compact order). */
function entries(plugin: BoostsPlugin): Entry[] {
    const skills: Entry[] = [];
    for (const skill of plugin.skillsToDisplay) {
        const boost = plugin.getBoostedSkillLevel(skill) - plugin.getRealSkillLevel(skill);
        if (boost === 0) continue;
        skills.push({ skill, text: plugin.boostText(skill), color: plugin.textColor(boost), tooltip: `${SKILL_NAME[skill]} boost` });
    }
    const timers: Entry[] = [];
    const up = plugin.getChangeUpTicks();
    if (up !== -1) {
        timers.push({ arrow: "down", text: String(plugin.getChangeTime(up)).padStart(2, "0"), color: up < 10 ? RED_BRIGHTER : WHITE, tooltip: "Next debuff change" });
    }
    const down = plugin.getChangeDownTicks();
    if (down !== -1) {
        timers.push({ arrow: "up", text: String(plugin.getChangeTime(down)).padStart(2, "0"), color: down < 10 ? RED_BRIGHTER : WHITE, tooltip: "Next buff change" });
    }
    return [...skills, ...timers];
}

function drawIcon(context: WidgetOverlayDrawContext, entry: Entry, x: number, y: number, size: number): void {
    const glr = context.renderer as any;
    if (entry.skill !== undefined) {
        const icon = context.sprite(skillIconSprite(entry.skill));
        if (!icon) return;
        const fit = Math.min(size / icon.w, size / icon.h);
        const w = icon.w * fit, h = icon.h * fit;
        glr.drawTexture(icon, x + (size - w) / 2, y + (size - h) / 2, w, h);
        return;
    }
    // RuneLite's buffed.png / debuffed.png: an arrow up or down.
    const m = size * 0.2;
    const points: [number, number][] = entry.arrow === "up"
        ? [[x + size / 2, y + m], [x + size - m, y + size - m], [x + m, y + size - m]]
        : [[x + m, y + m], [x + size - m, y + m], [x + size / 2, y + size - m]];
    glr.drawPolygon?.(points, entry.arrow === "up" ? BUFFED : DEBUFFED);
}

function text(context: WidgetOverlayDrawContext, value: string, x: number, y: number, w: number, h: number,
    color: number, xAlign: number, yAlign: number, sx: number, sy: number, font = FONT_PLAIN_11): void {
    drawTextGL(context.renderer, context.fontLoader, value, x, y, w, h, font, color, xAlign, yAlign, true, 1, undefined, sx, sy);
}

function frame(context: WidgetOverlayDrawContext, r: Rect, sx: number, sy: number): void {
    const glr = context.renderer;
    glr.drawRect(r.x, r.y, r.w, r.h, BACKGROUND);
    glr.drawRect(r.x, r.y, r.w, sy, OUTLINE);
    glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, OUTLINE);
    glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
    glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, OUTLINE);
}

/**
 * RuneLite's BoostIndicator and StatChangeIndicator infoboxes, as one movable row: the skill
 * icon with its level (or relative boost), then the buff and debuff restore timers.
 */
export class BoostsInfoBoxOverlay implements WidgetOverlay {
    readonly movable = { name: "BoostsInfoBoxOverlay", position: OverlayPosition.TOP_LEFT };

    constructor(private readonly plugin: BoostsPlugin) {}

    menuEntries(): OverlayMenuEntry[] {
        return menuEntries(this.plugin);
    }

    private entries(): Entry[] {
        if (!this.plugin.isStarted() || this.plugin.config.displayInfoboxes() !== true) return [];
        return entries(this.plugin);
    }

    signature(): string {
        const list = this.entries();
        return list.length === 0 ? "" : JSON.stringify(list.map((e) => [e.skill ?? e.arrow, e.text, e.color]));
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const list = this.entries();
        if (list.length === 0) return [];
        const width = list.length * INFOBOX_SIZE + (list.length - 1) * INFOBOX_GAP;
        const at = context.place(this, width, INFOBOX_SIZE);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const rects: Rect[] = [];
        list.forEach((entry, i) => {
            const r = { x: at.x + i * (INFOBOX_SIZE + INFOBOX_GAP) * sx, y: at.y, w: INFOBOX_SIZE * sx, h: INFOBOX_SIZE * sy };
            frame(context, r, sx, sy);
            const pad = ((INFOBOX_SIZE - INFOBOX_ICON) / 2) * sx;
            drawIcon(context, entry, r.x + pad, r.y + 2 * sy, INFOBOX_ICON * sx);
            text(context, entry.text, r.x, r.y + r.h - 13 * sy, r.w, 12 * sy, entry.color, 1, 1, sx, sy);
            rects.push(r);
        });
        return rects;
    }
}

/** RuneLite's BoostsOverlay: a panel of restore timers and "boosted/base" per skill. */
export class BoostsPanelOverlay implements WidgetOverlay {
    readonly movable = { name: "BoostsOverlay", position: OverlayPosition.TOP_LEFT };

    constructor(private readonly plugin: BoostsPlugin) {}

    menuEntries(): OverlayMenuEntry[] {
        return menuEntries(this.plugin);
    }

    /** [left, right parts with colours]. */
    private lines(): [string, [string, number][]][] {
        const plugin = this.plugin;
        if (!plugin.isStarted() || plugin.config.displayPanel() !== true) return [];
        const lines: [string, [string, number][]][] = [];
        const down = plugin.getChangeDownTicks();
        if (down !== -1) lines.push(["Next + restore in", [[String(plugin.getChangeTime(down)), WHITE]]]);
        const up = plugin.getChangeUpTicks();
        if (up !== -1) lines.push(["Next - restore in", [[String(plugin.getChangeTime(up)), WHITE]]]);
        for (const skill of plugin.skillsToDisplay) {
            const boosted = plugin.getBoostedSkillLevel(skill);
            const base = plugin.getRealSkillLevel(skill);
            const boost = boosted - base;
            const color = plugin.textColor(boost);
            if (plugin.config.useRelativeBoost() === true) {
                lines.push([SKILL_NAME[skill], [[boost > 0 ? `+${boost}` : String(boost), color]]]);
            } else {
                lines.push([SKILL_NAME[skill], [[String(boosted), color], [`/${base}`, WHITE]]]);
            }
        }
        return lines;
    }

    signature(): string {
        const lines = this.lines();
        return lines.length === 0 ? "" : JSON.stringify(lines);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const lines = this.lines();
        if (lines.length === 0) return [];
        const height = 2 * PANEL_BORDER + lines.length * LINE_HEIGHT;
        const at = context.place(this, PANEL_WIDTH, height);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const r = { x: at.x, y: at.y, w: PANEL_WIDTH * sx, h: height * sy };
        frame(context, r, sx, sy);
        const font = context.fontLoader(FONT_PLAIN_12);
        const innerX = r.x + PANEL_BORDER * sx;
        const innerW = r.w - 2 * PANEL_BORDER * sx;
        lines.forEach(([left, right], i) => {
            const y = r.y + (PANEL_BORDER + i * LINE_HEIGHT) * sy;
            const h = LINE_HEIGHT * sy;
            text(context, left, innerX, y, innerW, h, WHITE, 0, 1, sx, sy, FONT_PLAIN_12);
            // Right-aligned, last part first.
            let end = innerX + innerW;
            for (let p = right.length - 1; p >= 0; p--) {
                const [value, color] = right[p];
                const w = (font ? font.measure(value) : value.length * 7) * sx;
                text(context, value, end - w, y, w, h, color, 0, 1, sx, sy, FONT_PLAIN_12);
                end -= w;
            }
        });
        return [r];
    }
}

/** RuneLite's CompactBoostsOverlay: a small icon and right-justified text per boost and timer. */
export class CompactBoostsOverlay implements WidgetOverlay {
    readonly movable = { name: "CompactBoostsOverlay", position: OverlayPosition.TOP_LEFT };

    constructor(private readonly plugin: BoostsPlugin) {}

    menuEntries(): OverlayMenuEntry[] {
        return menuEntries(this.plugin);
    }

    private entries(): Entry[] {
        if (!this.plugin.isStarted() || this.plugin.config.compactDisplay() !== true) return [];
        return entries(this.plugin);
    }

    signature(): string {
        const list = this.entries();
        return list.length === 0 ? "" : JSON.stringify(list.map((e) => [e.skill ?? e.arrow, e.text, e.color]));
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const list = this.entries();
        if (list.length === 0) return [];
        const row = COMPACT_ICON + V_PADDING;
        const width = COMPACT_ICON + H_PADDING + TEXT_WIDTH;
        const at = context.place(this, width, list.length * row);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        list.forEach((entry, i) => {
            const y = at.y + i * row * sy;
            drawIcon(context, entry, at.x, y, COMPACT_ICON * sx);
            text(context, entry.text, at.x + (COMPACT_ICON + H_PADDING) * sx, y, TEXT_WIDTH * sx, COMPACT_ICON * sy,
                entry.color, 2, 1, sx, sy, FONT_PLAIN_12);
        });
        return [{ x: at.x, y: at.y, w: width * sx, h: list.length * row * sy }];
    }
}
