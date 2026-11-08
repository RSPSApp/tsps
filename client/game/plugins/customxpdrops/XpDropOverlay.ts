import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { overlayFontsVersion } from "@runelite/client/ui/overlay/OverlayFonts";
import type { FontType } from "@runelite/client/config/FontType";
import type { OverlayMenuEntry, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { CenterOn, HorizontalDirection, TextBackground, VerticalDirection } from "./CustomXpDropsConfig";
import type { CustomXpDropsPlugin } from "./CustomXpDropsPlugin";
import { drawIcons, iconsWidth, Pen, plainText, type Rect } from "./drawing";
import { dropBoxSize, dropText, type TargetActor, type TextSettings, XpDropStyle } from "./xpDrops";

/** RuneLite's logical height cap for where text sits over an actor (XpDropSceneOverlay). */
const MAX_TEXT_HEIGHT = 140;
/** A player's logical height. */
const PLAYER_HEIGHT = 200;

/** The settings the drawing reads, once per frame. */
function textSettings(plugin: CustomXpDropsPlugin): TextSettings {
    const c = plugin.config;
    return {
        xpDropPrefix: String(c.xpDropPrefix() ?? ""),
        xpDropSuffix: String(c.xpDropSuffix() ?? ""),
        predictedHitPrefix: String(c.predictedHitPrefix() ?? ""),
        predictedHitSuffix: String(c.predictedHitSuffix() ?? ""),
        predictedHitColorOverride: c.predictedHitColorOverride() === true,
        predictedHitColor: Number(c.predictedHitColor()) >>> 0,
        colors: {
            [XpDropStyle.DEFAULT]: Number(c.xpDropColor()) >>> 0,
            [XpDropStyle.MELEE]: Number(c.xpDropColorMelee()) >>> 0,
            [XpDropStyle.MAGE]: Number(c.xpDropColorMage()) >>> 0,
            [XpDropStyle.RANGE]: Number(c.xpDropColorRange()) >>> 0,
        },
    };
}

/**
 * XpDropOverlay and XpDropSceneOverlay: the drops in flight, in a movable box (top right by
 * default), or over the player (or the target they hit) when attached.
 */
export class XpDropOverlay implements WidgetOverlay {
    /** A movable box only while the drops aren't attached to an actor. */
    get movable(): { name: string; position: OverlayPosition } | undefined {
        return this.attached() ? undefined : { name: "CustomizableXpDropOverlay", position: OverlayPosition.TOP_RIGHT };
    }

    constructor(private readonly plugin: CustomXpDropsPlugin) {}

    get drawBelowWidgets(): boolean {
        return this.attached();
    }

    menuEntries(): OverlayMenuEntry[] {
        return [{ option: "Configure", target: "Customizable XP drops overlay", onClick: () => this.plugin.openSettings() }];
    }

    private attached(): boolean {
        const c = this.plugin.config;
        return c.attachToPlayer() === true || c.attachToTarget() === true;
    }

    private active(): boolean {
        const plugin = this.plugin;
        return plugin.isStarted() && plugin.isLoggedIn() && plugin.config.useCustomizableXpDrops() === true;
    }

    signature(): string {
        if (!this.active()) return "";
        const drawn = this.plugin.shouldDraw()
            ? this.plugin.state.inFlight.filter((drop) => drop.frame >= 0).map((drop) => [
                drop.amount, drop.hit, drop.icons, drop.style, Math.round(drop.xOffset), Math.round(drop.yOffset),
                Math.round(drop.alpha), drop.target?.serverId ?? -1,
            ])
            : [];
        // Attached drops follow actors across the screen: redraw while any is up.
        if (this.attached()) return drawn.length === 0 ? "" : JSON.stringify([drawn, performance.now()]);
        const c = this.plugin.config;
        return JSON.stringify([drawn, overlayFontsVersion(), c.framesPerDrop(), c.xPixelsPerSecond(), c.yPixelsPerSecond(),
            c.xpDropFontType(), c.xDirection(), c.yDirection(), c.xpDropForceCentered(), c.xpDropCenterOn()]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        if (!this.active()) return [];
        return this.attached() ? this.drawAttached(context) : this.drawBox(context);
    }

    /** XpDropOverlay.render: drops move from their corner of a box sized to their travel. */
    private drawBox(context: WidgetOverlayDrawContext): Rect[] {
        const plugin = this.plugin;
        const c = plugin.config;
        const settings = plugin.dropSettings();
        const measure = new Pen(context, c.xpDropFontType() as FontType, 1);
        const { width: totalWidth, height: totalHeight } = dropBoxSize(measure.width("###,###,###"), measure.height, settings);
        const at = context.place(this, totalWidth, totalHeight);
        if (!at) return [];
        const pen = new Pen(context, c.xpDropFontType() as FontType, at.scaleX);
        const rects: Rect[] = [{ x: at.x, y: at.y, w: totalWidth * at.scaleX, h: totalHeight * at.scaleY }];
        if (!plugin.shouldDraw()) return rects;

        const text = textSettings(plugin);
        const background = c.xpDropBackground() as TextBackground;
        const iconSize = Number(c.iconSizeOverride()) || 0;
        const centered = c.xpDropForceCentered() === true;
        const centerOnText = c.xpDropCenterOn() === CenterOn.TEXT;
        const right = c.xDirection() === HorizontalDirection.RIGHT;
        const down = c.yDirection() === VerticalDirection.DOWN;
        const X = (u: number) => at.x + u * at.scaleX;
        const Y = (u: number) => at.y + u * at.scaleY;

        for (const drop of plugin.state.inFlight) {
            if (drop.frame < 0) continue;
            const parts = dropText(drop, text);
            const textWidth = pen.width(plainText(parts));
            const textY = down
                ? drop.yOffset + pen.ascent
                : totalHeight + drop.yOffset + pen.ascent - pen.height;
            const imageY = Y(textY - pen.ascent);
            if (centered) {
                const icons = iconsWidth(pen, drop.icons, iconSize);
                const x = centerOnText
                    ? totalWidth / 2 - textWidth / 2 + drop.xOffset
                    : totalWidth / 2 - (textWidth + icons) / 2 + icons + drop.xOffset;
                pen.text(parts, X(x), Y(textY), drop.alpha, background);
                drawIcons(pen, drop.icons, X(x - 2), imageY, drop.alpha, true, iconSize);
            } else if (right) {
                // Left to right: icons first, then the text.
                const imageWidth = drawIcons(pen, drop.icons, X(drop.xOffset), imageY, drop.alpha, false, iconSize);
                pen.text(parts, X(drop.xOffset + imageWidth), Y(textY), drop.alpha, background);
            } else {
                // Right to left: the text against the right edge, then the icons before it.
                const x = totalWidth + drop.xOffset - textWidth;
                pen.text(parts, X(x), Y(textY), drop.alpha, background);
                drawIcons(pen, drop.icons, X(x - 2), imageY, drop.alpha, true, iconSize);
            }
        }
        return rects.concat(pen.rects);
    }

    /** XpDropSceneOverlay: each drop centred over the player, or the target it was against. */
    private drawAttached(context: WidgetOverlayDrawContext): Rect[] {
        const plugin = this.plugin;
        if (!plugin.shouldDraw()) return [];
        const c = plugin.config;
        const pen = new Pen(context, c.xpDropFontType() as FontType, 1);
        const text = textSettings(plugin);
        const background = c.xpDropBackground() as TextBackground;
        const iconSize = Number(c.iconSizeOverride()) || 0;
        const centerOnText = c.xpDropCenterOn() === CenterOn.TEXT;
        const toTarget = c.attachToTarget() === true;
        const offsetX = Number(c.attachToOffsetX()) || 0;
        const offsetY = Number(c.attachToOffsetY()) || 0;

        for (const drop of plugin.state.inFlight) {
            if (drop.frame < 0) continue;
            const point = this.actorTextPoint(pen, toTarget ? drop.target : undefined);
            if (!point) continue;
            const px = point[0] + offsetX;
            // Up is positive for the offset, as the plugin has it.
            const py = point[1] - offsetY;
            const parts = dropText(drop, text);
            const textWidth = pen.width(plainText(parts));
            let x: number;
            if (centerOnText) {
                x = drop.xOffset + px - textWidth / 2;
            } else {
                const icons = iconsWidth(pen, drop.icons, iconSize);
                x = drop.xOffset + px - (textWidth + icons) / 2 + icons;
            }
            const y = drop.yOffset + py;
            pen.text(parts, x, y, drop.alpha, background);
            drawIcons(pen, drop.icons, x - 2, y - pen.ascent, drop.alpha, true, iconSize);
        }
        return pen.rects;
    }

    /**
     * Actor.getCanvasTextLocation for "x" at min(logical height, 140) above the actor: the
     * local player's, or the target's while it is in the scene (else none, as the plugin skips it).
     */
    private actorTextPoint(pen: Pen, target: TargetActor | undefined): readonly [number, number] | undefined {
        const client: any = this.plugin.getClient();
        const scene = client.sceneGeometry;
        if (!scene) return undefined;
        let x: number, y: number, plane: number, height: number;
        if (target?.type === "npc") {
            const npcs = client.npcEcs;
            const ecsId = npcs.getEcsIdForServer(target.serverId);
            if (ecsId === undefined) return undefined;
            x = npcs.getWorldX(ecsId) / 128;
            y = npcs.getWorldY(ecsId) / 128;
            plane = npcs.getLevel(ecsId) | 0;
            height = scene.npcHeight(npcs.getNpcTypeId(ecsId) | 0);
        } else {
            const players = client.playerEcs;
            const serverId = target?.type === "player" ? target.serverId : client.controlledPlayerServerId | 0;
            const index = players.getIndexForServerId(serverId);
            if (index === undefined) return undefined;
            x = players.getX(index) / 128;
            y = players.getY(index) / 128;
            plane = players.getLevel(index) | 0;
            height = PLAYER_HEIGHT;
        }
        const z = Math.min(Number(height) || 0, MAX_TEXT_HEIGHT) / 128;
        const p = scene.worldToScreen(x, scene.tileHeight(x, y, plane) - z, y);
        if (!p) return undefined;
        return [p[0] - pen.width("x") / 2, p[1] - pen.height / 2 + pen.ascent];
    }
}
