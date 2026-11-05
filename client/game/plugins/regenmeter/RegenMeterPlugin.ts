import type { Client } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged, GameTick } from "@runelite/api/events";
import { LIGHTBEARER } from "@runelite/api/gameval/ItemID";
import { PRAYER_RAPIDHEAL } from "@runelite/api/gameval/VarbitID";
import { SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier } from "@runelite/client/Notifier";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { SkillId } from "../../../rs/skill/skills";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { OrbComponent, type OrbComponentId, orbBounds } from "../orbWidgets";
import { RegenMeterConfig } from "./RegenMeterConfig";

/** RuneLite's Constants.GAME_TICK_LENGTH. */
const GAME_TICK_LENGTH = 600;
const SPEC_REGEN_TICKS = 50;
const NORMAL_HP_REGEN_TICKS = 100;

type Rgba = [number, number, number, number];
type NotifyClient = { notify(message: string): void };

/** RegenMeterOverlay.brighter: the colour at full saturation and brightness (Color.getHSBColor). */
function brighter(color: number): Rgba {
    const r = (color >>> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
        const d = max - min;
        if (r === max) hue = (g - b) / d;
        else if (g === max) hue = 2 + (b - r) / d;
        else hue = 4 + (r - g) / d;
        hue /= 6;
        if (hue < 0) hue += 1;
    }
    const h = (hue - Math.floor(hue)) * 6;
    const f = h - Math.floor(h);
    const q = Math.trunc(255 * (1 - f) + 0.5), t = Math.trunc(255 * f + 0.5);
    const rgb: [number, number, number][] = [[255, t, 0], [q, 255, 0], [0, 255, t], [0, q, 255], [t, 0, 255], [255, 0, q]];
    const [rr, gg, bb] = rgb[Math.floor(h)];
    return [rr / 255, gg / 255, bb / 255, 1];
}

const HITPOINTS_COLOR = brighter(0x9b0703);
const SPECIAL_COLOR = brighter(0x1e95b0);
const DIAMETER = 26;
const OFFSET = 27;
/** Segments in a full ring; an arc takes its share. */
const RING_SEGMENTS = 64;

/**
 * RuneLite 1.13.5 Regeneration Meter: rings around the hitpoints and special attack orbs filling
 * up to the next hitpoint and the next 10% of special attack, and an optional notification
 * shortly before the next hitpoint.
 */
export class RegenMeterPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Regeneration Meter",
        description: "Track and show the hitpoints and special attack regeneration timers",
        tags: ["combat", "health", "hitpoints", "special", "attack", "overlay", "notifications"],
        configKey: "regenmeterplugin",
    };

    static config = RegenMeterConfig;

    readonly config = inject(ConfigManager).getConfig(RegenMeterConfig);
    private readonly client: Client;
    private readonly notifier: NotifyClient;
    private readonly wornItems: () => number[];
    private readonly osrsClient?: OsrsClient;
    private hitpointsPercentage = 0;
    private specialPercentage = 0;
    private ticksSinceSpecRegen = 0;
    private ticksSinceHPRegen = 0;
    private wearingLightbearer = false;
    /** The last Rapid Heal varbit seen, for RuneLite's onVarbitChanged. */
    private rapidHeal = -1;

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => this.overlaySignature(),
        draw: (context) => this.draw(context),
    };

    constructor(client?: Client, notifier?: NotifyClient, wornItems?: () => number[]) {
        super();
        if (client) {
            this.client = client;
        } else {
            this.osrsClient = inject<OsrsClient>(CLIENT_TOKEN);
            this.client = new ClientImpl(this.osrsClient);
        }
        this.notifier = notifier ?? new Notifier(this.osrsClient!);
        const osrsClient = this.osrsClient;
        this.wornItems = wornItems ?? (() => osrsClient?.equipment.getSlots().map((slot) => slot.itemId) ?? []);
    }

    getHitpointsPercentage(): number {
        return this.hitpointsPercentage;
    }

    getSpecialPercentage(): number {
        return this.specialPercentage;
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state === GameState.HOPPING || state === GameState.LOGIN_SCREEN) {
            this.ticksSinceHPRegen = -2; // For some reason this makes this accurate
            this.ticksSinceSpecRegen = 0;
        }
    }

    /** RuneLite's onItemContainerChanged for the worn items, polled each tick. */
    private updateLightbearer(): void {
        const hasLightbearer = this.wornItems().includes(LIGHTBEARER);
        if (hasLightbearer === this.wearingLightbearer) return;
        // Lightbearer switch preserves time until next spec regen if <25 ticks remain
        // If unequipping Lightbearer, this will always evaluate to 0
        this.ticksSinceSpecRegen = Math.max(0, this.ticksSinceSpecRegen - 25);
        this.wearingLightbearer = hasLightbearer;
    }

    onGameTick(_event?: GameTick): void {
        if (!this.isStarted()) return;
        this.updateLightbearer();
        const rapidHeal = this.client.getVarbitValue(PRAYER_RAPIDHEAL);
        if (this.rapidHeal !== -1 && rapidHeal !== this.rapidHeal) this.ticksSinceHPRegen = 0;
        this.rapidHeal = rapidHeal;

        const ticksPerSpecRegen = this.wearingLightbearer ? SPEC_REGEN_TICKS / 2 : SPEC_REGEN_TICKS;
        if (this.client.getVarpValue(SA_ENERGY) === 1000) {
            // The recharge doesn't tick when at 100%
            this.ticksSinceSpecRegen = 0;
        } else {
            this.ticksSinceSpecRegen = (this.ticksSinceSpecRegen + 1) % ticksPerSpecRegen;
        }
        this.specialPercentage = this.ticksSinceSpecRegen / ticksPerSpecRegen;

        let ticksPerHPRegen = NORMAL_HP_REGEN_TICKS;
        if (rapidHeal === 1) ticksPerHPRegen /= 2;
        this.ticksSinceHPRegen = (this.ticksSinceHPRegen + 1) % ticksPerHPRegen;
        this.hitpointsPercentage = this.ticksSinceHPRegen / ticksPerHPRegen;

        const currentHP = this.client.getBoostedSkillLevel(SkillId.Hitpoints);
        const maxHP = this.client.getRealSkillLevel(SkillId.Hitpoints);
        if (currentHP === maxHP && this.config.showWhenNoChange() !== true) {
            this.hitpointsPercentage = 0;
        } else if (currentHP > maxHP) {
            // Show it going down
            this.hitpointsPercentage = 1 - this.hitpointsPercentage;
        }

        if ((Number(this.config.getNotifyBeforeHpRegenSeconds()) || 0) > 0 && currentHP < maxHP
            && this.shouldNotifyHpRegenThisTick(ticksPerHPRegen)) {
            this.notifier.notify("Your next hitpoint will regenerate soon!");
        }
    }

    private shouldNotifyHpRegenThisTick(ticksPerHPRegen: number): boolean {
        // if the configured duration lies between two ticks, choose the earlier tick
        const ticksBeforeHPRegen = ticksPerHPRegen - this.ticksSinceHPRegen;
        const seconds = Number(this.config.getNotifyBeforeHpRegenSeconds()) || 0;
        const notifyTick = Math.ceil((seconds * 1000) / GAME_TICK_LENGTH);
        return ticksBeforeHPRegen === notifyTick;
    }

    /** The rings to draw: [orb, fraction, colour]. */
    private rings(): [OrbComponentId, number, Rgba][] {
        if (!this.isStarted()) return [];
        const rings: [OrbComponentId, number, Rgba][] = [];
        if (this.config.showHitpoints() === true) rings.push([OrbComponent.ORB_HEALTH, this.hitpointsPercentage, HITPOINTS_COLOR]);
        if (this.config.showSpecial() === true) rings.push([OrbComponent.ORB_SPECENERGY, this.specialPercentage, SPECIAL_COLOR]);
        return rings;
    }

    private overlaySignature(): string {
        const client = this.osrsClient;
        if (!client) return "";
        const parts = this.rings().map(([orb, percent]) => {
            const b = orbBounds(client, orb);
            return b && percent > 0 ? [b.x, b.y, b.w, b.h, percent] : null;
        });
        return parts.some((p) => p) ? JSON.stringify(parts) : "";
    }

    /** RegenMeterOverlay.renderRegen: an arc clockwise from the top, 2 px wide, right of the orb's icon. */
    private draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const client = this.osrsClient;
        if (!client) return [];
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        for (const [orb, percent, color] of this.rings()) {
            const bounds = orbBounds(client, orb);
            if (!bounds || !(percent > 0)) continue;
            const { scaleX: sx, scaleY: sy } = bounds;
            const rx = (DIAMETER / 2) * sx, ry = (DIAMETER / 2) * sy;
            const cx = bounds.x + OFFSET * sx + rx;
            const cy = bounds.y + bounds.h / 2;
            const segments = Math.max(1, Math.ceil(RING_SEGMENTS * percent));
            const points: [number, number][] = [];
            for (let i = 0; i <= segments; i++) {
                const angle = Math.PI / 2 - (2 * Math.PI * percent * i) / segments;
                points.push([cx + rx * Math.cos(angle), cy - ry * Math.sin(angle)]);
            }
            context.renderer.drawPolyline(points, 2 * Math.min(sx, sy), color, false);
            rects.push({ x: cx - rx - 2 * sx, y: cy - ry - 2 * sy, w: 2 * rx + 4 * sx, h: 2 * ry + 4 * sy });
        }
        return rects;
    }
}
