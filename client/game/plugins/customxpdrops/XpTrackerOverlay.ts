import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { overlayFontsVersion } from "@runelite/client/ui/overlay/OverlayFonts";
import type { FontType } from "@runelite/client/config/FontType";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import type { TextBackground } from "./CustomXpDropsConfig";
import type { CustomXpDropsPlugin } from "./CustomXpDropsPlugin";
import { Pen, statIconSprite, type Rect } from "./drawing";
import { formatXp, OVERALL, trackerAlpha } from "./xpDrops";

const MIN_PROGRESS_BAR_HEIGHT = 3;

type Rgba = [number, number, number, number];

function rgba(argb: number, alpha: number): Rgba {
    const v = argb >>> 0;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, alpha / 255];
}

/**
 * XpTrackerOverlay: the tracked skill's icon and XP (the most recent skill's by default), with
 * an optional progress bar to its goal, fading out once it has lingered.
 */
export class XpTrackerOverlay implements WidgetOverlay {
    readonly movable = { name: "CustomizableXpTrackerOverlay", position: OverlayPosition.TOP_RIGHT };

    constructor(private readonly plugin: CustomXpDropsPlugin) {}

    menuEntries(): OverlayMenuEntry[] {
        return [{ option: "Configure", target: "Customizable XP tracker overlay", onClick: () => this.plugin.openSettings() }];
    }

    private active(): boolean {
        const plugin = this.plugin;
        return plugin.isStarted() && plugin.isLoggedIn() && plugin.config.useXpTracker() === true;
    }

    private alpha(): number {
        const c = this.plugin.config;
        return trackerAlpha(this.plugin.now(), this.plugin.state.lastSkillSetMillis,
            Number(c.xpTrackerClientTicksToLinger()) || 0, c.xpTrackerFadeOut() === true);
    }

    signature(): string {
        if (!this.active()) return "";
        const plugin = this.plugin;
        const c = plugin.config;
        const skill = plugin.state.lastSkill;
        return JSON.stringify([
            skill, plugin.trackerXp(skill), plugin.shouldDraw(), this.alpha(), overlayFontsVersion(),
            skill === OVERALL ? 0 : plugin.trackerGoals(skill), c.xpTrackerFontType(), c.showIconsXpTracker(),
            c.xpTrackerIconSizeOverride(), c.xpTrackerColor(), c.xpTrackerBackground(), c.showXpTrackerProgressBar(),
            c.xpTrackerProgressBarHeight(), c.xpTrackerBorderColor(),
        ]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        if (!this.active()) return [];
        const plugin = this.plugin;
        const c = plugin.config;
        const skill = plugin.state.lastSkill;
        const xp = plugin.trackerXp(skill);
        const text = formatXp(xp);
        const measure = new Pen(context, c.xpTrackerFontType() as FontType, 1);
        const icon = this.iconSize(measure, skill);
        // The box: icon, gap, the number at its widest; the bar under it.
        const textWidth = measure.monospacedWidth(text);
        const width = (icon ? icon.w + 5 : 0) + textWidth;
        const lineHeight = Math.max(measure.height, icon?.h ?? 0);
        const showBar = c.showXpTrackerProgressBar() === true && skill !== OVERALL;
        const barHeight = Math.max(MIN_PROGRESS_BAR_HEIGHT, Number(c.xpTrackerProgressBarHeight()) || 0);
        const height = lineHeight + (showBar ? barHeight + 1 : 0);
        const at = context.place(this, width, plugin.shouldDraw() ? height : measure.height);
        if (!at) return [];
        const rects: Rect[] = [{ x: at.x, y: at.y, w: width * at.scaleX, h: height * at.scaleY }];
        if (!plugin.shouldDraw()) return rects;

        const pen = new Pen(context, c.xpTrackerFontType() as FontType, at.scaleX);
        const alpha = this.alpha();
        const X = (u: number) => at.x + u * at.scaleX;
        const Y = (u: number) => at.y + u * at.scaleY;
        if (icon) pen.icon(statIconSprite(pen, skill), X(0), Y(0), icon.w, icon.h, alpha / 255, false);
        const imageWidth = icon ? icon.w + 5 : 0;
        // Right-aligned in the widest number's width, so the digits don't jump as they change.
        const color = (Number(c.xpTrackerColor()) >>> 0);
        pen.text([{ text, color }], X(imageWidth + textWidth - pen.width(text)), Y(pen.ascent), alpha,
            c.xpTrackerBackground() as TextBackground);

        if (showBar) {
            const { start, end } = plugin.trackerGoals(skill);
            this.drawProgressBar(context, X(0), Y(lineHeight + 1), width * at.scaleX, barHeight, at.scaleY, start, end, xp, alpha);
        }
        return rects.concat(pen.rects);
    }

    /** The icon's size in layout units (XpTrackerOverlay.drawIcon), none with icons off. */
    private iconSize(pen: Pen, skill: number): { w: number; h: number } | undefined {
        const c = this.plugin.config;
        if (c.showIconsXpTracker() !== true) return undefined;
        const size = pen.spriteSize(statIconSprite(pen, skill));
        if (!size) return undefined;
        const override = Number(c.xpTrackerIconSizeOverride()) || 0;
        const s = Math.max(override > 0 ? override : pen.height, 18);
        return { w: Math.trunc((size.w * s) / 25), h: Math.trunc((size.h * s) / 25) };
    }

    /** drawProgressBar: a border, black behind, and red to green as the goal nears. */
    private drawProgressBar(context: WidgetOverlayDrawContext, x: number, y: number, width: number, barHeight: number,
        k: number, start: number, end: number, current: number, alpha: number): void {
        end = Math.max(start, end);
        current = Math.max(start, Math.min(end, current));
        if (start < 0 || end < 0 || start === end) return;
        const ratio = end - start > 0 ? Math.max(0, current - start) / (end - start) : 1;
        const glr: any = context.renderer;
        const border = Number(this.plugin.config.xpTrackerBorderColor()) >>> 0;
        glr.drawRect(x, y, width, (barHeight + 2) * k, rgba(border, alpha));
        glr.drawRect(x + k, y + k, width - 2 * k, barHeight * k, [0, 0, 0, alpha / 255]);
        const fill: Rgba = [(255 - 130 * ratio) / 255, (255 * ratio) / 255, 0, alpha / 255];
        glr.drawRect(x + 2 * k, y + 2 * k, Math.trunc(ratio * (width / k - 4)) * k, (barHeight - 2) * k, fill);
    }
}
